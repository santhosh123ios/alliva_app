import './../src/load-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Decimal from 'decimal.js';

/**
 * End-to-end checks of the marketing module against a real Postgres database (set DATABASE_URL, run the seed first).
 * Refuses to run against anything that is not a local database, because it creates users, stores and payments.
 */
const url = process.env.DATABASE_URL ?? '';
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const enabled = Boolean(url) && local;
const PASSWORD = 'Alliva123!';
const run = Date.now().toString(36);

type Api = Awaited<ReturnType<typeof import('../src/app').createApp>>;
type Session = { id: string; email: string; get: (path: string) => Promise<Res>; post: (path: string, body?: unknown) => Promise<Res>; patch: (path: string, body?: unknown) => Promise<Res> };
type Res = { status: number; body: any; headers: Record<string, any>; text: string };

describe('marketing management system', { skip: !enabled }, () => {
  let app: Api;
  let agent: typeof import('supertest');
  const prisma = () => app.container.prisma;
  const M = () => app.container.marketing;

  const s: Record<string, Session> = {};
  const ids: Record<string, string> = {};
  let originalSettings: Record<string, unknown> = {};
  let planCore = '';
  let planPro = '';
  let categoryId = '';

  async function login(email: string): Promise<Session> {
    const res = await agent(app.app).post('/api/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 201, `login ${email}: ${res.text}`);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const csrf = res.body.csrfToken as string;
    const call = (method: 'get' | 'post' | 'patch', path: string, body?: unknown) => {
      let req = agent(app.app)[method](`/api${path}`).set('Cookie', cookies).set('x-csrf-token', csrf);
      if (body !== undefined) req = req.send(body as object);
      return req as unknown as Promise<Res>;
    };
    return { id: res.body.user.id, email, get: (p) => call('get', p), post: (p, b) => call('post', p, b ?? {}), patch: (p, b) => call('patch', p, b ?? {}) };
  }

  async function newStaff(label: string, headUserId: string) {
    const email = `${label}.${run}@test.alliva.bh`;
    const res = await s.admin!.post('/marketing/staff', { fullName: `${label} Staff`, employeeId: `T-${label}-${run}`.toUpperCase(), email, phone: `+9733${Math.floor(1_000_000 + Math.random() * 8_999_999)}`, password: PASSWORD, headUserId });
    assert.equal(res.status, 201, res.text);
    return { email, userId: res.body.id as string, referralCode: res.body.referralCode as string };
  }

  const dec = (value: unknown) => new Decimal(String(value));
  const p8 = () => `3${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const future = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

  /** Staff registers a store through the portal (separate from the throttled public registration). */
  async function createStore(session: Session, name: string, planId: string, extra: Record<string, unknown> = {}) {
    const res = await session.post('/marketing/stores', {
      businessName: `${name} ${run}`,
      phone: `+9733${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
      email: `${name.toLowerCase().replace(/\W/g, '')}.${run}@store.test`,
      city: 'Manama',
      businessType: 'Restaurant',
      categoryId,
      planId,
      billingInterval: 'MONTHLY',
      ...extra,
    });
    assert.equal(res.status, 201, res.text);
    return res.body.id as string;
  }

  const entries = (merchantId: string) => prisma().commissionEntry.findMany({ where: { merchantId }, orderBy: { tier: 'asc' } });
  const wallet = async (userId: string) => {
    const row = await prisma().marketingWallet.findUniqueOrThrow({ where: { userId } });
    return { available: dec(row.balance), pending: dec(row.pendingBalance), reserved: dec(row.reservedBalance), recovery: dec(row.recoveryDue) };
  };

  before(async () => {
    const { createApp } = await import('../src/app');
    agent = (await import('supertest')).default;
    process.env.MARKETING_JOBS_ENABLED = 'false';
    app = createApp();

    const plans = await prisma().subscriptionPlan.findMany();
    planCore = plans.find((p) => p.code === 'core')!.id;
    planPro = plans.find((p) => p.code === 'pro')!.id;
    categoryId = (await prisma().businessCategory.findFirstOrThrow()).id;

    s.admin = await login('superadmin@alliva.bh');
    s.headA = await login('marketing.head@alliva.bh');
    s.staffA = await login('marketing.staff@alliva.bh');
    ids.headA = s.headA.id;
    ids.staffA = s.staffA.id;

    // Test configuration: a low withdrawal minimum so small test commissions can be withdrawn. Restored in after().
    const current = (await s.admin.get('/marketing/settings')).body;
    originalSettings = { minWithdrawal: current.minWithdrawal, staffPercent: current.staffPercent, headPercent: current.headPercent, approval: current.approval, cadence: current.cadence };
    const patched = await s.admin.patch('/marketing/settings', { minWithdrawal: '1.000', staffPercent: '10.000', headPercent: '1.000', approval: 'AUTO' });
    assert.equal(patched.status, 200, patched.text);

    // A second head with one staff member (cross-team isolation) and two more staff under head A.
    const headBEmail = `headb.${run}@test.alliva.bh`;
    const headB = await s.admin.post('/marketing/heads', { fullName: 'Head B', employeeId: `T-HB-${run}`.toUpperCase(), email: headBEmail, phone: `+9733${Math.floor(1_000_000 + Math.random() * 8_999_999)}`, password: PASSWORD });
    assert.equal(headB.status, 201, headB.text);
    ids.headB = headB.body.id;
    s.headB = await login(headBEmail);

    const a2 = await newStaff('staffa2', ids.headA!);
    ids.staffA2 = a2.userId;
    s.staffA2 = await login(a2.email);
    const b1 = await newStaff('staffb1', ids.headB!);
    ids.staffB = b1.userId;
    s.staffB = await login(b1.email);
    const w = await newStaff('staffw', ids.headA!);
    ids.staffW = w.userId;
    ids.staffWCode = w.referralCode;
    s.staffW = await login(w.email);
  });

  after(async () => {
    if (s.admin && Object.keys(originalSettings).length) await s.admin.patch('/marketing/settings', originalSettings);
    await app?.close();
  });

  // ---------------------------------------------------------------- staff creation
  it('creates staff with a generated ALV- referral code and a wallet, under a mandatory head', async () => {
    const profile = await prisma().marketingProfile.findUniqueOrThrow({ where: { userId: ids.staffW! } });
    assert.match(profile.referralCode ?? '', /^ALV-[A-Z0-9]+$/);
    assert.equal(profile.parentUserId, ids.headA);
    assert.ok(await prisma().marketingWallet.findUnique({ where: { userId: ids.staffW! } }));
    const noHead = await s.admin!.post('/marketing/staff', { fullName: 'No Head', employeeId: `T-NH-${run}`, email: `nohead.${run}@t.bh`, password: PASSWORD });
    assert.equal(noHead.status, 400);
  });

  // ---------------------------------------------------------------- authorization
  it('keeps staff, heads and admin routes separated (RBAC)', async () => {
    assert.equal((await s.staffA!.get('/marketing/heads')).status, 403);
    assert.equal((await s.staffA!.get('/marketing/settings')).status, 403);
    assert.equal((await s.headA!.get('/marketing/settings')).status, 403);
    assert.equal((await s.headA!.get('/marketing/promos')).status, 403);
    assert.equal((await s.headA!.post('/marketing/staff', { fullName: 'X', employeeId: 'X1234', email: 'x@y.bh', headUserId: ids.headA })).status, 403);
    assert.equal((await s.staffA!.get('/marketing/reports')).status, 200); // list exists, but empty for staff
    assert.deepEqual((await s.staffA!.get('/marketing/reports')).body, []);
    assert.equal((await s.staffA!.get('/marketing/reports/staff-performance')).status, 403);
    assert.equal((await s.headA!.get('/marketing/reports/head-performance')).status, 403);
    assert.equal((await s.headA!.get('/marketing/reports/revenue')).status, 403);
    assert.equal((await agent(app.app).get('/api/marketing/leads')).status, 401);
  });

  it('answers 404 for other people’s leads, staff, wallets and withdrawals', async () => {
    const lead = await s.staffA!.post('/marketing/leads', { businessName: `Iso Cafe ${run}`, contactName: 'Iso Owner', phone: `+973${p8()}` });
    assert.equal(lead.status, 201, lead.text);
    const leadId = lead.body.id as string;
    assert.equal((await s.staffA2!.get(`/marketing/leads/${leadId}`)).status, 404, 'another staff member');
    assert.equal((await s.staffB!.get(`/marketing/leads/${leadId}`)).status, 404, 'staff of another team');
    assert.equal((await s.headB!.get(`/marketing/leads/${leadId}`)).status, 404, 'head of another team');
    assert.equal((await s.headA!.get(`/marketing/leads/${leadId}`)).status, 200, 'own head');
    assert.equal((await s.admin!.get(`/marketing/leads/${leadId}`)).status, 200);
    assert.equal((await s.staffA2!.post(`/marketing/leads/${leadId}/status`, { status: 'CONTACTED' })).status, 404);
    assert.equal((await s.staffA2!.post(`/marketing/leads/${leadId}/notes`, { body: 'sneaky note' })).status, 404);
    assert.equal((await s.headA!.post(`/marketing/leads/${leadId}/status`, { status: 'CONTACTED' })).status, 403, 'heads read but do not edit');
    // lists only contain own records
    const listA2 = await s.staffA2!.get('/marketing/leads');
    assert.equal(listA2.body.items.some((row: { id: string }) => row.id === leadId), false);
    const listHeadB = await s.headB!.get('/marketing/leads');
    assert.equal(listHeadB.body.items.some((row: { id: string }) => row.id === leadId), false);
    // staff detail / wallets
    assert.equal((await s.headB!.get(`/marketing/staff/${ids.staffA}`)).status, 404);
    assert.equal((await s.staffA2!.get(`/marketing/staff/${ids.staffA}`)).status, 404);
    assert.equal((await s.staffA2!.get(`/marketing/wallet?userId=${ids.staffA}`)).status, 404);
    assert.equal((await s.headA!.get(`/marketing/wallet?userId=${ids.staffA}`)).status, 404, 'heads see only their own wallet');
    assert.equal((await s.staffA2!.get(`/marketing/leads?staffId=${ids.staffA}`)).status, 404);
  });

  // ---------------------------------------------------------------- referral vs promo
  it('keeps the referral code and the promo code separate at registration', async () => {
    const base = (suffix: string) => ({
      businessName: `Reg Shop ${suffix} ${run}`,
      website: 'https://shop.example.com',
      businessType: 'Restaurant',
      city: 'Manama',
      phone: `+9733${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
      email: `reg.${suffix}.${run}@shop.test`,
      firstName: 'Reg',
      lastName: 'Owner',
      password: PASSWORD,
      planId: planCore,
      billingInterval: 'MONTHLY',
      delivery: true,
      takeaway: true,
    });
    // a promo code is not a referral code, and a referral code is not a promo code
    assert.equal((await agent(app.app).post('/api/public/merchant-registration').send({ ...base('x1'), referralCode: 'OMAR20' })).status, 400);
    assert.equal((await agent(app.app).post('/api/public/merchant-registration').send({ ...base('x2'), promoCode: 'ALV-OMAR001' })).status, 400);
    assert.equal((await agent(app.app).post('/api/public/merchant-registration').send({ ...base('x3'), referralCode: 'ALV-NOPE999' })).status, 400);

    const quote = await agent(app.app).post('/api/public/subscription-quote').send({ planId: planCore, billingInterval: 'MONTHLY', promoCode: 'omar20', referralCode: 'alv-omar001' });
    assert.equal(quote.status, 201, quote.text);
    assert.equal(quote.body.gross, '20.000');
    assert.equal(quote.body.discount, '2.000');
    assert.equal(quote.body.payable, '18.000');
    assert.equal(quote.body.referral.valid, true);
    const badQuote = await agent(app.app).post('/api/public/subscription-quote').send({ planId: planCore, billingInterval: 'MONTHLY', promoCode: 'ALV-OMAR001' });
    assert.equal(badQuote.body.promo.valid, false);

    const reg = await agent(app.app).post('/api/public/merchant-registration').send({ ...base('ok'), referralCode: 'alv-omar001', promoCode: 'omar20' });
    assert.equal(reg.status, 201, reg.text);
    const referral = await prisma().merchantReferral.findUniqueOrThrow({ where: { merchantId: reg.body.id } });
    assert.equal(referral.marketingUserId, ids.staffA);
    assert.equal(referral.headUserId, ids.headA, 'head is snapshotted at registration');
    assert.equal(referral.codeUsed, 'ALV-OMAR001');
    assert.equal(referral.source, 'SIGNUP');
    const reservation = await prisma().subscriptionPromoRedemption.findFirstOrThrow({ where: { merchantId: reg.body.id }, include: { promoCode: true } });
    assert.equal(reservation.promoCode.code, 'OMAR20');
    assert.equal(reservation.status, 'RESERVED');

    // promo only (no referral): discount reserved, no attribution
    const promoOnly = await agent(app.app).post('/api/public/merchant-registration').send({ ...base('p'), promoCode: 'OMAR20' });
    assert.equal(promoOnly.status, 201, promoOnly.text);
    assert.equal(await prisma().merchantReferral.count({ where: { merchantId: promoOnly.body.id } }), 0);
    assert.equal(await prisma().subscriptionPromoRedemption.count({ where: { merchantId: promoOnly.body.id } }), 1);
    ids.regMerchant = reg.body.id;
  });

  // ---------------------------------------------------------------- commission
  it('generates commission only after admin payment verification, at the configured rates on the net amount', async () => {
    const merchantId = ids.regMerchant!;
    assert.equal((await entries(merchantId)).length, 0, 'nothing before verification');
    const before = await wallet(ids.staffA!);
    const verified = await s.admin!.post(`/admin/merchants/${merchantId}/subscription/verify-payment`);
    assert.equal(verified.status, 201, verified.text);
    assert.equal(verified.body.gross, '20.000');
    assert.equal(verified.body.discount, '2.000');
    assert.equal(verified.body.amount, '18.000');
    const rows = await entries(merchantId);
    assert.equal(rows.length, 2);
    const staff = rows.find((row) => row.tier === 'STAFF')!;
    const head = rows.find((row) => row.tier === 'HEAD')!;
    assert.equal(dec(staff.amount).toFixed(3), '1.800');
    assert.equal(dec(staff.ratePercent).toFixed(3), '10.000');
    assert.equal(dec(staff.eligibleAmount).toFixed(3), '18.000');
    assert.equal(dec(head.amount).toFixed(3), '0.180');
    assert.equal(head.beneficiaryUserId, ids.headA);
    assert.equal(staff.status, 'APPROVED');
    const after = await wallet(ids.staffA!);
    assert.equal(after.available.minus(before.available).toFixed(3), '1.800');
    const redemption = await prisma().subscriptionPromoRedemption.findFirstOrThrow({ where: { merchantId, status: 'APPLIED' } });
    assert.equal(dec(redemption.discountAmount).toFixed(3), '2.000');
    assert.ok(redemption.subscriptionPaymentId);
    // a retry of the same verification cannot credit twice
    assert.equal((await s.admin!.post(`/admin/merchants/${merchantId}/subscription/verify-payment`)).status, 400);
    assert.equal((await entries(merchantId)).length, 2);
    assert.equal((await M().finance.reconcile(ids.staffA!)).consistent, true);
  });

  it('credits commission exactly once under concurrent verification', async () => {
    const merchantId = await createStore(s.staffW!, 'Concurrent', planPro);
    const results = await Promise.all(Array.from({ length: 6 }, () => s.admin!.post(`/admin/merchants/${merchantId}/subscription/verify-payment`)));
    assert.equal(results.filter((res) => res.status === 201).length >= 1, true);
    const payments = await prisma().subscriptionPayment.findMany({ where: { merchantId } });
    assert.equal(payments.length, 1, 'one payment per billing period');
    const rows = await entries(merchantId);
    assert.equal(rows.length, 2, 'one staff and one head entry');
    assert.equal(dec(rows.find((r) => r.tier === 'STAFF')!.amount).toFixed(3), '4.000');
    assert.equal(dec(rows.find((r) => r.tier === 'HEAD')!.amount).toFixed(3), '0.400');
    const txCount = await prisma().marketingWalletTransaction.count({ where: { commissionEntryId: { in: rows.map((r) => r.id) }, type: 'COMMISSION_CREDIT' } });
    assert.equal(txCount, 2);
    assert.equal((await M().finance.reconcile(ids.staffW!)).consistent, true);
    ids.merchantPro = merchantId;
  });

  it('does not generate commission for renewals or for stores without a referral', async () => {
    const merchantId = ids.merchantPro!;
    const subscription = await prisma().merchantSubscription.findUniqueOrThrow({ where: { merchantId } });
    await prisma().merchantSubscription.update({ where: { id: subscription.id }, data: { currentPeriodStart: new Date(Date.now() + 1000) } });
    const renewal = await app.container.platform.recordSubscriptionPayment({ subscriptionId: subscription.id, merchantId, amount: '40.000' });
    assert.equal(renewal.isRenewal, true);
    assert.equal((await entries(merchantId)).length, 2, 'no new commission for a renewal');
    // store with no referral
    const merchant = await prisma().merchant.findFirstOrThrow({ where: { referral: null, subscription: { isNot: null } } });
    const before = await prisma().commissionEntry.count();
    const sub = await prisma().merchantSubscription.findUniqueOrThrow({ where: { merchantId: merchant.id } });
    await prisma().merchantSubscription.update({ where: { id: sub.id }, data: { currentPeriodStart: new Date(Date.now() + 5000) } });
    await app.container.platform.recordSubscriptionPayment({ subscriptionId: sub.id, merchantId: merchant.id, amount: '10.000' });
    assert.equal(await prisma().commissionEntry.count(), before);
  });

  it('never creates commission from a payment that is not verified', async () => {
    const merchantId = await createStore(s.staffW!, 'Unverified', planCore);
    const subscription = await prisma().merchantSubscription.findUniqueOrThrow({ where: { merchantId } });
    const payment = await prisma().subscriptionPayment.create({ data: { subscriptionId: subscription.id, merchantId, amount: '20.000', status: 'PENDING', idempotencyKey: `unverified:${run}` } });
    await assert.rejects(() => prisma().$transaction((tx) => M().finance.onVerifiedPayment(tx, { id: payment.id, merchantId, amount: '20.000', status: 'PENDING', verifiedAt: null, isRenewal: false })));
    assert.equal((await entries(merchantId)).length, 0);
  });

  // ---------------------------------------------------------------- refunds
  it('reverses commission proportionally on partial and full refunds, idempotently', async () => {
    const merchantId = ids.regMerchant!;
    const payment = await prisma().subscriptionPayment.findFirstOrThrow({ where: { merchantId, verifiedAt: { not: null } } });
    const before = await wallet(ids.staffA!);
    const partial = await s.admin!.post(`/admin/subscription-payments/${payment.id}/refund`, { amount: '9.000', reason: 'Half month refund', idempotencyKey: `refund-a-${run}` });
    assert.equal(partial.status, 201, partial.text);
    let rows = await entries(merchantId);
    assert.equal(dec(rows.find((r) => r.tier === 'STAFF')!.reversedAmount).toFixed(3), '0.900');
    assert.equal(dec(rows.find((r) => r.tier === 'HEAD')!.reversedAmount).toFixed(3), '0.090');
    let now = await wallet(ids.staffA!);
    assert.equal(before.available.minus(now.available).toFixed(3), '0.900');

    // replay with the same key changes nothing
    const replay = await s.admin!.post(`/admin/subscription-payments/${payment.id}/refund`, { amount: '9.000', reason: 'Half month refund', idempotencyKey: `refund-a-${run}` });
    assert.ok(replay.status < 300, replay.text);
    assert.equal((await wallet(ids.staffA!)).available.toFixed(3), now.available.toFixed(3));
    assert.equal(await prisma().subscriptionRefund.count({ where: { paymentId: payment.id } }), 1);

    // over-refund is rejected
    assert.equal((await s.admin!.post(`/admin/subscription-payments/${payment.id}/refund`, { amount: '9.001', reason: 'Too much money' })).status, 400);
    // refund the rest
    const rest = await s.admin!.post(`/admin/subscription-payments/${payment.id}/refund`, { amount: '9.000', reason: 'Second half refund' });
    assert.equal(rest.status, 201, rest.text);
    rows = await entries(merchantId);
    assert.equal(dec(rows.find((r) => r.tier === 'STAFF')!.reversedAmount).toFixed(3), '1.800');
    assert.equal(rows.find((r) => r.tier === 'STAFF')!.status, 'REVERSED');
    now = await wallet(ids.staffA!);
    assert.equal(before.available.minus(now.available).toFixed(3), '1.800');
    assert.equal((await M().finance.reconcile(ids.staffA!)).consistent, true);
    // staff cannot refund
    assert.equal((await s.staffA!.post(`/admin/subscription-payments/${payment.id}/refund`, { reason: 'I want my commission' })).status, 403);
  });

  it('records recovery debt when a refund arrives after the commission was withdrawn, and nets it against later credits', async () => {
    const before = await wallet(ids.staffW!);
    const available = before.available;
    assert.ok(available.gt(0));
    const withdrawal = await s.staffW!.post('/marketing/wallet/withdrawals', { amount: available.toFixed(3), method: 'BANK_TRANSFER', acceptTerms: true });
    assert.equal(withdrawal.status, 201, withdrawal.text);
    const payment = await prisma().subscriptionPayment.findFirstOrThrow({ where: { merchantId: ids.merchantPro!, verifiedAt: { not: null }, isRenewal: false } });
    const refund = await s.admin!.post(`/admin/subscription-payments/${payment.id}/refund`, { reason: 'Full refund after payout request' });
    assert.equal(refund.status, 201, refund.text);
    const mid = await wallet(ids.staffW!);
    for (const bucket of Object.values(mid)) assert.equal(bucket.gte(0), true, 'no bucket may go negative');
    assert.equal(mid.recovery.toFixed(3), '4.000', 'the whole reversal became recovery debt (nothing was available)');
    assert.equal((await M().finance.reconcile(ids.staffW!)).consistent, true);
    // the next credit pays the debt down first
    const merchantId = await createStore(s.staffW!, 'Recovery', planPro);
    assert.equal((await s.admin!.post(`/admin/merchants/${merchantId}/subscription/verify-payment`)).status, 201);
    const end = await wallet(ids.staffW!);
    assert.equal(end.recovery.toFixed(3), '0.000');
    assert.equal(end.available.toFixed(3), '0.000', '4.000 earned, 4.000 repaid');
    assert.equal((await M().finance.reconcile(ids.staffW!)).consistent, true);
    ids.withdrawalW = withdrawal.body.id;
  });

  // ---------------------------------------------------------------- withdrawals
  it('allows only one of several concurrent withdrawals of the same balance', async () => {
    const merchantId = await createStore(s.staffA2!, 'Withdraw Source', planPro);
    assert.equal((await s.admin!.post(`/admin/merchants/${merchantId}/subscription/verify-payment`)).status, 201);
    const balance = await wallet(ids.staffA2!);
    assert.equal(balance.available.toFixed(3), '4.000');
    const attempts = await Promise.all(Array.from({ length: 5 }, () => s.staffA2!.post('/marketing/wallet/withdrawals', { amount: '4.000', method: 'BANK_TRANSFER', acceptTerms: true })));
    assert.equal(attempts.filter((res) => res.status === 201).length, 1, JSON.stringify(attempts.map((r) => r.status)));
    const state = await wallet(ids.staffA2!);
    assert.equal(state.available.toFixed(3), '0.000');
    assert.equal(state.reserved.toFixed(3), '4.000');
    assert.equal((await M().finance.reconcile(ids.staffA2!)).consistent, true);
    ids.withdrawalA2 = attempts.find((res) => res.status === 201)!.body.id;
  });

  it('moves a withdrawal through review, approval, processing and paid, and rejects invalid steps', async () => {
    const id = ids.withdrawalA2!;
    const decide = (to: string, extra: Record<string, unknown> = {}) => s.admin!.post(`/marketing/withdrawals/${id}/decision`, { to, ...extra });
    assert.equal((await s.staffA2!.post(`/marketing/withdrawals/${id}/decision`, { to: 'PAID', payoutReference: 'X' })).status, 403);
    assert.equal((await s.headA!.post(`/marketing/withdrawals/${id}/decision`, { to: 'PAID', payoutReference: 'X' })).status, 403);
    assert.equal((await decide('PAID', { payoutReference: 'REF-1' })).status, 400, 'cannot jump from requested to paid');
    assert.equal((await decide('UNDER_REVIEW')).status, 201);
    assert.equal((await decide('APPROVED')).status, 201);
    assert.equal((await decide('PROCESSING')).status, 201);
    assert.equal((await decide('PAID')).status, 400, 'payout reference required');
    assert.equal((await decide('PAID', { payoutReference: `BANK-${run}` })).status, 201);
    assert.equal((await decide('REJECTED', { reason: 'Too late to reject' })).status, 400, 'paid is final');
    const state = await wallet(ids.staffA2!);
    assert.equal(state.reserved.toFixed(3), '0.000');
    const row = await prisma().marketingWallet.findUniqueOrThrow({ where: { userId: ids.staffA2! } });
    assert.equal(dec(row.totalWithdrawn).toFixed(3), '4.000');
    assert.equal((await M().finance.reconcile(ids.staffA2!)).consistent, true);
    assert.ok(await prisma().auditLog.findFirst({ where: { entityId: id, action: { contains: 'withdrawal' } } }));
  });

  it('releases the reserved funds when a withdrawal is rejected', async () => {
    const id = ids.withdrawalW!;
    const before = await wallet(ids.staffW!);
    assert.equal((await s.admin!.post(`/marketing/withdrawals/${id}/decision`, { to: 'REJECTED' })).status, 400, 'reason required');
    const rejected = await s.admin!.post(`/marketing/withdrawals/${id}/decision`, { to: 'REJECTED', reason: 'Bank details missing' });
    assert.equal(rejected.status, 201, rejected.text);
    const after = await wallet(ids.staffW!);
    assert.equal(after.reserved.toFixed(3), '0.000');
    assert.ok(after.available.gte(before.available));
    assert.equal((await M().finance.reconcile(ids.staffW!)).consistent, true);
  });

  it('rejects withdrawals above the balance, below the minimum, or without accepting terms', async () => {
    assert.equal((await s.staffB!.post('/marketing/wallet/withdrawals', { amount: '5.000', method: 'BANK_TRANSFER', acceptTerms: true })).status, 400);
    assert.equal((await s.staffB!.post('/marketing/wallet/withdrawals', { amount: '5.000', method: 'BANK_TRANSFER', acceptTerms: false })).status, 400);
    assert.equal((await s.staffB!.post('/marketing/wallet/withdrawals', { amount: '-1.000', method: 'BANK_TRANSFER', acceptTerms: true })).status, 400);
  });

  // ---------------------------------------------------------------- admin adjustments
  it('requires a reason for admin wallet adjustments and never allows a negative balance', async () => {
    assert.equal((await s.admin!.post(`/marketing/wallets/${ids.staffB}/adjust`, { amount: '5.000', reason: 'no' })).status, 400);
    const credit = await s.admin!.post(`/marketing/wallets/${ids.staffB}/adjust`, { amount: '5.000', reason: 'Goodwill bonus for onboarding' });
    assert.equal(credit.status, 201, credit.text);
    assert.equal((await wallet(ids.staffB!)).available.toFixed(3), '5.000');
    assert.equal((await s.admin!.post(`/marketing/wallets/${ids.staffB}/adjust`, { amount: '-6.000', reason: 'Correction larger than balance' })).status, 400);
    assert.equal((await s.staffB!.post(`/marketing/wallets/${ids.staffB}/adjust`, { amount: '50.000', reason: 'Give myself money' })).status, 403);
    assert.equal((await wallet(ids.staffB!)).available.toFixed(3), '5.000');
  });

  // ---------------------------------------------------------------- pipeline
  it('manages leads: duplicates, statuses, visits, appointments and follow-ups', async () => {
    const pipePhone = p8();
    const created = await s.staffA!.post('/marketing/leads', { businessName: `Pipeline Cafe ${run}`, contactName: 'Pipe Owner', phone: `+973${pipePhone}`, email: `pipe.${run}@cafe.test`, status: 'NEW', nextFollowUpAt: future(60 * 24) });
    assert.equal(created.status, 201, created.text);
    const id = created.body.id as string;
    assert.equal(created.body.status, 'FOLLOW_UP_REQUIRED');
    assert.ok(created.body.nextFollowUpAt);
    assert.equal((await s.staffA!.post('/marketing/leads', { businessName: 'Dup', contactName: 'Dup Owner', phone: `+973 ${pipePhone.slice(0, 4)} ${pipePhone.slice(4)}` })).status, 400, 'duplicate phone after normalisation');
    assert.equal((await s.staffA!.post(`/marketing/leads/${id}/status`, { status: 'REGISTERED' })).status, 400, 'cannot mark registered manually');
    assert.equal((await s.staffA!.post(`/marketing/leads/${id}/status`, { status: 'NOPE' })).status, 400);

    const visit = await s.staffA!.post(`/marketing/leads/${id}/visits`, { visitedAt: new Date(Date.now() - 3600_000).toISOString(), outcome: 'Met the owner', notes: 'Interested in the core plan' });
    assert.equal(visit.status, 201, visit.text);
    assert.equal((await s.staffA!.post(`/marketing/leads/${id}/visits`, { visitedAt: future(120) })).status, 400, 'a visit cannot be in the future');

    assert.equal((await s.staffA!.post('/marketing/appointments', { leadId: id, kind: 'APPOINTMENT', scheduledAt: new Date(Date.now() - 3600_000).toISOString() })).status, 400, 'no appointments in the past');
    const appt = await s.staffA!.post('/marketing/appointments', { leadId: id, kind: 'APPOINTMENT', scheduledAt: future(180), notes: 'Contract signing' });
    assert.equal(appt.status, 201, appt.text);
    let lead = (await s.staffA!.get(`/marketing/leads/${id}`)).body;
    assert.equal(lead.status, 'APPOINTMENT_SCHEDULED');
    assert.ok(lead.nextAppointmentAt);
    assert.equal(lead.visits.length, 1);

    const moved = await s.staffA!.post(`/marketing/appointments/${appt.body.id}/reschedule`, { scheduledAt: future(300), reason: 'Owner asked for later' });
    assert.equal(moved.status, 201, moved.text);
    assert.equal((await s.staffA!.post(`/marketing/appointments/${appt.body.id}/reschedule`, { scheduledAt: future(400) })).status, 400, 'old entry is closed');
    const completed = await s.staffA!.post(`/marketing/appointments/${moved.body.id}/complete`, { outcome: 'Needs a day to decide', nextFollowUpAt: future(60 * 48) });
    assert.equal(completed.status, 201, completed.text);
    assert.equal((await s.staffA!.post(`/marketing/appointments/${moved.body.id}/complete`, { outcome: 'again' })).status, 400, 'already completed');
    lead = (await s.staffA!.get(`/marketing/leads/${id}`)).body;
    assert.equal(lead.nextAppointmentAt, null);
    assert.ok(lead.nextFollowUpAt);
    assert.ok(lead.history.length >= 5);
    assert.ok(lead.history.some((h: { kind: string }) => h.kind === 'VISIT'));

    const closed = await s.staffA!.post(`/marketing/leads/${id}/status`, { status: 'NOT_INTERESTED', note: 'Went with a competitor' });
    assert.equal(closed.status, 201, closed.text);
    lead = (await s.staffA!.get(`/marketing/leads/${id}`)).body;
    assert.equal(lead.nextFollowUpAt, null, 'closing a lead cancels open follow-ups');
    const activity = await s.headA!.get('/marketing/activity');
    assert.equal(activity.status, 200);
    assert.ok(activity.body.items.length > 0);
    // heads see the team calendar but cannot schedule on behalf of staff
    assert.equal((await s.headA!.post('/marketing/appointments', { leadId: id, kind: 'FOLLOW_UP', scheduledAt: future(60) })).status, 403);
  });

  it('links a lead to a registered store only on a unique phone or email match for the same staff member', async () => {
    const matchPhone = p8();
    const otherPhone = p8();
    const mine = await s.staffA!.post('/marketing/leads', { businessName: 'Match Me', contactName: 'Mo', phone: `+973 ${matchPhone.slice(0, 4)} ${matchPhone.slice(4)}`, status: 'NEGOTIATION' });
    const other = await s.staffA2!.post('/marketing/leads', { businessName: 'Other Staff Lead', contactName: 'Oz', phone: `+973 ${otherPhone.slice(0, 4)} ${otherPhone.slice(4)}` });
    assert.equal(mine.status, 201);
    assert.equal(other.status, 201);
    const resolved = await M().referrals.resolve('ALV-OMAR001');
    const mk = async (phone: string, email: string) =>
      prisma().$transaction(async (tx) => {
        const merchant = await tx.merchant.create({ data: { slug: `m-${Math.random().toString(36).slice(2)}`, name: { en: 'M', ar: 'M' }, description: { en: 'M', ar: 'M' }, businessType: 'Cafe', phone, email } });
        await M().referrals.attribute(tx, { merchantId: merchant.id, resolved, source: 'SIGNUP', actorId: ids.staffA!, contact: { phone, email }, merchantName: 'M' });
        return merchant.id;
      });
    await mk(`+973${p8()}`, `nomatch.${run}@m.test`);
    assert.equal((await prisma().marketingLead.findUniqueOrThrow({ where: { id: mine.body.id } })).merchantId, null, 'a store with a different phone and email is not linked');
    const merchantId = await mk(matchPhone, `another.${run}@m.test`);
    const linked = await prisma().marketingLead.findUniqueOrThrow({ where: { id: mine.body.id } });
    assert.equal(linked.merchantId, merchantId, 'same phone after normalisation links the lead');
    assert.equal(linked.status, 'REGISTERED');
    // a lead belonging to a different staff member is never touched by this staff member's referral
    await mk(`+973${otherPhone}`, `x.${run}@m.test`);
    const untouched = await prisma().marketingLead.findUniqueOrThrow({ where: { id: other.body.id } });
    assert.equal(untouched.merchantId, null);
    assert.equal(untouched.status, 'NEW');
  });

  // ---------------------------------------------------------------- scheduler and notifications
  it('sends each reminder once, marks missed meetings once, and scopes notifications to their owner', async () => {
    const lead = await s.staffA2!.post('/marketing/leads', { businessName: `Reminder Cafe ${run}`, contactName: 'Rem', phone: `+973${p8()}` });
    const soon = await s.staffA2!.post('/marketing/appointments', { leadId: lead.body.id, kind: 'APPOINTMENT', scheduledAt: future(30) });
    assert.equal(soon.status, 201, soon.text);
    const first = await M().scheduler.runOnce();
    assert.ok(first.reminders >= 1);
    const second = await M().scheduler.runOnce();
    assert.equal(second.reminders, 0, 'deduplicated on the second run');
    const reminders = await prisma().notification.findMany({ where: { entityId: soon.body.id, userId: ids.staffA2! } });
    assert.equal(reminders.length, 1);
    assert.match(reminders[0]!.dedupeKey ?? '', /^appt:/);

    // a meeting that happened in the past without being completed becomes MISSED once, alerting staff and head
    const past = await prisma().marketingAppointment.create({
      data: { kind: 'APPOINTMENT', leadId: lead.body.id, staffUserId: ids.staffA2!, headUserId: ids.headA!, title: 'Old meeting', scheduledAt: new Date(Date.now() - 6 * 3_600_000) },
    });
    const late = await M().scheduler.runOnce();
    assert.ok(late.missed >= 1);
    assert.equal((await prisma().marketingAppointment.findUniqueOrThrow({ where: { id: past.id } })).status, 'MISSED');
    await M().scheduler.runOnce();
    assert.equal(await prisma().notification.count({ where: { entityId: past.id, userId: ids.staffA2! } }), 1);
    assert.equal(await prisma().notification.count({ where: { entityId: past.id, userId: ids.headA! } }), 1);

    // notification API
    const unread = await s.staffA2!.get('/marketing/notifications/unread-count');
    assert.ok(unread.body.unread >= 2);
    const list = await s.staffA2!.get('/marketing/notifications?unread=true');
    const target = list.body.items[0].id as string;
    assert.equal((await s.staffA!.post(`/marketing/notifications/${target}/read`)).status, 404, 'other users cannot touch it');
    assert.equal((await s.staffA2!.post(`/marketing/notifications/${target}/read`)).status, 201);
    assert.equal((await s.staffA2!.post('/marketing/notifications/read-all')).status, 201);
    assert.equal((await s.staffA2!.get('/marketing/notifications/unread-count')).body.unread, 0);
    // a missed appointment can be rescheduled
    assert.equal((await s.staffA2!.post(`/marketing/appointments/${past.id}/reschedule`, { scheduledAt: future(600) })).status, 201);
  });

  // ---------------------------------------------------------------- team operations
  it('transfers staff to another head without rewriting history, and blocks suspended accounts', async () => {
    const referral = await prisma().merchantReferral.findUniqueOrThrow({ where: { merchantId: ids.regMerchant! } });
    const transfer = await s.admin!.post(`/marketing/staff/${ids.staffA2}/transfer`, { headUserId: ids.headB, reason: 'Reorganisation' });
    assert.equal(transfer.status, 201, transfer.text);
    assert.equal((await prisma().marketingProfile.findUniqueOrThrow({ where: { userId: ids.staffA2! } })).parentUserId, ids.headB);
    assert.equal((await prisma().marketingLead.findFirstOrThrow({ where: { marketingUserId: ids.staffA2! } })).headUserId, ids.headB);
    const unchanged = await prisma().merchantReferral.findUniqueOrThrow({ where: { merchantId: ids.regMerchant! } });
    assert.equal(unchanged.headUserId, referral.headUserId, 'store attribution keeps the head it was registered under');
    assert.equal((await s.headB!.get(`/marketing/staff/${ids.staffA2}`)).status, 200);
    assert.equal((await s.headA!.get(`/marketing/staff/${ids.staffA2}`)).status, 404);

    const suspend = await s.admin!.post(`/marketing/members/${ids.staffB}/status`, { status: 'SUSPENDED', reason: 'Policy breach' });
    assert.equal(suspend.status, 201, suspend.text);
    const blocked = await s.staffB!.get('/marketing/leads');
    assert.ok([401, 403].includes(blocked.status), `suspended staff must be locked out, got ${blocked.status}`);
    const relogin = await agent(app.app).post('/api/auth/login').send({ email: s.staffB!.email, password: PASSWORD });
    assert.notEqual(relogin.status, 201);
  });

  // ---------------------------------------------------------------- referral code management
  it('keeps referral code history when a code is changed and rejects duplicates and invalid codes', async () => {
    const dup = await s.admin!.post(`/marketing/staff/${ids.staffW}/referral-code`, { code: 'ALV-OMAR001' });
    assert.equal(dup.status, 400);
    assert.equal((await s.admin!.post(`/marketing/staff/${ids.staffW}/referral-code`, { code: 'bad code!' })).status, 400);
    const changed = await s.admin!.post(`/marketing/staff/${ids.staffW}/referral-code`, { code: `alv-w${run}` });
    assert.equal(changed.status, 201, changed.text);
    const codes = await prisma().marketingReferralCode.findMany({ where: { userId: ids.staffW! } });
    assert.equal(codes.length, 2);
    assert.equal(codes.filter((c) => c.active).length, 1);
    assert.equal((await agent(app.app).get(`/api/marketing/referral/validate?code=${ids.staffWCode}`)).body.valid, false, 'the retired code no longer works for new stores');
    assert.equal((await agent(app.app).get(`/api/marketing/referral/validate?code=alv-w${run}`)).body.valid, true);
    assert.equal((await s.admin!.post(`/marketing/staff/${ids.staffW}/referral-active`, { active: false })).status, 201);
    assert.equal((await agent(app.app).get(`/api/marketing/referral/validate?code=alv-w${run}`)).body.valid, false);
    await s.admin!.post(`/marketing/staff/${ids.staffW}/referral-active`, { active: true });
  });

  // ---------------------------------------------------------------- promo management
  it('manages subscription promo codes: validation, edit rules, deactivation, usage', async () => {
    const body = { code: `T${run}`.toUpperCase(), campaignName: 'Test campaign', discountType: 'PERCENTAGE', discountValue: '25', startsAt: '2026-01-01', endsAt: '2099-01-01', usageLimit: 1 };
    assert.equal((await s.staffA!.post('/marketing/promos', body)).status, 403);
    assert.equal((await s.admin!.post('/marketing/promos', { ...body, discountValue: '150' })).status, 400);
    assert.equal((await s.admin!.post('/marketing/promos', { ...body, endsAt: '2025-01-01' })).status, 400);
    const created = await s.admin!.post('/marketing/promos', body);
    assert.equal(created.status, 201, created.text);
    assert.equal((await s.admin!.post('/marketing/promos', body)).status, 400, 'duplicate code');
    const promoId = created.body.id as string;
    const patched = await s.admin!.patch(`/marketing/promos/${promoId}`, { discountValue: '30' });
    assert.equal(patched.status, 200, patched.text);

    const quote = await agent(app.app).post('/api/public/subscription-quote').send({ planId: planCore, billingInterval: 'MONTHLY', promoCode: body.code });
    assert.equal(quote.body.discount, '6.000');
    const used = await s.staffW!.post('/marketing/stores', {
      businessName: `Promo Use ${run}`, phone: `+973${p8()}`, email: `promouse.${run}@s.test`, city: 'Manama', businessType: 'Cafe', categoryId, planId: planCore, billingInterval: 'MONTHLY', promoCode: body.code,
    });
    assert.equal(used.status, 201, used.text);
    const second = await agent(app.app).post('/api/public/subscription-quote').send({ planId: planCore, billingInterval: 'MONTHLY', promoCode: body.code });
    assert.equal(second.body.promo.valid, false, 'usage limit reached');
    assert.equal((await s.admin!.patch(`/marketing/promos/${promoId}`, { code: `Z${run}`.toUpperCase() })).status, 400, 'a used code cannot be renamed');
    assert.equal((await s.admin!.patch(`/marketing/promos/${promoId}`, { usageLimit: 1 })).status, 200);
    assert.equal((await s.admin!.post(`/marketing/promos/${promoId}/active`, { active: false })).status, 201);
    const usage = await s.admin!.get(`/marketing/promos/${promoId}/usage`);
    assert.equal(usage.status, 200);
    assert.equal(usage.body.items.length, 1);
    // deactivated promo cancels the reservation: the merchant pays the full price
    const merchantId = used.body.id as string;
    const verified = await s.admin!.post(`/admin/merchants/${merchantId}/subscription/verify-payment`);
    assert.equal(verified.status, 201, verified.text);
    assert.equal(verified.body.discount, '0.000');
  });

  // ---------------------------------------------------------------- settings
  it('audits settings changes and applies new rates only to future commissions', async () => {
    assert.equal((await s.staffA!.patch('/marketing/settings', { staffPercent: '90.000' })).status, 403);
    assert.equal((await s.admin!.patch('/marketing/settings', { staffPercent: '101' })).status, 400);
    assert.equal((await s.admin!.patch('/marketing/settings', { firstPaymentOnly: false })).status, 400);
    const merchantBefore = ids.merchantPro!;
    const oldRate = dec((await entries(merchantBefore)).find((e) => e.tier === 'STAFF')!.ratePercent).toFixed(3);
    assert.equal((await s.admin!.patch('/marketing/settings', { staffPercent: '12.500' })).status, 200);
    const merchantId = await createStore(s.staffA!, 'NewRate', planPro);
    assert.equal((await s.admin!.post(`/admin/merchants/${merchantId}/subscription/verify-payment`)).status, 201);
    const staffEntry = (await entries(merchantId)).find((e) => e.tier === 'STAFF')!;
    assert.equal(dec(staffEntry.ratePercent).toFixed(3), '12.500');
    assert.equal(dec(staffEntry.amount).toFixed(3), '5.000');
    assert.equal(dec((await entries(merchantBefore)).find((e) => e.tier === 'STAFF')!.ratePercent).toFixed(3), oldRate, 'history is not rewritten');
    const audit = await prisma().auditLog.findMany({ where: { action: 'marketing.settings.financial' }, orderBy: { createdAt: 'desc' }, take: 3 });
    assert.ok(audit.length >= 1);
    await s.admin!.patch('/marketing/settings', { staffPercent: '10.000' });
  });

  // ---------------------------------------------------------------- reports
  it('serves all eleven reports with CSV and XLSX export, scoped to the caller', async () => {
    const list = await s.admin!.get('/marketing/reports');
    assert.equal(list.body.length, 11);
    for (const report of list.body as { id: string }[]) {
      const res = await s.admin!.get(`/marketing/reports/${report.id}`);
      assert.equal(res.status, 200, `${report.id}: ${res.text}`);
      assert.ok(Array.isArray(res.body.columns) && Array.isArray(res.body.rows), report.id);
    }
    const csvRes = await s.admin!.get('/marketing/reports/commissions/export?format=csv');
    assert.equal(csvRes.status, 200);
    assert.match(String(csvRes.headers['content-type']), /text\/csv/);
    assert.ok(csvRes.text.startsWith('\uFEFFCreated,Merchant'));
    const finance = await login('finance.staff@alliva.bh');
    assert.equal((await finance.get('/marketing/reports/staff-performance/export?format=xlsx')).status, 403, 'finance staff have no marketing access');
    const xlsx = await agent(app.app).get('/api/marketing/reports/staff-performance/export?format=xlsx').set('Cookie', (await agent(app.app).post('/api/auth/login').send({ email: 'superadmin@alliva.bh', password: PASSWORD })).headers['set-cookie'] as unknown as string[]).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(xlsx.status, 200);
    assert.equal((xlsx.body as Buffer).subarray(0, 2).toString(), 'PK', 'a real xlsx (zip) file');

    // head: only own team, only allowed reports
    const staffReport = await s.headA!.get('/marketing/reports/staff-performance');
    assert.equal(staffReport.status, 200);
    const names = (staffReport.body.rows as { staff: string }[]).map((row) => row.staff);
    assert.ok(names.includes('Omar Sharif'));
    assert.equal(names.some((name) => name.startsWith('staffb1')), false, 'no staff from another team');
    assert.equal((await s.headA!.get(`/marketing/reports/staff-performance?staffId=${ids.staffB}`)).status, 404);
    const xlsxHead = await s.headA!.get('/marketing/reports/merchant-referrals/export?format=xlsx');
    assert.equal(xlsxHead.status, 200);
    // an unknown report id
    assert.equal((await s.admin!.get('/marketing/reports/nope')).status, 400);
  });

  it('shows each role only its own dashboard numbers', async () => {
    const admin = await s.admin!.get('/marketing/dashboard');
    const head = await s.headA!.get('/marketing/dashboard');
    const staffB = await s.staffA2!.get('/marketing/dashboard');
    assert.equal(admin.status, 200);
    assert.ok(Number(admin.body.kpis.referredStores) >= Number(head.body.kpis.referredStores));
    assert.ok(Number(head.body.kpis.referredStores) >= Number(staffB.body.kpis.referredStores));
    assert.equal(staffB.body.kpis.heads, undefined, 'staff do not see platform-wide counters');
  });
});

describe('csv export safety', () => {
  it('neutralises spreadsheet formulas and escapes delimiters', async () => {
    const { csv } = await import('../src/modules/marketing/report.service');
    assert.equal(csv('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
    assert.equal(csv('+1+1'), "'+1+1");
    assert.equal(csv('a,b'), '"a,b"');
    assert.equal(csv(-5), '-5');
    assert.equal(csv(null), '');
  });
});
