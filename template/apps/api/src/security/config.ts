import { config } from 'dotenv';
import { endpointConfig } from './urls';
import { readFileSync } from 'node:fs';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { accessPolicy } from './policy';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });

export interface SecurityConfig {
  privateKey: string;
  publicKey: string;
  cookieSecret: string;
  dataKey: Buffer;
  origin: string;
  apiUrl: string;
  secureCookies: boolean;
  cookieName: string;
  policy: ReturnType<typeof accessPolicy>;
}
function secret(name: string, filename: string) {
  return readFileSync(
    process.env[name] ||
      fileURLToPath(new URL(`../../../../.secrets/${filename}`, import.meta.url)),
    'utf8',
  ).trim();
}
let cached: SecurityConfig | undefined;
export function loadSecurity(): SecurityConfig {
  if (cached) return cached;
  const privateKey = secret('JWT_PRIVATE_KEY_FILE', 'jwt-private.pem');
  const publicKey = secret('JWT_PUBLIC_KEY_FILE', 'jwt-public.pem');
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength || 0) < 3072)
    throw new Error('RSA keys must be at least 3072 bits');
  const challenge = Buffer.from('__APP_SLUG__-key-validation');
  if (!verify('sha256', challenge, createPublicKey(publicKey), sign('sha256', challenge, key)))
    throw new Error('RSA public/private keys do not match');
  const dataHex = secret('DATA_KEY_FILE', 'data-key');
  const cookieSecret = secret('COOKIE_KEY_FILE', 'cookie-key');
  if (!/^[a-f0-9]{64}$/i.test(dataHex) || cookieSecret.length < 64)
    throw new Error('Invalid encryption/cookie keys');
  const { origin, apiUrl, secureCookies } = endpointConfig(process.env);
  if (process.env.NODE_ENV === 'production' && !secureCookies)
    throw new Error('Production requires HTTPS');
  const policy = accessPolicy(process.env);
  if (secureCookies && !policy.subjects.length && !policy.emails.length)
    throw new Error('Configure the private Google account allowlist before production startup');
  cached = {
    privateKey,
    publicKey,
    cookieSecret,
    dataKey: Buffer.from(dataHex, 'hex'),
    origin,
    apiUrl,
    secureCookies,
    policy,
    cookieName: secureCookies ? '__Host-__APP_SLUG___session' : '__APP_SLUG___session',
  };
  return cached;
}
