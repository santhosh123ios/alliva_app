import { deliveryFeeForDistance, type DeliveryPricingSettings } from './delivery-pricing';
import { estimateDeliveryMinutes, legacyDeliveryRule, pickDeliverySetting, quoteDelivery, type DeliveryRule } from './delivery-quote';
import { haversineKm, insideBahrain, parsePoint, pointInGeoJson } from './geo';

const now = new Date('2026-10-29T10:00:00Z');

function rule(patch: Partial<DeliveryRule> = {}): DeliveryRule {
  return {
    source: 'BRANCH',
    settingId: 'setting-1',
    version: 3,
    updatedAt: now.toISOString(),
    deliveryEnabled: true,
    freeRadiusKm: '3',
    maxRadiusKm: '10',
    includedKm: '0',
    baseCharge: '0',
    chargePerStep: '0.300',
    billingStepKm: '1',
    minCharge: null,
    maxCharge: null,
    freeAboveOrder: null,
    taxRate: '0',
    promoFreeFrom: null,
    promoFreeUntil: null,
    ...patch,
  };
}

const quote = (patch: Partial<DeliveryRule>, distanceKm: number | null, orderAmount: string | null = null) =>
  quoteDelivery({ rule: rule(patch), distanceKm, method: 'HAVERSINE', orderAmount, now });

describe('delivery quote', () => {
  it('matches the worked example: 6.2 km, 3 km free, 1 km steps at 0.300', () => {
    const result = quote({}, 6.2);
    expect(result.available).toBe(true);
    expect(result.chargeableKm).toBe('3.200');
    expect(result.billingUnits).toBe(4);
    expect(result.charge).toBe('1.200');
    expect(result.total).toBe('1.200');
  });

  it('is free inside the free-delivery radius', () => {
    const result = quote({}, 2.9);
    expect(result.charge).toBe('0.000');
    expect(result.freeReason).toBe('WITHIN_FREE_RADIUS');
  });

  it('rounds up by half-kilometre steps', () => {
    const result = quote({ billingStepKm: '0.5', chargePerStep: '0.150' }, 4.1);
    expect(result.billingUnits).toBe(3);
    expect(result.charge).toBe('0.450');
  });

  it('does not add a unit for floating-point noise on an exact step', () => {
    expect(quote({ freeRadiusKm: '0' }, 3.0000000001).billingUnits).toBe(3);
  });

  it('adds the base charge to the stepped charge', () => {
    expect(quote({ baseCharge: '0.500' }, 6.2).charge).toBe('1.700');
  });

  it('applies minimum and maximum charges', () => {
    expect(quote({ minCharge: '1.500' }, 4).charge).toBe('1.500');
    expect(quote({ maxCharge: '1.000' }, 9.5).charge).toBe('1.000');
  });

  it('blocks addresses beyond the maximum radius', () => {
    const result = quote({}, 10.01);
    expect(result.available).toBe(false);
    expect(result.reason).toBe('OUT_OF_RANGE');
    expect(result.charge).toBe('0.000');
  });

  it('treats a zero maximum radius as no limit', () => {
    expect(quote({ maxRadiusKm: '0' }, 40).available).toBe(true);
  });

  it('reports disabled delivery', () => {
    expect(quote({ deliveryEnabled: false }, 1).reason).toBe('DELIVERY_DISABLED');
  });

  it('reports unusable configuration instead of guessing', () => {
    expect(quote({ billingStepKm: '0' }, 5).reason).toBe('CONFIG_MISSING');
    expect(quote({ minCharge: '2.000', maxCharge: '1.000' }, 5).reason).toBe('CONFIG_MISSING');
    expect(quote({ chargePerStep: '-1' }, 5).reason).toBe('CONFIG_MISSING');
  });

  it('reports missing coordinates', () => {
    expect(quote({}, null).reason).toBe('INVALID_COORDINATES');
  });

  it('waives the charge above the free-delivery order amount', () => {
    expect(quote({ freeAboveOrder: '10.000' }, 6.2, '9.999').charge).toBe('1.200');
    const free = quote({ freeAboveOrder: '10.000' }, 6.2, '10.000');
    expect(free.charge).toBe('0.000');
    expect(free.standardCharge).toBe('1.200');
    expect(free.freeReason).toBe('MINIMUM_ORDER');
  });

  it('waives the charge during a promotional window only', () => {
    const live = quote({ promoFreeFrom: new Date('2026-10-01T00:00:00Z'), promoFreeUntil: new Date('2026-11-01T00:00:00Z') }, 6.2);
    expect(live.freeReason).toBe('PROMOTION');
    const ended = quote({ promoFreeFrom: new Date('2026-09-01T00:00:00Z'), promoFreeUntil: new Date('2026-10-01T00:00:00Z') }, 6.2);
    expect(ended.charge).toBe('1.200');
  });

  it('adds delivery tax only when configured, rounded to fils', () => {
    expect(quote({ taxRate: '0.1' }, 6.2).tax).toBe('0.120');
    expect(quote({ taxRate: '0.1' }, 6.2).total).toBe('1.320');
    expect(quote({ taxRate: '0.1', chargePerStep: '0.333' }, 6.2).tax).toBe('0.133');
    expect(quote({}, 6.2).tax).toBe('0.000');
  });
});

describe('legacy store delivery fields', () => {
  const legacy: DeliveryPricingSettings & { deliveryEnabled: boolean; updatedAt: Date } = {
    deliveryEnabled: true,
    freeDeliveryEnabled: false,
    freeDeliveryKm: '0',
    baseDeliveryKm: '3',
    baseDeliveryFee: '1.000',
    beyondFreeDeliveryFee: '0.250',
    beyondDeliveryFeeMode: 'PER_KM',
    maxDeliveryKm: '10',
    updatedAt: now,
  };
  const both = (patch: Partial<typeof legacy>, distance: number) => {
    const merged = { ...legacy, ...patch };
    const mapped = quoteDelivery({ rule: legacyDeliveryRule(merged, '0.500'), distanceKm: distance, method: 'HAVERSINE', orderAmount: null, now });
    return { mapped: mapped.charge, original: deliveryFeeForDistance(merged, distance, '0.500') };
  };

  it.each([
    [{}, 2.5],
    [{}, 5],
    [{ freeDeliveryEnabled: true, freeDeliveryKm: '2' }, 1],
    [{ freeDeliveryEnabled: true, freeDeliveryKm: '2' }, 4],
    [{ beyondDeliveryFeeMode: 'FIXED' as const, beyondFreeDeliveryFee: '2.000' }, 2],
    [{ beyondDeliveryFeeMode: 'FIXED' as const, beyondFreeDeliveryFee: '2.000' }, 5],
    [{ beyondDeliveryFeeMode: 'FIXED' as const, beyondFreeDeliveryFee: '2.000', baseDeliveryKm: '0', baseDeliveryFee: '0' }, 5],
    [{ baseDeliveryKm: '0', baseDeliveryFee: '0', beyondFreeDeliveryFee: '0' }, 4],
  ])('keeps the original price for %j at %d km', (patch, distance) => {
    const { mapped, original } = both(patch, distance);
    expect(mapped).toBe(original);
  });

  it('keeps the original maximum radius', () => {
    const mapped = quoteDelivery({ rule: legacyDeliveryRule(legacy, '0.500'), distanceKm: 11, method: 'HAVERSINE', orderAmount: null, now });
    expect(mapped.reason).toBe('OUT_OF_RANGE');
  });
});

describe('delivery setting precedence', () => {
  const rows = [
    { id: 'store', branchId: null, serviceAreaId: null, active: true },
    { id: 'branch', branchId: 'b1', serviceAreaId: null, active: true },
    { id: 'zone', branchId: null, serviceAreaId: 'z1', active: true },
    { id: 'off', branchId: 'b2', serviceAreaId: null, active: false },
  ];

  it('prefers a matching zone, then the branch, then the store', () => {
    expect(pickDeliverySetting(rows, 'b1', ['z1'])?.setting.id).toBe('zone');
    expect(pickDeliverySetting(rows, 'b1', [])?.setting.id).toBe('branch');
    expect(pickDeliverySetting(rows, 'b2', [])?.setting.id).toBe('store');
    expect(pickDeliverySetting([], 'b1', [])).toBeNull();
  });
});

describe('geo helpers', () => {
  it('measures Manama to Muharraq at roughly 4 km', () => {
    const km = haversineKm({ latitude: 26.2285, longitude: 50.586 }, { latitude: 26.2572, longitude: 50.6119 });
    expect(km).toBeGreaterThan(3.5);
    expect(km).toBeLessThan(4.5);
  });

  it('rejects missing or impossible coordinates', () => {
    expect(parsePoint('', '50.5')).toBeNull();
    expect(parsePoint('abc', '50.5')).toBeNull();
    expect(parsePoint('0', '0')).toBeNull();
    expect(parsePoint('91', '50')).toBeNull();
    expect(parsePoint('26.2', '50.5')).toEqual({ latitude: 26.2, longitude: 50.5 });
  });

  it('knows Bahrain from elsewhere', () => {
    expect(insideBahrain({ latitude: 26.2285, longitude: 50.586 })).toBe(true);
    expect(insideBahrain({ latitude: 25.2, longitude: 55.27 })).toBe(false);
  });

  it('finds points inside GeoJSON polygons', () => {
    const square = { type: 'Polygon', coordinates: [[[50.5, 26.1], [50.7, 26.1], [50.7, 26.3], [50.5, 26.3], [50.5, 26.1]]] };
    expect(pointInGeoJson({ latitude: 26.2, longitude: 50.6 }, square)).toBe(true);
    expect(pointInGeoJson({ latitude: 26.4, longitude: 50.6 }, square)).toBe(false);
    expect(pointInGeoJson({ latitude: 26.2, longitude: 50.6 }, { type: 'Feature', geometry: square })).toBe(true);
    expect(pointInGeoJson({ latitude: 26.2, longitude: 50.6 }, null)).toBe(false);
  });

  it('estimates delivery minutes from preparation and distance', () => {
    expect(estimateDeliveryMinutes(20, 4)).toBe(35);
    expect(estimateDeliveryMinutes(20, null)).toBe(35);
  });
});
