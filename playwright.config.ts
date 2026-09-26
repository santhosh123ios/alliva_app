import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  use: { trace: 'on-first-retry' },
  projects: [
    { name: 'customer', use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3000' } },
    { name: 'admin', use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3001' } },
    { name: 'merchant', use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3002' } },
  ],
});
