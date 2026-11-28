import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';
import { sites } from './scripts/vite/sites-vite-plugin';

export default defineConfig({
  plugins: [react(), sites({ mockAuth: false }), cloudflare({
    viteEnvironment: { name: 'server' },
    inspectorPort: false,
    config: {
      name: 'raport-pondok', main: './worker/index.ts',
      compatibility_date: '2026-05-15', compatibility_flags: ['nodejs_compat'],
      assets: { directory: './dist/client', binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] },
      d1_databases: [{ binding: 'DB', database_name: 'raport-pondok', database_id: '00000000-0000-4000-8000-000000000000' }],
    },
  })],
  environments: {
    client: { build: { outDir: 'dist/client', chunkSizeWarningLimit: 1800 } },
    server: { build: { outDir: 'dist/server' } },
  },
  server: { host: '0.0.0.0', allowedHosts: ['terminal.local'] },
});
