import type { FulfillmentType, MerchantDashboard } from '@alliva/types';
import type { MarketingFinanceService } from './marketing/finance.service';
import type { MarketingPromoService } from './marketing/promo.service';
import { assertFeatureAllowed, assertFeatureEnabled, assertWithinLimit, EntitlementError, readEntitlement } from '../domain/entitlements';
import { assignmentBlockReason, subscriptionShouldExpire, validatePlanEntitlements, type EntitlementRow } from '../domain/subscriptions';
import { money, moneyString } from '../domain/money';
import { platformPlanCharges, priceWithCharges } from '../domain/charges';
import { availableBalance } from '../domain/wallet';
import { badRequest, notFound } from '../common/errors';
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

export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly marketing?: { promo: MarketingPromoService; finance: MarketingFinanceService },
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
        this.prisma.commissionEntry.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { amount: true, reversedAmount: true } }),
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
      marketingCommissions: moneyString(money(dec(commissions._sum.amount)).minus(dec(commissions._sum.reversedAmount))),
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

  merchantDashboard(merchantId: string, branchId?: string) {
    const scope = branchId ? `${merchantId}:${branchId}` : merchantId;
    return this.remember(`merchant-dashboard:${scope}`, 15_000, () => this.buildMerchantDashboard(merchantId, branchId));
  }

  forgetMerchantDashboard(merchantId: string) {
    const prefix = `merchant-dashboard:${merchantId}`;
    for (const key of this.readCache.keys()) {
      if (key === prefix || key.startsWith(`${prefix}:`)) this.readCache.delete(key);
    }
  }

  private async buildMerchantDashboard(merchantId: string, branchId?: string): Promise<MerchantDashboard> {
    const now = new Date();
    const today = bahrainParts(now);
    const todayStart = bahrainDate(today.year, today.month, today.day);
    const yesterdayKey = bahrainParts(new Date(todayStart.getTime() - 86_400_000)).key;
    const weekStart = new Date(todayStart.getTime() - 6 * 86_400_000);
    const prevWeekStart = new Date(todayStart.getTime() - 13 * 86_400_000);
    const monthStart = new Date(todayStart.getTime() - 29 * 86_400_000);
    const prevMonthStart = new Date(todayStart.getTime() - 59 * 86_400_000);
    const liveStatuses = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER', 'OUT_FOR_DELIVERY'] as const;
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({ where: { id: branchId, merchantId }, select: { id: true } });
      if (!branch) branchId = undefined;
    }
    const orderWhere = { merchantId, ...(branchId ? { branchId } : {}) };
    const [merchant, rangeOrders, liveOrders, cash, settled, reserved, owed, lowStock, usage, reviews, driverRows, driversAssigned] = await Promise.all([
      this.prisma.merchant.findUnique({
        where: { id: merchantId },
        select: {
          name: true,
          slug: true,
          availability: true,
          preparationMinutes: true,
          subscription: { select: { plan: { select: { name: true } } } },
          branches: { where: { active: true }, select: { id: true, name: true, city: true }, orderBy: { createdAt: 'asc' } },
        },
      }),
      this.prisma.order.findMany({
        where: { ...orderWhere, createdAt: { gte: prevMonthStart } },
        select: {
          id: true,
          number: true,
          status: true,
          fulfillmentType: true,
          total: true,
          createdAt: true,
          preparationMinutes: true,
          estimatedReadyAt: true,
          addressSnapshot: true,
          branch: { select: { latitude: true, longitude: true } },
          customer: { select: { user: { select: { firstName: true, lastName: true } } } },
          table: { select: { number: true } },
          items: { select: { id: true, productId: true, name: true, quantity: true, lineTotal: true } },
          events: { where: { status: { in: ['PREPARING', 'READY_FOR_PICKUP', 'DELIVERED'] } }, select: { status: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        take: 3000,
      }),
      this.prisma.order.findMany({
        where: { ...orderWhere, status: { in: [...liveStatuses] } },
        select: {
          id: true,
          number: true,
          status: true,
          fulfillmentType: true,
          total: true,
          createdAt: true,
          preparationMinutes: true,
          estimatedReadyAt: true,
          customer: { select: { user: { select: { firstName: true, lastName: true } } } },
          table: { select: { number: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 60,
      }),
      this.prisma.cashCollection.aggregate({ where: { merchantId, status: { in: ['COLLECTED', 'CONFIRMED'] } }, _sum: { amount: true } }),
      this.prisma.settlement.aggregate({ where: { merchantId, status: { in: ['APPROVED', 'PAID'] } }, _sum: { amount: true } }),
      this.prisma.settlement.aggregate({ where: { merchantId, status: { in: ['DRAFT', 'PENDING_APPROVAL'] } }, _sum: { amount: true } }),
      this.prisma.order.aggregate({ where: { merchantId, status: 'DELIVERED' }, _sum: { merchantNet: true } }),
      this.prisma.inventoryItem.findMany({
        where: { merchantId, ...(branchId ? { branchId } : {}) },
        select: { productId: true, quantity: true, lowStockThreshold: true, product: { select: { name: true } } },
      }),
      this.entitlementUsage(merchantId),
      this.prisma.review.aggregate({ where: { merchantId }, _avg: { rating: true }, _count: true }),
      this.prisma.driverProfile.findMany({
        where: { merchantId, active: true },
        select: { id: true, user: { select: { firstName: true, lastName: true } } },
        take: 20,
      }),
      this.prisma.dispatchAssignment.count({
        where: { merchantId, order: { status: { in: ['ASSIGNED_TO_DRIVER', 'OUT_FOR_DELIVERY'] }, ...(branchId ? { branchId } : {}) } },
      }),
    ]);
    const paid = dec(settled._sum.amount);
    const net = dec(owed._sum.merchantNet);
    const dayKey = (date: Date) => bahrainParts(date).key;
    const todayOrders = rangeOrders.filter((order) => dayKey(order.createdAt) === today.key);
    const yesterdayOrders = rangeOrders.filter((order) => dayKey(order.createdAt) === yesterdayKey);
    const weekOrders = rangeOrders.filter((order) => order.createdAt >= weekStart);
    const prevWeekOrders = rangeOrders.filter((order) => order.createdAt >= prevWeekStart && order.createdAt < weekStart);
    const monthOrders = rangeOrders.filter((order) => order.createdAt >= monthStart);
    const prevMonthOrders = rangeOrders.filter((order) => order.createdAt >= prevMonthStart && order.createdAt < monthStart);
    const soldToday = todayOrders.filter((order) => order.status !== 'CANCELLED' && order.status !== 'REFUNDED');
    const netSales = sumOrderTotals(soldToday);
    const productCounts = new Map<string, { name: unknown; quantity: number; orders: Set<string>; revenue: ReturnType<typeof money> }>();
    for (const order of soldToday) {
      for (const item of order.items) {
        const id = item.productId ?? item.id;
        const current = productCounts.get(id) ?? { name: item.name, quantity: 0, orders: new Set<string>(), revenue: money(0) };
        current.quantity += item.quantity;
        current.orders.add(order.id);
        current.revenue = current.revenue.plus(money(dec(item.lineTotal)));
        productCounts.set(id, current);
      }
    }
    const imageIds = [...productCounts.keys()].filter((id) => soldToday.some((order) => order.items.some((item) => item.productId === id)));
    const images = imageIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: imageIds } }, select: { id: true, imageUrl: true } })
      : [];
    const imageById = new Map(images.map((product) => [product.id, product.imageUrl]));
    const prepSamples = soldToday
      .map((order) => preparationSpan(order.events))
      .filter((value): value is number => value !== null);
    const target = merchant?.preparationMinutes ?? 20;
    const attentionOrders = liveOrders.filter((order) => needsAttention(order, now, target)).length;
    const limitFor = (key: string) => {
      const row = usage.find((entry) => entry.key === key);
      return { used: row?.usage ?? 0, limit: limitNumber(row?.value) };
    };
    const dashboard: MerchantDashboard = {
      ordersToday: todayOrders.length,
      pendingOrders: todayOrders.filter((order) => order.status === 'PENDING').length,
      preparingOrders: todayOrders.filter((order) => order.status === 'PREPARING').length,
      revenueToday: moneyString(netSales),
      cashCollections: moneyString(money(dec(cash._sum.amount))),
      settlementBalance: availableBalance(net, paid, dec(reserved._sum.amount)),
      topProducts: [...productCounts.entries()]
        .map(([id, value]) => ({
          id,
          name: loc(value.name),
          quantity: value.quantity,
          orders: value.orders.size,
          revenue: moneyString(value.revenue),
          imageUrl: imageById.get(id) ?? null,
        }))
        .sort((a, b) => Number(b.revenue) - Number(a.revenue))
        .slice(0, 4),
      lowStock: lowStock
        .filter((row) => row.quantity <= row.lowStockThreshold)
        .sort((a, b) => a.quantity - b.quantity)
        .map((row) => ({ id: row.productId, name: loc(row.product.name), quantity: row.quantity })),
      subscriptionUsage: usage,
      feedbackAverage: (reviews._avg.rating ?? 0).toFixed(2),
      feedbackCount: reviews._count,
      merchantName: loc(merchant?.name),
      slug: merchant?.slug ?? '',
      acceptingOrders: merchant?.availability === 'OPEN',
      preparationTargetMinutes: target,
      branches: (merchant?.branches ?? []).map((branch) => ({ id: branch.id, name: loc(branch.name), city: branch.city })),
      ordersChange: percentChange(money(todayOrders.length), money(yesterdayOrders.length)),
      salesChange: percentChange(netSales, sumOrderTotals(yesterdayOrders)),
      netSales: moneyString(netSales),
      activeOrders: liveOrders.length,
      attentionOrders,
      averagePreparationMinutes: prepSamples.length ? Math.round(prepSamples.reduce((sum, value) => sum + value, 0) / prepSamples.length) : null,
      liveOrders: liveOrders.map((order) => ({
        id: order.id,
        number: order.number,
        customerName: `${order.customer.user.firstName} ${order.customer.user.lastName}`.trim(),
        tableNumber: order.table?.number ?? null,
        fulfillmentType: order.fulfillmentType,
        amount: moneyString(money(dec(order.total))),
        status: order.status,
        createdAt: order.createdAt.toISOString(),
        preparationMinutes: order.preparationMinutes,
      })),
      drivers: driverRows.map((driver) => ({ id: driver.id, name: `${driver.user.firstName} ${driver.user.lastName}`.trim() })),
      sales: {
        today: salesSeries(hourKeys(), todayOrders, (order) => String(bahrainHour(order.createdAt)).padStart(2, '0')),
        week: salesSeries(dayKeys(todayStart, 7), weekOrders, (order) => dayKey(order.createdAt)),
        month: salesSeries(dayKeys(todayStart, 30), monthOrders, (order) => dayKey(order.createdAt)),
      },
      channels: {
        today: channelRows(todayOrders, yesterdayOrders),
        week: channelRows(weekOrders, prevWeekOrders),
        month: channelRows(monthOrders, prevMonthOrders),
      },
      delivery: deliveryStats(weekOrders, prevWeekOrders, driverRows.length, driversAssigned),
      plan: {
        name: merchant?.subscription ? loc(merchant.subscription.plan.name) : null,
        products: limitFor('productLimit'),
        orders: limitFor('monthlyOrderLimit'),
        staff: limitFor('staffLimit'),
      },
    };
    return dashboard;
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

  async expireDueSubscription(merchantId: string) {
    await this.applyDuePlanChange(merchantId);
    const subscription = await this.prisma.merchantSubscription.findUnique({ where: { merchantId } });
    if (!subscription || !subscriptionShouldExpire(subscription)) return;
    await this.prisma.merchantSubscription.update({ where: { id: subscription.id }, data: { status: 'EXPIRED' } });
  }

  private async activeSubscription(merchantId: string) {
    await this.expireDueSubscription(merchantId);
    const subscription = await this.prisma.merchantSubscription.findUnique({ where: { merchantId }, include: { plan: { include: { entitlements: true } }, pendingPlan: true } });
    if (!subscription || subscription.status !== 'ACTIVE') return null;
    return subscription;
  }

  async assertMerchantLimit(merchantId: string, key: 'productLimit' | 'branchLimit' | 'staffLimit' | 'tableCountLimit', adding = 1) {
    const rows = await this.entitlementUsage(merchantId);
    if (!rows.length) throw new EntitlementError('An active subscription is required');
    const row = rows.find((entry) => entry.key === key);
    assertWithinLimit(row?.value, row?.usage ?? 0, adding, key);
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
    if (!current) throw notFound('Plan not found');
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
    if (!plan) throw notFound('Plan not found');
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

  /** Payments for a merchant's subscription, used by the admin to verify, review and refund. */
  async subscriptionPayments(merchantId: string) {
    const [rows, subscription] = await Promise.all([
      this.prisma.subscriptionPayment.findMany({
        where: { merchantId },
        include: { commissions: true, refunds: { orderBy: { createdAt: 'desc' } }, subscription: { include: { plan: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.merchantSubscription.findUnique({ where: { merchantId }, include: { plan: true } }),
    ]);
    const key = subscription ? `sub:${subscription.id}:${subscription.currentPeriodStart.getTime()}` : null;
    const current = key ? rows.find((row) => row.idempotencyKey === key) : undefined;
    return {
      currentPeriodVerified: Boolean(current),
      payments: rows.map((row) => ({
        id: row.id,
        plan: loc(row.subscription.plan.name),
        gross: dec(row.grossAmount ?? row.amount),
        discount: dec(row.discountAmount),
        amount: dec(row.amount),
        refunded: dec(row.refundedAmount),
        status: row.status,
        isRenewal: row.isRenewal,
        verifiedAt: row.verifiedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        commission: moneyString(row.commissions.reduce((total, entry) => total.plus(entry.amount.toString()).minus(entry.reversedAmount.toString()), money(0))),
        refunds: row.refunds.map((refund) => ({ id: refund.id, amount: dec(refund.amount), reason: refund.reason, createdAt: refund.createdAt.toISOString() })),
      })),
    };
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
    if (!plan) throw notFound('Plan not found');
    const blocked = assignmentBlockReason(plan.status);
    if (blocked) throw badRequest(blocked);
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
      await this.recordSubscriptionPayment({ subscriptionId: subscription.id, merchantId, amount, actorId });
    }
    await this.prisma.subscriptionChange.create({
      data: { merchantId, subscriptionId: subscription.id, fromPlanId: existing?.planId ?? null, toPlanId: plan.id, billingInterval, effectiveAt: start, appliedAt: start, actorId },
    });
    await this.audit.log({ actorId, action: 'subscription.assign', entityType: 'Merchant', entityId: merchantId, metadata: { planId } });
    return { ...subscription, scheduled: false, effectiveAt: start.toISOString() };
  }

  async renewSubscription(
    merchantId: string,
    actorId: string,
    input: { planId: string; billingInterval: 'MONTHLY' | 'ANNUAL'; autoRenew: boolean; paymentMethod?: 'CARD' | 'BENEFIT' | 'BANK' },
  ) {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: input.planId }, include: { entitlements: true } });
    if (!plan) throw notFound('Plan not found');
    const blocked = assignmentBlockReason(plan.status);
    if (blocked) throw badRequest(blocked);
    const allowed = billingChoices(plan.entitlements);
    if (!allowed.includes(input.billingInterval)) throw badRequest('This plan does not offer that billing period');
    await this.expireDueSubscription(merchantId);
    const existing = await this.prisma.merchantSubscription.findUnique({ where: { merchantId } });
    const live = Boolean(existing && existing.status === 'ACTIVE' && existing.currentPeriodEnd > new Date());
    if (live && existing!.planId === input.planId && existing!.billingInterval === input.billingInterval) {
      await this.prisma.merchantSubscription.update({ where: { merchantId }, data: { autoRenew: input.autoRenew } });
      return { scheduled: false, renewed: false, autoRenew: input.autoRenew };
    }
    if (!live && !input.paymentMethod) throw badRequest('Choose a payment method');
    const assigned = await this.assignSubscription(merchantId, input.planId, input.billingInterval, actorId, !live);
    const saved = await this.prisma.merchantSubscription.update({ where: { merchantId }, data: { autoRenew: input.autoRenew } });
    await this.audit.log({
      actorId,
      action: 'subscription.renew',
      entityType: 'Merchant',
      entityId: merchantId,
      metadata: { planId: input.planId, autoRenew: input.autoRenew, paymentMethod: input.paymentMethod ?? null, scheduled: assigned.scheduled },
    });
    return {
      scheduled: Boolean(assigned.scheduled),
      renewed: !assigned.scheduled && !live,
      autoRenew: saved.autoRenew,
      effectiveAt: assigned.effectiveAt,
      currentPeriodEnd: saved.currentPeriodEnd.toISOString(),
    };
  }

  async setAutoRenew(merchantId: string, autoRenew: boolean, actorId: string) {
    const existing = await this.prisma.merchantSubscription.findUnique({ where: { merchantId } });
    if (!existing) throw badRequest('Your store does not have a subscription yet');
    await this.prisma.merchantSubscription.update({ where: { merchantId }, data: { autoRenew } });
    await this.audit.log({ actorId, action: 'subscription.auto-renew', entityType: 'Merchant', entityId: merchantId, metadata: { autoRenew } });
    return { autoRenew };
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
      await this.recordSubscriptionPayment({ subscriptionId: subscription.id, merchantId, amount });
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

  /**
   * Records a verified subscription payment. Everything happens in one transaction: the reserved promo is consumed,
   * the payment and invoice are written and commission is generated, so a failure leaves no half-applied state.
   *
   * Whether this is the merchant's first payment is derived from payment history (not from the caller), and the
   * idempotency key is deterministic per billing period, so a retried request returns the original payment
   * instead of creating a second one.
   */
  async recordSubscriptionPayment(input: { subscriptionId: string; merchantId: string; amount: string; actorId?: string }) {
    const subscription = await this.prisma.merchantSubscription.findUnique({ where: { id: input.subscriptionId } });
    if (!subscription) throw notFound('Subscription not found');
    const chargeRows = await this.prisma.platformSetting.findMany({ where: { key: { in: ['serviceFee', 'taxCharge'] } } });
    const planCharges = platformPlanCharges(new Map(chargeRows.map((row) => [row.key, row.value])));
    const key = `sub:${subscription.id}:${subscription.currentPeriodStart.getTime()}`;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const prior = await tx.subscriptionPayment.count({ where: { merchantId: input.merchantId, verifiedAt: { not: null } } });
          const isRenewal = prior > 0;
          const applied =
            !isRenewal && this.marketing
              ? await this.marketing.promo.applyReserved(tx, { merchantId: input.merchantId, gross: input.amount, planId: subscription.planId, interval: subscription.billingInterval })
              : { discount: '0.000', payable: input.amount, promoCodeId: null, redemptionId: null };
          const payable = priceWithCharges(applied.payable, planCharges).payable;
          const payment = await tx.subscriptionPayment.create({
            data: {
              subscriptionId: input.subscriptionId,
              merchantId: input.merchantId,
              amount: payable,
              grossAmount: input.amount,
              discountAmount: applied.discount,
              promoCodeId: applied.promoCodeId,
              status: 'CAPTURED',
              isRenewal,
              verifiedAt: new Date(),
              idempotencyKey: key,
            },
          });
          await tx.invoice.create({
            data: {
              merchantId: input.merchantId,
              kind: 'SUBSCRIPTION',
              number: `SUB-${payment.id.slice(0, 8).toUpperCase()}`,
              amount: payable,
              status: 'PAID',
            },
          });
          if (this.marketing) {
            await this.marketing.promo.linkPayment(tx, applied.redemptionId, payment.id);
            await this.marketing.finance.onVerifiedPayment(tx, { id: payment.id, merchantId: payment.merchantId, amount: dec(payment.amount), status: payment.status, verifiedAt: payment.verifiedAt, isRenewal }, input.actorId);
          }
          return payment;
        },
        { maxWait: 10_000, timeout: 30_000 },
      );
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        const existing = await this.prisma.subscriptionPayment.findUnique({ where: { idempotencyKey: key } });
        if (existing) return existing;
      }
      throw error;
    }
  }

  /**
   * Admin confirms that the merchant has paid for the current billing period. This is the verification step that
   * makes commission eligible; pending or unconfirmed subscriptions never produce commission.
   */
  async verifySubscriptionPayment(merchantId: string, actorId: string) {
    const subscription = await this.prisma.merchantSubscription.findUnique({ where: { merchantId }, include: { plan: true } });
    if (!subscription) throw badRequest('This merchant has no subscription');
    if (subscription.status === 'CANCELLED') throw badRequest('This subscription is cancelled');
    const key = `sub:${subscription.id}:${subscription.currentPeriodStart.getTime()}`;
    if (await this.prisma.subscriptionPayment.findUnique({ where: { idempotencyKey: key } })) {
      throw badRequest('The payment for the current billing period is already recorded');
    }
    const amount = subscription.billingInterval === 'ANNUAL' ? dec(subscription.plan.priceAnnual) : dec(subscription.plan.priceMonthly);
    const payment = await this.recordSubscriptionPayment({ subscriptionId: subscription.id, merchantId, amount, actorId });
    await this.audit.log({ actorId, action: 'subscription.payment.verify', entityType: 'SubscriptionPayment', entityId: payment.id, metadata: { merchantId, amount: dec(payment.amount) } });
    return { id: payment.id, amount: dec(payment.amount), gross: dec(payment.grossAmount ?? payment.amount), discount: dec(payment.discountAmount), isRenewal: payment.isRenewal };
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
      commissionTotal: moneyString(commissions.reduce((sum, row) => sum.plus(dec(row.amount)).minus(dec(row.reversedAmount)), money(0))),
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

function billingChoices(rows: { key: string; value: unknown }[]) {
  const value = rows.find((row) => row.key === 'billingIntervals')?.value;
  const choices = Array.isArray(value) ? value.filter((item): item is 'MONTHLY' | 'ANNUAL' => item === 'MONTHLY' || item === 'ANNUAL') : [];
  return choices.length ? choices : (['MONTHLY'] as ('MONTHLY' | 'ANNUAL')[]);
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

const CHANNELS: FulfillmentType[] = ['DELIVERY', 'TAKEAWAY', 'DINE_IN'];

type SalesOrder = {
  status: string;
  fulfillmentType: FulfillmentType;
  total: { toFixed: (digits: number) => string } | null;
  createdAt: Date;
  addressSnapshot?: unknown;
  branch?: { latitude: unknown; longitude: unknown };
  events?: { status: string; createdAt: Date }[];
  preparationMinutes?: number | null;
};

function sumOrderTotals(orders: SalesOrder[], fulfillment?: FulfillmentType) {
  return orders.reduce((sum, order) => {
    if (order.status === 'CANCELLED' || order.status === 'REFUNDED') return sum;
    if (fulfillment && order.fulfillmentType !== fulfillment) return sum;
    return sum.plus(money(dec(order.total)));
  }, money(0));
}

function salesSeries(keys: string[], orders: SalesOrder[], bucket: (order: SalesOrder) => string) {
  const buckets = new Map(keys.map((key) => [key, money(0)]));
  for (const order of orders) {
    if (order.status === 'CANCELLED' || order.status === 'REFUNDED') continue;
    const key = bucket(order);
    if (!buckets.has(key)) continue;
    buckets.set(key, buckets.get(key)!.plus(money(dec(order.total))));
  }
  return keys.map((at) => ({ at, amount: moneyString(buckets.get(at) ?? money(0)) }));
}

function channelRows(current: SalesOrder[], previous: SalesOrder[]): MerchantDashboard['channels']['today'] {
  return CHANNELS.map((fulfillment) => ({
    fulfillment,
    amount: moneyString(sumOrderTotals(current, fulfillment)),
    change: percentChange(sumOrderTotals(current, fulfillment), sumOrderTotals(previous, fulfillment)),
  }));
}

function hourKeys() {
  return Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
}

function dayKeys(todayStart: Date, days: number) {
  return Array.from({ length: days }, (_, index) => bahrainParts(new Date(todayStart.getTime() - (days - 1 - index) * 86_400_000)).key);
}

function bahrainHour(date: Date) {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bahrain', hour: '2-digit', hourCycle: 'h23' }).format(date);
  return Number(hour);
}

function preparationSpan(events: { status: string; createdAt: Date }[]) {
  const start = events.find((event) => event.status === 'PREPARING')?.createdAt;
  const ready = events.find((event) => event.status === 'READY_FOR_PICKUP')?.createdAt;
  if (!start || !ready) return null;
  const minutes = (ready.getTime() - start.getTime()) / 60000;
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 180) return null;
  return minutes;
}

function needsAttention(order: { status: string; createdAt: Date; estimatedReadyAt: Date | null; preparationMinutes: number | null }, now: Date, target: number) {
  const age = (now.getTime() - order.createdAt.getTime()) / 60000;
  if (order.status === 'PENDING' && age >= 5) return true;
  if (order.status === 'ACCEPTED' || order.status === 'PREPARING') {
    if (order.estimatedReadyAt && order.estimatedReadyAt.getTime() < now.getTime()) return true;
    if (!order.estimatedReadyAt && age > (order.preparationMinutes ?? target)) return true;
  }
  return false;
}

function deliveryStats(current: SalesOrder[], previous: SalesOrder[], driversOnline: number, driversAssigned: number): MerchantDashboard['delivery'] {
  const currentRate = onTimeRate(current);
  const previousRate = onTimeRate(previous);
  const currentDistance = averageDistance(current);
  const previousDistance = averageDistance(previous);
  return {
    onTimeRate: currentRate === null ? null : `${Math.round(currentRate * 100)}%`,
    onTimeChange: currentRate === null || previousRate === null ? null : percentChange(money(currentRate), money(previousRate)),
    averageDistanceKm: currentDistance === null ? null : currentDistance.toFixed(1),
    distanceChange: currentDistance === null || previousDistance === null ? null : percentChange(money(currentDistance), money(previousDistance)),
    driversOnline,
    driversAssigned,
  };
}

function onTimeRate(orders: SalesOrder[]) {
  const delivered = orders.filter((order) => order.status === 'DELIVERED' && order.fulfillmentType === 'DELIVERY');
  if (!delivered.length) return null;
  const onTime = delivered.filter((order) => {
    const done = order.events?.find((event) => event.status === 'DELIVERED');
    if (!done) return false;
    const limit = (order.preparationMinutes ?? 20) + 15;
    return (done.createdAt.getTime() - order.createdAt.getTime()) / 60000 <= limit;
  }).length;
  return onTime / delivered.length;
}

function averageDistance(orders: SalesOrder[]) {
  const values = orders
    .filter((order) => order.fulfillmentType === 'DELIVERY' && order.branch)
    .map((order) => kilometers(order.branch!, order.addressSnapshot))
    .filter((value): value is number => value !== null);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function kilometers(branch: { latitude: unknown; longitude: unknown }, snapshot: unknown) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const row = snapshot as { latitude?: unknown; longitude?: unknown };
  const lat1 = Number(branch.latitude);
  const lng1 = Number(branch.longitude);
  const lat2 = Number(row.latitude);
  const lng2 = Number(row.longitude);
  if (![lat1, lng1, lat2, lng2].every((value) => Number.isFinite(value))) return null;
  const earth = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const km = 2 * earth * Math.asin(Math.sqrt(a));
  if (!Number.isFinite(km) || km <= 0 || km > 80) return null;
  return km;
}
