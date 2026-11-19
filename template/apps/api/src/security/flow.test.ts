import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app';
import { database } from '../database';
import { testDatabase } from './test-database';
import { loadSecurity } from './config';
import { decrypt, encrypt } from './encryption';
import { auditAad, type AuditRecord } from './audit';
import { endpointConfig } from './urls';
import { once } from 'node:events';
const directory = mkdtempSync(join(tmpdir(), 'starter-security-'));
const pair = generateKeyPairSync('rsa', {
  modulusLength: 3072,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
for (const [env, name, value] of [
  ['JWT_PRIVATE_KEY_FILE', 'private', pair.privateKey],
  ['JWT_PUBLIC_KEY_FILE', 'public', pair.publicKey],
  ['COOKIE_KEY_FILE', 'cookie', randomBytes(32).toString('hex')],
  ['DATA_KEY_FILE', 'data', randomBytes(32).toString('hex')],
]) {
  const file = join(directory, name!);
  writeFileSync(file, value!, { mode: 0o600 });
  process.env[env!] = file;
}
Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: '',
  FRONTEND_URL: 'http://localhost:__WEB_PORT__',
  API_BASE_URL: 'http://localhost:__API_PORT__/api',
  GOOGLE_ALLOWED_SUBJECTS: 'owner-a,owner-b',
  GOOGLE_ALLOWED_EMAILS: '',
  TRUSTED_PROXY_CIDRS: '',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
});
after(() => rmSync(directory, { recursive: true, force: true }));
async function fixture(google = false, profile?: Record<string, unknown>) {
  process.env.GOOGLE_CLIENT_ID = google ? 'synthetic-client' : '';
  process.env.GOOGLE_CLIENT_SECRET = google ? 'synthetic-secret' : '';
  const data = testDatabase(),
    app = buildApp();
  let restoreFetch: (() => void) | undefined;
  if (profile) {
    app.addHook('onRequest', async (request) => {
      if (request.url.startsWith('/api/auth/google/callback'))
        request.server.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow = async () =>
          ({ token: { access_token: 'synthetic-provider-token' } }) as any;
    });
    const fetchMock = mock.method(
      globalThis,
      'fetch',
      async () => new Response(JSON.stringify(profile), { status: 200 }),
    );
    restoreFetch = () => fetchMock.mock.restore();
  }
  await app.ready();
  const get = mock.method(database, 'get', async () => data.fake),
    transaction = mock.method(database, 'transaction', data.transaction);
  function headers(userId = 'owner-a', fresh = true) {
    const sid = randomUUID();
    data.table('users').set(userId, {
      _id: userId,
      googleId: userId,
      email: userId + '@example.test',
      emailVerified: true,
      name: userId,
      ...(userId.startsWith('member') ? { accessStatus: 'approved' } : {}),
    });
    data.table('sessions').set(sid, {
      _id: sid,
      userId,
      authenticatedAt: new Date(Date.now() - (fresh ? 0 : 360000)),
      expiresAt: new Date(Date.now() + 3600000),
      idleExpiresAt: new Date(Date.now() + 600000),
    });
    return {
      origin: 'http://localhost:__WEB_PORT__',
      cookie: loadSecurity().cookieName + '=' + app.jwt.sign({ id: userId, jti: sid }),
    };
  }
  return {
    ...data,
    app,
    headers,
    async close() {
      await app.close();
      restoreFetch?.();
      get.mock.restore();
      transaction.mock.restore();
      process.env.GOOGLE_CLIENT_ID = '';
      process.env.GOOGLE_CLIENT_SECRET = '';
    },
  };
}
test('protected endpoints reject unauthenticated requests and bearer-only JWTs', async () => {
  const f = await fixture();
  try {
    for (const url of [
      '/api/auth/me',
      '/api/auth/sessions',
      '/api/audit',
      '/api/admin/registrations',
    ])
      assert.equal((await f.app.inject({ url })).statusCode, 401);
    const h = f.headers();
    const token = h.cookie.split('=')[1];
    assert.equal(
      (await f.app.inject({ url: '/api/auth/me', headers: { authorization: 'Bearer ' + token } }))
        .statusCode,
      401,
    );
  } finally {
    await f.close();
  }
});
test('Origin is mandatory for mutations and GET polling never extends idle expiry', async () => {
  const f = await fixture();
  try {
    const headers = f.headers();
    const before = [...f.table('sessions').values()][0].idleExpiresAt.getTime();
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/auth/activity',
          headers: { cookie: headers.cookie },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/auth/activity',
          headers: { ...headers, origin: 'https://attacker.test' },
        })
      ).statusCode,
      403,
    );
    for (let i = 0; i < 3; i++)
      assert.equal((await f.app.inject({ url: '/api/auth/me', headers })).statusCode, 200);
    assert.equal([...f.table('sessions').values()][0].idleExpiresAt.getTime(), before);
  } finally {
    await f.close();
  }
});
test('expired sessions and revoked approvals are rejected immediately', async () => {
  const f = await fixture();
  try {
    const headers = f.headers('member-a');
    [...f.table('sessions').values()][0].idleExpiresAt = new Date(Date.now() - 1000);
    assert.equal((await f.app.inject({ url: '/api/auth/me', headers })).statusCode, 401);
    const fresh = f.headers('member-b');
    f.table('users').get('member-b')!.accessStatus = 'revoked';
    assert.equal((await f.app.inject({ url: '/api/auth/me', headers: fresh })).statusCode, 401);
  } finally {
    await f.close();
  }
});
test('audit and sessions stay account-scoped; members cannot view admin scopes or change access', async () => {
  const f = await fixture();
  try {
    const a = f.headers(),
      b = f.headers('owner-b');
    await f.app.inject({ url: '/api/auth/me', headers: b });
    const own = await f.app.inject({ url: '/api/audit', headers: a });
    assert.equal(own.statusCode, 200);
    assert.ok(own.json().events.every((row: any) => !JSON.stringify(row).includes('owner-b')));
    assert.equal(
      (await f.app.inject({ url: '/api/auth/sessions', headers: a })).json().sessions.length,
      1,
    );
    const member = f.headers('member-a');
    assert.equal(
      (await f.app.inject({ url: '/api/audit?scope=system', headers: member })).statusCode,
      403,
    );
    assert.equal(
      (await f.app.inject({ url: '/api/admin/registrations', headers: member })).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/admin/registrations/member-a/decision',
          headers: member,
          payload: { decision: 'approve', confirm: true },
        })
      ).statusCode,
      403,
    );
  } finally {
    await f.close();
  }
});
test('revocation requires recent sign-in and explicit confirmation, then removes only owner sessions', async () => {
  const f = await fixture();
  try {
    const stale = f.headers('owner-a', false);
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/auth/sessions/revoke-all',
          headers: stale,
          payload: { confirm: true },
        })
      ).statusCode,
      428,
    );
    const headers = f.headers();
    f.headers('owner-b');
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/auth/sessions/revoke-all',
          headers,
          payload: {},
        })
      ).statusCode,
      400,
    );
    const result = await f.app.inject({
      method: 'POST',
      url: '/api/auth/sessions/revoke-all',
      headers,
      payload: { confirm: true },
    });
    assert.equal(result.statusCode, 200);
    assert.ok([...f.table('sessions').values()].every((row) => row.userId === 'owner-b'));
    assert.match(result.headers['set-cookie'] as string, /HttpOnly/);
  } finally {
    await f.close();
  }
});
test('audit failure rolls back access changes and session deletion', async () => {
  const f = await fixture();
  try {
    const headers = f.headers();
    f.headers('member-a');
    f.setAuditFailure(true);
    const result = await f.app.inject({
      method: 'POST',
      url: '/api/admin/registrations/member-a/decision',
      headers,
      payload: { decision: 'revoke', confirm: true },
    });
    assert.equal(result.statusCode, 503);
    assert.equal(f.table('users').get('member-a')!.accessStatus, 'approved');
    assert.ok([...f.table('sessions').values()].some((s) => s.userId === 'member-a'));
  } finally {
    await f.close();
  }
});
test('approved access can be revoked atomically, and configured administrators are protected', async () => {
  const f = await fixture();
  try {
    const headers = f.headers();
    const member = f.headers('member-a');
    f.headers('owner-b');
    f.table('users').get('owner-b')!.accessStatus = 'approved';
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/admin/registrations/owner-b/decision',
          headers,
          payload: { decision: 'revoke', confirm: true },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/admin/registrations/member-a/decision',
          headers,
          payload: { decision: 'revoke', confirm: true },
        })
      ).statusCode,
      200,
    );
    assert.equal((await f.app.inject({ url: '/api/auth/me', headers: member })).statusCode, 401);
    assert.ok(
      [...f.table('audit_events').values()].some((r) => r.action === 'admin.registration_decided'),
    );
  } finally {
    await f.close();
  }
});
test('browser telemetry cannot forge server actions or arbitrary page/body data', async () => {
  const f = await fixture();
  try {
    const headers = f.headers();
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/activity-events',
          headers,
          payload: { action: 'auth.login_succeeded', page: 'workspace' },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/activity-events',
          headers,
          payload: { action: 'ui.navigation', page: 'workspace', token: 'do-not-log' },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/activity-events',
          headers,
          payload: { action: 'ui.navigation', page: 'workspace' },
        })
      ).statusCode,
      201,
    );
    const event = [...f.table('audit_events').values()].find((r) => r.action === 'ui.navigation')!;
    assert.equal(event.evidence, 'client');
    assert.ok(!JSON.stringify(event).includes('workspace'));
    const detail = decrypt(
      event.encrypted,
      loadSecurity().dataKey,
      auditAad(event as AuditRecord),
    ) as any;
    assert.equal(detail.page, 'workspace');
    assert.throws(() =>
      decrypt(
        event.encrypted,
        loadSecurity().dataKey,
        auditAad({ ...event, action: 'auth.login_succeeded' } as AuditRecord),
      ),
    );
  } finally {
    await f.close();
  }
});
test('malformed audit cursors and scope escalation fail closed', async () => {
  const f = await fixture();
  try {
    const headers = f.headers();
    assert.equal(
      (await f.app.inject({ url: '/api/audit?cursor=broken', headers })).statusCode,
      400,
    );
    assert.equal(
      (await f.app.inject({ url: '/api/audit?userId=owner-b', headers })).statusCode,
      400,
    );
  } finally {
    await f.close();
  }
});
test('Google authorize flow uses signed state, PKCE S256 and exact callback; invalid callbacks create no session', async () => {
  const f = await fixture(true);
  try {
    const res = await f.app.inject({ url: '/api/auth/google' });
    assert.equal(res.statusCode, 302);
    const url = new URL(res.headers.location!);
    assert.equal(url.hostname, 'accounts.google.com');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('state'));
    assert.ok(url.searchParams.get('code_challenge'));
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'http://localhost:__API_PORT__/api/auth/google/callback',
    );
    assert.match(JSON.stringify(res.headers['set-cookie']), /HttpOnly/);
    const bad = await f.app.inject({
      url: '/api/auth/google/callback?code=synthetic&state=invalid',
    });
    assert.equal(bad.statusCode, 302);
    assert.match(bad.headers.location!, /auth_failed/);
    assert.equal(f.table('sessions').size, 0);
  } finally {
    await f.close();
  }
});
test('HTTPS endpoints use secure origins and reject cross-origin API configuration', () => {
  assert.equal(
    endpointConfig({
      FRONTEND_URL: 'https://app.example.test',
      API_BASE_URL: 'https://api.example.test/api',
    }).secureCookies,
    true,
  );
  assert.throws(() =>
    endpointConfig({
      FRONTEND_URL: 'https://app.example.test',
      API_BASE_URL: 'http://api.example.test/api',
    }),
  );
});
test('AES context prevents ownership and plaintext metadata tampering', () => {
  const key = randomBytes(32),
    message = encrypt({ secret: 'synthetic' }, key, 'owner-a:1');
  assert.throws(() => decrypt(message, key, 'owner-b:1'));
});

test('verified Google sign-in creates only an HttpOnly cookie and records success atomically', async () => {
  const f = await fixture(true, {
    id: 'owner-a',
    email: 'owner@example.test',
    verified_email: true,
    name: 'Synthetic Owner',
  });
  try {
    const response = await f.app.inject({ url: '/api/auth/google/callback?code=synthetic' });
    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, 'http://localhost:__WEB_PORT__/dashboard');
    const cookies = response.cookies;
    const session = cookies.find((c) => c.name === loadSecurity().cookieName);
    assert.ok(session);
    assert.equal(session.httpOnly, true);
    assert.equal(session.sameSite, 'Lax');
    assert.equal(f.table('sessions').size, 1);
    assert.ok(
      [...f.table('audit_events').values()].some((e) => e.action === 'auth.login_succeeded'),
    );
    assert.ok(!response.headers.location!.includes(session.value));
  } finally {
    await f.close();
  }
});
test('unverified Google email and unknown unregistered accounts receive no app session', async () => {
  for (const profile of [
    { id: 'owner-a', email: 'owner@example.test', verified_email: false },
    { id: 'unknown', email: 'unknown@example.test', verified_email: true },
  ]) {
    const f = await fixture(true, profile);
    try {
      const response = await f.app.inject({ url: '/api/auth/google/callback?code=synthetic' });
      assert.equal(response.statusCode, 302);
      assert.ok(!response.cookies.some((c) => c.name === loadSecurity().cookieName && c.value));
      assert.equal(f.table('sessions').size, 0);
    } finally {
      await f.close();
    }
  }
});
test('registration creates a pending record without a session; approval enables a subsequent login', async () => {
  const f = await fixture(true, {
    id: 'new-member',
    email: 'new-member@example.test',
    verified_email: true,
    name: 'Synthetic Member',
  });
  try {
    const start = await f.app.inject({ url: '/api/auth/register' });
    const cookie = start.cookies.map((c) => c.name + '=' + encodeURIComponent(c.value)).join('; ');
    const pending = await f.app.inject({
      url: '/api/auth/google/callback?code=synthetic',
      headers: { cookie },
    });
    assert.equal(pending.headers.location, 'http://localhost:__WEB_PORT__/register?status=pending');
    assert.equal(f.table('sessions').size, 0);
    const row = [...f.table('users').values()].find((r) => r.googleId === 'new-member')!;
    assert.equal(row.accessStatus, 'pending');
    const headers = f.headers();
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/admin/registrations/new-member/decision',
          headers,
          payload: { decision: 'approve', confirm: true },
        })
      ).statusCode,
      200,
    );
    const login = await f.app.inject({ url: '/api/auth/google/callback?code=synthetic' });
    assert.equal(login.headers.location, 'http://localhost:__WEB_PORT__/dashboard');
    assert.ok([...f.table('sessions').values()].some((s) => s.userId === 'new-member'));
  } finally {
    await f.close();
  }
});
test('OAuth sign-in fails without creating a session when the audit write fails', async () => {
  const f = await fixture(true, {
    id: 'owner-a',
    email: 'owner@example.test',
    verified_email: true,
  });
  try {
    f.setAuditFailure(true);
    const response = await f.app.inject({ url: '/api/auth/google/callback?code=synthetic' });
    assert.equal(response.statusCode, 500);
    assert.equal(f.table('sessions').size, 0);
    assert.equal(f.table('users').size, 0);
  } finally {
    await f.close();
  }
});
test('live connections reject foreign origins, bearer-only tokens, and query credentials', async () => {
  const f = await fixture();
  try {
    const headers = f.headers();
    for (const [url, supplied] of [
      ['/api/events', {}],
      ['/api/events', { origin: headers.origin }],
      ['/api/events', { ...headers, origin: 'https://attacker.test' }],
      ['/api/events?token=synthetic', headers],
      [
        '/api/events',
        { origin: headers.origin, authorization: 'Bearer ' + headers.cookie.split('=')[1] },
      ],
    ] as const)
      await assert.rejects(
        f.app.injectWS(url, { headers: supplied, socket: { remoteAddress: '127.0.0.1' } as any }),
      );
  } finally {
    await f.close();
  }
});
test('live connections expire without activity and cannot send application commands', async () => {
  const f = await fixture();
  try {
    const headers = f.headers();
    const row = [...f.table('sessions').values()][0];
    row.idleExpiresAt = new Date(Date.now() + 100);
    const deadline = row.idleExpiresAt.getTime();
    const socket = await f.app.injectWS('/api/events', {
      headers,
      socket: { remoteAddress: '127.0.0.1' } as any,
    });
    assert.equal((await once(socket, 'close'))[0], 4001);
    assert.equal(f.table('sessions').get(row._id)?.idleExpiresAt.getTime(), deadline);
    const readonly = await f.app.injectWS('/api/events', {
      headers: f.headers(),
      socket: { remoteAddress: '127.0.0.1' } as any,
    });
    const closed = once(readonly, 'close');
    readonly.send(JSON.stringify({ action: 'write', owner: 'owner-b' }));
    assert.equal((await closed)[0], 1008);
  } finally {
    await f.close();
  }
});
