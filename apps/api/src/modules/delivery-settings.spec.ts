import { deliveryPreviewSchema, deliverySettingSchema, deliverySettingUpdateSchema } from '@alliva/validation';
import { deliverySettingData, previewDeliverySetting } from './delivery-settings';

const valid = {
  deliveryEnabled: true,
  freeRadiusKm: '3',
  maxRadiusKm: '10',
  baseCharge: '0.500',
  chargePerStep: '0.300',
  billingStepKm: '1',
  minCharge: '0.500',
  maxCharge: '3.000',
  freeAboveOrder: '15.000',
  taxRate: '0.1',
  promoFreeFrom: null,
  promoFreeUntil: null,
};

function issues(schema: typeof deliverySettingSchema | typeof deliverySettingUpdateSchema, value: unknown) {
  const parsed = schema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
}

describe('delivery setting validation', () => {
  it('accepts a complete store default, branch override and zone override', () => {
    expect(issues(deliverySettingSchema, valid)).toEqual([]);
    expect(issues(deliverySettingSchema, { ...valid, branchId: '6f1c1d5e-2b7a-4c39-9a51-0d3c2f6b8e11' })).toEqual([]);
    expect(issues(deliverySettingSchema, { ...valid, serviceAreaId: '6f1c1d5e-2b7a-4c39-9a51-0d3c2f6b8e11' })).toEqual([]);
  });

  it('rejects negative amounts and distances', () => {
    for (const field of ['freeRadiusKm', 'maxRadiusKm', 'baseCharge', 'chargePerStep', 'billingStepKm', 'minCharge', 'maxCharge', 'freeAboveOrder', 'taxRate']) {
      expect(issues(deliverySettingSchema, { ...valid, [field]: '-1' })).toContain(field);
    }
  });

  it('rejects tax above 100%', () => {
    expect(issues(deliverySettingSchema, { ...valid, taxRate: '1.5' })).toContain('taxRate');
    expect(issues(deliverySettingSchema, { ...valid, taxRate: '1' })).toEqual([]);
  });

  it('needs a billing step when a per-step charge is set', () => {
    expect(issues(deliverySettingSchema, { ...valid, billingStepKm: '0' })).toEqual(['billingStepKm']);
    expect(issues(deliverySettingSchema, { ...valid, chargePerStep: '0', billingStepKm: '0' })).toEqual([]);
    expect(issues(deliverySettingSchema, { ...valid, billingStepKm: '0.5' })).toEqual([]);
  });

  it('keeps the minimum charge at or below the maximum', () => {
    expect(issues(deliverySettingSchema, { ...valid, minCharge: '3.500' })).toEqual(['minCharge']);
    expect(issues(deliverySettingSchema, { ...valid, minCharge: '3.000' })).toEqual([]);
    expect(issues(deliverySettingSchema, { ...valid, minCharge: '5.000', maxCharge: null })).toEqual([]);
  });

  it('keeps the free radius inside the delivery area and the promotion in order', () => {
    expect(issues(deliverySettingSchema, { ...valid, freeRadiusKm: '12' })).toEqual(['freeRadiusKm']);
    expect(issues(deliverySettingSchema, { ...valid, freeRadiusKm: '12', maxRadiusKm: '0' })).toEqual([]);
    expect(issues(deliverySettingSchema, { ...valid, promoFreeFrom: '2026-11-02T00:00:00Z', promoFreeUntil: '2026-11-01T00:00:00Z' })).toEqual(['promoFreeUntil']);
  });

  it('applies the same rules to updates and does not let them move the row', () => {
    expect(issues(deliverySettingUpdateSchema, { ...valid, minCharge: '9.000', version: 2 })).toEqual(['minCharge']);
    const parsed = deliverySettingUpdateSchema.parse({ ...valid, version: 2, branchId: '6f1c1d5e-2b7a-4c39-9a51-0d3c2f6b8e11' });
    expect('branchId' in parsed).toBe(false);
  });

  it('clears optional limits that are left empty', () => {
    const data = deliverySettingData({ ...valid, minCharge: undefined, maxCharge: null, freeAboveOrder: undefined });
    expect(data).toMatchObject({ minCharge: null, maxCharge: null, freeAboveOrder: null, includedKm: '0' });
  });
});

describe('delivery setting preview', () => {
  it('quotes a draft with the checkout engine', () => {
    const body = deliveryPreviewSchema.parse({ ...valid, freeAboveOrder: null, distancesKm: [2, 6.2, 12] });
    const [inside, priced, far] = previewDeliverySetting(body, new Date('2026-10-29T10:00:00Z')).quotes;
    expect(inside).toMatchObject({ available: true, free: true, freeReason: 'WITHIN_FREE_RADIUS', total: '0.000' });
    // 3.2 km past the free radius bills 4 started km: 0.500 + 4 × 0.300 = 1.700, plus 10% tax.
    expect(priced).toMatchObject({ available: true, billingUnits: 4, charge: '1.700', tax: '0.170', total: '1.870' });
    expect(far).toMatchObject({ available: false, reason: 'OUT_OF_RANGE' });
  });

  it('shows free delivery once the order reaches the free-delivery minimum', () => {
    const body = deliveryPreviewSchema.parse({ ...valid, distancesKm: [6.2], orderAmount: '20.000' });
    expect(previewDeliverySetting(body).quotes[0]).toMatchObject({ free: true, freeReason: 'MINIMUM_ORDER', standardCharge: '1.700' });
  });
});
