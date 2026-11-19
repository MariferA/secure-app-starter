import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function encrypt(value: unknown, key: Buffer, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}
export function decrypt(value: ReturnType<typeof encrypt>, key: Buffer, context: string): unknown {
  if (value.version !== 1) throw new Error('Unknown encryption version');
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(value.ciphertext, 'base64')),
      cipher.final(),
    ]).toString('utf8'),
  );
}
