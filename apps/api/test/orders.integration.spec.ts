import './../src/load-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const enabled = Boolean(process.env.DATABASE_URL);

describe('orders and payments', { skip: !enabled }, () => {
  let app: Awaited<ReturnType<typeof import('../src/app').createApp>>;

  before(async () => {
    const { createApp } = await import('../src/app');
    app = createApp();
  });

  after(async () => {
    await app?.close();
  });

  it('logs in a merchant and lists orders stored in Postgres', async () => {
    const request = (await import('supertest')).default;
    const login = await request(app.app)
      .post('/api/auth/login')
      .send({ email: 'owner@saffronhouse.bh', password: 'Alliva123!' });
    assert.equal(login.status, 201);
    const orders = await request(app.app).get('/api/orders').set('Cookie', login.headers['set-cookie']);
    assert.equal(orders.status, 200);
    assert.equal(Array.isArray(orders.body), true);
    assert.equal(orders.body.some((order: { number: string }) => order.number === 'ALV-10002'), true);
  });

  it('rejects a payment webhook with a bad signature', async () => {
    const request = (await import('supertest')).default;
    const response = await request(app.app)
      .post('/api/payments/webhooks/tap?signature=bad')
      .send({ externalId: 'tap_test' });
    assert.ok(response.status >= 400);
  });
});
