import { dec, loc } from '../common/crypto';
import {
  estimateDeliveryMinutes,
  legacyDeliveryRule,
  pickDeliverySetting,
  quoteDelivery,
  type DeliveryFailure,
  type DeliveryQuote,
  type DeliveryRule,
} from '../domain/delivery-quote';
import { haversineKm, pointInGeoJson, type Point } from '../domain/geo';
import type { PrismaService } from '../prisma/prisma.service';
import type { DistanceProvider } from '../providers/location';

type DecimalLike = { toString(): string };

export type DeliverySettingRow = {
  id: string;
  branchId: string | null;
  serviceAreaId: string | null;
  active: boolean;
  deliveryEnabled: boolean;
  freeRadiusKm: DecimalLike;
  maxRadiusKm: DecimalLike;
  includedKm: DecimalLike;
  baseCharge: DecimalLike;
  chargePerStep: DecimalLike;
  billingStepKm: DecimalLike;
  minCharge: DecimalLike | null;
  maxCharge: DecimalLike | null;
  freeAboveOrder: DecimalLike | null;
  taxRate: DecimalLike;
  promoFreeFrom: Date | null;
  promoFreeUntil: Date | null;
  version: number;
  updatedAt: Date;
};

export type DeliveryMerchant = {
  id: string;
  deliveryEnabled: boolean;
  freeDeliveryEnabled: boolean;
  freeDeliveryKm: DecimalLike;
  baseDeliveryKm: DecimalLike;
  baseDeliveryFee: DecimalLike;
  beyondFreeDeliveryFee: DecimalLike;
  beyondDeliveryFeeMode: string;
  maxDeliveryKm: DecimalLike;
  preparationMinutes: number;
  updatedAt: Date;
  branches: { id: string; name: unknown; line1: string; city: string; latitude: DecimalLike; longitude: DecimalLike; active: boolean; createdAt: Date }[];
  deliverySettings?: DeliverySettingRow[];
};

/** Why a store cannot deliver, as the customer app needs it. Adds branch problems to the pricing failures. */
export type DeliveryUnavailable = DeliveryFailure | 'BRANCH_INACTIVE';

export type BranchQuote = {
  branch: DeliveryMerchant['branches'][number] | null;
  quote: DeliveryQuote | null;
  reason: DeliveryUnavailable | null;
  minutes: number;
};

export type DeliveryContext = { platformFee: string; zones: { id: string; geoJson: unknown }[] };

/** Prisma include that loads everything a delivery quote reads. */
export const deliveryInclude = {
  branches: true,
  deliverySettings: { where: { active: true } },
} as const;

export class DeliveryService {
  private zoneCache: { at: number; rows: { id: string; geoJson: unknown }[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly distance: DistanceProvider,
  ) {}

  /** Platform fallback fee and the service-area zones that contain the point. Cached for a minute. */
  async context(point: Point | null): Promise<DeliveryContext> {
    const stale = !this.zoneCache || Date.now() - this.zoneCache.at > 60_000;
    const [rows, rule] = await Promise.all([
      stale ? this.prisma.serviceArea.findMany({ where: { active: true }, select: { id: true, geoJson: true } }) : null,
      this.prisma.deliveryPricingRule.findFirst({ where: { active: true, merchantId: null } }),
    ]);
    const zoneCache = rows ? (this.zoneCache = { at: Date.now(), rows }) : this.zoneCache!;
    return {
      platformFee: rule ? dec(rule.baseFee) : '0.500',
      zones: point ? zoneCache.rows.filter((zone) => pointInGeoJson(point, zone.geoJson)) : [],
    };
  }

  ruleFor(merchant: DeliveryMerchant, branchId: string, context: DeliveryContext): DeliveryRule {
    const picked = pickDeliverySetting(merchant.deliverySettings ?? [], branchId, context.zones.map((zone) => zone.id));
    if (!picked) {
      return legacyDeliveryRule(
        {
          deliveryEnabled: merchant.deliveryEnabled,
          freeDeliveryEnabled: merchant.freeDeliveryEnabled,
          freeDeliveryKm: merchant.freeDeliveryKm.toString(),
          baseDeliveryKm: merchant.baseDeliveryKm.toString(),
          baseDeliveryFee: merchant.baseDeliveryFee.toString(),
          beyondFreeDeliveryFee: merchant.beyondFreeDeliveryFee.toString(),
          beyondDeliveryFeeMode: merchant.beyondDeliveryFeeMode,
          maxDeliveryKm: merchant.maxDeliveryKm.toString(),
          updatedAt: merchant.updatedAt,
        },
        context.platformFee,
      );
    }
    const row = picked.setting;
    return {
      source: picked.source,
      settingId: row.id,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
      // The store-wide switch always wins over a branch rule.
      deliveryEnabled: merchant.deliveryEnabled && row.deliveryEnabled,
      freeRadiusKm: row.freeRadiusKm.toString(),
      maxRadiusKm: row.maxRadiusKm.toString(),
      includedKm: row.includedKm.toString(),
      baseCharge: row.baseCharge.toString(),
      chargePerStep: row.chargePerStep.toString(),
      billingStepKm: row.billingStepKm.toString(),
      minCharge: row.minCharge?.toString() ?? null,
      maxCharge: row.maxCharge?.toString() ?? null,
      freeAboveOrder: row.freeAboveOrder?.toString() ?? null,
      taxRate: row.taxRate.toString(),
      promoFreeFrom: row.promoFreeFrom,
      promoFreeUntil: row.promoFreeUntil,
    };
  }

  /**
   * Quote for the store list. Straight-line distance only, so a long list costs no map calls.
   * Picks the closest active branch that can deliver, or the closest active branch with its reason.
   */
  listingQuote(merchant: DeliveryMerchant, point: Point, context: DeliveryContext, now = new Date()): BranchQuote {
    const branches = merchant.branches.filter((branch) => branch.active);
    if (!branches.length) return { branch: null, quote: null, reason: 'BRANCH_INACTIVE', minutes: estimateDeliveryMinutes(merchant.preparationMinutes, null) };
    const quotes = branches
      .map((branch) => {
        const km = haversineKm(point, branchPoint(branch));
        return { branch, km, quote: quoteDelivery({ rule: this.ruleFor(merchant, branch.id, context), distanceKm: km, method: 'HAVERSINE', orderAmount: null, now }) };
      })
      .sort((a, b) => Number(b.quote.available) - Number(a.quote.available) || a.km - b.km);
    const best = quotes[0]!;
    return {
      branch: best.branch,
      quote: best.quote,
      reason: best.quote.reason,
      minutes: estimateDeliveryMinutes(merchant.preparationMinutes, best.km),
    };
  }

  /**
   * Quote for a cart or checkout, using the configured distance provider (road distance when available).
   * Measures the three straight-line closest branches, or only the requested branch.
   */
  async checkoutQuote(merchant: DeliveryMerchant, point: Point, input: { orderAmount: string | null; branchId?: string | null; now?: Date }): Promise<BranchQuote> {
    const now = input.now ?? new Date();
    const context = await this.context(point);
    const active = merchant.branches.filter((branch) => branch.active && (!input.branchId || branch.id === input.branchId));
    if (!active.length) return { branch: null, quote: null, reason: 'BRANCH_INACTIVE', minutes: estimateDeliveryMinutes(merchant.preparationMinutes, null) };
    const nearest = [...active].sort((a, b) => haversineKm(point, branchPoint(a)) - haversineKm(point, branchPoint(b))).slice(0, 3);
    const measured = await Promise.all(
      nearest.map(async (branch) => {
        const distance = await this.distance.measure(branchPoint(branch), point);
        const quote = quoteDelivery({ rule: this.ruleFor(merchant, branch.id, context), distanceKm: distance.km, method: distance.method, orderAmount: input.orderAmount, now });
        return { branch, km: distance.km, quote };
      }),
    );
    measured.sort((a, b) => Number(b.quote.available) - Number(a.quote.available) || a.km - b.km);
    const best = measured[0]!;
    return { branch: best.branch, quote: best.quote, reason: best.quote.reason, minutes: estimateDeliveryMinutes(merchant.preparationMinutes, best.km) };
  }
}

export function branchPoint(branch: { latitude: DecimalLike; longitude: DecimalLike }): Point {
  return { latitude: Number(branch.latitude.toString()), longitude: Number(branch.longitude.toString()) };
}

/** What the customer app and the delivery-quote API return. */
export function presentBranchQuote(result: BranchQuote, locale: 'en' | 'ar' = 'en') {
  const quote = result.quote;
  const rule = quote?.rule;
  return {
    branchId: result.branch?.id ?? null,
    branchName: result.branch ? (loc(result.branch.name)[locale] || loc(result.branch.name).en || null) : null,
    available: Boolean(quote?.available),
    reason: result.reason,
    distance: quote && result.reason !== 'INVALID_COORDINATES' ? quote.distanceKm : null,
    distanceUnit: 'km' as const,
    estimatedMinutes: result.minutes,
    freeDelivery: Boolean(quote?.free),
    freeReason: quote?.freeReason ?? null,
    freeAboveOrder: quote?.freeAboveOrder ?? null,
    deliveryCharge: quote?.charge ?? '0.000',
    tax: quote?.tax ?? '0.000',
    total: quote?.total ?? '0.000',
    currency: 'BHD' as const,
    summary: quote && rule
      ? {
          method: quote.method,
          freeRadiusKm: rule.freeRadiusKm,
          maxRadiusKm: rule.maxRadiusKm,
          chargeableKm: quote.chargeableKm,
          billingStepKm: rule.billingStepKm,
          billingUnits: quote.billingUnits,
          ratePerStep: rule.chargePerStep,
          baseCharge: rule.baseCharge,
          minCharge: rule.minCharge,
          maxCharge: rule.maxCharge,
          standardCharge: quote.standardCharge,
          taxRate: rule.taxRate,
          source: rule.source,
          version: rule.version,
          configUpdatedAt: rule.updatedAt,
        }
      : null,
  };
}

export type DeliveryQuoteView = ReturnType<typeof presentBranchQuote>;

/** The audit record stored on an order. It never changes after the order is placed. */
export function deliverySnapshot(result: BranchQuote, customer: Point, calculatedAt = new Date()) {
  const quote = result.quote!;
  const branch = result.branch!;
  const origin = branchPoint(branch);
  return {
    customer: { latitude: customer.latitude.toFixed(6), longitude: customer.longitude.toFixed(6) },
    branch: { id: branch.id, latitude: origin.latitude.toFixed(6), longitude: origin.longitude.toFixed(6) },
    distanceKm: quote.distanceKm,
    method: quote.method,
    freeRadiusKm: quote.rule.freeRadiusKm,
    includedKm: quote.rule.includedKm,
    maxRadiusKm: quote.rule.maxRadiusKm,
    chargeableKm: quote.chargeableKm,
    billingStepKm: quote.rule.billingStepKm,
    billingUnits: quote.billingUnits,
    baseCharge: quote.rule.baseCharge,
    ratePerStep: quote.rule.chargePerStep,
    minCharge: quote.rule.minCharge,
    maxCharge: quote.rule.maxCharge,
    standardCharge: quote.standardCharge,
    freeReason: quote.freeReason,
    charge: quote.charge,
    taxRate: quote.rule.taxRate,
    tax: quote.tax,
    total: quote.total,
    estimatedMinutes: result.minutes,
    config: { source: quote.rule.source, settingId: quote.rule.settingId, version: quote.rule.version, updatedAt: quote.rule.updatedAt },
    calculatedAt: calculatedAt.toISOString(),
  };
}
