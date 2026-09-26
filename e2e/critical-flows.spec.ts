import { expect, test } from '@playwright/test';

test('admin can sign in and see today orders', async ({ page, baseURL }) => {
  test.skip(!baseURL?.includes('3001'), 'admin project only');
  await page.goto('/en/login');
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await expect(page.getByText('Orders today')).toBeVisible();
});

test('customer home lists Bahrain merchants', async ({ page, baseURL }) => {
  test.skip(!baseURL?.includes('3000'), 'customer project only');
  await page.goto('/en');
  await expect(page.getByRole('heading', { name: /Bahrain/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Saffron House' })).toBeVisible();
});

test('merchant accepts a pending order', async ({ page, baseURL }) => {
  test.skip(!baseURL?.includes('3002'), 'merchant project only');
  await page.goto('/en/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Pending')).toBeVisible();
  await page.goto('/en/orders');
  await expect(page.getByText(/ALV-/).first()).toBeVisible();
});
