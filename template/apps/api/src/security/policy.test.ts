import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { accessPolicy, assertAllowed } from './policy';
import { compileCidrs } from './ip';
import { auditPrivilegesAreRestricted, runtimePrivileges } from '../maintenance/schema';

test('private account access denies empty/unknown lists and accepts only approved identity', () => {
  assert.throws(() => assertAllowed('unknown', accessPolicy({})));
  const policy = accessPolicy({
    GOOGLE_ALLOWED_SUBJECTS: 'approved',
    GOOGLE_ALLOWED_EMAILS: 'owner@example.test',
  });
  assert.doesNotThrow(() => assertAllowed('approved', policy));
  assert.throws(() => assertAllowed('someone-else', policy));
  assert.doesNotThrow(() => assertAllowed('subject', policy, 'OWNER@example.test'));
  assert.throws(() => accessPolicy({ GOOGLE_ALLOWED_EMAILS: '*@example.test' }));
  assert.throws(() => accessPolicy({ AUDIT_RETENTION_DAYS: '0' }));
});
test('IP matching supports exact IPv4, CIDR and IPv6 and rejects malformed/proxy-wide networks', () => {
  const allowed = compileCidrs(['203.0.113.7/32', '2001:db8:abcd::/48']);
  assert.equal(allowed('203.0.113.7'), true);
  assert.equal(allowed('::ffff:203.0.113.7'), true);
  assert.equal(allowed('203.0.113.8'), false);
  assert.equal(allowed('2001:db8:abcd::12'), true);
  assert.equal(allowed('2001:db8:ffff::12'), false);
  for (const value of ['nonsense', '127.0.0.1/99', '::1/129', '203.0.113.0/-1', '1.2.3.4/32/1'])
    assert.throws(() => compileCidrs([value]));
  assert.throws(() => accessPolicy({ TRUSTED_PROXY_CIDRS: '0.0.0.0/0' }));
});
test('forwarded IP headers are ignored from untrusted clients and only one verified proxy hop is accepted', async () => {
  const policy = accessPolicy({ TRUSTED_PROXY_CIDRS: '10.20.30.40/32' });
  const app = Fastify({ trustProxy: policy.trustProxy });
  app.get('/', (request) => ({ ip: request.ip }));
  try {
    assert.equal(
      (
        await app.inject({
          url: '/',
          remoteAddress: '198.51.100.3',
          headers: { 'x-forwarded-for': '203.0.113.7' },
        })
      ).json().ip,
      '198.51.100.3',
    );
    assert.equal(
      (
        await app.inject({
          url: '/',
          remoteAddress: '10.20.30.40',
          headers: { 'x-forwarded-for': '192.0.2.99, 203.0.113.7' },
        })
      ).json().ip,
      '203.0.113.7',
    );
  } finally {
    await app.close();
  }
});

test('runtime database privileges require exact collection permissions and reject inherited broad/audit-changing access', () => {
  const privileges = Object.entries(runtimePrivileges).map(([collection, actions]) => ({
    resource: { db: '__APP_SLUG__', collection },
    actions: [...actions],
  }));
  assert.equal(auditPrivilegesAreRestricted(privileges, '__APP_SLUG__'), true);
  for (const action of ['update', 'remove', 'createIndex', 'collMod', 'dropCollection']) {
    assert.equal(
      auditPrivilegesAreRestricted(
        [
          ...privileges,
          { resource: { db: '__APP_SLUG__', collection: 'audit_events' }, actions: [action] },
        ],
        '__APP_SLUG__',
      ),
      false,
    );
  }
  assert.equal(
    auditPrivilegesAreRestricted(
      [...privileges, { resource: { db: '', collection: '' }, actions: ['find'] }],
      '__APP_SLUG__',
    ),
    false,
  );
  assert.equal(
    auditPrivilegesAreRestricted(
      privileges.filter((item) => item.resource.collection !== 'audit_events'),
      '__APP_SLUG__',
    ),
    false,
  );
});
