import { createHmac } from 'node:crypto';
import type { Db } from 'mongodb';
import type { FastifyRequest } from 'fastify';
import { loadSecurity } from './config';
import { PolicyError } from './errors';
declare module 'fastify' {
  interface FastifyRequest {
    accountWriteBudget?: Promise<void>;
  }
}
export class AccountWriteLimitError extends PolicyError {
  constructor(public retryAfter: number) {
    super(429, 'account_write_limit', 'Too many account changes. Retry later.');
  }
}
export function protectAccountWrite(request: FastifyRequest, db: Db, userId: string) {
  if (
    !['POST', 'PATCH', 'DELETE'].includes(request.method) ||
    ['/api/auth/logout', '/api/auth/sessions/revoke-all'].includes(request.routeOptions.url || '')
  )
    return;
  return (request.accountWriteBudget ??= consume(db, userId));
}
async function consume(db: Db, userId: string) {
  const now = Date.now(),
    window = Math.floor(now / 60000),
    id = createHmac('sha256', loadSecurity().dataKey)
      .update(JSON.stringify(['write.v1', userId, window]))
      .digest('hex');
  const counters = db.collection<{ _id: string; count: number; expiresAt: Date }>('rate_limits');
  const filter = { _id: id, count: { $lt: 60 } },
    update = { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 2) * 60000) } };
  try {
    await counters.updateOne(filter, update, { upsert: true });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
      if ((await counters.updateOne(filter, update, { upsert: false })).matchedCount === 1) return;
      throw new AccountWriteLimitError(Math.max(1, Math.ceil(((window + 1) * 60000 - now) / 1000)));
    }
    throw new PolicyError(503, 'account_limit_unavailable', 'Account protection is unavailable.');
  }
}
