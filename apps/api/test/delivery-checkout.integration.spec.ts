import './../src/load-env';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

const enabled = Boolean(process.env.DATABASE_URL);

// Seeded data: Saffron House (Manama branch at 26.2285, 50.586) prices delivery at 3 km free,
// then BHD 0.300 per started kilometre, up to 10 km. The demo customer signs in with +97336000001.
const SAFFRON = 'saffron-house';
const KM = 1 / 111.195;

describe('guest shopping, delivery quotes and checkout', { skip: !enabled }, () => {
  let app: Awaited<ReturnType<typeof import('../src/app').createApp>>;
  let request: typeof import('supertest');
  const jar = new Map<string, string>();

  const cookieHeader = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const remember = (headers: Record<string, unknown>) => {
    for (const line of (headers['set-cookie'] as string[] | undefined) ?? []) {
      const [pair] = line.split(';');
      const index = pair!.indexOf('=');
      jar.set(pair!.slice(0, index).trim(), pair!.slice(index + 1));
    }
  };
  async function call(method: 'get' | 'post' | 'put' | 'delete', path: string, body?: object, headers: Record<string, string> = {}) {
    let req = request(app.app)[method](`/api${path}`).set('x-alliva-portal', 'customer').set('Cookie', cookieHeader());
    const csrf = jar.get('alliva_csrf_customer');
    if (csrf && method !== 'get') req = req.set('x-csrf-token', decodeURIComponent(csrf));
    for (const [name, value] of Object.entries(headers)) req = req.set(name, value);
    const response = body ? await req.send(body) : await req;
    remember(response.headers);
    return response;
  }

  before(async () => {
    const { createApp } = await import('../src/app');
    request = (await import('supertest')).default;
    app = createApp();
  });

  after(async () => {
    await app?.close();
  });

  it('quotes delivery from the branch rule: 6.2 km costs 4 started km at 0.300', async () => {
    await call('post', '/guests');
    const store = await call('get', `/storefront/merchants/${SAFFRON}`);
    const quote = await call('post', '/delivery/quote', { latitude: (26.2285 + 6.2 * KM).toFixed(6), longitude: '50.586000', merchantId: store.body.id });
    assert.equal(quote.status, 201);
    assert.equal(quote.body.available, true);
    assert.equal(quote.body.distance, '6.200');
    assert.equal(quote.body.summary.billingUnits, 4);
    assert.equal(quote.body.deliveryCharge, '1.200');

    const far = await call('post', '/delivery/quote', { latitude: (26.2285 - 12 * KM).toFixed(6), longitude: '50.586000', merchantId: store.body.id });
    assert.equal(far.body.available, false);
    assert.equal(far.body.reason, 'OUT_OF_RANGE');
  });

  it('hides stores that cannot deliver to the chosen location', async () => {
    const near = await call('get', '/storefront/nearby?lat=26.2285&lng=50.586');
    assert.ok(near.body.merchants.some((row: { slug: string }) => row.slug === SAFFRON));
    const zallaq = await call('get', '/storefront/nearby?lat=26.0469&lng=50.4836');
    const all = [...zallaq.body.merchants, ...zallaq.body.closedMerchants];
    assert.equal(all.some((row: { slug: string }) => row.slug === SAFFRON), false);
  });

  it('keeps the guest cart through sign-in and refuses unsafe orders', async () => {
    await call('put', '/guests/location', { latitude: '26.2285', longitude: '50.586', source: 'GPS' });
    const store = await call('get', `/storefront/merchants/${SAFFRON}`);
    const products = store.body.categories.flatMap((category: { products: { id: string }[] }) => category.products);
    const added = await call('post', '/cart/items', { productId: products[0].id, quantity: 2, notes: 'no onion', replace: true });
    assert.equal(added.status, 201);

    await call('post', '/auth/otp/request', { phone: '+97336000001' });
    const login = await call('post', '/auth/otp/verify', { phone: '+97336000001', code: process.env.SMS_DEV_CODE ?? '123456' });
    assert.equal(login.status, 201);
    const cart = await call('get', '/cart');
    assert.equal(cart.body.merchant.slug, SAFFRON);
    const line = cart.body.items.find((item: { productId: string }) => item.productId === products[0].id);
    assert.equal(line.quantity, 2);
    assert.equal(line.notes, 'no onion');

    const missing = await call('post', '/orders', { fulfillmentType: 'DELIVERY', paymentMethod: 'CASH' }, { 'idempotency-key': randomUUID() });
    assert.equal(missing.body.code, 'ADDRESS_REQUIRED');

    const typedOnly = await call('post', '/customers/me/addresses', { label: 'Home', line1: 'Road 1', city: 'Manama' });
    assert.equal(typedOnly.status, 400);

    const outOfRange = await call('post', '/customers/me/addresses', { label: 'Riffa', road: '1', city: 'Riffa', latitude: (26.2285 - 12 * KM).toFixed(6), longitude: '50.586', forCheckout: true });
    assert.equal(outOfRange.body.code, 'ADDRESS_OUT_OF_RANGE');

    const address = await call('post', '/customers/me/addresses', { label: 'Work', building: '12', road: '383', block: '316', city: 'Manama', latitude: (26.2285 + 6.2 * KM).toFixed(6), longitude: '50.586', forCheckout: true });
    assert.equal(address.status, 201);
    const nearest = await call('get', `/customers/me/addresses/nearest?lat=${address.body.latitude}&lng=${address.body.longitude}`);
    // Earlier runs may have saved an address at the same pin, so compare the location rather than the id.
    assert.equal(nearest.body.address.latitude, address.body.latitude);
    assert.equal(nearest.body.distanceKm, '0.000');

    const checked = await call('post', '/checkout/validate', { fulfillmentType: 'DELIVERY', addressId: address.body.id, paymentMethod: 'CASH' });
    assert.equal(checked.body.canPlace, true);
    assert.equal(checked.body.delivery.distance, '6.200');

    const stale = await call('post', '/orders', { fulfillmentType: 'DELIVERY', addressId: address.body.id, paymentMethod: 'CASH', expectedTotal: '0.001' }, { 'idempotency-key': randomUUID() });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'TOTAL_CHANGED');

    const key = randomUUID();
    const body = { fulfillmentType: 'DELIVERY', addressId: address.body.id, paymentMethod: 'CASH', expectedTotal: checked.body.pricing.total, cartVersion: checked.body.cartVersion };
    const placed = await call('post', '/orders', body, { 'idempotency-key': key });
    assert.equal(placed.status, 201);
    const again = await call('post', '/orders', body, { 'idempotency-key': key });
    assert.equal(again.body.id, placed.body.id);

    const { PrismaService } = await import('../src/prisma/prisma.service');
    const prisma = new PrismaService();
    const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.body.id } });
    await prisma.$disconnect();
    const snapshot = order.deliveryQuote as Record<string, unknown>;
    assert.equal(snapshot.distanceKm, '6.200');
    assert.equal(snapshot.chargeableKm, '3.200');
    assert.equal(snapshot.billingUnits, 4);
    assert.equal(snapshot.charge, '1.200');
    assert.equal(snapshot.finalCharge, order.deliveryFee.toFixed(3));
    assert.deepEqual(snapshot.customer, { latitude: address.body.latitude, longitude: address.body.longitude });
  });
});
