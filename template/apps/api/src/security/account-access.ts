import type { ClientSession, Db } from 'mongodb';
import type { FastifyRequest } from 'fastify';
import type { SecurityConfig } from './config';
import { assertAllowed } from './policy';
import { PolicyError } from './errors';
import { requireRecentSession, requireSession, SessionError } from './session';

export type AccessStatus = 'pending' | 'approved' | 'rejected' | 'revoked';
export interface AccountRecord {
  googleId: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
  accessStatus?: AccessStatus;
  registrationRequestedAt?: Date;
  accessDecidedAt?: Date;
  accessDecidedBy?: string;
}
export function configuredAdmin(subject: string, security: SecurityConfig, verifiedEmail?: string) {
  try {
    assertAllowed(subject, security.policy, verifiedEmail);
    return true;
  } catch (error) {
    if (error instanceof PolicyError && error.code === 'account_not_allowed') return false;
    throw error;
  }
}
export async function accountRole(
  db: Db,
  subject: string,
  security: SecurityConfig,
  verifiedEmail?: string,
  session?: ClientSession,
): Promise<'admin' | 'user'> {
  const user = await db
    .collection<AccountRecord>('users')
    .findOne({ googleId: subject }, { session });
  const email = verifiedEmail ?? (user?.emailVerified === true ? user.email : undefined);
  // Admin authority comes only from the existing private server allowlist, never
  // from a registration body, OAuth query, JWT role claim or editable DB role.
  if (configuredAdmin(subject, security, email)) return 'admin';
  if (user?.emailVerified === true && user.accessStatus === 'approved') return 'user';
  if (user?.accessStatus)
    throw new PolicyError(
      403,
      `registration_${user.accessStatus}`,
      'Your account does not have approved access.',
    );
  assertAllowed(subject, security.policy, email);
  throw new PolicyError(
    403,
    'account_not_allowed',
    'Register and wait for administrator approval.',
  );
}
export async function requireAdmin(request: FastifyRequest, recent = false) {
  let current;
  try {
    current = recent ? await requireRecentSession(request) : await requireSession(request);
  } catch (error) {
    if (error instanceof SessionError)
      throw new PolicyError(401, 'sign_in_required', 'Sign in is required.');
    throw error;
  }
  if (current.role !== 'admin')
    throw new PolicyError(403, 'admin_required', 'Administrator access is required.');
  return current;
}
