import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setup } from './setup.mjs';
import { publicConfig } from './public-config.mjs';
test('public browser configuration has an explicit allowlist', () => {
  const config = publicConfig(
    {
      API_BASE_URL: 'http://localhost:__API_PORT__/api',
      MONGODB_URI: 'secret-marker',
      GOOGLE_CLIENT_SECRET: 'secret-marker',
      VITE_LEAK: 'secret-marker',
    },
    { name: 'New App', slug: 'new-app' },
  );
  assert.deepEqual(Object.keys(config), ['name', 'slug', 'apiUrl', 'description']);
  assert.ok(!JSON.stringify(config).includes('secret-marker'));
  assert.throws(() =>
    publicConfig(
      { API_BASE_URL: 'https://username:secret@example.test/api' },
      { name: 'App', slug: 'app' },
    ),
  );
});
test('setup makes unique private keys, preserves credentials, and refuses partial keys', () => {
  const dirs = [
    mkdtempSync(path.join(tmpdir(), 'starter-keys-')),
    mkdtempSync(path.join(tmpdir(), 'starter-keys-')),
  ];
  try {
    for (const root of dirs) {
      writeFileSync(path.join(root, '.env.example'), 'GOOGLE_CLIENT_SECRET=\n');
      setup(root);
    }
    assert.notEqual(
      readFileSync(path.join(dirs[0], '.secrets/data-key'), 'utf8'),
      readFileSync(path.join(dirs[1], '.secrets/data-key'), 'utf8'),
    );
    const before = readFileSync(path.join(dirs[0], '.secrets/jwt-private.pem'), 'utf8');
    writeFileSync(path.join(dirs[0], '.env'), 'KEEP=existing');
    setup(dirs[0]);
    assert.equal(readFileSync(path.join(dirs[0], '.env'), 'utf8'), 'KEEP=existing');
    assert.equal(readFileSync(path.join(dirs[0], '.secrets/jwt-private.pem'), 'utf8'), before);
    for (const file of readdirSync(path.join(dirs[0], '.secrets')))
      assert.equal(statSync(path.join(dirs[0], '.secrets', file)).mode & 0o777, 0o600);
    unlinkSync(path.join(dirs[0], '.secrets/cookie-key'));
    assert.throws(() => setup(dirs[0]), /Partial key set/);
  } finally {
    dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  }
});
