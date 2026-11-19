import type { Db } from 'mongodb';
export const runtimePrivileges: Record<string, string[]> = {
  users: ['find', 'insert', 'update', 'listIndexes'],
  sessions: ['find', 'insert', 'update', 'remove', 'listIndexes'],
  audit_events: ['find', 'insert', 'listIndexes'],
  rate_limits: ['find', 'insert', 'update', 'listIndexes'],
};
export async function prepareSchema(db: Db) {
  for (const name of Object.keys(runtimePrivileges)) {
    try {
      await db.createCollection(name);
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 48)
        throw error;
    }
  }
  await db.collection('users').createIndex({ googleId: 1 }, { unique: true });
  await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('sessions').createIndex({ idleExpiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('sessions').createIndex({ userId: 1, authenticatedAt: -1 });
  await db.collection('audit_events').createIndex({ userId: 1, createdAt: -1, _id: -1 });
  await db.collection('audit_events').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('rate_limits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
export function auditPrivilegesAreRestricted(
  privileges: {
    resource: { anyResource?: boolean; cluster?: boolean; db?: string; collection?: string };
    actions: string[];
  }[],
  databaseName: string,
) {
  if (!privileges.length) return false;
  const granted = new Map<string, Set<string>>();
  for (const p of privileges) {
    const name = p.resource.collection || '';
    if (
      p.resource.anyResource ||
      p.resource.cluster ||
      p.resource.db !== databaseName ||
      !runtimePrivileges[name] ||
      p.actions.some((action) => !runtimePrivileges[name].includes(action))
    )
      return false;
    if (!granted.has(name)) granted.set(name, new Set());
    for (const action of p.actions) granted.get(name)!.add(action);
  }
  return Object.entries(runtimePrivileges).every(([name, actions]) =>
    actions.every((action) => granted.get(name)?.has(action)),
  );
}
export async function verifySchema(db: Db) {
  const users = await db.collection('users').listIndexes().toArray();
  if (!users.some((i) => JSON.stringify(i.key) === JSON.stringify({ googleId: 1 }) && i.unique))
    throw new Error('Prepare database indexes first');
  for (const [name, key] of [
    ['sessions', 'idleExpiresAt'],
    ['sessions', 'expiresAt'],
    ['audit_events', 'expiresAt'],
    ['rate_limits', 'expiresAt'],
  ]) {
    const indexes = await db.collection(name).listIndexes().toArray();
    if (
      !indexes.some(
        (i) => JSON.stringify(i.key) === JSON.stringify({ [key]: 1 }) && i.expireAfterSeconds === 0,
      )
    )
      throw new Error('Prepare database indexes first');
  }
}
export async function verifyAuditPermissions(db: Db) {
  const result = await db.command({ connectionStatus: 1, showPrivileges: true });
  if (
    !auditPrivilegesAreRestricted(
      result.authInfo?.authenticatedUserPrivileges || [],
      db.databaseName,
    )
  )
    throw new Error('Use a collection-scoped credential with append-only audit permissions');
}
