import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { database } from '../database';
import { requireAdmin, configuredAdmin, type AccountRecord } from '../security/account-access';
import type { SecurityConfig } from '../security/config';
import { auditedMutation, insertAudit, recordAudit } from '../security/audit';
import { PolicyError } from '../security/errors';
import type { Session } from '../security/session';

export default async function adminRoutes(
  app: FastifyInstance,
  { security }: { security: SecurityConfig },
) {
  app.get('/admin/registrations', async (request) => {
    const admin = await requireAdmin(request);
    const query = z
      .object({
        status: z.enum(['all', 'pending', 'approved', 'rejected', 'revoked']).default('pending'),
        q: z.string().trim().max(100).default(''),
      })
      .strict()
      .safeParse(request.query);
    if (!query.success)
      throw new PolicyError(
        400,
        'invalid_registration_filter',
        'Choose a valid registration status.',
      );
    const db = await database.get();
    const search = new RegExp(query.data.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const users = await db
      .collection<AccountRecord>('users')
      .find(
        {
          accessStatus:
            query.data.status === 'all'
              ? { $in: ['pending', 'approved', 'rejected', 'revoked'] }
              : query.data.status,
          ...(query.data.q ? { $or: [{ name: search }, { email: search }] } : {}),
        },
        {
          projection: {
            googleId: 1,
            name: 1,
            email: 1,
            emailVerified: 1,
            accessStatus: 1,
            registrationRequestedAt: 1,
            accessDecidedAt: 1,
          },
        },
      )
      .sort({ registrationRequestedAt: -1 })
      .limit(101)
      .toArray();
    await recordAudit(request, admin.userId, 'admin.registrations_viewed', 'success', {
      reason: query.data.status,
    });
    return {
      registrations: users
        .slice(0, 100)
        .filter(
          (user) =>
            !configuredAdmin(user.googleId, security, user.emailVerified ? user.email : undefined),
        )
        .map((user) => ({
          id: user.googleId,
          name: user.name || 'Google account',
          email: user.email,
          status: user.accessStatus,
          requestedAt: user.registrationRequestedAt,
          decidedAt: user.accessDecidedAt,
        })),
      hasMore: users.length > 100,
    };
  });
  app.post('/admin/registrations/:id/decision', async (request) => {
    const admin = await requireAdmin(request, true);
    const params = z
      .object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) })
      .safeParse(request.params);
    const input = z
      .object({ decision: z.enum(['approve', 'reject', 'revoke']), confirm: z.literal(true) })
      .strict()
      .safeParse(request.body);
    if (!params.success || !input.success)
      throw new PolicyError(
        400,
        'invalid_access_decision',
        'An explicit registration decision is required.',
      );
    const targetId = params.data.id;
    const decision = input.data.decision;
    const result = await auditedMutation(
      request,
      admin.userId,
      'admin.registration_decided',
      async (db, session) => {
        const target = await db
          .collection<AccountRecord>('users')
          .findOne({ googleId: targetId }, { session });
        if (!target?.accessStatus)
          throw new PolicyError(404, 'registration_missing', 'Registration not found.');
        if (decision === 'approve' && target.emailVerified !== true)
          throw new PolicyError(
            400,
            'verified_identity_required',
            'A verified Google account is required.',
          );
        if (
          targetId === admin.userId ||
          configuredAdmin(targetId, security, target.emailVerified ? target.email : undefined)
        )
          throw new PolicyError(
            403,
            'owner_access_protected',
            'Configured administrators cannot be changed through registration decisions.',
          );
        if (
          (decision === 'revoke' && target.accessStatus !== 'approved') ||
          (decision !== 'revoke' &&
            !['pending', 'revoked', 'rejected'].includes(target.accessStatus))
        )
          throw new PolicyError(
            409,
            'access_status_changed',
            'This registration has changed. Refresh before deciding.',
          );
        const status =
          decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'revoked';
        const updated = await db.collection<AccountRecord>('users').updateOne(
          { googleId: targetId, accessStatus: target.accessStatus },
          {
            $set: {
              accessStatus: status,
              accessDecidedAt: new Date(),
              accessDecidedBy: admin.userId,
            },
          },
          { session },
        );
        if (!updated.matchedCount)
          throw new PolicyError(
            409,
            'access_status_changed',
            'This registration has changed. Refresh before deciding.',
          );
        await db.collection<Session>('sessions').deleteMany({ userId: targetId }, { session });
        await insertAudit(db, session, request, targetId, 'auth.access_changed', 'success', {
          reason: status,
        });
        return { value: { success: true, status }, targetId, reason: status };
      },
    );
    app.realtime?.disconnect(targetId);
    app.realtime?.publish(targetId, ['sessions', 'audit']);
    return result;
  });
}
