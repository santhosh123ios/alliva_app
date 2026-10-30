import './../src/load-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const enabled = Boolean(process.env.DATABASE_URL);

// Seeded data: Saffron House has a store-wide rule (3 km free, then 0.300 BHD a started km, 10 km limit)
// and its Manama branch sits at 26.2285, 50.586. Pearl Grill is another store.
const SAFFRON = 'saffron-house';
const KM = 1 / 111.195;
const sixKm = { latitude: (26.2285 + 6.2 * KM).toFixed(6), longitude: '50.586000' };

const branchPrice = {
  deliveryEnabled: true,
  freeRadiusKm: '1',
  maxRadiusKm: '12',
  baseCharge: '0.400',
  chargePerStep: '0.200',
  billingStepKm: '0.5',
  minCharge: null,
  maxCharge: '5.000',
  freeAboveOrder: null,
  taxRate: '0',
  promoFreeFrom: null,
  promoFreeUntil: null,
};

describe('merchant delivery pricing', { skip: !enabled }, () => {
  let app: Awaited<ReturnType<typeof import('../src/app').createApp>>;
  let request: typeof import('supertest');
  const jars = { merchant: new Map<string, string>(), customer: new Map<string, string>() };
  const created: string[] = [];

  async function call(portal: 'merchant' | 'customer', method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object) {
    const jar = jars[portal];
    let req = request(app.app)[method](`/api${path}`).set('x-alliva-portal', portal).set('Cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '));
    const csrf = jar.get(`alliva_csrf_${portal}`);
    if (csrf && method !== 'get') req = req.set('x-csrf-token', decodeURIComponent(csrf));
    const response = body ? await req.send(body) : await req;
    for (const line of (response.headers['set-cookie'] as unknown as string[] | undefined) ?? []) {
      const [pair] = line.split(';');
      const index = pair!.indexOf('=');
      jar.set(pair!.slice(0, index).trim(), pair!.slice(index + 1));
    }
    return response;
  }

  const quote = async () => {
    const store = await call('customer', 'get', `/storefront/merchants/${SAFFRON}`);
    return call('customer', 'post', '/delivery/quote', { ...sixKm, merchantId: store.body.id });
  };

  before(async () => {
    const { createApp } = await import('../src/app');
    request = (await import('supertest')).default;
    app = createApp();
    const login = await call('merchant', 'post', '/auth/login', { email: 'owner@saffronhouse.bh', password: 'Alliva123!' });
    assert.equal(login.status, 201);
    await call('customer', 'post', '/guests');
  });

  after(async () => {
    // Leave the seeded store rule as the only live rule, whatever happened above.
    for (const id of created) await call('merchant', 'delete', `/merchant/delivery-settings/${id}`);
    await app?.close();
  });

  it('lets the merchant override one branch and the customer quote follows it', async () => {
    const before = await quote();
    assert.equal(before.body.deliveryCharge, '1.200');
    assert.equal(before.body.summary.source, 'MERCHANT');

    const list = await call('merchant', 'get', '/merchant/delivery-settings');
    assert.equal(list.status, 200);
    const branchId = list.body.branches[0].id as string;
    assert.ok(list.body.settings.some((row: { branchId: string | null }) => row.branchId === null));

    const saved = await call('merchant', 'post', '/merchant/delivery-settings', { ...branchPrice, branchId });
    assert.equal(saved.status, 201);
    created.push(saved.body.id);
    assert.equal(saved.body.version, 1);
    assert.ok(saved.body.updatedById);

    // 5.2 km past the free radius in 0.5 km steps is 11 steps: 0.400 + 11 × 0.200 = 2.600.
    const after = await quote();
    assert.equal(after.body.summary.source, 'BRANCH');
    assert.equal(after.body.summary.billingUnits, 11);
    assert.equal(after.body.deliveryCharge, '2.600');

    const changed = await call('merchant', 'patch', `/merchant/delivery-settings/${saved.body.id}`, { ...branchPrice, maxCharge: '2.000', version: 1 });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.version, 2);
    assert.equal((await quote()).body.deliveryCharge, '2.000');

    const stale = await call('merchant', 'patch', `/merchant/delivery-settings/${saved.body.id}`, { ...branchPrice, version: 1 });
    assert.equal(stale.status, 409);

    const duplicate = await call('merchant', 'post', '/merchant/delivery-settings', { ...branchPrice, branchId });
    assert.equal(duplicate.status, 409);

    const removed = await call('merchant', 'delete', `/merchant/delivery-settings/${saved.body.id}`);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.active, false);
    assert.equal((await quote()).body.deliveryCharge, '1.200');
  });

  it('refuses invalid pricing and other stores’ branches', async () => {
    const minAboveMax = await call('merchant', 'post', '/merchant/delivery-settings', { ...branchPrice, minCharge: '6.000' });
    assert.equal(minAboveMax.status, 400);
    const noStep = await call('merchant', 'post', '/merchant/delivery-settings', { ...branchPrice, billingStepKm: '0' });
    assert.equal(noStep.status, 400);
    const negative = await call('merchant', 'post', '/merchant/delivery-settings', { ...branchPrice, baseCharge: '-1' });
    assert.equal(negative.status, 400);

    // Pearl Grill's Muharraq branch from the seed (id 602).
    const foreignBranch = `00000000-0000-4000-8000-${(602).toString(16).padStart(12, '0')}`;
    const foreign = await call('merchant', 'post', '/merchant/delivery-settings', { ...branchPrice, branchId: foreignBranch });
    assert.equal(foreign.status, 400);
  });

  it('writes an audit entry for each change', async () => {
    const { PrismaService } = await import('../src/prisma/prisma.service');
    const prisma = new PrismaService();
    try {
      const actions = await prisma.auditLog.findMany({ where: { entityType: 'DeliverySetting' }, select: { action: true } });
      const seen = new Set(actions.map((row) => row.action));
      for (const action of ['delivery_setting.create', 'delivery_setting.update', 'delivery_setting.deactivate']) assert.ok(seen.has(action), action);
    } finally {
      await prisma.$disconnect();
    }
  });
});
