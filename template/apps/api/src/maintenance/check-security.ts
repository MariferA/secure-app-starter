import { getAppDb, closeMongoConnection } from '../mongo';
import { verifySchema, verifyAuditPermissions } from './schema';
try {
  const db = await getAppDb();
  await verifySchema(db);
  await verifyAuditPermissions(db);
  console.log('Database permissions and schema passed.');
} catch {
  console.error('Check failed: use the documented schema and restricted runtime role.');
  process.exitCode = 1;
} finally {
  await closeMongoConnection();
}
