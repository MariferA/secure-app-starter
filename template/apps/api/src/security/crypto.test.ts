import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt } from './encryption';

test('AES-GCM preserves messages, randomizes ciphertext, and binds ownership', () => {
  const key = randomBytes(32);
  const data = { body: 'Synthetic audit event', sender: 'TEST' };
  const encrypted = encrypt(data, key, 'user-a:message-1');
  assert.deepEqual(decrypt(encrypted, key, 'user-a:message-1'), data);
  assert.notEqual(encrypt(data, key, 'user-a:message-1').ciphertext, encrypted.ciphertext);
  assert.throws(() => decrypt(encrypted, key, 'user-b:message-1'));
  assert.throws(() => decrypt(encrypted, randomBytes(32), 'user-a:message-1'));
  const bytes = Buffer.from(encrypted.ciphertext, 'base64');
  bytes[0] = bytes[0]! ^ 1;
  assert.throws(() =>
    decrypt({ ...encrypted, ciphertext: bytes.toString('base64') }, key, 'user-a:message-1'),
  );
  assert.ok(!JSON.stringify(encrypted).includes('Synthetic'));
});
