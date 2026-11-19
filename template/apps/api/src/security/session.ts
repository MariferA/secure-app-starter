import type { FastifyRequest } from 'fastify';
import { database } from '../database';
import { loadSecurity } from './config';
import { accountRole } from './account-access';
import { PolicyError } from './errors';
import { auditedMutation, recordAudit } from './audit';
import { protectAccountWrite } from './account-limits';

export const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const ABSOLUTE_SESSION_MS = 8 * 60 * 60 * 1000;
export interface Session {
  _id: string;
  userId: string;
  expiresAt: Date;
  idleExpiresAt: Date;
  authenticatedAt?: Date;
}
export class SessionError extends Error {}

export async function sessionClaims(request: FastifyRequest) {
  let claims: { id: string; jti: string };
  try {
    claims = await request.jwtVerify<{ id: string; jti: string }>({ onlyCookie: true });
  } catch {
    throw new SessionError('Invalid session');
  }
  if (typeof claims.id !== 'string' || typeof claims.jti !== 'string')
    throw new SessionError('Invalid session');
  return claims;
}

export async function requireSession(request: FastifyRequest) {
  const claims = await sessionClaims(request);
  const db = await database.get();
  const security = loadSecurity();
  let role: 'admin' | 'user';
  try {
    role = await accountRole(db, claims.id, security);
  } catch (error) {
    if (error instanceof PolicyError && error.statusCode === 403) {
      request.auditActor = claims.id;
      request.auditSession = claims.jti;
      await recordAudit(request, claims.id, 'auth.account_denied', 'denied', {
        reason: error.code,
      });
    }
    throw error;
  }
  const now = new Date();
  // Reading/polling a session never extends inactivity expiry.
  const session = await db.collection<Session>('sessions').findOne({
    _id: claims.jti,
    userId: claims.id,
    expiresAt: { $gt: now },
    idleExpiresAt: { $gt: now },
  });
  if (!session) {
    const previous = await db
      .collection<Session>('sessions')
      .findOne({ _id: claims.jti, userId: claims.id });
    request.auditSession = claims.jti;
    await recordAudit(
      request,
      claims.id,
      previous ? 'auth.session_expired' : 'auth.session_invalid',
      'denied',
      { reason: previous ? 'session_expired' : 'session_missing_or_revoked' },
    );
    throw new SessionError('Session expired');
  }
  request.auditActor = claims.id;
  request.auditSession = claims.jti;
  await protectAccountWrite(request, db, claims.id);
  return {
    userId: claims.id,
    role,
    sessionId: claims.jti,
    idleExpiresAt: session.idleExpiresAt,
    expiresAt: session.expiresAt,
    authenticatedAt: session.authenticatedAt,
  };
}

export async function requireRecentSession(request: FastifyRequest) {
  const session = await requireSession(request);
  if (!session.authenticatedAt || Date.now() - session.authenticatedAt.getTime() > 5 * 60 * 1000)
    throw new PolicyError(
      428,
      'reauthentication_required',
      'Sign in with Google again before changing security settings.',
    );
  return session;
}

export async function recordActivity(request: FastifyRequest) {
  const session = await requireSession(request);
  const now = new Date();
  const idleExpiresAt = new Date(
    Math.min(now.getTime() + IDLE_TIMEOUT_MS, session.expiresAt.getTime()),
  );
  return auditedMutation(request, session.userId, 'auth.activity', async (db, transaction) => {
    const result = await db.collection<Session>('sessions').updateOne(
      {
        _id: session.sessionId,
        userId: session.userId,
        expiresAt: { $gt: now },
        idleExpiresAt: { $gt: now },
      },
      { $max: { idleExpiresAt } },
      { session: transaction },
    );
    if (!result.matchedCount) throw new SessionError('Session expired');
    return {
      value: {
        idleExpiresAt: Math.max(idleExpiresAt.getTime(), session.idleExpiresAt.getTime()),
        idleTimeoutMs: IDLE_TIMEOUT_MS,
      },
    };
  });
}
