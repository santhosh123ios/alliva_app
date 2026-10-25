import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AuditService } from '../../common/audit';
import { dec, loc } from '../../common/crypto';
import { badRequest, notFound } from '../../common/errors';
import type { RequestUser } from '../../common/http';
import { dateRange, paged, pageQuery, readQuery } from '../../common/paging';
import { evaluatePromo, promoStatus, type PromoRules } from '../../domain/marketing';
import { money, moneyString } from '../../domain/money';
import type { PrismaService } from '../../prisma/prisma.service';
import { fullName, isUniqueViolation, type Db } from './shared';

const decimal = z.string().regex(/^\d+(\.\d{1,3})?$/, 'Enter a valid amount');

const promoFields = {
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,32}$/, 'Promo code must be 3 to 32 letters, numbers, dashes or underscores'),
  campaignName: z.string().trim().min(2).max(80),
  descriptionEn: z.string().trim().max(240),
  descriptionAr: z.string().trim().max(240),
  discountType: z.enum(['PERCENTAGE', 'FIXED']),
  discountValue: decimal,
  maxDiscount: decimal.nullish(),
  minimumAmount: decimal.nullish(),
  planIds: z.array(z.uuid()).max(50).nullish(),
  startsAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  endsAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  usageLimit: z.number().int().min(1).nullish(),
  perMerchantLimit: z.number().int().min(1).nullish(),
  firstTimeMerchantOnly: z.boolean(),
  campaignSource: z.string().trim().max(60).nullish(),
  assignedUserId: z.uuid().nullish(),
  assignedHeadUserId: z.uuid().nullish(),
  active: z.boolean(),
};

export const subscriptionPromoInputSchema = z
  .object({ ...promoFields, descriptionEn: promoFields.descriptionEn.default(''), descriptionAr: promoFields.descriptionAr.default(''), firstTimeMerchantOnly: promoFields.firstTimeMerchantOnly.default(false), active: promoFields.active.default(true) })
  .superRefine((value, ctx) => {
    if (Number(value.discountValue) <= 0) ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Enter a discount greater than zero' });
    if (value.discountType === 'PERCENTAGE' && Number(value.discountValue) > 100) {
      ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Percent discount cannot exceed 100' });
    }
    if (new Date(boundary(value.endsAt, true)) <= new Date(boundary(value.startsAt, false))) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Expiry must be after the start date' });
    }
  });

/** Fields of a partial update; the merged result is validated again against the full schema in `update`. */
export const subscriptionPromoPatchSchema = z.object(promoFields).partial().strict();

export type SubscriptionPromoInput = z.infer<typeof subscriptionPromoInputSchema>;

/** Bare dates are Bahrain calendar days: start at 00:00, expiry at 23:59:59 Bahrain time. */
function boundary(value: string, end: boolean): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return `${value}T${end ? '23:59:59.999' : '00:00:00.000'}+03:00`;
}

type PromoRow = Prisma.PromoCodeGetPayload<{ include: { assignedUser: true; assignedHead: true } }>;

export function rulesOf(promo: {
  active: boolean;
  deletedAt: Date | null;
  startsAt: Date;
  endsAt: Date;
  discountType: 'FIXED' | 'PERCENTAGE';
  discountValue: { toFixed: (n: number) => string };
  maxDiscount: { toFixed: (n: number) => string } | null;
  minimumOrder: { toFixed: (n: number) => string } | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  firstOrderOnly: boolean;
  planIds: unknown;
}): PromoRules {
  return {
    active: promo.active,
    deletedAt: promo.deletedAt,
    startsAt: promo.startsAt,
    endsAt: promo.endsAt,
    discountType: promo.discountType,
    discountValue: dec(promo.discountValue),
    maxDiscount: promo.maxDiscount ? dec(promo.maxDiscount) : null,
    minimumAmount: promo.minimumOrder ? dec(promo.minimumOrder) : null,
    usageLimit: promo.usageLimit,
    perMerchantLimit: promo.perCustomerLimit,
    firstTimeMerchantOnly: promo.firstOrderOnly,
    planIds: Array.isArray(promo.planIds) ? (promo.planIds as string[]) : null,
  };
}

export type PromoQuote =
  | { valid: true; promoCodeId: string; code: string; campaignName: string | null; gross: string; discount: string; payable: string }
  | { valid: false; reason: string };

export class MarketingPromoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ pricing

  async planPrice(planId: string, interval: 'MONTHLY' | 'ANNUAL', db: Db = this.prisma) {
    const plan = await db.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan || plan.status !== 'ACTIVE') throw badRequest('Choose an available plan');
    return { plan, gross: interval === 'ANNUAL' ? dec(plan.priceAnnual) : dec(plan.priceMonthly) };
  }

  /**
   * Validates a promo code for a plan and returns the price the merchant would pay. The discount is always computed
   * here on the backend; clients only display what this returns.
   */
  async quote(input: { code: string; planId: string; interval: 'MONTHLY' | 'ANNUAL'; merchantId?: string }, db: Db = this.prisma): Promise<PromoQuote> {
    const code = input.code.trim().toUpperCase();
    const promo = await db.promoCode.findFirst({ where: { code, purpose: 'SUBSCRIPTION', deletedAt: null } });
    if (!promo) return { valid: false, reason: 'This promo code is not valid' };
    const { gross } = await this.planPrice(input.planId, input.interval, db);
    const [totalUses, merchantUses, paidBefore] = await Promise.all([
      db.subscriptionPromoRedemption.count({ where: { promoCodeId: promo.id, status: { in: ['RESERVED', 'APPLIED'] } } }),
      input.merchantId ? db.subscriptionPromoRedemption.count({ where: { promoCodeId: promo.id, merchantId: input.merchantId, status: { in: ['RESERVED', 'APPLIED'] } } }) : Promise.resolve(0),
      input.merchantId ? db.subscriptionPayment.count({ where: { merchantId: input.merchantId, verifiedAt: { not: null } } }) : Promise.resolve(0),
    ]);
    const verdict = evaluatePromo(rulesOf(promo), { planId: input.planId, amount: gross, totalUses, merchantUses, merchantHasPaidBefore: paidBefore > 0 });
    if (!verdict.ok) return { valid: false, reason: verdict.reason };
    return { valid: true, promoCodeId: promo.id, code: promo.code, campaignName: promo.campaignName, gross, discount: verdict.discount, payable: verdict.payable };
  }

  /** Records the merchant's entitlement at registration. The discount itself is applied when the payment is verified. */
  async reserve(db: Db, input: { merchantId: string; promoCodeId: string }) {
    await db.subscriptionPromoRedemption.create({ data: { merchantId: input.merchantId, promoCodeId: input.promoCodeId, status: 'RESERVED' } });
  }

  /**
   * Called inside the payment transaction. Consumes the merchant's reserved promo exactly once:
   * the redemption row is claimed with a conditional update, so a retry or concurrent call cannot apply it twice.
   */
  async applyReserved(db: Prisma.TransactionClient, input: { merchantId: string; gross: string; planId: string; interval: 'MONTHLY' | 'ANNUAL' }) {
    const none = { discount: '0.000', payable: input.gross, promoCodeId: null as string | null, redemptionId: null as string | null };
    const reservation = await db.subscriptionPromoRedemption.findFirst({
      where: { merchantId: input.merchantId, status: 'RESERVED' },
      orderBy: { createdAt: 'asc' },
      include: { promoCode: true },
    });
    if (!reservation) return none;
    const claimed = await db.subscriptionPromoRedemption.updateMany({ where: { id: reservation.id, status: 'RESERVED' }, data: { status: 'APPLIED', appliedAt: new Date() } });
    if (claimed.count === 0) return none;
    const promo = reservation.promoCode;
    // A reservation honours rules as they were when it was made, but an admin deactivation cancels it.
    const rules = { ...rulesOf(promo), endsAt: new Date('2999-01-01'), startsAt: new Date(0), usageLimit: null, perMerchantLimit: null, firstTimeMerchantOnly: false };
    const verdict = promo.active && !promo.deletedAt ? evaluatePromo(rules, { planId: input.planId, amount: input.gross, totalUses: 0, merchantUses: 0, merchantHasPaidBefore: false }) : null;
    if (!verdict || !verdict.ok) {
      await db.subscriptionPromoRedemption.update({ where: { id: reservation.id }, data: { status: 'VOID' } });
      return none;
    }
    await db.subscriptionPromoRedemption.update({ where: { id: reservation.id }, data: { discountAmount: verdict.discount } });
    return { discount: verdict.discount, payable: verdict.payable, promoCodeId: promo.id, redemptionId: reservation.id };
  }

  /** Links the consumed redemption to the payment that used it, so usage reports can show the discount per payment. */
  async linkPayment(db: Db, redemptionId: string | null, paymentId: string) {
    if (!redemptionId) return;
    await db.subscriptionPromoRedemption.update({ where: { id: redemptionId }, data: { subscriptionPaymentId: paymentId } });
  }

  // ------------------------------------------------------------------ admin CRUD

  private present(promo: PromoRow, usage?: { uses: number; discount: string }) {
    return {
      id: promo.id,
      code: promo.code,
      campaignName: promo.campaignName,
      description: loc(promo.description),
      discountType: promo.discountType,
      discountValue: dec(promo.discountValue),
      maxDiscount: promo.maxDiscount ? dec(promo.maxDiscount) : null,
      minimumAmount: promo.minimumOrder ? dec(promo.minimumOrder) : null,
      planIds: Array.isArray(promo.planIds) ? (promo.planIds as string[]) : null,
      startsAt: promo.startsAt.toISOString(),
      endsAt: promo.endsAt.toISOString(),
      usageLimit: promo.usageLimit,
      perMerchantLimit: promo.perCustomerLimit,
      firstTimeMerchantOnly: promo.firstOrderOnly,
      campaignSource: promo.campaignSource,
      active: promo.active,
      status: promoStatus(promo),
      assignedUser: promo.assignedUser ? { id: promo.assignedUser.id, name: fullName(promo.assignedUser) } : null,
      assignedHead: promo.assignedHead ? { id: promo.assignedHead.id, name: fullName(promo.assignedHead) } : null,
      uses: usage?.uses ?? 0,
      discountGiven: usage?.discount ?? '0.000',
      createdAt: promo.createdAt.toISOString(),
    };
  }

  async list(query: Record<string, unknown>) {
    const page = pageQuery(query);
    const raw = readQuery(query);
    const now = new Date();
    const and: Prisma.PromoCodeWhereInput[] = [{ purpose: 'SUBSCRIPTION', deletedAt: null }];
    if (page.q) and.push({ OR: [{ code: { contains: page.q, mode: 'insensitive' } }, { campaignName: { contains: page.q, mode: 'insensitive' } }] });
    if (raw.status === 'ACTIVE') and.push({ active: true, endsAt: { gte: now } });
    if (raw.status === 'INACTIVE') and.push({ active: false });
    if (raw.status === 'EXPIRED') and.push({ active: true, endsAt: { lt: now } });
    if (raw.assignedUserId) and.push({ assignedUserId: raw.assignedUserId });
    if (raw.source) and.push({ campaignSource: raw.source });
    const where: Prisma.PromoCodeWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.promoCode.findMany({ where, include: { assignedUser: true, assignedHead: true }, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.pageSize }),
      this.prisma.promoCode.count({ where }),
    ]);
    const usage = await this.usageTotals(rows.map((row) => row.id));
    return paged(rows.map((row) => this.present(row, usage.get(row.id))), total, page);
  }

  private async usageTotals(ids: string[]) {
    const out = new Map<string, { uses: number; discount: string }>();
    if (!ids.length) return out;
    const rows = await this.prisma.subscriptionPromoRedemption.groupBy({
      by: ['promoCodeId'],
      where: { promoCodeId: { in: ids }, status: 'APPLIED' },
      _count: { _all: true },
      _sum: { discountAmount: true },
    });
    for (const row of rows) out.set(row.promoCodeId, { uses: row._count._all, discount: dec(row._sum.discountAmount) });
    return out;
  }

  async create(actor: RequestUser, input: SubscriptionPromoInput) {
    const assignment = await this.resolveAssignment(input.assignedUserId ?? null, input.assignedHeadUserId ?? null);
    await this.assertPlans(input.planIds ?? null);
    try {
      const promo = await this.prisma.promoCode.create({
        data: {
          code: input.code,
          campaignName: input.campaignName,
          description: { en: input.descriptionEn || input.campaignName, ar: input.descriptionAr || input.campaignName },
          scope: 'GLOBAL',
          purpose: 'SUBSCRIPTION',
          discountType: input.discountType,
          discountValue: Number(input.discountValue).toFixed(3),
          maxDiscount: input.maxDiscount ? Number(input.maxDiscount).toFixed(3) : null,
          minimumOrder: input.minimumAmount ? Number(input.minimumAmount).toFixed(3) : null,
          planIds: input.planIds?.length ? input.planIds : undefined,
          startsAt: new Date(boundary(input.startsAt, false)),
          endsAt: new Date(boundary(input.endsAt, true)),
          usageLimit: input.usageLimit ?? null,
          perCustomerLimit: input.perMerchantLimit ?? null,
          firstOrderOnly: input.firstTimeMerchantOnly,
          campaignSource: input.campaignSource || null,
          assignedUserId: assignment.userId,
          assignedHeadUserId: assignment.headUserId,
          active: input.active,
          createdById: actor.id,
        },
        include: { assignedUser: true, assignedHead: true },
      });
      await this.audit.log({ actorId: actor.id, action: 'promo.create', entityType: 'PromoCode', entityId: promo.id, metadata: { code: promo.code, purpose: 'SUBSCRIPTION' } });
      return this.present(promo);
    } catch (error) {
      if (isUniqueViolation(error, 'code')) throw badRequest('That promo code is already in use');
      throw error;
    }
  }

  async update(actor: RequestUser, id: string, input: Partial<SubscriptionPromoInput>) {
    const existing = await this.prisma.promoCode.findFirst({ where: { id, purpose: 'SUBSCRIPTION', deletedAt: null } });
    if (!existing) throw notFound('Promo code not found');
    const used = await this.prisma.subscriptionPromoRedemption.count({ where: { promoCodeId: id } });
    if (input.code && input.code !== existing.code && used > 0) throw badRequest('A promo code that has been used cannot be renamed. Deactivate it and create a new one.');
    const merged = subscriptionPromoInputSchema.safeParse({
      code: input.code ?? existing.code,
      campaignName: input.campaignName ?? existing.campaignName ?? existing.code,
      descriptionEn: input.descriptionEn ?? loc(existing.description).en,
      descriptionAr: input.descriptionAr ?? loc(existing.description).ar,
      discountType: input.discountType ?? existing.discountType,
      discountValue: input.discountValue ?? dec(existing.discountValue),
      maxDiscount: input.maxDiscount === undefined ? (existing.maxDiscount ? dec(existing.maxDiscount) : null) : input.maxDiscount,
      minimumAmount: input.minimumAmount === undefined ? (existing.minimumOrder ? dec(existing.minimumOrder) : null) : input.minimumAmount,
      planIds: input.planIds === undefined ? (Array.isArray(existing.planIds) ? existing.planIds : null) : input.planIds,
      startsAt: input.startsAt ?? existing.startsAt.toISOString(),
      endsAt: input.endsAt ?? existing.endsAt.toISOString(),
      usageLimit: input.usageLimit === undefined ? existing.usageLimit : input.usageLimit,
      perMerchantLimit: input.perMerchantLimit === undefined ? existing.perCustomerLimit : input.perMerchantLimit,
      firstTimeMerchantOnly: input.firstTimeMerchantOnly ?? existing.firstOrderOnly,
      campaignSource: input.campaignSource === undefined ? existing.campaignSource : input.campaignSource,
      assignedUserId: input.assignedUserId === undefined ? existing.assignedUserId : input.assignedUserId,
      assignedHeadUserId: input.assignedHeadUserId === undefined ? existing.assignedHeadUserId : input.assignedHeadUserId,
      active: input.active ?? existing.active,
    });
    if (!merged.success) throw badRequest(merged.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })));
    const next = merged.data;
    if (input.usageLimit != null && input.usageLimit < used) throw badRequest('The usage limit cannot be lower than the number of times the code was already used');
    const assignment = await this.resolveAssignment(next.assignedUserId ?? null, next.assignedHeadUserId ?? null);
    await this.assertPlans(next.planIds ?? null);
    try {
      const promo = await this.prisma.promoCode.update({
        where: { id },
        data: {
          code: next.code,
          campaignName: next.campaignName,
          description: { en: next.descriptionEn || next.campaignName, ar: next.descriptionAr || next.campaignName },
          discountType: next.discountType,
          discountValue: Number(next.discountValue).toFixed(3),
          maxDiscount: next.maxDiscount ? Number(next.maxDiscount).toFixed(3) : null,
          minimumOrder: next.minimumAmount ? Number(next.minimumAmount).toFixed(3) : null,
          planIds: next.planIds?.length ? next.planIds : (null as never),
          startsAt: new Date(boundary(next.startsAt, false)),
          endsAt: new Date(boundary(next.endsAt, true)),
          usageLimit: next.usageLimit ?? null,
          perCustomerLimit: next.perMerchantLimit ?? null,
          firstOrderOnly: next.firstTimeMerchantOnly,
          campaignSource: next.campaignSource || null,
          assignedUserId: assignment.userId,
          assignedHeadUserId: assignment.headUserId,
          active: next.active,
        },
        include: { assignedUser: true, assignedHead: true },
      });
      await this.audit.log({
        actorId: actor.id,
        action: 'promo.update',
        entityType: 'PromoCode',
        entityId: id,
        metadata: { fields: Object.keys(input), discountValue: input.discountValue, discountType: input.discountType } as never,
      });
      const usage = await this.usageTotals([id]);
      return this.present(promo, usage.get(id));
    } catch (error) {
      if (isUniqueViolation(error, 'code')) throw badRequest('That promo code is already in use');
      throw error;
    }
  }

  async setActive(actor: RequestUser, id: string, active: boolean) {
    const promo = await this.prisma.promoCode.findFirst({ where: { id, purpose: 'SUBSCRIPTION', deletedAt: null } });
    if (!promo) throw notFound('Promo code not found');
    await this.prisma.promoCode.update({ where: { id }, data: { active } });
    await this.audit.log({ actorId: actor.id, action: active ? 'promo.activate' : 'promo.deactivate', entityType: 'PromoCode', entityId: id });
    return { ok: true };
  }

  /** Usage rows for one promo (admin view). */
  async usage(id: string, query: Record<string, unknown>) {
    const page = pageQuery(query);
    const raw = readQuery(query);
    const range = dateRange(raw);
    const where: Prisma.SubscriptionPromoRedemptionWhereInput = {
      promoCodeId: id,
      ...(raw.status ? { status: raw.status as never } : {}),
      ...(range ? { createdAt: range } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.subscriptionPromoRedemption.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.pageSize }),
      this.prisma.subscriptionPromoRedemption.count({ where }),
    ]);
    const merchants = await this.prisma.merchant.findMany({ where: { id: { in: rows.map((row) => row.merchantId) } }, select: { id: true, name: true } });
    const names = new Map(merchants.map((row) => [row.id, loc(row.name).en]));
    return paged(
      rows.map((row) => ({
        id: row.id,
        merchantId: row.merchantId,
        merchantName: names.get(row.merchantId) ?? '',
        status: row.status,
        discountAmount: dec(row.discountAmount),
        createdAt: row.createdAt.toISOString(),
        appliedAt: row.appliedAt?.toISOString() ?? null,
      })),
      total,
      page,
    );
  }

  async assignable() {
    const rows = await this.prisma.marketingProfile.findMany({ include: { user: true }, orderBy: { createdAt: 'asc' } });
    return rows.map((row) => ({ id: row.userId, name: fullName(row.user), kind: row.kind, headUserId: row.parentUserId, status: row.status }));
  }

  private async resolveAssignment(userId: string | null, headUserId: string | null) {
    let head = headUserId;
    if (userId) {
      const profile = await this.prisma.marketingProfile.findUnique({ where: { userId } });
      if (!profile) throw badRequest('Choose a marketing staff member');
      if (!head && profile.kind === 'STAFF') head = profile.parentUserId;
      if (!head && profile.kind === 'HEAD') head = profile.userId;
    }
    if (head) {
      const profile = await this.prisma.marketingProfile.findUnique({ where: { userId: head } });
      if (!profile || profile.kind !== 'HEAD') throw badRequest('Choose a marketing head');
    }
    return { userId, headUserId: head };
  }

  private async assertPlans(planIds: string[] | null) {
    if (!planIds?.length) return;
    const found = await this.prisma.subscriptionPlan.count({ where: { id: { in: planIds } } });
    if (found !== new Set(planIds).size) throw badRequest('One of the selected plans does not exist');
  }

  /** Usage summary used by dashboards/reports. */
  async performance(range?: { gte?: Date; lte?: Date }) {
    const rows = await this.prisma.subscriptionPromoRedemption.groupBy({
      by: ['promoCodeId', 'status'],
      where: range ? { createdAt: range } : {},
      _count: { _all: true },
      _sum: { discountAmount: true },
    });
    const promos = await this.prisma.promoCode.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.promoCodeId))] } }, select: { id: true, code: true, campaignName: true, campaignSource: true } });
    const byId = new Map(promos.map((promo) => [promo.id, promo]));
    const out = new Map<string, { id: string; code: string; campaign: string | null; source: string | null; reserved: number; applied: number; voided: number; discount: string }>();
    for (const row of rows) {
      const promo = byId.get(row.promoCodeId);
      const entry = out.get(row.promoCodeId) ?? { id: row.promoCodeId, code: promo?.code ?? '', campaign: promo?.campaignName ?? null, source: promo?.campaignSource ?? null, reserved: 0, applied: 0, voided: 0, discount: '0.000' };
      if (row.status === 'RESERVED') entry.reserved += row._count._all;
      if (row.status === 'APPLIED') {
        entry.applied += row._count._all;
        entry.discount = moneyString(money(entry.discount).plus(money(dec(row._sum.discountAmount))));
      }
      if (row.status === 'VOID') entry.voided += row._count._all;
      out.set(row.promoCodeId, entry);
    }
    return [...out.values()].sort((a, b) => b.applied - a.applied);
  }
}
