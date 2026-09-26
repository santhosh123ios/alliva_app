import './../src/load-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const enabled = Boolean(process.env.DATABASE_URL);

describe('orders and payments', { skip: !enabled }, () => {
  let app: { getHttpServer(): unknown; close(): Promise<void> };

  before(async () => {
    const { NestFactory } = await import('@nestjs/core');
    const cookieParser = (await import('cookie-parser')).default;
    const { AppModule } = await import('../src/app.module');
    const nest = await NestFactory.create(AppModule, { logger: false });
    nest.setGlobalPrefix('api');
    nest.use(cookieParser());
    await nest.init();
    app = nest;
  });

  after(async () => {
    await app?.close();
  });

  it('logs in a merchant and lists orders stored in Postgres', async () => {
    const request = (await import('supertest')).default;
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'owner@saffronhouse.bh', password: 'Alliva123!' });
    assert.equal(login.status, 201);
    const orders = await request(app.getHttpServer()).get('/api/orders').set('Cookie', login.headers['set-cookie']);
    assert.equal(orders.status, 200);
    assert.equal(Array.isArray(orders.body), true);
    assert.equal(orders.body.some((order: { number: string }) => order.number === 'ALV-10002'), true);
  });

  it('rejects a payment webhook with a bad signature', async () => {
    const request = (await import('supertest')).default;
    const response = await request(app.getHttpServer())
      .post('/api/payments/webhooks/tap?signature=bad')
      .send({ externalId: 'tap_test' });
    assert.ok(response.status >= 400);
  });
});
