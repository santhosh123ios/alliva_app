import { defineConfig, devices } from '@playwright/test';

// Point E2E_*_URL at a stack that uses a throw-away database; these specs create leads and stores.
// E2E_CHANNEL=chrome reuses an installed Google Chrome instead of Playwright's downloaded browser.
const channel = process.env.E2E_CHANNEL || undefined;
const desktop = { ...devices['Desktop Chrome'], channel };

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  workers: 1,
  use: { trace: 'on-first-retry' },
  projects: [
    { name: 'customer', use: { ...desktop, baseURL: process.env.E2E_CUSTOMER_URL ?? 'http://localhost:3000' } },
    { name: 'admin', use: { ...desktop, baseURL: process.env.E2E_ADMIN_URL ?? 'http://localhost:3001' } },
    { name: 'merchant', use: { ...desktop, baseURL: process.env.E2E_MERCHANT_URL ?? 'http://localhost:3002' } },
    { name: 'marketing', use: { ...desktop, baseURL: process.env.E2E_MARKETING_URL ?? 'http://localhost:3003' } },
  ],
});
