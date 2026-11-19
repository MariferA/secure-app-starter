import { getAppDb, getMongoClient } from './mongo';
import type { ClientSession, Db } from 'mongodb';

// Small adapter so endpoint tests can use a disposable in-memory test double.
export const database = {
  get: getAppDb,
  async transaction<T>(operation: (db: Db, session: ClientSession) => Promise<T>): Promise<T> {
    const client = await getMongoClient();
    const db = await getAppDb();
    for (let attempt = 0; ; attempt++) {
      try {
        return await client.withSession((session) =>
          session.withTransaction(() => operation(db, session), {
            readConcern: { level: 'snapshot' },
            writeConcern: { w: 'majority' },
            readPreference: 'primary',
            timeoutMS: 15000,
          }),
        );
      } catch (error) {
        // A simultaneous idempotency/upsert insert can win after our snapshot.
        // Retry the complete transaction so it sees the committed receipt.
        if (
          attempt >= 2 ||
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 11000
        )
          throw error;
      }
    }
  },
};
