import { money, moneyString, zero, type Money } from './money';

export type DeliveryRuleSource = 'ZONE' | 'BRANCH' | 'MERCHANT' | 'LEGACY_MERCHANT' | 'PLATFORM_DEFAULT';

export type DistanceMethod = 'ROAD' | 'HAVERSINE';

/** One store's delivery pricing, already resolved for a branch and zone. Money and distances are decimal strings. */
export type DeliveryRule = {
  source: DeliveryRuleSource;
  settingId: string | null;
  version: number;
  updatedAt: string | null;
  deliveryEnabled: boolean;
  freeRadiusKm: string;
  /** 0 means the store set no limit. */
  maxRadiusKm: string;
  /** Distance the base charge already covers. Billing starts after the larger of this and the free radius. */
  includedKm: string;
  baseCharge: string;
  chargePerStep: string;
  /** 0 bills the exact distance instead of whole steps. */
  billingStepKm: string;
  minCharge: string | null;
  maxCharge: string | null;
  freeAboveOrder: string | null;
  taxRate: string;
  promoFreeFrom: Date | null;
  promoFreeUntil: Date | null;
};

export type DeliveryFailure = 'DELIVERY_DISABLED' | 'OUT_OF_RANGE' | 'CONFIG_MISSING' | 'INVALID_COORDINATES';

export type FreeDeliveryReason = 'PROMOTION' | 'MINIMUM_ORDER' | 'WITHIN_FREE_RADIUS';

export type DeliveryQuote = {
  available: boolean;
  reason: DeliveryFailure | null;
  distanceKm: string;
  method: DistanceMethod;
  chargeableKm: string;
  billingUnits: number;
  /** Charge before any free-delivery rule, after the min and max limits. */
  standardCharge: string;
  charge: string;
  tax: string;
  total: string;
  free: boolean;
  freeReason: FreeDeliveryReason | null;
  /** Order amount still needed for free delivery, when the store offers it. */
  freeAboveOrder: string | null;
  rule: DeliveryRule;
};

export function quoteDelivery(input: {
  rule: DeliveryRule;
  distanceKm: number | null;
  method: DistanceMethod;
  /** Food total after discounts. Null on the store list, where no cart exists yet. */
  orderAmount: string | null;
  now: Date;
}): DeliveryQuote {
  const { rule } = input;
  const base = {
    method: input.method,
    freeAboveOrder: rule.freeAboveOrder,
    rule,
  };
  const failed = (reason: DeliveryFailure, distanceKm = 0): DeliveryQuote => ({
    ...base,
    available: false,
    reason,
    distanceKm: km(distanceKm),
    chargeableKm: '0.000',
    billingUnits: 0,
    standardCharge: '0.000',
    charge: '0.000',
    tax: '0.000',
    total: '0.000',
    free: false,
    freeReason: null,
  });

  if (input.distanceKm === null || !Number.isFinite(input.distanceKm) || input.distanceKm < 0) return failed('INVALID_COORDINATES');
  const distance = input.distanceKm;
  if (!rule.deliveryEnabled) return failed('DELIVERY_DISABLED', distance);
  const config = readRule(rule);
  if (!config) return failed('CONFIG_MISSING', distance);
  if (config.maxKm > 0 && distance > config.maxKm) return failed('OUT_OF_RANGE', distance);

  const billableFrom = Math.max(config.freeKm, config.includedKm);
  const chargeableKm = Math.max(0, distance - billableFrom);
  const units = config.stepKm > 0 ? Math.ceil(round6(chargeableKm / config.stepKm)) : 0;
  let standard = config.stepKm > 0
    ? config.base.plus(config.rate.mul(units))
    : config.base.plus(config.rate.mul(chargeableKm.toFixed(6)));
  if (config.min && standard.lt(config.min)) standard = config.min;
  if (config.max && standard.gt(config.max)) standard = config.max;
  standard = money(moneyString(standard));

  const freeReason = whyFree(input, config, distance);
  const charge = freeReason ? zero() : standard;
  const tax = money(moneyString(charge.mul(config.taxRate)));
  return {
    ...base,
    available: true,
    reason: null,
    distanceKm: km(distance),
    chargeableKm: km(chargeableKm),
    billingUnits: units,
    standardCharge: moneyString(standard),
    charge: moneyString(charge),
    tax: moneyString(tax),
    total: moneyString(charge.plus(tax)),
    free: Boolean(freeReason),
    freeReason,
  };
}

/** Rough travel time: preparation, then about 2.5 minutes a kilometre on Bahrain roads, rounded up to 5 minutes. */
export function estimateDeliveryMinutes(preparationMinutes: number, distanceKm: number | null) {
  const prep = Number.isFinite(preparationMinutes) && preparationMinutes > 0 ? preparationMinutes : 20;
  const travel = distanceKm !== null && Number.isFinite(distanceKm) ? Math.ceil(distanceKm * 2.5) + 5 : 15;
  return Math.ceil((prep + travel) / 5) * 5;
}

/** Map the original per-store delivery fields onto the newer rule shape, so stores that never saved a rule keep their prices. */
export function legacyDeliveryRule(merchant: {
  deliveryEnabled: boolean;
  freeDeliveryEnabled: boolean;
  freeDeliveryKm: string;
  baseDeliveryKm: string;
  baseDeliveryFee: string;
  beyondFreeDeliveryFee: string;
  beyondDeliveryFeeMode: string;
  maxDeliveryKm: string;
  updatedAt: Date;
}, platformFee: string): DeliveryRule {
  const common = {
    settingId: null,
    version: 0,
    updatedAt: merchant.updatedAt.toISOString(),
    deliveryEnabled: merchant.deliveryEnabled,
    maxRadiusKm: positive(merchant.maxDeliveryKm),
    minCharge: null,
    maxCharge: null,
    freeAboveOrder: null,
    taxRate: '0',
    promoFreeFrom: null,
    promoFreeUntil: null,
  };
  const fixed = merchant.beyondDeliveryFeeMode === 'FIXED';
  const beyond = positive(merchant.beyondFreeDeliveryFee);
  const baseFee = positive(merchant.baseDeliveryFee);
  const baseKm = positive(merchant.baseDeliveryKm);
  const configured = merchant.freeDeliveryEnabled || Number(baseKm) > 0 || Number(baseFee) > 0 || Number(beyond) > 0;
  if (!configured) {
    return { ...common, source: 'PLATFORM_DEFAULT', freeRadiusKm: '0', includedKm: '0', baseCharge: platformFee, chargePerStep: '0', billingStepKm: '0' };
  }
  if (merchant.freeDeliveryEnabled) {
    return {
      ...common,
      source: 'LEGACY_MERCHANT',
      freeRadiusKm: positive(merchant.freeDeliveryKm),
      includedKm: '0',
      baseCharge: fixed ? beyond : '0',
      chargePerStep: fixed ? '0' : beyond,
      billingStepKm: '0',
    };
  }
  if (fixed && Number(baseKm) === 0) {
    return { ...common, source: 'LEGACY_MERCHANT', freeRadiusKm: '0', includedKm: '0', baseCharge: Number(beyond) > 0 ? beyond : baseFee, chargePerStep: '0', billingStepKm: '0' };
  }
  if (fixed) {
    // Inside the base range the base fee applies; past it the single fixed price applies.
    // One very wide billing step turns "any distance past the range" into exactly one extra unit.
    const step = '100000';
    const extra = money(beyond).minus(baseFee);
    return {
      ...common,
      source: 'LEGACY_MERCHANT',
      freeRadiusKm: '0',
      includedKm: baseKm,
      baseCharge: baseFee,
      chargePerStep: extra.isNeg() ? '0' : moneyString(extra),
      billingStepKm: step,
    };
  }
  return { ...common, source: 'LEGACY_MERCHANT', freeRadiusKm: '0', includedKm: baseKm, baseCharge: baseFee, chargePerStep: beyond, billingStepKm: '0' };
}

/** The rule that applies to one branch: a matching zone first, then the branch, then the store default. */
export function pickDeliverySetting<T extends { branchId: string | null; serviceAreaId: string | null; active: boolean }>(
  settings: T[],
  branchId: string,
  zoneIds: string[],
): { setting: T; source: Exclude<DeliveryRuleSource, 'LEGACY_MERCHANT' | 'PLATFORM_DEFAULT'> } | null {
  const live = settings.filter((row) => row.active);
  const zone =
    live.find((row) => row.serviceAreaId && zoneIds.includes(row.serviceAreaId) && row.branchId === branchId) ??
    live.find((row) => row.serviceAreaId && zoneIds.includes(row.serviceAreaId) && !row.branchId);
  if (zone) return { setting: zone, source: 'ZONE' };
  const branch = live.find((row) => !row.serviceAreaId && row.branchId === branchId);
  if (branch) return { setting: branch, source: 'BRANCH' };
  const store = live.find((row) => !row.serviceAreaId && !row.branchId);
  if (store) return { setting: store, source: 'MERCHANT' };
  return null;
}

function whyFree(input: { orderAmount: string | null; now: Date }, config: NonNullable<ReturnType<typeof readRule>>, distance: number): FreeDeliveryReason | null {
  const promo = config.promoFrom || config.promoUntil;
  if (promo && (!config.promoFrom || input.now >= config.promoFrom) && (!config.promoUntil || input.now <= config.promoUntil)) return 'PROMOTION';
  if (config.freeAbove && input.orderAmount !== null && money(input.orderAmount).gte(config.freeAbove)) return 'MINIMUM_ORDER';
  if (config.freeKm > 0 && distance <= config.freeKm) return 'WITHIN_FREE_RADIUS';
  return null;
}

function readRule(rule: DeliveryRule) {
  const freeKm = Number(rule.freeRadiusKm);
  const maxKm = Number(rule.maxRadiusKm);
  const includedKm = Number(rule.includedKm);
  const stepKm = Number(rule.billingStepKm);
  if (![freeKm, maxKm, includedKm, stepKm].every((value) => Number.isFinite(value) && value >= 0)) return null;
  const amounts = [rule.baseCharge, rule.chargePerStep, rule.taxRate, rule.minCharge, rule.maxCharge, rule.freeAboveOrder];
  let parsed: (Money | null)[];
  try {
    parsed = amounts.map((value) => (value === null || value === '' ? null : money(value)));
  } catch {
    return null;
  }
  if (parsed.some((value) => value?.isNeg())) return null;
  const [base, rate, taxRate, min, max, freeAbove] = parsed;
  if (!base || !rate || !taxRate) return null;
  if (min && max && min.gt(max)) return null;
  if (rate.gt(0) && stepKm === 0 && rule.source !== 'LEGACY_MERCHANT') return null;
  return { freeKm, maxKm, includedKm, stepKm, base, rate, taxRate, min, max, freeAbove, promoFrom: rule.promoFreeFrom, promoUntil: rule.promoFreeUntil };
}

function positive(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? value : '0';
}

function km(value: number) {
  return value.toFixed(3);
}

function round6(value: number) {
  return Math.round(value * 1e6) / 1e6;
}
