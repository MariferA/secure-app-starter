import { z } from 'zod';
import { PolicyError } from './errors';
import { compileCidrs } from './ip';

const csv = (value: string | undefined) =>
  value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean) || [];
export function accessPolicy(env: NodeJS.ProcessEnv) {
  const subjects = csv(env.GOOGLE_ALLOWED_SUBJECTS);
  const emails = csv(env.GOOGLE_ALLOWED_EMAILS).map((value) => value.toLowerCase());
  if (
    subjects.some((value) => !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) ||
    emails.some((value) => !z.email().safeParse(value).success)
  )
    throw new Error('Invalid account allowlist');
  const retentionDays = Number(env.AUDIT_RETENTION_DAYS || 180);
  if (!Number.isInteger(retentionDays) || retentionDays < 30 || retentionDays > 3650)
    throw new Error('Invalid audit retention');
  const proxyCidrs = csv(env.TRUSTED_PROXY_CIDRS);
  const trusted = compileCidrs(proxyCidrs, true);
  return {
    subjects,
    emails,
    retentionDays,
    proxyCidrs,
    trustProxy: (address: string, hop: number) => hop === 0 && trusted(address),
  };
}
export function assertAllowed(
  subject: string,
  policy: ReturnType<typeof accessPolicy>,
  verifiedEmail?: string,
) {
  if (
    policy.subjects.includes(subject) ||
    (verifiedEmail && policy.emails.includes(verifiedEmail.toLowerCase()))
  )
    return;
  throw new PolicyError(
    403,
    'account_not_allowed',
    'This Google account is not approved for this app.',
  );
}
