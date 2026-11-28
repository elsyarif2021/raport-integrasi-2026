import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins:[react()],
  define:{'import.meta.env.VITE_RAPORT_HOST':JSON.stringify('vercel')},
  build:{outDir:'dist',chunkSizeWarningLimit:1800},
  server:{host:'0.0.0.0',allowedHosts:['terminal.local']},
});
