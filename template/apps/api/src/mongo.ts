import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';
import { Db, MongoClient } from 'mongodb';

config({
  quiet: true,
  path: fileURLToPath(new URL('../../../.env', import.meta.url)),
});

let client: MongoClient | undefined;
let connectionPromise: Promise<MongoClient> | undefined;

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not defined`);
  }

  return value;
}

export function getMongoClient(): Promise<MongoClient> {
  const uri = requireEnvironmentVariable('MONGODB_URI');
  if (!/^mongodb(?:\+srv)?:\/\//.test(uri)) throw new Error('Invalid MongoDB URI scheme');
  const options = new URLSearchParams(uri.split('?')[1] || '');
  const host = uri.split('://')[1]?.split('/')[0]?.split('@').pop() || '';
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  if (!local && !(uri.startsWith('mongodb+srv://') || options.get('tls') === 'true'))
    throw new Error('Remote MongoDB requires TLS');
  for (const [name, value] of options) {
    if (
      (['tls', 'ssl'].includes(name.toLowerCase()) && value.toLowerCase() === 'false') ||
      (['tlsinsecure', 'tlsallowinvalidcertificates', 'tlsallowinvalidhostnames'].includes(
        name.toLowerCase(),
      ) &&
        value.toLowerCase() === 'true')
    )
      throw new Error('Insecure MongoDB TLS options are not allowed');
  }

  if (!client) {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
    connectionPromise = client.connect().catch((error: unknown) => {
      client = undefined;
      connectionPromise = undefined;
      throw error;
    });
  }

  return connectionPromise ?? Promise.resolve(client);
}

export async function getAppDb(): Promise<Db> {
  const connectedClient = await getMongoClient();
  const databaseName = requireEnvironmentVariable('MONGODB_APP_DATABASE');

  return connectedClient.db(databaseName);
}

export async function closeMongoConnection(): Promise<void> {
  if (!client) {
    return;
  }

  const connectedClient = await (connectionPromise ?? Promise.resolve(client));
  await connectedClient.close();
  client = undefined;
  connectionPromise = undefined;
}
