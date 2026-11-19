import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { database } from '../database';
import { decrypt } from '../security/encryption';
import { PolicyError } from '../security/errors';
import { requireSession, SessionError } from '../security/session';
import { auditActions, recordAudit, auditAad } from '../security/audit';
import type { AuditAction, AuditRecord } from '../security/audit';
import type { SecurityConfig } from '../security/config';

const telemetry = z
  .object({
    action: z.literal('ui.navigation'),
    page: z.enum(['workspace', 'security', 'approvals']),
  })
  .strict();
const cursorSchema = z.object({ time: z.iso.datetime(), id: z.uuid() }).strict();
const querySchema = z
  .object({
    scope: z.enum(['account', 'anonymous', 'system']).default('account'),
    cursor: z.string().max(256).optional(),
    action: z.enum(auditActions).optional(),
    outcome: z.enum(['success', 'denied', 'failure']).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  })
  .strict();
export default async function auditRoutes(
  app: FastifyInstance,
  { security }: { security: SecurityConfig },
) {
  app.addHook('preHandler', async (request, reply) => {
    try {
      await requireSession(request);
    } catch (error) {
      if (error instanceof SessionError) return reply.code(401).send({ error: 'Sign in required' });
      throw error;
    }
  });
  app.get('/audit', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid audit filters' });
    const { userId, role } = await requireSession(request);
    if (parsed.data.scope !== 'account' && role !== 'admin')
      throw new PolicyError(
        403,
        'admin_required',
        'Only administrators can view application-wide security events.',
      );
    const { cursor, action, outcome, from, to, scope } = parsed.data;
    const auditOwner = scope === 'account' ? userId : null;
    const scopeActions: AuditAction[] | null =
      scope === 'anonymous'
        ? ['auth.login_started', 'auth.login_failed', 'auth.account_denied']
        : scope === 'system'
          ? ['ops.runtime_started']
          : null;
    if (from && to && from > to) return reply.code(400).send({ error: 'Invalid audit date range' });
    let after;
    if (cursor) {
      try {
        after = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
      } catch {
        return reply.code(400).send({ error: 'Invalid audit cursor' });
      }
    }
    const db = await database.get();
    const filter = {
      ...(scopeActions ? { $and: [{ action: { $in: scopeActions } }] } : {}),
      userId: auditOwner,
      expiresAt: { $gt: new Date() },
      ...(action ? { action } : {}),
      ...(outcome ? { outcome } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { $gte: new Date(from) } : {}),
              ...(to ? { $lt: new Date(to) } : {}),
            },
          }
        : {}),
      ...(after
        ? {
            $or: [
              { createdAt: { $lt: new Date(after.time) } },
              { createdAt: new Date(after.time), _id: { $lt: after.id } },
            ],
          }
        : {}),
    };
    const rows = await db
      .collection<AuditRecord>('audit_events')
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(51)
      .toArray();
    const page = rows.slice(0, 50);
    const last = page.at(-1);
    return {
      events: page.map((row) => ({
        id: row._id,
        action: row.action,
        outcome: row.outcome,
        evidence: row.evidence,
        createdAt: row.createdAt,
        requestId: row.requestId,
        ...(decrypt(row.encrypted, security.dataKey, auditAad(row)) as object),
      })),
      nextCursor:
        rows.length > 50 && last
          ? Buffer.from(
              JSON.stringify({ time: last.createdAt.toISOString(), id: last._id }),
            ).toString('base64url')
          : null,
      retentionDays: security.policy.retentionDays,
    };
  });
  app.post(
    '/activity-events',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = telemetry.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid activity event' });
      const { userId } = await requireSession(request);
      await recordAudit(
        request,
        userId,
        parsed.data.action,
        'success',
        { page: parsed.data.page },
        'client',
      );
      return reply.code(201).send({ success: true });
    },
  );
}
