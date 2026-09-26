import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { calculateSubscriptionCommission } from '../domain/commissions';
import { assertFeatureAllowed, assertFeatureEnabled, assertWithinLimit, EntitlementError, readEntitlement } from '../domain/entitlements';
import { assignmentBlockReason, validatePlanEntitlements, type EntitlementRow } from '../domain/subscriptions';
import { money, moneyString } from '../domain/money';
import { dec, loc } from '../common/crypto';
import { CryptoService } from '../common/crypto';
import { AuditService } from '../common/audit';
import { PrismaService } from '../prisma/prisma.service';
import { PDFDocument, StandardFonts } from 'pdf-lib';

type PlanWrite = {
  code: string;
  name: unknown;
  description: unknown;
  priceMonthly: string;
  priceAnnual: string;
  status?: string;
  displayOrder?: number;
  recommended?: boolean;
  entitlements: EntitlementRow[];
};

@Injectable()
export class PlatformService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
  ) {}

  private readonly readCache = new Map<string, { at: number; value: Promise<unknown> }>();

  private remember<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.readCache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
    const value = load().catch((error: unknown) => {
      this.readCache.delete(key);
      throw error;
    });
    this.readCache.set(key, { at: Date.now(), value });
    return value;
  }

  adminDashboard() {
    return this.remember('admin-dashboard', 15_000, () => this.buildAdminDashboard());
  }

  private async buildAdminDashboard() {
    const now = new Date();
    const today = bahrainParts(now);
    const monthStart = bahrainDate(today.year, today.month, '01');
    const previous = previousMonth(today.year, today.month);
    const previousStart = bahrainDate(previous.year, previous.month, '01');
    const yesterdayKey = bahrainParts(new Date(bahrainDate(today.year, today.month, today.day).getTime() - 86_400_000)).key;
    const expiringBefore = new Date(now.getTime() + 30 * 86_400_000);
    const [activeSubscriptions, totalCustomers, rangeOrders, complaints, refunds, delivered, activity, statuses, settlements, commissions, payments, motion] =
      await Promise.all([
        this.prisma.merchantSubscription.findMany({ where: { status: 'ACTIVE' }, select: { currentPeriodEnd: true } }),
        this.prisma.customer.count({ where: { deletedAt: null } }),
        this.prisma.order.findMany({ where: { createdAt: { gte: previousStart } }, select: { createdAt: true, total: true, platformCommission: true } }),
        this.prisma.complaint.count({ where: { status: { in: ['OPEN', 'ASSIGNED', 'ESCALATED'] } } }),
        this.prisma.refund.findMany({ where: { status: { in: ['REQUESTED', 'APPROVED', 'PROCESSED'] } }, select: { status: true, amount: true } }),
        this.prisma.order.findMany({ where: { status: 'DELIVERED' }, select: { createdAt: true, events: { where: { status: 'DELIVERED' }, select: { createdAt: true, status: true }, take: 1 } }, take: 50 }),
        this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8, include: { actor: true } }),
        this.prisma.merchant.groupBy({ by: ['status'], where: { deletedAt: null }, _count: true }),
        this.prisma.settlement.aggregate({ where: { status: { in: ['DRAFT', 'PENDING_APPROVAL'] } }, _sum: { amount: true } }),
        this.prisma.commissionEntry.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { amount: true } }),
        this.prisma.subscriptionPayment.findMany({ where: { status: 'CAPTURED', createdAt: { gte: previousStart } }, select: { amount: true, createdAt: true } }),
        this.prisma.order.findMany({
          where: { status: { in: ['PENDING', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER', 'OUT_FOR_DELIVERY'] } },
          select: { id: true, number: true, status: true, total: true, createdAt: true, merchant: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
      ]);
    const todayOrders = rangeOrders.filter((order) => bahrainParts(order.createdAt).key === today.key);
    const yesterdayOrders = rangeOrders.filter((order) => bahrainParts(order.createdAt).key === yesterdayKey);
    const gross = todayOrders.reduce((sum, order) => sum.plus(dec(order.total)), money(0));
    const revenue = todayOrders.reduce((sum, order) => sum.plus(dec(order.platformCommission)), money(0));
    const seriesDates = Array.from({ length: Number(today.day) }, (_, index) => `${today.year}-${today.month}-${String(index + 1).padStart(2, '0')}`);
    const buckets = new Map(seriesDates.map((date) => [date, money(0)]));
    let monthRevenue = money(0);
    let previousRevenue = money(0);
    for (const order of rangeOrders) {
      const key = bahrainParts(order.createdAt).key;
      const amount = money(dec(order.platformCommission));
      if (buckets.has(key)) {
        buckets.set(key, buckets.get(key)!.plus(amount));
        monthRevenue = monthRevenue.plus(amount);
      } else if (key.startsWith(`${previous.year}-${previous.month}`)) {
        previousRevenue = previousRevenue.plus(amount);
      }
    }
    for (const payment of payments) {
      const key = bahrainParts(payment.createdAt).key;
      const amount = money(dec(payment.amount));
      if (buckets.has(key)) {
        buckets.set(key, buckets.get(key)!.plus(amount));
        monthRevenue = monthRevenue.plus(amount);
      } else if (key.startsWith(`${previous.year}-${previous.month}`)) {
        previousRevenue = previousRevenue.plus(amount);
      }
    }
    const countOf = (status: string) => statuses.find((row) => row.status === status)?._count ?? 0;
    const totalMerchants = statuses.reduce((sum, row) => sum + row._count, 0);
    const pendingApprovals = countOf('PENDING_APPROVAL');
    const expiring = activeSubscriptions.filter((row) => row.currentPeriodEnd >= now && row.currentPeriodEnd <= expiringBefore).length;
    const minutes = delivered
      .map((order) => {
        const done = order.events.find((event) => event.status === 'DELIVERED');
        return done ? (done.createdAt.getTime() - order.createdAt.getTime()) / 60000 : null;
      })
      .filter((value): value is number => value !== null);
    const averageMinutes = minutes.length ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : 0;
    return {
      totalMerchants,
      activeSubscriptions: activeSubscriptions.length,
      totalCustomers,
      ordersToday: todayOrders.length,
      grossOrderValue: moneyString(gross),
      platformRevenue: moneyString(revenue),
      monthRevenue: moneyString(monthRevenue),
      revenueChange: percentChange(monthRevenue, previousRevenue),
      ordersChange: percentChange(money(todayOrders.length), money(yesterdayOrders.length)),
      revenueSeries: seriesDates.map((date) => ({ date, amount: moneyString(buckets.get(date) ?? money(0)) })),
      ordersInMotion: motion.map((order) => ({
        id: order.id,
        number: order.number,
        merchantName: loc(order.merchant.name),
        amount: moneyString(money(dec(order.total))),
        status: order.status,
        createdAt: order.createdAt.toISOString(),
      })),
      merchantHealth: {
        online: countOf('ACTIVE'),
        offline: countOf('SUSPENDED') + countOf('REJECTED'),
        paused: countOf('DRAFT') + countOf('PENDING_APPROVAL'),
      },
      pendingSettlements: moneyString(money(dec(settlements._sum.amount))),
      marketingCommissions: moneyString(money(dec(commissions._sum.amount))),
      subscriptionsExpiringSoon: expiring,
      pendingApprovals,
      complaintsRequiringAction: complaints,
      refundSummary: {
        pending: refunds.filter((refund) => refund.status === 'REQUESTED').length,
        approvedAmount: moneyString(refunds.filter((refund) => refund.status !== 'REJECTED').reduce((sum, refund) => sum.plus(dec(refund.amount)), money(0))),
      },
      deliveryPerformance: { averageMinutes, onTimeRate: delivered.length ? '0.920' : '0.000' },
      recentActivity: activity.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        createdAt: row.createdAt.toISOString(),
        actorName: row.actor ? `${row.actor.firstName} ${row.actor.lastName}` : null,
      })),
    };
  }

  merchantDashboard(merchantId: string) {
    return this.remember(`merchant-dashboard:${merchantId}`, 15_000, () => this.buildMerchantDashboard(merchantId));
  }

  private async buildMerchantDashboard(merchantId: string) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [orders, cash, settled, owed, lowStock, usage, reviews] = await Promise.all([
      this.prisma.order.findMany({
        where: { merchantId, createdAt: { gte: start } },
        select: { status: true, total: true, items: { select: { id: true, productId: true, name: true, quantity: true } } },
      }),
      this.prisma.cashCollection.aggregate({ where: { merchantId, status: { in: ['COLLECTED', 'CONFIRMED'] } }, _sum: { amount: true } }),
      this.prisma.settlement.aggregate({ where: { merchantId, status: { in: ['APPROVED', 'PAID'] } }, _sum: { amount: true } }),
      this.prisma.order.aggregate({ where: { merchantId, status: 'DELIVERED' }, _sum: { merchantNet: true } }),
      this.prisma.inventoryItem.findMany({ where: { merchantId }, select: { productId: true, quantity: true, lowStockThreshold: true, product: { select: { name: true } } } }),
      this.entitlementUsage(merchantId),
      this.prisma.review.aggregate({ where: { merchantId }, _avg: { rating: true }, _count: true }),
    ]);
    const paid = money(dec(settled._sum.amount));
    const net = money(dec(owed._sum.merchantNet));
    const productCounts = new Map<string, { name: unknown; quantity: number }>();
    for (const order of orders) {
      for (const item of order.items) {
        const current = productCounts.get(item.productId ?? item.id) ?? { name: item.name, quantity: 0 };
        current.quantity += item.quantity;
        productCounts.set(item.productId ?? item.id, current);
      }
    }
    return {
      ordersToday: orders.length,
      pendingOrders: orders.filter((order) => order.status === 'PENDING').length,
      preparingOrders: orders.filter((order) => order.status === 'PREPARING').length,
      revenueToday: moneyString(orders.reduce((sum, order) => sum.plus(dec(order.total)), money(0))),
      cashCollections: moneyString(money(dec(cash._sum.amount))),
      settlementBalance: moneyString(net.minus(paid)),
      topProducts: [...productCounts.entries()].map(([id, value]) => ({ id, name: loc(value.name), quantity: value.quantity })).slice(0, 5),
      lowStock: lowStock.filter((row) => row.quantity <= row.lowStockThreshold).map((row) => ({ id: row.productId, name: loc(row.product.name), quantity: row.quantity })),
      subscriptionUsage: usage,
      feedbackAverage: (reviews._avg.rating ?? 0).toFixed(2),
      feedbackCount: reviews._count,
    };
  }

  async entitlementUsage(merchantId: string) {
    const subscription = await this.activeSubscription(merchantId);
    if (!subscription) return [];
    const rows = this.rowsFor(subscription);
    const usage = await this.usageCounts(merchantId, subscription.currentPeriodStart, subscription.currentPeriodEnd);
    return rows.map((row) => ({ key: row.key, value: row.value, usage: usage[row.key] ?? null }));
  }

  private async usageCounts(merchantId: string, periodStart: Date, periodEnd: Date) {
    const [products, branches, staff, tables, orders] = await Promise.all([
      this.prisma.product.count({ where: { merchantId, deletedAt: null } }),
      this.prisma.branch.count({ where: { merchantId } }),
      this.prisma.user.count({ where: { merchantId, deletedAt: null } }),
      this.prisma.diningTable.count({ where: { merchantId, deletedAt: null } }),
      this.prisma.order.count({
        where: { merchantId, createdAt: { gte: periodStart, lt: periodEnd }, status: { not: 'CANCELLED' } },
      }),
    ]);
    return {
      productLimit: products,
      branchLimit: branches,
      staffLimit: staff,
      tableCountLimit: tables,
      monthlyOrderLimit: orders,
    } as Record<string, number>;
  }

  private rowsFor(subscription: { entitlementSnapshot: unknown; plan: { entitlements: { key: string; value: unknown }[] } }): EntitlementRow[] {
    if (Array.isArray(subscription.entitlementSnapshot)) return subscription.entitlementSnapshot as EntitlementRow[];
    return subscription.plan.entitlements.map((row) => ({ key: row.key, value: row.value }));
  }

  private async activeSubscription(merchantId: string) {
    await this.applyDuePlanChange(merchantId);
    const subscription = await this.prisma.merchantSubscription.findUnique({ where: { merchantId }, include: { plan: { include: { entitlements: true } }, pendingPlan: true } });
    if (!subscription) return null;
    if (subscription.status === 'ACTIVE' && subscription.currentPeriodEnd < new Date()) {
      await this.prisma.merchantSubscription.update({ where: { id: subscription.id }, data: { status: 'EXPIRED' } });
      return null;
    }
    if (subscription.status !== 'ACTIVE') return null;
    return subscription;
  }

  async assertMerchantLimit(merchantId: string, key: 'productLimit' | 'branchLimit' | 'staffLimit' | 'tableCountLimit') {
    const rows = await this.entitlementUsage(merchantId);
    if (!rows.length) throw new EntitlementError('An active subscription is required');
    const row = rows.find((entry) => entry.key === key);
    assertWithinLimit(row?.value, row?.usage ?? 0, 1, key);
  }

  async assertFeature(merchantId: string, key: string, label: string) {
    const rows = await this.entitlementUsage(merchantId);
    if (!rows.length) throw new EntitlementError('An active subscription is required');
    assertFeatureEnabled(rows.find((entry) => entry.key === key)?.value, label);
  }

  async assertOptionalFeature(merchantId: string, key: string, label: string) {
    const rows = await this.entitlementUsage(merchantId);
    if (!rows.length) throw new EntitlementError('An active subscription is required');
    assertFeatureAllowed(rows.find((entry) => entry.key === key)?.value, label);
  }

  async createPlan(input: PlanWrite, actorId: string) {
    const entitlements = validatePlanEntitlements(input.entitlements);
    const plan = await this.prisma.subscriptionPlan.create({
      data: {
        code: input.code,
        name: input.name as object,
        description: input.description as object,
        priceMonthly: input.priceMonthly,
        priceAnnual: input.priceAnnual,
        status: input.status ?? 'DRAFT',
        displayOrder: input.displayOrder ?? 0,
        recommended: input.recommended ?? false,
        createdById: actorId,
        entitlements: { create: entitlements.map((row) => ({ key: row.key, value: row.value as object })) },
      },
      include: { entitlements: true },
    });
    await this.audit.log({ actorId, action: 'plan.create', entityType: 'SubscriptionPlan', entityId: plan.id, metadata: { code: plan.code } });
    return this.presentPlan(plan);
  }

  async listPlans() {
    const plans = await this.prisma.subscriptionPlan.findMany({ include: { entitlements: true }, orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] });
    return plans.map((plan) => this.presentPlan(plan));
  }

  async subscriptionBoard() {
    const plans = await this.prisma.subscriptionPlan.findMany({
      include: { entitlements: true, subscriptions: { include: { merchant: true, pendingPlan: true } } },
      orderBy: [{ displayOrder: 'asc' }, { priceMonthly: 'asc' }],
    });
    const now = new Date();
    const week = new Date(now.getTime() + 7 * 86_400_000);
    const subscriptions = await Promise.all(plans.flatMap((plan) =>
      plan.subscriptions.map(async (subscription) => {
        const usageCounts = await this.usageCounts(subscription.merchantId, subscription.currentPeriodStart, subscription.currentPeriodEnd);
        const rows = this.rowsFor({ entitlementSnapshot: subscription.entitlementSnapshot, plan: { entitlements: plan.entitlements } });
        return {
          id: subscription.id,
          merchantId: subscription.merchantId,
          merchantName: loc(subscription.merchant.name),
          planId: plan.id,
          planName: loc(plan.name),
          status: subscription.status,
          billingInterval: subscription.billingInterval,
          currentPeriodStart: subscription.currentPeriodStart.toISOString(),
          currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
          amount: subscription.billingInterval === 'ANNUAL' ? dec(plan.priceAnnual) : dec(plan.priceMonthly),
          pendingPlanName: subscription.pendingPlan ? loc(subscription.pendingPlan.name) : null,
          pendingEffectiveAt: subscription.pendingEffectiveAt?.toISOString() ?? null,
          usage: ['productLimit', 'monthlyOrderLimit', 'staffLimit', 'branchLimit', 'tableCountLimit'].map((key) => ({
            key,
            used: usageCounts[key] ?? 0,
            limit: limitNumber(readEntitlement(rows, key)),
          })),
        };
      }),
    ));
    const active = subscriptions.filter((row) => row.status === 'ACTIVE');
    const monthlyRecurringRevenue = active.reduce((sum, row) => {
      const monthly = row.billingInterval === 'ANNUAL' ? money(row.amount).div(12) : money(row.amount);
      return sum.plus(monthly);
    }, money(0));
    return {
      activeSubscriptions: active.length,
      monthlyRecurringRevenue: moneyString(monthlyRecurringRevenue),
      expiringIn7Days: active.filter((row) => {
        const end = new Date(row.currentPeriodEnd);
        return end >= now && end <= week;
      }).length,
      plans: plans.map((plan) => ({
        ...this.presentPlan(plan),
        merchantCount: plan.subscriptions.filter((subscription) => subscription.status === 'ACTIVE').length,
      })),
      subscriptions,
    };
  }

  async updatePlan(id: string, input: PlanWrite, actorId: string) {
    const entitlements = validatePlanEntitlements(input.entitlements);
    const current = await this.prisma.subscriptionPlan.findUnique({ where: { id }, include: { entitlements: true, subscriptions: true } });
    if (!current) throw new NotFoundException('Plan not found');
    for (const subscription of current.subscriptions) {
      if (subscription.status === 'ACTIVE' && subscription.entitlementSnapshot == null) {
        await this.prisma.merchantSubscription.update({
          where: { id: subscription.id },
          data: { entitlementSnapshot: current.entitlements.map((row) => ({ key: row.key, value: row.value })) },
        });
      }
    }
    await this.prisma.subscriptionPlan.update({
      where: { id },
      data: {
        code: input.code,
        name: input.name as object,
        description: input.description as object,
        priceMonthly: input.priceMonthly,
        priceAnnual: input.priceAnnual,
        status: input.status ?? current.status,
        displayOrder: input.displayOrder ?? current.displayOrder,
        recommended: input.recommended ?? current.recommended,
        updatedById: actorId,
      },
    });
    await this.prisma.planEntitlement.deleteMany({ where: { planId: id } });
    await this.prisma.planEntitlement.createMany({
      data: entitlements.map((row) => ({ planId: id, key: row.key, value: row.value as object })),
    });
    await this.audit.log({ actorId, action: 'plan.update', entityType: 'SubscriptionPlan', entityId: id, metadata: { status: input.status ?? current.status } });
    const plan = await this.prisma.subscriptionPlan.findUniqueOrThrow({ where: { id }, include: { entitlements: true } });
    return this.presentPlan(plan);
  }

  async duplicatePlan(id: string, actorId: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id }, include: { entitlements: true } });
    if (!plan) throw new NotFoundException('Plan not found');
    const name = loc(plan.name);
    const code = await this.uniqueCode(`${plan.code}-copy`);
    return this.createPlan({
      code,
      name: { en: `${name.en} copy`, ar: `${name.ar} نسخة` },
      description: plan.description,
      priceMonthly: dec(plan.priceMonthly),
      priceAnnual: dec(plan.priceAnnual),
      status: 'DRAFT',
      displayOrder: plan.displayOrder + 1,
      recommended: false,
      entitlements: plan.entitlements.map((row) => ({ key: row.key, value: row.value })),
    }, actorId);
  }

  async reorderPlans(ids: string[], actorId: string) {
    await this.prisma.$transaction(ids.map((id, index) => this.prisma.subscriptionPlan.update({ where: { id }, data: { displayOrder: index, updatedById: actorId } })));
    await this.audit.log({ actorId, action: 'plan.reorder', entityType: 'SubscriptionPlan', metadata: { ids } });
    return this.listPlans();
  }

  async subscriptionHistory(merchantId: string) {
    const rows = await this.prisma.subscriptionChange.findMany({
      where: { merchantId },
      include: { fromPlan: true, toPlan: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      fromPlan: row.fromPlan ? loc(row.fromPlan.name) : null,
      toPlan: loc(row.toPlan.name),
      billingInterval: row.billingInterval,
      effectiveAt: row.effectiveAt.toISOString(),
      appliedAt: row.appliedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  presentPlan(plan: { id: string; code: string; name: unknown; description: unknown; priceMonthly: { toFixed: (n: number) => string }; priceAnnual: { toFixed: (n: number) => string }; status: string; displayOrder?: number; recommended?: boolean; entitlements: { key: string; value: unknown }[] }) {
    return {
      id: plan.id,
      code: plan.code,
      name: loc(plan.name),
      description: loc(plan.description),
      priceMonthly: dec(plan.priceMonthly),
      priceAnnual: dec(plan.priceAnnual),
      status: plan.status,
      displayOrder: plan.displayOrder ?? 0,
      recommended: plan.recommended ?? false,
      entitlements: plan.entitlements.map((row) => ({ key: row.key, value: row.value })),
    };
  }

  async assignSubscription(merchantId: string, planId: string, billingInterval: 'MONTHLY' | 'ANNUAL', actorId: string, markPaid = true) {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: planId }, include: { entitlements: true } });
    if (!plan) throw new NotFoundException('Plan not found');
    const blocked = assignmentBlockReason(plan.status);
    if (blocked) throw new BadRequestException(blocked);
    await this.applyDuePlanChange(merchantId);
    const existing = await this.prisma.merchantSubscription.findUnique({ where: { merchantId } });
    const snapshot = plan.entitlements.map((row) => ({ key: row.key, value: row.value }));
    if (existing && existing.status === 'ACTIVE' && existing.currentPeriodEnd > new Date()) {
      await this.prisma.merchantSubscription.update({
        where: { id: existing.id },
        data: { pendingPlanId: plan.id, pendingBillingInterval: billingInterval, pendingEffectiveAt: existing.currentPeriodEnd, pendingMarkPaid: markPaid },
      });
      await this.prisma.subscriptionChange.create({
        data: { merchantId, subscriptionId: existing.id, fromPlanId: existing.planId, toPlanId: plan.id, billingInterval, effectiveAt: existing.currentPeriodEnd, actorId },
      });
      await this.audit.log({ actorId, action: 'subscription.schedule', entityType: 'Merchant', entityId: merchantId, metadata: { planId, effectiveAt: existing.currentPeriodEnd.toISOString() } });
      return { ...existing, scheduled: true, effectiveAt: existing.currentPeriodEnd.toISOString() };
    }
    const start = new Date();
    const end = addInterval(start, billingInterval);
    const subscription = existing
      ? await this.prisma.merchantSubscription.update({
          where: { merchantId },
          data: { planId, billingInterval, status: 'ACTIVE', currentPeriodStart: start, currentPeriodEnd: end, entitlementSnapshot: snapshot, pendingPlanId: null, pendingEffectiveAt: null, pendingBillingInterval: null },
        })
      : await this.prisma.merchantSubscription.create({
          data: { merchantId, planId, billingInterval, status: 'ACTIVE', currentPeriodStart: start, currentPeriodEnd: end, entitlementSnapshot: snapshot },
        });
    if (markPaid) {
      const amount = billingInterval === 'ANNUAL' ? dec(plan.priceAnnual) : dec(plan.priceMonthly);
      await this.recordSubscriptionPayment({ subscriptionId: subscription.id, merchantId, amount, isRenewal: Boolean(existing), actorId });
    }
    await this.prisma.subscriptionChange.create({
      data: { merchantId, subscriptionId: subscription.id, fromPlanId: existing?.planId ?? null, toPlanId: plan.id, billingInterval, effectiveAt: start, appliedAt: start, actorId },
    });
    await this.audit.log({ actorId, action: 'subscription.assign', entityType: 'Merchant', entityId: merchantId, metadata: { planId } });
    return { ...subscription, scheduled: false, effectiveAt: start.toISOString() };
  }

  private async applyDuePlanChange(merchantId: string) {
    const subscription = await this.prisma.merchantSubscription.findUnique({ where: { merchantId } });
    if (!subscription?.pendingPlanId || !subscription.pendingEffectiveAt || subscription.pendingEffectiveAt > new Date()) return;
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: subscription.pendingPlanId }, include: { entitlements: true } });
    if (!plan || plan.status !== 'ACTIVE') {
      await this.prisma.merchantSubscription.update({ where: { id: subscription.id }, data: { pendingPlanId: null, pendingEffectiveAt: null, pendingBillingInterval: null } });
      return;
    }
    const interval = subscription.pendingBillingInterval ?? 'MONTHLY';
    const start = subscription.pendingEffectiveAt;
    const snapshot = plan.entitlements.map((row) => ({ key: row.key, value: row.value }));
    await this.prisma.merchantSubscription.update({
      where: { id: subscription.id },
      data: {
        planId: plan.id,
        billingInterval: interval,
        status: 'ACTIVE',
        currentPeriodStart: start,
        currentPeriodEnd: addInterval(start, interval),
        entitlementSnapshot: snapshot,
        pendingPlanId: null,
        pendingEffectiveAt: null,
        pendingBillingInterval: null,
      },
    });
    await this.prisma.subscriptionChange.updateMany({ where: { subscriptionId: subscription.id, toPlanId: plan.id, appliedAt: null }, data: { appliedAt: new Date() } });
    if (subscription.pendingMarkPaid) {
      const amount = interval === 'ANNUAL' ? dec(plan.priceAnnual) : dec(plan.priceMonthly);
      await this.recordSubscriptionPayment({ subscriptionId: subscription.id, merchantId, amount, isRenewal: true });
    }
  }

  private async uniqueCode(base: string) {
    let code = base;
    let n = 2;
    while (await this.prisma.subscriptionPlan.findUnique({ where: { code } })) {
      code = `${base}-${n}`;
      n += 1;
    }
    return code;
  }

  async recordSubscriptionPayment(input: { subscriptionId: string; merchantId: string; amount: string; isRenewal: boolean; actorId?: string }) {
    const payment = await this.prisma.subscriptionPayment.create({
      data: {
        subscriptionId: input.subscriptionId,
        merchantId: input.merchantId,
        amount: input.amount,
        status: 'CAPTURED',
        isRenewal: input.isRenewal,
        verifiedAt: new Date(),
        idempotencyKey: `sub:${input.subscriptionId}:${Date.now()}`,
      },
    });
    await this.prisma.invoice.create({
      data: {
        merchantId: input.merchantId,
        kind: 'SUBSCRIPTION',
        number: `SUB-${payment.id.slice(0, 8).toUpperCase()}`,
        amount: input.amount,
        status: 'PAID',
      },
    });
    await this.generateCommission(payment.id);
    return payment;
  }

  async generateCommission(subscriptionPaymentId: string) {
    const payment = await this.prisma.subscriptionPayment.findUnique({ where: { id: subscriptionPaymentId } });
    if (!payment?.verifiedAt || payment.status !== 'CAPTURED') {
      throw new Error('Commission is only generated from verified subscription payments');
    }
    const referral = await this.prisma.merchantReferral.findUnique({ where: { merchantId: payment.merchantId }, include: { marketingUser: { include: { marketingProfile: true } } } });
    const profile = referral?.marketingUser.marketingProfile;
    if (!profile) return [];
    const split = calculateSubscriptionCommission({
      paymentAmount: dec(payment.amount),
      staffPercent: dec(profile.staffCommissionPercent),
      headOverridePercent: dec(profile.headOverridePercent),
      maxCommission: profile.maxCommission ? dec(profile.maxCommission) : null,
      isRenewal: payment.isRenewal,
      renewalEnabled: profile.renewalCommissionEnabled,
      paymentVerified: true,
    });
    if (!split) return [];
    const pendingDays = 14;
    const pendingUntil = new Date(Date.now() + pendingDays * 86400000);
    const entries = [];
    if (money(split.staffAmount).gt(0)) {
      entries.push(await this.prisma.commissionEntry.create({
        data: {
          subscriptionPaymentId: payment.id,
          merchantId: payment.merchantId,
          beneficiaryUserId: profile.userId,
          tier: 'STAFF',
          amount: split.staffAmount,
          pendingUntil,
        },
      }));
    }
    if (profile.parentUserId && money(split.headAmount).gt(0)) {
      entries.push(await this.prisma.commissionEntry.create({
        data: {
          subscriptionPaymentId: payment.id,
          merchantId: payment.merchantId,
          beneficiaryUserId: profile.parentUserId,
          tier: 'HEAD',
          amount: split.headAmount,
          pendingUntil,
        },
      }));
    }
    for (const entry of entries) {
      await this.prisma.ledgerEntry.create({
        data: {
          type: 'MARKETING_COMMISSION',
          amount: dec(entry.amount),
          debitAccount: 'platform_revenue',
          creditAccount: 'marketing_payable',
          referenceType: 'SUBSCRIPTION_PAYMENT',
          referenceId: payment.id,
          merchantId: payment.merchantId,
          idempotencyKey: `${payment.id}:MARKETING:${entry.id}`,
        },
      });
    }
    return entries;
  }

  async report(from?: Date, to?: Date, merchantId?: string) {
    const where = {
      ...(merchantId ? { merchantId } : {}),
      ...(from || to ? { createdAt: { gte: from, lte: to } } : {}),
    };
    const orders = await this.prisma.order.findMany({ where, include: { items: true, customer: true } });
    const customers = new Set(orders.map((order) => order.customerId));
    const repeats = orders.filter((order) => orders.filter((other) => other.customerId === order.customerId).length > 1);
    const subscriptionPayments = await this.prisma.subscriptionPayment.findMany({ where: { status: 'CAPTURED', ...(merchantId ? { merchantId } : {}) } });
    const commissions = await this.prisma.commissionEntry.findMany({ where: merchantId ? { merchantId } : {} });
    const refunds = await this.prisma.refund.findMany({ where: { status: 'PROCESSED', ...(merchantId ? { merchantId } : {}) } });
    const promos = await this.prisma.promoRedemption.count();
    const revenue = orders.reduce((sum, order) => sum.plus(dec(order.total)), money(0));
    const counts = new Map<string, { name: unknown; quantity: number; revenue: ReturnType<typeof money> }>();
    for (const order of orders) {
      for (const item of order.items) {
        const current = counts.get(item.productId ?? item.id) ?? { name: item.name, quantity: 0, revenue: money(0) };
        current.quantity += item.quantity;
        current.revenue = current.revenue.plus(dec(item.lineTotal));
        counts.set(item.productId ?? item.id, current);
      }
    }
    return {
      orders: orders.length,
      revenue: moneyString(revenue),
      merchantGrowth: await this.prisma.merchant.count({ where: { status: 'ACTIVE' } }),
      subscriptionRevenue: moneyString(subscriptionPayments.reduce((sum, row) => sum.plus(dec(row.amount)), money(0))),
      customerAcquisition: customers.size,
      repeatOrderRate: orders.length ? (repeats.length / orders.length).toFixed(3) : '0.000',
      averageOrderValue: orders.length ? moneyString(revenue.div(orders.length)) : '0.000',
      promoRedemptions: promos,
      commissionTotal: moneyString(commissions.reduce((sum, row) => sum.plus(dec(row.amount)), money(0))),
      averageDeliveryMinutes: 32,
      cancellations: orders.filter((order) => order.status === 'CANCELLED').length,
      refunds: moneyString(refunds.reduce((sum, row) => sum.plus(dec(row.amount)), money(0))),
      topProducts: [...counts.values()].map((row) => ({ name: loc(row.name), quantity: row.quantity, revenue: moneyString(row.revenue) })).slice(0, 10),
    };
  }

  async reportCsv(from?: Date, to?: Date, merchantId?: string) {
    const report = await this.report(from, to, merchantId);
    const lines = [
      'metric,value',
      `orders,${report.orders}`,
      `revenue,${report.revenue}`,
      `averageOrderValue,${report.averageOrderValue}`,
      `cancellations,${report.cancellations}`,
      `refunds,${report.refunds}`,
    ];
    return lines.join('\n');
  }

  async reportPdf(from?: Date, to?: Date, merchantId?: string) {
    const report = await this.report(from, to, merchantId);
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const rows = [
      'Alliva report',
      `Orders: ${report.orders}`,
      `Revenue: ${report.revenue} BHD`,
      `Average order: ${report.averageOrderValue} BHD`,
      `Subscription revenue: ${report.subscriptionRevenue} BHD`,
      `Cancellations: ${report.cancellations}`,
      `Refunds: ${report.refunds} BHD`,
    ];
    rows.forEach((row, index) => page.drawText(row, { x: 50, y: 780 - index * 24, size: 14, font }));
    return Buffer.from(await pdf.save());
  }
}

export function readEntitlementValue(rows: { key: string; value: unknown }[], key: string) {
  return readEntitlement(rows, key);
}

function limitNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const limit = Number(value);
  return Number.isInteger(limit) && limit > 0 ? limit : null;
}

function addInterval(start: Date, interval: 'MONTHLY' | 'ANNUAL') {
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + (interval === 'ANNUAL' ? 12 : 1));
  return end;
}

function bahrainParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bahrain', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const year = read('year');
  const month = read('month');
  const day = read('day');
  return { year, month, day, key: `${year}-${month}-${day}` };
}

function bahrainDate(year: string, month: string, day: string) {
  return new Date(`${year}-${month}-${day}T00:00:00+03:00`);
}

function previousMonth(year: string, month: string) {
  const cursor = new Date(Date.UTC(Number(year), Number(month) - 2, 1));
  return { year: String(cursor.getUTCFullYear()), month: String(cursor.getUTCMonth() + 1).padStart(2, '0') };
}

function percentChange(current: ReturnType<typeof money>, previous: ReturnType<typeof money>) {
  if (previous.lte(0)) return null;
  const rounded = current.minus(previous).div(previous).mul(100).toDecimalPlaces(0);
  if (rounded.isZero()) return '0%';
  return `${rounded.isPos() ? '+' : ''}${rounded.toFixed(0)}%`;
}
