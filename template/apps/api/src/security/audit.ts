import { createHmac, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { ClientSession, Db } from 'mongodb';
import { database } from '../database';
import { encrypt } from './encryption';
import { loadSecurity } from './config';
import { PolicyError } from './errors';
import { topicsForAction } from '../realtime/broker';

declare module 'fastify' {
  interface FastifyRequest {
    auditActor?: string;
    auditSession?: string;
    auditRecorded?: boolean;
  }
}
export const auditActions = [
  'ops.runtime_started',
  'realtime.connected',
  'realtime.disconnected',
  'auth.profile_viewed',
  'auth.login_started',
  'auth.login_succeeded',
  'auth.login_failed',
  'auth.account_denied',
  'auth.registration_requested',
  'auth.access_changed',
  'admin.registrations_viewed',
  'admin.registration_decided',
  'auth.logout',
  'auth.session_expired',
  'auth.session_invalid',
  'auth.activity',
  'auth.sessions_listed',
  'auth.sessions_revoked',
  'audit.viewed',
  'ui.navigation',
  'api.denied',
] as const;
export type AuditAction = (typeof auditActions)[number];
export type AuditOutcome = 'success' | 'denied' | 'failure';
export interface AuditRecord {
  schemaVersion?: 1;
  _id: string;
  userId: string | null;
  action: AuditAction;
  outcome: AuditOutcome;
  evidence: 'server' | 'client';
  createdAt: Date;
  expiresAt: Date;
  requestId: string;
  encrypted: ReturnType<typeof encrypt>;
}

interface AuditDetail {
  targetId?: string;
  reason?: string;
  page?: string;
  statusCode?: number;
}
export function auditAad(record: Omit<AuditRecord, 'encrypted'>) {
  if (!record.schemaVersion) return `audit:${record.userId || 'unknown'}:${record._id}`;
  return JSON.stringify([
    'audit.v1',
    record.userId,
    record._id,
    record.action,
    record.outcome,
    record.evidence,
    record.createdAt.toISOString(),
    record.expiresAt.toISOString(),
    record.requestId,
  ]);
}

export async function insertAudit(
  db: Db,
  session: ClientSession | undefined,
  request: FastifyRequest,
  userId: string | null,
  action: AuditAction,
  outcome: AuditOutcome,
  detail: AuditDetail = {},
  evidence: 'server' | 'client' = 'server',
) {
  const security = loadSecurity();
  const id = randomUUID();
  const createdAt = new Date();
  const fingerprint = (value: string) =>
    createHmac('sha256', security.cookieSecret).update(value).digest('hex');
  const release = /^[A-Za-z0-9_.-]{1,128}$/.test(process.env.APP_RELEASE || 'local')
    ? process.env.APP_RELEASE || 'local'
    : 'unknown';
  const context = {
    ...detail,
    release,
    ipFingerprint: fingerprint(`ip:${request.ip}`),
    ...(request.auditSession
      ? { sessionFingerprint: fingerprint(`session:${request.auditSession}`) }
      : {}),
  };
  const record: Omit<AuditRecord, 'encrypted'> = {
    schemaVersion: 1,
    _id: id,
    userId,
    action,
    outcome,
    evidence,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + security.policy.retentionDays * 86400000),
    requestId: request.id,
  };
  await db
    .collection<AuditRecord>('audit_events')
    .insertOne(
      { ...record, encrypted: encrypt(context, security.dataKey, auditAad(record)) },
      { session },
    );
}

export async function recordAudit(
  request: FastifyRequest,
  userId: string | null,
  action: AuditAction,
  outcome: AuditOutcome,
  detail: AuditDetail = {},
  evidence: 'server' | 'client' = 'server',
) {
  const db = await database.get();
  await insertAudit(db, undefined, request, userId, action, outcome, detail, evidence);
  request.auditRecorded = true;
  if (
    userId &&
    (action.startsWith('ui.') ||
      ['realtime.disconnected', 'auth.session_expired', 'auth.session_invalid'].includes(action))
  )
    request.server?.realtime?.publish(userId, ['audit']);
}

export async function auditedMutation<T>(
  request: FastifyRequest,
  userId: string,
  action: AuditAction,
  operation: (
    db: Db,
    session: ClientSession,
  ) => Promise<{
    value: T;
    targetId?: string;
    outcome?: AuditOutcome;
    action?: AuditAction;
    reason?: string;
  }>,
): Promise<T> {
  request.auditActor = userId;
  try {
    const value = await database.transaction(async (db, session) => {
      const result = await operation(db, session);
      await insertAudit(
        db,
        session,
        request,
        userId,
        result.action || action,
        result.outcome || 'success',
        {
          targetId: result.targetId,
          reason: result.reason,
        },
      );
      return result.value;
    });
    request.auditRecorded = true;
    request.server.realtime?.publish(userId, topicsForAction(action));
    if (action === 'auth.logout') request.server.realtime?.disconnect(userId, request.auditSession);
    if (action === 'auth.sessions_revoked') request.server.realtime?.disconnect(userId);
    return value;
  } catch (error) {
    try {
      await recordAudit(
        request,
        userId,
        action,
        error instanceof PolicyError && error.statusCode < 500 ? 'denied' : 'failure',
        { reason: error instanceof PolicyError ? error.code : 'transaction_failed' },
      );
    } catch {
      throw new PolicyError(
        503,
        'audit_unavailable',
        'Security history is unavailable. Please try again later.',
      );
    }
    throw error;
  }
}

export async function recordRuntimeStartup() {
  const db = await database.get();
  // A system event, not a claim that a particular person initiated deployment.
  await insertAudit(
    db,
    undefined,
    { id: randomUUID(), ip: 'system' } as FastifyRequest,
    null,
    'ops.runtime_started',
    'success',
  );
}
