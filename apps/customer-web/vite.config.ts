import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { devCertificate } from './dev-https';

// `pnpm dev:https` serves on https at 3443 (self-signed), so phones on the Wi-Fi can use their location.
const secure = process.env.DEV_HTTPS === '1';
const port = secure ? 3443 : 3000;
const https = secure ? devCertificate(fileURLToPath(new URL('.', import.meta.url))) : undefined;
const api = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
const proxy = { '/api': api, '/uploads': api };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: { include: ['@alliva/validation'] },
  server: { port, strictPort: true, host: true, proxy, ...(https ? { https: { key: https.key, cert: https.cert } } : {}) },
  preview: { port, strictPort: true, host: true, proxy },
});
