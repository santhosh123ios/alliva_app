import { money } from './money';
import { priceOrder } from './pricing';
import { assertTransition } from './order-machine';
import { assertFeatureEnabled, assertWithinLimit, suggestionMode } from './entitlements';
import { assignmentBlockReason, countsTowardMonthlyOrderLimit, suggestedMerchants, validatePlanEntitlements } from './subscriptions';
import { calculateSubscriptionCommission } from './commissions';
import { assertLedgerImmutable, buildCaptureLedger } from './ledger';
import { isOpenAt } from './hours';

describe('pricing', () => {
  it('recalculates BHD totals with free delivery and tax', () => {
    const quote = priceOrder({
      lines: [{ unitPrice: '8.500', quantity: 2 }],
      fulfillment: 'DELIVERY',
      deliveryFee: '0.500',
      freeDeliveryMinimum: '8.000',
      taxRate: '0.100',
      promo: null,
    });
    expect(quote.subtotal).toBe('17.000');
    expect(quote.deliveryFee).toBe('0.000');
    expect(quote.deliveryFeeSaved).toBe('0.500');
    expect(quote.tax).toBe('1.700');
    expect(quote.total).toBe('18.700');
    expect(quote.currency).toBe('BHD');
  });

  it('caps a percentage promo', () => {
    const quote = priceOrder({
      lines: [{ unitPrice: '20.000', quantity: 1 }],
      fulfillment: 'TAKEAWAY',
      deliveryFee: '0.500',
      freeDeliveryMinimum: null,
      taxRate: '0',
      promo: {
        code: 'WELCOME10',
        discountType: 'PERCENTAGE',
        discountValue: '10',
        maxDiscount: '1.500',
        minimumOrder: '5.000',
        usageLimit: 10,
        usedCount: 0,
        perCustomerLimit: 1,
        customerUsed: 0,
        startsAt: new Date('2020-01-01'),
        endsAt: new Date('2099-01-01'),
        firstOrderOnly: false,
        customerOrderCount: 0,
        budget: '100.000',
        budgetSpent: '0.000',
        merchantAllowed: true,
        categoryAllowed: true,
        now: new Date('2026-09-22'),
      },
    });
    expect(quote.discount).toBe('1.500');
    expect(quote.total).toBe('18.500');
  });
});

describe('order machine', () => {
  it('lets kitchen staff move an accepted order into preparation', () => {
    expect(() =>
      assertTransition({ from: 'ACCEPTED', to: 'PREPARING', fulfillment: 'DELIVERY', roles: ['KITCHEN_STAFF'] }),
    ).not.toThrow();
  });

  it('blocks delivering a delivery order straight from the counter', () => {
    expect(() =>
      assertTransition({ from: 'READY_FOR_PICKUP', to: 'DELIVERED', fulfillment: 'DELIVERY', roles: ['MERCHANT_OWNER'] }),
    ).toThrow(/driver/i);
  });
});

describe('entitlements', () => {
  it('reads visibility from stored rows', () => {
    expect(suggestionMode('EXCLUSIVE_STOREFRONT')).toBe('CURRENT_STORE_ONLY');
    expect(suggestionMode('MARKETPLACE')).toBe('ALL_STORES');
    expect(suggestionMode('EXCLUDE_SAME_BUSINESS_TYPE')).toBe('EXCLUDE_SAME_BUSINESS_TYPE');
    expect(() => assertWithinLimit(2, 2, 1, 'product limit')).toThrow(/reached/);
    expect(() => assertFeatureEnabled(false, 'Table ordering')).toThrow(/not included/);
  });
});

describe('subscription plans', () => {
  const current = { id: 'saffron', businessType: 'Bahraini kitchen' };
  const candidates = [
    current,
    { id: 'pearl', businessType: 'Bahraini kitchen' },
    { id: 'thyme', businessType: 'Cafe' },
  ];

  it('keeps the scanned store first and filters suggestions by plan visibility', () => {
    expect(suggestedMerchants({ mode: 'CURRENT_STORE_ONLY', current, candidates }).map((row) => row.id)).toEqual(['saffron']);
    expect(suggestedMerchants({ mode: 'EXCLUDE_SAME_BUSINESS_TYPE', current, candidates }).map((row) => row.id)).toEqual(['saffron', 'thyme']);
    expect(suggestedMerchants({ mode: 'ALL_STORES', current, candidates }).map((row) => row.id)).toEqual(['saffron', 'pearl', 'thyme']);
  });

  it('does not count cancelled orders toward the billing-period limit', () => {
    expect(countsTowardMonthlyOrderLimit('CANCELLED')).toBe(false);
    expect(countsTowardMonthlyOrderLimit('DELIVERED')).toBe(true);
    expect(countsTowardMonthlyOrderLimit('REFUNDED')).toBe(true);
  });

  it('rejects archived plans and incomplete feature rows', () => {
    expect(assignmentBlockReason('ARCHIVED')).toMatch(/Archived/);
    expect(assignmentBlockReason('DRAFT')).toMatch(/published/);
    expect(assignmentBlockReason('ACTIVE')).toBeNull();
    expect(() => validatePlanEntitlements([{ key: 'visibility', value: 'ALL_STORES' }])).toThrow(/productLimit/);
    const rows = validatePlanEntitlements([
      { key: 'visibility', value: 'MARKETPLACE' },
      { key: 'productLimit', value: null },
      { key: 'monthlyOrderLimit', value: 10 },
      { key: 'offerHighlighting', value: true },
      { key: 'paymentIntegration', value: false },
      { key: 'deliveryOrdering', value: true },
      { key: 'takeawayOrdering', value: true },
      { key: 'tableOrdering', value: false },
      { key: 'tableCountLimit', value: 12 },
      { key: 'staffLimit', value: 4 },
      { key: 'branchLimit', value: 1 },
      { key: 'merchantPromoCodes', value: false },
      { key: 'reporting', value: 'BASIC' },
      { key: 'transactionalNotifications', value: true },
      { key: 'promotionalNotifications', value: false },
      { key: 'supportLevel', value: 'STANDARD' },
    ]);
    expect(rows.find((row) => row.key === 'visibility')?.value).toBe('ALL_STORES');
    expect(rows.find((row) => row.key === 'tableCountLimit')?.value).toBeNull();
  });
});

describe('commissions', () => {
  it('pays staff and head only from a verified subscription payment', () => {
    const split = calculateSubscriptionCommission({
      paymentAmount: '49.000',
      staffPercent: '8',
      headOverridePercent: '2',
      maxCommission: '25.000',
      isRenewal: false,
      renewalEnabled: false,
      paymentVerified: true,
    });
    expect(split).toEqual({ staffAmount: '3.920', headAmount: '0.980' });
    expect(() =>
      calculateSubscriptionCommission({
        paymentAmount: '49.000',
        staffPercent: '8',
        headOverridePercent: '2',
        maxCommission: null,
        isRenewal: false,
        renewalEnabled: false,
        paymentVerified: false,
      }),
    ).toThrow(/verified/);
  });

  it('skips renewal commission when the plan does not allow it', () => {
    expect(
      calculateSubscriptionCommission({
        paymentAmount: '49.000',
        staffPercent: '8',
        headOverridePercent: '2',
        maxCommission: null,
        isRenewal: true,
        renewalEnabled: false,
        paymentVerified: true,
      }),
    ).toBeNull();
  });
});

describe('ledger', () => {
  it('builds balanced capture lines and refuses mutation', () => {
    const lines = buildCaptureLedger({
      total: '9.350',
      foodAfterDiscount: '8.500',
      tax: '0.850',
      deliveryFee: '0.000',
      commissionRate: '0.12',
      gatewayRate: '0.025',
      payDriver: false,
      referenceId: 'order-1',
    });
    expect(lines.find((line) => line.type === 'CUSTOMER_PAYMENT')?.amount).toBe('9.350');
    expect(lines.find((line) => line.type === 'MERCHANT_AMOUNT')?.amount).toBe('7.480');
    expect(() => assertLedgerImmutable('update')).toThrow(/immutable/);
  });
});

describe('hours', () => {
  it('uses the Bahrain clock', () => {
    const open = isOpenAt(
      [{ dayOfWeek: 2, opensAt: '00:00', closesAt: '23:59', closed: false }],
      new Date('2026-09-22T12:00:00Z'),
    );
    expect(open).toBe(true);
  });
});
