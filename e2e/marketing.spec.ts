import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Marketing management system, end to end through the real UI. Needs the seeded accounts and a throw-away database
 * (the lead test creates data). Each project only runs the tests that belong to its portal.
 */
const PASSWORD = 'Alliva123!';
const STAFF = 'marketing.staff@alliva.bh';
const HEAD = 'marketing.head@alliva.bh';
const ADMIN = 'admin@alliva.bh';

async function fillLogin(page: Page, email: string, password = PASSWORD) {
  await page.goto('/en/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
}

// The API limits sign-ins to 10 per minute, so each account signs in once and its cookies are reused.
type Runner = Pick<typeof import('@playwright/test'), 'request'>;
type State = Awaited<ReturnType<APIRequestContext['storageState']>>;
const sessions = new Map<string, State>();

async function session(runner: Runner, baseURL: string, email: string): Promise<State> {
  const cached = sessions.get(email);
  if (cached) return cached;
  const api = await runner.request.newContext({ baseURL });
  const response = await api.post('/api/auth/login', { data: { email, password: PASSWORD } });
  expect(response.ok(), `sign-in as ${email}`).toBeTruthy();
  const state = await api.storageState();
  await api.dispose();
  sessions.set(email, state);
  return state;
}

/** Signs the browser page in as `email` without going through the login form. */
async function signIn(page: Page, runner: Runner, baseURL: string | undefined, email: string) {
  const state = await session(runner, baseURL!, email);
  await page.context().addCookies(state.cookies);
}

/** An API client that is signed in as `email`, independent of the browser page. */
async function apiAs(runner: Runner, baseURL: string | undefined, email: string) {
  return runner.request.newContext({ baseURL, storageState: await session(runner, baseURL!, email) });
}

test.describe('marketing portal', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'marketing', 'marketing project only');
  });

  test('staff sees the staff console and cannot open head screens', async ({ page, playwright, baseURL }) => {
    await signIn(page, playwright, baseURL, STAFF);
    await page.goto('/en/dashboard');
    await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Omar/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add new store' })).toBeVisible();
    const nav = page.getByRole('navigation');
    for (const label of ['My leads', 'My stores', 'Referral & wallet']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
    await expect(nav.getByRole('link', { name: 'Commission', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Commission transactions' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'My team' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Store visits' })).toHaveCount(0);
    await page.goto('/en/heads');
    await expect(page.getByText('Not available')).toBeVisible();
  });

  test('staff adds a lead and finds it in the list', async ({ page, playwright, baseURL }) => {
    const business = `E2E Cafe ${Date.now().toString(36)}`;
    const phone = `+9733${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    await signIn(page, playwright, baseURL, STAFF);
    await page.goto('/en/leads');
    await page.getByRole('button', { name: 'Add lead' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Business \*/).fill(business);
    await dialog.getByLabel(/^Contact person/).fill('E2E Owner');
    await dialog.getByLabel(/^Phone \*/).fill(phone);
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog).toBeHidden();
    await page.getByPlaceholder(/search/i).first().fill(business);
    await expect(page.getByText(business).first()).toBeVisible();
  });

  test('staff referral and wallet share one page', async ({ page, playwright, baseURL }) => {
    await signIn(page, playwright, baseURL, STAFF);
    await page.goto('/en/wallet');
    await expect(page.getByRole('heading', { name: 'Referral & wallet' })).toBeVisible();
    await expect(page.getByText(/^ALV-/).first()).toBeVisible();
    await expect(page.getByText(/\/register\?ref=ALV-/).first()).toBeVisible();
    await expect(page.getByRole('img', { name: 'Referral registration QR code' })).toBeVisible();
    await expect(page.getByText('Available', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request withdrawal' })).toBeVisible();
    await page.goto('/en/referral');
    await expect(page).toHaveURL(/\/wallet$/);
    await expect(page.getByRole('heading', { name: 'Referral & wallet' })).toBeVisible();
  });

  test('head sees the team screens and not the staff-only referral screen', async ({ page, playwright, baseURL }) => {
    await signIn(page, playwright, baseURL, HEAD);
    await page.goto('/en/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('link', { name: 'My team' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'My commission' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Commission transactions' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Referral & wallet' })).toBeVisible();
    await page.goto('/en/wallet');
    await expect(page.getByRole('heading', { name: 'Referral & wallet' })).toBeVisible();
    await expect(page.getByText('Available', { exact: true })).toBeVisible();
    await page.goto('/en/staff');
    await expect(page.getByText('Omar Sharif').first()).toBeVisible();
    await page.goto('/en/referral');
    await expect(page).toHaveURL(/\/wallet$/);
    await expect(page.getByRole('heading', { name: 'Referral & wallet' })).toBeVisible();
  });

  test('a wrong password is rejected and a non-marketing account is refused', async ({ page }) => {
    await fillLogin(page, STAFF, 'not-the-password');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toHaveCount(0);
    await fillLogin(page, 'admin@alliva.bh');
    await expect(page.getByText('This portal is for marketing heads and staff.').first()).toBeVisible();
  });

  test('invitation link without a token explains the problem', async ({ page }) => {
    await page.goto('/en/reset');
    await expect(page.getByText(/missing its token/i)).toBeVisible();
  });
});

test.describe('admin marketing console', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'admin', 'admin project only');
  });

  test('admin opens heads, settings and promo codes under the Marketing group', async ({ page, playwright, baseURL }) => {
    await signIn(page, playwright, baseURL, ADMIN);
    await page.goto('/en/dashboard');
    await expect(page.getByText('Orders today')).toBeVisible();
    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('link', { name: 'Marketing heads' })).toBeVisible();
    await page.goto('/en/marketing/heads');
    await expect(page.getByText('Mariam Al Doseri').first()).toBeVisible();
    await page.goto('/en/marketing/settings');
    await expect(page.getByRole('heading', { name: 'Marketing settings' })).toBeVisible();
    await expect(page.getByLabel(/Staff commission %/)).toBeVisible();
    await page.goto('/en/promos');
    await expect(page).toHaveURL(/\/marketing\/promos/);
    await expect(page.getByText('OMAR20').first()).toBeVisible();
  });

  test('referred store: admin verifies payment, staff earns commission once, refund reverses it', async ({ page, playwright, baseURL }) => {
    const unique = Date.now().toString(36);
    const business = `E2E Store ${unique}`;
    const request = await apiAs(playwright, baseURL, STAFF);
    const { referralCode } = await (await request.get('/api/marketing/me')).json();
    const walletBefore = await (await request.get('/api/marketing/wallet')).json();
    const plans = await (await request.get('/api/public/plans')).json();
    const plan = [...plans].sort((a: { priceMonthly: string }, b: { priceMonthly: string }) => Number(b.priceMonthly) - Number(a.priceMonthly))[0];
    expect(Number(plan.priceMonthly)).toBeGreaterThan(0);

    const registered = await request.post('/api/public/merchant-registration', {
      data: {
        businessName: business, website: `www.e2e${unique}.bh`, businessType: 'Cafe', city: 'Manama', phone: `+9733${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
        email: `e2e.${unique}@example.com`, firstName: 'E2E', lastName: 'Owner', password: 'Alliva123!', planId: plan.id, billingInterval: 'MONTHLY',
        referralCode, delivery: true, takeaway: true,
      },
    });
    expect(registered.ok(), await registered.text()).toBeTruthy();

    // Before verification the staff member has earned nothing from this store.
    const pending = await (await request.get('/api/marketing/commissions', { params: { pageSize: '100' } })).json();
    expect(pending.items.filter((row: { merchantName?: string }) => row.merchantName === business)).toHaveLength(0);

    await signIn(page, playwright, baseURL, ADMIN);
    await page.goto('/en/subscriptions');
    await page.getByRole('tab', { name: /Merchant subscriptions/i }).click();
    await page.getByPlaceholder('Search merchants').fill(business);
    await page.getByRole('button', { name: 'Payments' }).first().click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog.getByText('Current billing period is not verified yet')).toBeVisible();
    await dialog.getByRole('button', { name: 'Mark as paid' }).click();
    await page.getByRole('dialog').last().getByRole('button', { name: 'Mark as paid' }).click();
    await expect(dialog.getByText('Current billing period is paid and verified')).toBeVisible();

    const earned = await (await request.get('/api/marketing/commissions', { params: { pageSize: '100' } })).json();
    const rows = earned.items.filter((row: { merchantName?: string }) => row.merchantName === business);
    expect(rows).toHaveLength(1);
    const walletAfter = await (await request.get('/api/marketing/wallet')).json();
    expect(Number(walletAfter.pending ?? 0) + Number(walletAfter.available ?? 0)).toBeGreaterThan(Number(walletBefore.pending ?? 0) + Number(walletBefore.available ?? 0));

    // A second verification attempt is refused and does not pay twice.
    await expect(dialog.getByRole('button', { name: 'Mark as paid' })).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Refund' }).first().click();
    await page.getByLabel(/^Reason/).fill('E2E full refund');
    await page.getByRole('dialog').last().getByRole('button', { name: 'Refund' }).click();
    await expect(dialog.getByText(/BHD 79.000 · E2E full refund/)).toBeVisible();
    const total = async () => {
      const wallet = await (await request.get('/api/marketing/wallet')).json();
      return Number(wallet.pending ?? 0) + Number(wallet.available ?? 0);
    };
    await expect.poll(total).toBeCloseTo(Number(walletBefore.pending ?? 0) + Number(walletBefore.available ?? 0), 3);
  });

  test('admin can open subscription payments for a merchant', async ({ page, playwright, baseURL }) => {
    await signIn(page, playwright, baseURL, ADMIN);
    await page.goto('/en/subscriptions');
    await page.getByRole('tab', { name: /Merchant subscriptions/i }).click();
    await page.getByRole('button', { name: 'Payments' }).first().click();
    await expect(page.getByRole('dialog').getByText('Subscription payments')).toBeVisible();
  });
});

test.describe('merchant registration', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'merchant', 'merchant project only');
  });

  test('a referral link prefills the referral code and validates it separately from the promo code', async ({ page, playwright, baseURL }) => {
    const request = await apiAs(playwright, baseURL, STAFF);
    const me = await (await request.get('/api/marketing/me')).json();
    const code = me.referralCode as string;
    expect(code).toMatch(/^ALV-/);

    await page.goto(`/en/register?ref=${code}`);
    await expect(page.getByLabel(/Referral code/)).toHaveValue(code);
    await expect(page.getByText(/Referred by/)).toBeVisible();
    await expect(page.getByLabel(/Promo code/)).toHaveCount(0); // the promo field lives on the plan step

    await page.getByLabel(/Referral code/).fill('ALV-NOPE00');
    await expect(page.getByText(/could not find that referral code/i)).toBeVisible();
  });
});
