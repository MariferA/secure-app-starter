import { readFileSync, writeFileSync } from 'node:fs';
import { publicConfig } from './public-config.mjs';
const app = JSON.parse(readFileSync(new URL('../app.config.json', import.meta.url), 'utf8'));
const url = new URL(publicConfig(process.env, app).apiUrl);
const ws = new URL(url.origin);
ws.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
const config = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8').replaceAll(
  '__API_CONNECT_ORIGINS__',
  url.origin + ' ' + ws.origin,
);
writeFileSync('/tmp/app-nginx.conf', config);
