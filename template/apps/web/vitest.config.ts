import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: {
    __APP_CONFIG__: JSON.stringify({
      name: 'Test App',
      description: 'A personal workspace built for your next idea.',
      slug: 'test-app',
      apiUrl: 'http://localhost:__API_PORT__/api',
    }),
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.tsx'] },
});
