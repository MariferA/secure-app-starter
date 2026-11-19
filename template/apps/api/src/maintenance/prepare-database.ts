import { getAppDb, closeMongoConnection } from '../mongo';
import { prepareSchema } from './schema';
try {
  await prepareSchema(await getAppDb());
  console.log('Database schema prepared.');
} catch {
  console.error('Schema preparation failed. Check your private connection and schema permissions.');
  process.exitCode = 1;
} finally {
  await closeMongoConnection();
}
