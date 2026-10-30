import { merchantOrderCharges, platformPlanCharges, priceWithCharges } from './charges';
import { money } from './money';
import { orderPromoForMerchant, priceOrder } from './pricing';
import { assertTransition } from './order-machine';
import { assertFeatureEnabled, assertWithinLimit, suggestionMode } from './entitlements';
import { assignmentBlockReason, countsTowardMonthlyOrderLimit, subscriptionIsLive, subscriptionShouldExpire, suggestedMerchants, validatePlanEntitlements } from './subscriptions';
import { applySubscriptionDiscount, calculateSubscriptionCommission, nextRedemptionAt, redemptionAllowed } from './commissions';
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
    expect(quote.serviceFee).toBe('0.000');
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
    expect(quote.serviceFee).toBe('0.000');
    expect(quote.total).toBe('18.500');
  });

  it('accepts an order promo only for the merchant who owns the cart', () => {
    const promo = { purpose: 'ORDER', merchantId: 'store-a', active: true, deletedAt: null };
    expect(orderPromoForMerchant(promo, 'store-a')).toBe(true);
    expect(orderPromoForMerchant(promo, 'store-b')).toBe(false);
    expect(orderPromoForMerchant(promo, null)).toBe(false);
    expect(orderPromoForMerchant({ ...promo, purpose: 'SUBSCRIPTION' }, 'store-a')).toBe(false);
    expect(orderPromoForMerchant({ ...promo, active: false }, 'store-a')).toBe(false);
    expect(orderPromoForMerchant({ ...promo, merchantId: null }, 'store-a')).toBe(false);
  });

  it('adds a fixed service fee and a percentage tax on the discounted food total', () => {
    const quote = priceOrder({
      lines: [{ unitPrice: '20.000', quantity: 1 }],
      fulfillment: 'TAKEAWAY',
      deliveryFee: '1.000',
      freeDeliveryMinimum: null,
      taxRate: '0.100',
      serviceFee: { enabled: true, mode: 'FIXED', amount: '0.500' },
      tax: { enabled: true, mode: 'PERCENTAGE', amount: '0.050' },
      promo: null,
    });
    expect(quote.serviceFee).toBe('0.500');
    expect(quote.tax).toBe('1.000');
    expect(quote.total).toBe('21.500');
  });

  it('skips a disabled charge', () => {
    const quote = priceOrder({
      lines: [{ unitPrice: '10.000', quantity: 1 }],
      fulfillment: 'TAKEAWAY',
      deliveryFee: '0',
      freeDeliveryMinimum: null,
      taxRate: '0.100',
      serviceFee: { enabled: false, mode: 'PERCENTAGE', amount: '0.100' },
      tax: { enabled: false, mode: 'FIXED', amount: '1.000' },
      promo: null,
    });
    expect(quote.serviceFee).toBe('0.000');
    expect(quote.tax).toBe('0.000');
    expect(quote.total).toBe('10.000');
  });

  it('adds only the charges a store has turned on', () => {
    expect(merchantOrderCharges(null)).toMatchObject({ serviceFee: { enabled: false }, tax: { enabled: false } });
    const store = merchantOrderCharges({
      serviceFee: { enabled: true, mode: 'FIXED', amount: '0.500', label: { en: 'Packing', ar: 'تغليف' } },
    });
    expect(store.serviceFee.enabled).toBe(true);
    expect(store.tax.enabled).toBe(false);
    expect(priceWithCharges('20.000', store)).toEqual({ serviceFee: '0.500', tax: '0.000', payable: '20.500' });
  });

  it('adds admin charges to a discounted plan price and leaves them off when unset', () => {
    const off = platformPlanCharges(new Map([['taxRate', '0.100']]));
    expect(priceWithCharges('18.000', off)).toEqual({ serviceFee: '0.000', tax: '0.000', payable: '18.000' });
    const on = platformPlanCharges(new Map([
      ['serviceFee', { enabled: true, mode: 'FIXED', amount: '1.000', label: { en: 'Service fee', ar: 'رسوم الخدمة' } }],
      ['taxCharge', { enabled: true, mode: 'PERCENTAGE', amount: '0.10000', label: { en: 'Tax', ar: 'الضريبة' } }],
    ]));
    expect(priceWithCharges('18.000', on)).toEqual({ serviceFee: '1.000', tax: '1.800', payable: '20.800' });
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

  it('lets counter staff hand a collection order to the customer', () => {
    expect(() =>
      assertTransition({ from: 'READY_FOR_PICKUP', to: 'DELIVERED', fulfillment: 'TAKEAWAY', roles: ['ORDER_TAKING_STAFF'] }),
    ).not.toThrow();
  });

  it('keeps counter staff out of the kitchen and billing staff out of order statuses', () => {
    expect(() =>
      assertTransition({ from: 'PREPARING', to: 'READY_FOR_PICKUP', fulfillment: 'TAKEAWAY', roles: ['ORDER_TAKING_STAFF'] }),
    ).toThrow(/role/i);
    expect(() =>
      assertTransition({ from: 'PENDING', to: 'ACCEPTED', fulfillment: 'TAKEAWAY', roles: ['BILLING_STAFF'] }),
    ).toThrow(/role/i);
    expect(() =>
      assertTransition({ from: 'PENDING', to: 'CANCELLED', fulfillment: 'TAKEAWAY', roles: ['KITCHEN_STAFF'] }),
    ).toThrow(/role/i);
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

  it('discounts the first subscription and floors the charge at zero', () => {
    expect(applySubscriptionDiscount('49.000', 'PERCENTAGE', '10')).toBe('44.100');
    expect(applySubscriptionDiscount('49.000', 'FIXED', '5.000')).toBe('44.000');
    expect(applySubscriptionDiscount('49.000', 'FIXED', '60.000')).toBe('0.000');
  });

  it('allows one redemption each week or calendar month', () => {
    const now = new Date('2026-10-20T12:00:00.000Z');
    expect(redemptionAllowed(null, 'WEEKLY', now)).toBe(true);
    expect(redemptionAllowed(new Date('2026-10-18T12:00:00.000Z'), 'WEEKLY', now)).toBe(false);
    expect(redemptionAllowed(new Date('2026-10-13T12:00:00.000Z'), 'WEEKLY', now)).toBe(true);
    expect(redemptionAllowed(new Date('2026-10-05T12:00:00.000Z'), 'MONTHLY', now)).toBe(false);
    expect(redemptionAllowed(new Date('2026-09-30T20:00:00.000Z'), 'MONTHLY', now)).toBe(true);
    expect(nextRedemptionAt(new Date('2026-10-18T12:00:00.000Z'), 'WEEKLY', now)?.toISOString()).toBe('2026-10-25T12:00:00.000Z');
    expect(nextRedemptionAt(new Date('2026-10-05T12:00:00.000Z'), 'MONTHLY', now)?.toISOString()).toBe('2026-10-31T21:00:00.000Z');
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

describe('subscription period', () => {
  const now = new Date('2026-10-28T12:00:00Z');

  it('expires a plan once the renewal date has passed', () => {
    const ended = { status: 'ACTIVE', currentPeriodEnd: new Date('2026-10-25T00:00:00Z') };
    expect(subscriptionShouldExpire(ended, now)).toBe(true);
    expect(subscriptionIsLive(ended, now)).toBe(false);
  });

  it('keeps a plan live until the renewal instant', () => {
    const current = { status: 'ACTIVE', currentPeriodEnd: new Date('2026-11-25T00:00:00Z') };
    expect(subscriptionShouldExpire(current, now)).toBe(false);
    expect(subscriptionIsLive(current, now)).toBe(true);
    expect(subscriptionIsLive({ status: 'EXPIRED', currentPeriodEnd: current.currentPeriodEnd }, now)).toBe(false);
    expect(subscriptionIsLive(null, now)).toBe(false);
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
