import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { publicConfig } from '../../scripts/public-config.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, root, ''), ...process.env };
  const app = JSON.parse(readFileSync(new URL('../../app.config.json', import.meta.url), 'utf8'));
  return {
    plugins: [react(), tailwindcss()],
    envDir: root,
    envPrefix: [],
    define: { __APP_CONFIG__: JSON.stringify(publicConfig(env, app)) },
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: { host: '127.0.0.1', port: Number(env.WEB_PORT || __WEB_PORT__), strictPort: true },
    preview: { host: '127.0.0.1', port: Number(env.WEB_PORT || __WEB_PORT__), strictPort: true },
  };
});
