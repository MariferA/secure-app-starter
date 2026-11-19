import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export function setup(root) {
  const secrets = path.join(root, '.secrets'),
    names = ['jwt-private.pem', 'jwt-public.pem', 'data-key', 'cookie-key'];
  const existing = names.filter((n) => existsSync(path.join(secrets, n)));
  if (existing.length && existing.length !== names.length)
    throw new Error(
      'Partial key set found. Restore the original key set; setup never rotates existing keys.',
    );
  if (!existing.length) {
    mkdirSync(secrets, { recursive: true, mode: 0o700 });
    chmodSync(secrets, 0o700);
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 3072,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const values = [
      privateKey,
      publicKey,
      randomBytes(32).toString('hex'),
      randomBytes(32).toString('hex'),
    ];
    names.forEach((n, i) =>
      writeFileSync(path.join(secrets, n), values[i], { mode: 0o600, flag: 'wx' }),
    );
  }
  const env = path.join(root, '.env');
  if (!existsSync(env))
    writeFileSync(env, readFileSync(path.join(root, '.env.example')), { mode: 0o600, flag: 'wx' });
  return { createdKeys: !existing.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = setup(fileURLToPath(new URL('../', import.meta.url)));
  console.log(
    result.createdKeys
      ? 'Fresh local keys and .env created. Add your own Google credentials and MongoDB URI to .env.'
      : 'Existing keys and .env preserved.',
  );
}
