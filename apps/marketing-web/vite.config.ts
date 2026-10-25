import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const port = 3003;
const api = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
const proxy = { '/api': api, '/uploads': api };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: { include: ['@alliva/types', '@alliva/validation'] },
  server: { port, strictPort: true, host: true, proxy },
  preview: { port, strictPort: true, host: true, proxy },
});
