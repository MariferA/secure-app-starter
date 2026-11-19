import { buildApp } from './app';
import { closeMongoConnection, getAppDb } from './mongo';
import { verifySchema, verifyAuditPermissions } from './maintenance/schema';
import { recordRuntimeStartup } from './security/audit';
const app = buildApp();
app.addHook('onClose', closeMongoConnection);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close();
  });
try {
  if (process.env.MONGODB_URI) {
    const db = await getAppDb();
    await db.command({ ping: 1 });
    await verifySchema(db);
    if (process.env.NODE_ENV === 'production') await verifyAuditPermissions(db);
    await recordRuntimeStartup();
  } else if (process.env.NODE_ENV === 'production') throw new Error('Database required');
  const port = Number(process.env.API_PORT || '__API_PORT__');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid API port');
  await app.listen({
    host: process.env.API_HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
    port,
  });
} catch {
  app.log.error('Startup failed. Check private configuration, database access and schema.');
  await app.close();
  process.exitCode = 1;
}
