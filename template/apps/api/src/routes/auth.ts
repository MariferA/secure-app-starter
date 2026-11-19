import type { FastifyInstance } from 'fastify';
import oauthPlugin, { type OAuth2Namespace } from '@fastify/oauth2';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database } from '../database';
import type { SecurityConfig } from '../security/config';
import {
  requireSession,
  requireRecentSession,
  sessionClaims,
  recordActivity,
  SessionError,
  IDLE_TIMEOUT_MS,
  ABSOLUTE_SESSION_MS,
  type Session,
} from '../security/session';
import { accountRole, configuredAdmin, type AccountRecord } from '../security/account-access';
import { auditedMutation, insertAudit, recordAudit } from '../security/audit';
import { PolicyError } from '../security/errors';
declare module 'fastify' {
  interface FastifyInstance {
    googleOAuth2: OAuth2Namespace;
  }
}
const profileSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  email: z.email(),
  verified_email: z.literal(true),
  name: z.string().max(200).optional(),
  picture: z.url().optional(),
});
export default async function authRoutes(
  app: FastifyInstance,
  { security }: { security: SecurityConfig },
) {
  const cookies = {
    path: '/',
    secure: security.secureCookies,
    httpOnly: true,
    sameSite: 'lax' as const,
  };
  app.get('/auth/config', async () => ({
    googleEnabled: Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.MONGODB_URI,
    ),
    databaseConfigured: Boolean(process.env.MONGODB_URI),
  }));
  app.get('/auth/me', async (request, reply) => {
    try {
      const current = await requireSession(request);
      const db = await database.get();
      const user = await db
        .collection<AccountRecord>('users')
        .findOne({ googleId: current.userId });
      if (!user) return reply.code(401).send({ authenticated: false });
      return {
        authenticated: true,
        user: {
          googleId: user.googleId,
          email: user.email,
          name: user.name,
          picture: user.picture,
          role: current.role,
        },
        idleExpiresAt: current.idleExpiresAt.getTime(),
        idleTimeoutMs: IDLE_TIMEOUT_MS,
        recentAuthentication: Boolean(
          current.authenticatedAt && Date.now() - current.authenticatedAt.getTime() <= 300000,
        ),
      };
    } catch (error) {
      if (
        error instanceof SessionError ||
        (error instanceof PolicyError && error.statusCode === 403)
      )
        return reply.code(401).send({ authenticated: false });
      throw error;
    }
  });
  app.post('/auth/logout', async (request, reply) => {
    try {
      const claims = await sessionClaims(request).catch((error) => {
        if (error instanceof SessionError) return undefined;
        throw error;
      });
      if (claims) {
        request.auditSession = claims.jti;
        await auditedMutation(request, claims.id, 'auth.logout', async (db, session) => {
          await db
            .collection<Session>('sessions')
            .deleteOne({ _id: claims.jti, userId: claims.id }, { session });
          return { value: undefined };
        });
      }
      return { success: true };
    } finally {
      reply.clearCookie(security.cookieName, cookies);
    }
  });
  app.post('/auth/activity', async (request, reply) => {
    const activity = await recordActivity(request);
    reply.setCookie(security.cookieName, request.cookies[security.cookieName]!, {
      ...cookies,
      maxAge: Math.max(1, Math.ceil((activity.idleExpiresAt - Date.now()) / 1000)),
    });
    return activity;
  });
  app.get('/auth/sessions', async (request) => {
    const current = await requireSession(request),
      db = await database.get(),
      now = new Date();
    const rows = await db
      .collection<Session>('sessions')
      .find({ userId: current.userId, expiresAt: { $gt: now }, idleExpiresAt: { $gt: now } })
      .sort({ authenticatedAt: -1 })
      .limit(25)
      .toArray();
    return {
      sessions: rows.map((row) => ({
        current: row._id === current.sessionId,
        authenticatedAt: row.authenticatedAt,
        expiresAt: row.expiresAt,
        idleExpiresAt: row.idleExpiresAt,
      })),
    };
  });
  app.post('/auth/sessions/revoke-all', async (request, reply) => {
    const current = await requireRecentSession(request);
    if (
      !z
        .object({ confirm: z.literal(true) })
        .strict()
        .safeParse(request.body).success
    )
      throw new PolicyError(400, 'confirmation_required', 'Explicit confirmation is required.');
    await auditedMutation(request, current.userId, 'auth.sessions_revoked', async (db, session) => {
      await db.collection<Session>('sessions').deleteMany({ userId: current.userId }, { session });
      return { value: undefined };
    });
    reply.clearCookie(security.cookieName, cookies);
    return { success: true };
  });
  const enabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  if (!enabled) {
    for (const path of ['/auth/google', '/auth/register', '/auth/reauth'])
      app.get(path, async (_request, reply) =>
        reply.redirect(security.origin + '/login?error=google_unavailable'),
      );
    return;
  }
  await app.register(oauthPlugin, {
    name: 'googleOAuth2',
    scope: ['profile', 'email'],
    pkce: 'S256',
    credentials: {
      client: { id: process.env.GOOGLE_CLIENT_ID!, secret: process.env.GOOGLE_CLIENT_SECRET! },
      auth: oauthPlugin.GOOGLE_CONFIGURATION,
    },
    startRedirectPath: '/auth/google',
    callbackUri: security.apiUrl + '/auth/google/callback',
    callbackUriParams: { prompt: 'select_account' },
    cookie: { ...cookies, signed: true, maxAge: 300 },
    hostPrefixedCookies: security.secureCookies,
  });
  const intentCookie = (security.secureCookies ? '__Host-' : '') + '__APP_SLUG___registration';
  const reauthCookie = (security.secureCookies ? '__Host-' : '') + '__APP_SLUG___reauth';
  app.addHook('preHandler', async (request, reply) => {
    if (request.routeOptions.url === '/api/auth/google') {
      reply.clearCookie(intentCookie, cookies);
      reply.clearCookie(reauthCookie, cookies);
      await recordAudit(request, null, 'auth.login_started', 'success');
    }
  });
  app.get('/auth/register', async (request, reply) => {
    reply.clearCookie(reauthCookie, cookies);
    reply.setCookie(intentCookie, 'request', { ...cookies, signed: true, maxAge: 300 });
    await recordAudit(request, null, 'auth.login_started', 'success', {
      reason: 'registration_requested',
    });
    return reply.redirect(await app.googleOAuth2.generateAuthorizationUri(request, reply));
  });
  app.get('/auth/reauth', async (request, reply) => {
    const current = await requireSession(request);
    reply.clearCookie(intentCookie, cookies);
    reply.setCookie(reauthCookie, JSON.stringify({ userId: current.userId, at: Date.now() }), {
      ...cookies,
      signed: true,
      maxAge: 300,
    });
    return reply.redirect(await app.googleOAuth2.generateAuthorizationUri(request, reply));
  });
  app.get('/auth/google/callback', async (request, reply) => {
    let actor: string | null = null;
    try {
      const { token } = await app.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(
        request,
        reply,
      );
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: 'Bearer ' + token.access_token },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Google profile unavailable');
      const user = profileSchema.parse(await response.json());
      actor = user.id;
      const rawIntent = request.cookies[intentCookie],
        intent = rawIntent ? request.unsignCookie(rawIntent) : null;
      reply.clearCookie(intentCookie, cookies);
      if (
        intent?.valid &&
        intent.value === 'request' &&
        !configuredAdmin(user.id, security, user.email)
      ) {
        const status = await database.transaction(async (db, session) => {
          const previous = await db
            .collection<AccountRecord>('users')
            .findOne({ googleId: user.id }, { session });
          if (previous?.accessStatus) return previous.accessStatus;
          const now = new Date();
          await db.collection('users').updateOne(
            { googleId: user.id },
            {
              $set: {
                email: user.email,
                emailVerified: true,
                name: user.name,
                picture: user.picture,
                accessStatus: 'pending',
                registrationRequestedAt: now,
              },
              $setOnInsert: { createdAt: now },
            },
            { upsert: true, session },
          );
          await insertAudit(
            db,
            session,
            request,
            user.id,
            'auth.registration_requested',
            'success',
          );
          return 'pending';
        });
        if (status !== 'approved') {
          reply.clearCookie(security.cookieName, cookies);
          return reply.redirect(security.origin + '/register?status=' + status);
        }
      }
      let reauth = false;
      const rawReauth = request.cookies[reauthCookie];
      reply.clearCookie(reauthCookie, cookies);
      if (rawReauth) {
        const unsigned = request.unsignCookie(rawReauth);
        let previous;
        try {
          previous = unsigned.valid
            ? z.object({ userId: z.string(), at: z.number() }).parse(JSON.parse(unsigned.value!))
            : null;
        } catch {
          previous = null;
        }
        if (
          !previous ||
          previous.userId !== user.id ||
          previous.at > Date.now() ||
          Date.now() - previous.at > 300000
        )
          throw new PolicyError(
            403,
            'reauth_account_mismatch',
            'Reauthenticate with the same Google account.',
          );
        const current = await requireSession(request);
        if (current.userId !== user.id)
          throw new PolicyError(403, 'reauth_account_mismatch', 'Use the same Google account.');
        reauth = true;
      }
      const previousClaims = await sessionClaims(request).catch((error) => {
        if (error instanceof SessionError) return undefined;
        throw error;
      });
      const now = new Date(),
        sid = randomUUID();
      const next: Session = {
        _id: sid,
        userId: user.id,
        authenticatedAt: now,
        expiresAt: new Date(now.getTime() + ABSOLUTE_SESSION_MS),
        idleExpiresAt: new Date(now.getTime() + IDLE_TIMEOUT_MS),
      };
      await database.transaction(async (db, session) => {
        await accountRole(db, user.id, security, user.email, session);
        await db.collection('users').updateOne(
          { googleId: user.id },
          {
            $set: {
              email: user.email,
              emailVerified: true,
              name: user.name,
              picture: user.picture,
              lastLoginAt: now,
            },
            $setOnInsert: { createdAt: now },
          },
          { upsert: true, session },
        );
        if (previousClaims)
          await db
            .collection<Session>('sessions')
            .deleteOne({ _id: previousClaims.jti, userId: previousClaims.id }, { session });
        await db.collection<Session>('sessions').insertOne(next, { session });
        await insertAudit(db, session, request, user.id, 'auth.login_succeeded', 'success');
      });
      if (previousClaims) app.realtime?.disconnect(previousClaims.id, previousClaims.jti);
      const signed = app.jwt.sign({ id: user.id, jti: sid });
      reply.setCookie(security.cookieName, signed, { ...cookies, maxAge: IDLE_TIMEOUT_MS / 1000 });
      return reply.redirect(security.origin + (reauth ? '/dashboard/security' : '/dashboard'));
    } catch (error) {
      const reason = error instanceof PolicyError ? error.code : 'oauth_failed';
      await recordAudit(
        request,
        actor,
        reason === 'account_not_allowed' || reason.startsWith('registration_')
          ? 'auth.account_denied'
          : 'auth.login_failed',
        'denied',
        { reason },
      );
      return reply.redirect(
        security.origin +
          '/login?error=' +
          (reason.startsWith('registration_') ? reason : 'auth_failed'),
      );
    }
  });
}
