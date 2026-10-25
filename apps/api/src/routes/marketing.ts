import { badRequest } from '../common/errors';
import { validate, type ApiRequest } from '../common/http';
import { createRoutes } from '../common/routes';
import type { Container } from '../container';
import type { LeadStatus } from '../domain/marketing';
import { resolveScope, requireAdminScope } from '../modules/marketing/scope';
import { subscriptionPromoInputSchema, subscriptionPromoPatchSchema, type SubscriptionPromoInput } from '../modules/marketing/promo.service';
import { marketingSettingsPatchSchema } from '../modules/marketing/settings';
import * as S from '../modules/marketing/schemas';

type Page = Record<string, unknown>;

/**
 * Marketing endpoints. Authorization is two-layered: the route's permission gates the feature, and `resolveScope`
 * decides which records the caller may see (admin: all, head: own team, staff: own records). A record outside the
 * caller's scope answers 404 so ids cannot be probed.
 */
export function marketingRoutes({ prisma, jwt, platform, marketing }: Container) {
  const routes = createRoutes({ jwt, prisma }, 'Marketing');
  const param = (request: ApiRequest, name: string) => request.params[name] as string;
  const query = (request: ApiRequest) => request.query as Page;
  const actor = (request: ApiRequest) => request.user!;
  const scopeOf = (request: ApiRequest) => resolveScope(prisma, actor(request));
  const adminOf = (request: ApiRequest) => requireAdminScope(prisma, actor(request));
  const portal = { permissions: ['marketing.portal'] };
  const manage = { permissions: ['marketing.manage'] };

  // ------------------------------------------------------------------ identity, dashboard, alerts

  routes.get('/marketing/me', portal, (request) => marketing.team.me(actor(request)));

  routes.patch('/marketing/me', portal, (request) => marketing.team.updateOwnProfile(actor(request), validate(S.ownProfileSchema, request.body)));

  routes.get('/marketing/dashboard', portal, async (request) => {
    const scope = await scopeOf(request);
    const [dashboard, alerts] = await Promise.all([marketing.reports.dashboard(scope, query(request)), marketing.pipeline.alerts(scope)]);
    return { ...dashboard, alerts };
  });

  routes.get('/marketing/admin/dashboard', manage, async (request) => {
    const scope = await adminOf(request);
    const [dashboard, alerts] = await Promise.all([marketing.reports.dashboard(scope, query(request)), marketing.pipeline.alerts(scope)]);
    return { ...dashboard, alerts };
  });

  // ------------------------------------------------------------------ team (admin manages, head reads own team)

  routes.get('/marketing/heads', manage, async (request) => {
    await adminOf(request);
    return marketing.team.listHeads(query(request));
  });

  routes.post('/marketing/heads', manage, async (request) => {
    await adminOf(request);
    return marketing.team.createHead(actor(request), validate(S.memberSchema, request.body));
  });

  routes.get('/marketing/staff', portal, async (request) => marketing.team.listStaff(await scopeOf(request), query(request)));

  routes.get('/marketing/staff/:id', portal, async (request) => marketing.team.detail(await scopeOf(request), param(request, 'id')));

  routes.post('/marketing/staff', manage, async (request) => {
    await adminOf(request);
    return marketing.team.createStaff(actor(request), validate(S.staffSchema, request.body));
  });

  routes.patch('/marketing/members/:id', manage, async (request) => {
    await adminOf(request);
    return marketing.team.update(actor(request), param(request, 'id'), validate(S.memberPatchSchema, request.body));
  });

  routes.post('/marketing/members/:id/status', manage, async (request) => {
    await adminOf(request);
    const body = validate<{ status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'; reason?: string }>(S.statusSchema, request.body);
    return marketing.team.setStatus(actor(request), param(request, 'id'), body.status, body.reason ?? undefined);
  });

  routes.post('/marketing/members/:id/invite', manage, async (request) => {
    await adminOf(request);
    return marketing.team.reissueInvite(actor(request), param(request, 'id'));
  });

  routes.post('/marketing/staff/:id/transfer', manage, async (request) => {
    await adminOf(request);
    const body = validate<{ headUserId: string; reason?: string }>(S.transferSchema, request.body);
    return marketing.team.transferStaff(actor(request), param(request, 'id'), body.headUserId, body.reason ?? undefined);
  });

  routes.post('/marketing/staff/:id/referral-code', manage, async (request) => {
    await adminOf(request);
    return marketing.team.changeReferralCode(actor(request), param(request, 'id'), validate<{ code: string }>(S.referralCodeSchema, request.body).code);
  });

  routes.post('/marketing/staff/:id/referral-active', manage, async (request) => {
    await adminOf(request);
    return marketing.team.setReferralActive(actor(request), param(request, 'id'), validate<{ active: boolean }>(S.referralActiveSchema, request.body).active);
  });

  routes.get('/marketing/activity', portal, async (request) => marketing.team.timeline(await scopeOf(request), query(request)));

  // ------------------------------------------------------------------ leads and visits

  routes.get('/marketing/leads', portal, async (request) => marketing.pipeline.listLeads(await scopeOf(request), query(request)));

  routes.post('/marketing/leads', portal, async (request) => marketing.pipeline.createLead(actor(request), await scopeOf(request), validate(S.leadSchema, request.body)));

  routes.get('/marketing/leads/:id', portal, async (request) => marketing.pipeline.getLead(await scopeOf(request), param(request, 'id')));

  routes.patch('/marketing/leads/:id', portal, async (request) => marketing.pipeline.updateLead(actor(request), await scopeOf(request), param(request, 'id'), validate(S.leadPatchSchema, request.body)));

  routes.post('/marketing/leads/:id/status', portal, async (request) => {
    const body = validate<{ status: LeadStatus; note?: string }>(S.leadStatusSchema, request.body);
    return marketing.pipeline.setStatus(actor(request), await scopeOf(request), param(request, 'id'), body.status, body.note ?? undefined);
  });

  routes.post('/marketing/leads/:id/notes', portal, async (request) => marketing.pipeline.addNote(actor(request), await scopeOf(request), param(request, 'id'), validate<{ body: string }>(S.noteSchema, request.body).body));

  routes.post('/marketing/leads/:id/visits', portal, async (request) =>
    marketing.pipeline.recordVisit(actor(request), await scopeOf(request), param(request, 'id'), validate(S.visitSchema, request.body)),
  );

  routes.post('/marketing/leads/:id/reassign', portal, async (request) =>
    marketing.pipeline.reassignLead(actor(request), await scopeOf(request), param(request, 'id'), validate<{ staffUserId: string }>(S.reassignLeadSchema, request.body).staffUserId),
  );

  routes.get('/marketing/visits', portal, async (request) => marketing.pipeline.listVisits(await scopeOf(request), query(request)));

  // ------------------------------------------------------------------ appointments and follow-ups

  routes.get('/marketing/appointments', portal, async (request) => marketing.pipeline.listAppointments(await scopeOf(request), query(request)));

  routes.post('/marketing/appointments', portal, async (request) => marketing.pipeline.createAppointment(actor(request), await scopeOf(request), validate(S.appointmentSchema, request.body)));

  routes.patch('/marketing/appointments/:id', portal, async (request) => marketing.pipeline.updateAppointment(actor(request), await scopeOf(request), param(request, 'id'), validate(S.appointmentPatchSchema, request.body)));

  routes.post('/marketing/appointments/:id/reschedule', portal, async (request) => {
    const body = validate<{ scheduledAt: string; reason?: string }>(S.rescheduleSchema, request.body);
    return marketing.pipeline.reschedule(actor(request), await scopeOf(request), param(request, 'id'), body.scheduledAt, body.reason ?? undefined);
  });

  routes.post('/marketing/appointments/:id/cancel', portal, async (request) =>
    marketing.pipeline.cancelAppointment(actor(request), await scopeOf(request), param(request, 'id'), validate<{ reason?: string }>(S.cancelSchema, request.body).reason ?? undefined),
  );

  routes.post('/marketing/appointments/:id/complete', portal, async (request) =>
    marketing.pipeline.completeAppointment(actor(request), await scopeOf(request), param(request, 'id'), validate(S.completeSchema, request.body)),
  );

  // ------------------------------------------------------------------ referred stores

  routes.get('/marketing/stores', portal, async (request) => marketing.pipeline.listStores(await scopeOf(request), query(request)));

  routes.post('/marketing/stores', portal, async (request) => marketing.pipeline.createStore(actor(request), await scopeOf(request), validate(S.storeSchema, request.body)));

  routes.post('/marketing/stores/:id/notes', portal, async (request) =>
    marketing.pipeline.addStoreNote(actor(request), await scopeOf(request), param(request, 'id'), validate<{ body: string }>(S.noteSchema, request.body).body),
  );

  routes.post('/marketing/stores/:id/reassign', manage, async (request) => {
    await adminOf(request);
    const body = validate<{ staffUserId: string; reason: string }>(S.reassignStoreSchema, request.body);
    return marketing.referrals.reassign(actor(request), param(request, 'id'), body.staffUserId, body.reason);
  });

  routes.get('/marketing/referral/validate', { public: true, throttle: 30 }, async (request) => {
    const code = typeof request.query.code === 'string' ? request.query.code : '';
    if (!code.trim()) throw badRequest('Enter a referral code');
    return marketing.referrals.validate(code);
  });

  // ------------------------------------------------------------------ commissions, wallet, withdrawals

  routes.get('/marketing/commissions', portal, async (request) => marketing.finance.commissions(await scopeOf(request), query(request)));

  routes.post('/marketing/commissions/approve', manage, async (request) => {
    await adminOf(request);
    return marketing.finance.approve(actor(request), validate<{ ids?: string[] }>(S.approveCommissionsSchema, request.body).ids);
  });

  routes.get('/marketing/wallet', portal, async (request) => {
    const requested = typeof request.query.userId === 'string' ? request.query.userId : undefined;
    return marketing.finance.wallet(await scopeOf(request), requested);
  });

  routes.get('/marketing/wallet/transactions', portal, async (request) => marketing.finance.transactions(await scopeOf(request), query(request)));

  routes.post('/marketing/wallet/withdrawals', portal, async (request) => {
    const scope = await scopeOf(request);
    if (scope.isAdmin) throw badRequest('Platform admins do not have a commission wallet');
    return marketing.finance.requestWithdrawal(actor(request), validate(S.withdrawalSchema, request.body));
  });

  routes.get('/marketing/withdrawals', portal, async (request) => marketing.finance.withdrawals(await scopeOf(request), query(request)));

  routes.post('/marketing/withdrawals/:id/cancel', portal, async (request) => marketing.finance.cancelWithdrawal(actor(request), param(request, 'id')));

  routes.post('/marketing/withdrawals/:id/decision', { permissions: ['settlement.process'] }, async (request) => {
    await adminOf(request);
    const body = validate<{ to: 'UNDER_REVIEW' | 'APPROVED' | 'PROCESSING' | 'PAID' | 'REJECTED'; reason?: string; payoutReference?: string; payoutMethod?: string; note?: string }>(S.withdrawalDecisionSchema, request.body);
    return marketing.finance.decideWithdrawal(actor(request), param(request, 'id'), body.to, {
      reason: body.reason ?? undefined,
      payoutReference: body.payoutReference ?? undefined,
      payoutMethod: body.payoutMethod ?? undefined,
      note: body.note ?? undefined,
    });
  });

  routes.get('/marketing/wallets', manage, async (request) => {
    await adminOf(request);
    return marketing.finance.walletsOverview(query(request));
  });

  routes.post('/marketing/wallets/:userId/adjust', manage, async (request) => {
    await adminOf(request);
    return marketing.finance.adjustWallet(actor(request), param(request, 'userId'), validate<{ amount: string; reason: string }>(S.adjustmentSchema, request.body));
  });

  // ------------------------------------------------------------------ notifications

  routes.get('/marketing/notifications', portal, (request) => marketing.pipeline.notifications(actor(request), query(request)));

  routes.get('/marketing/notifications/unread-count', portal, (request) => marketing.pipeline.unreadCount(actor(request)));

  routes.post('/marketing/notifications/read-all', portal, (request) => marketing.pipeline.markAllRead(actor(request)));

  routes.post('/marketing/notifications/:id/read', portal, (request) => marketing.pipeline.markRead(actor(request), param(request, 'id')));

  // ------------------------------------------------------------------ reports

  routes.get('/marketing/reports', portal, async (request) => marketing.reports.available(await scopeOf(request)));

  routes.get('/marketing/reports/:id', portal, async (request) => marketing.reports.run(await scopeOf(request), param(request, 'id'), query(request)));

  routes.get('/marketing/reports/:id/export', portal, async (request, response) => {
    const scope = await scopeOf(request);
    const format = request.query.format === 'xlsx' ? 'xlsx' : 'csv';
    const file = format === 'xlsx' ? await marketing.reports.exportXlsx(scope, param(request, 'id'), query(request)) : await marketing.reports.exportCsv(scope, param(request, 'id'), query(request));
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    response.setHeader('Cache-Control', 'no-store');
    response.send(file.body);
  });

  // ------------------------------------------------------------------ settings

  routes.get('/marketing/settings', manage, async (request) => {
    await adminOf(request);
    return marketing.settings.get();
  });

  routes.patch('/marketing/settings', manage, async (request) => {
    await adminOf(request);
    return marketing.settings.update(actor(request), validate(marketingSettingsPatchSchema, request.body));
  });

  // ------------------------------------------------------------------ subscription promo codes (platform admin only)

  const promoAdmin = { permissions: ['promo.manage'] };

  routes.get('/marketing/promos', promoAdmin, async (request) => {
    await adminOf(request);
    return marketing.promos.list(query(request));
  });

  routes.get('/marketing/promos/assignable', promoAdmin, async (request) => {
    await adminOf(request);
    return marketing.promos.assignable();
  });

  routes.get('/marketing/promos/performance', promoAdmin, async (request) => {
    await adminOf(request);
    return marketing.promos.performance();
  });

  routes.post('/marketing/promos', promoAdmin, async (request) => {
    await adminOf(request);
    return marketing.promos.create(actor(request), validate<SubscriptionPromoInput>(subscriptionPromoInputSchema, request.body));
  });

  routes.patch('/marketing/promos/:id', promoAdmin, async (request) => {
    await adminOf(request);
    return marketing.promos.update(actor(request), param(request, 'id'), validate<Partial<SubscriptionPromoInput>>(subscriptionPromoPatchSchema, request.body));
  });

  routes.post('/marketing/promos/:id/active', promoAdmin, async (request) => {
    await adminOf(request);
    return marketing.promos.setActive(actor(request), param(request, 'id'), validate<{ active: boolean }>(S.referralActiveSchema, request.body).active);
  });

  routes.get('/marketing/promos/:id/usage', promoAdmin, async (request) => {
    await adminOf(request);
    return marketing.promos.usage(param(request, 'id'), query(request));
  });

  // ------------------------------------------------------------------ subscription payments (verification and refunds)

  routes.get('/admin/merchants/:id/subscription/payments', { permissions: ['subscription.manage'] }, (request) => platform.subscriptionPayments(param(request, 'id')));

  routes.post('/admin/merchants/:id/subscription/verify-payment', { permissions: ['subscription.manage'] }, (request) => platform.verifySubscriptionPayment(param(request, 'id'), actor(request).id));

  routes.post('/admin/subscription-payments/:id/refund', { permissions: ['subscription.manage'] }, async (request) => {
    await adminOf(request);
    return marketing.finance.refundPayment(actor(request), param(request, 'id'), validate(S.refundSchema, request.body));
  });

  return routes;
}
