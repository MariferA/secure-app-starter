import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const { slug } = JSON.parse(readFileSync(new URL('../app.config.json', import.meta.url), 'utf8'));
const action = process.argv[2];
if (!['up', 'down', 'ps'].includes(action))
  throw new Error('Use docker:up, docker:down, or docker:ps.');
const env = {
  ...process.env,
  APP_UID: String(process.getuid?.() || 1000),
  APP_GID: String(process.getgid?.() || 1000),
};
for (const key of Object.keys(env)) if (key.startsWith('COMPOSE_')) delete env[key];
const result = spawnSync(
  'docker',
  [
    'compose',
    '--project-name',
    slug,
    '--project-directory',
    root,
    '--env-file',
    root + '.env',
    '-f',
    root + 'compose.yaml',
    ...(action === 'up' ? ['up', '-d', '--build'] : action === 'down' ? ['down'] : ['ps']),
  ],
  { cwd: root, env, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
