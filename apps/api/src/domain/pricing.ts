import { assertNonNegative, money, moneyString, zero, type Money } from './money';

export type PromoFacts = {
  code: string;
  discountType: 'FIXED' | 'PERCENTAGE';
  discountValue: string;
  maxDiscount: string | null;
  minimumOrder: string | null;
  usageLimit: number | null;
  usedCount: number;
  perCustomerLimit: number | null;
  customerUsed: number;
  startsAt: Date;
  endsAt: Date;
  firstOrderOnly: boolean;
  customerOrderCount: number;
  budget: string | null;
  budgetSpent: string;
  merchantAllowed: boolean;
  categoryAllowed: boolean;
  now: Date;
};

export type ChargeInput = {
  enabled: boolean;
  mode: 'PERCENTAGE' | 'FIXED';
  amount: string;
};

export type PriceInput = {
  lines: { unitPrice: string; quantity: number }[];
  fulfillment: 'DELIVERY' | 'TAKEAWAY' | 'DINE_IN';
  deliveryFee: string;
  /** Tax on the delivery charge itself, from the branch delivery settings. Dropped when delivery becomes free. */
  deliveryTax?: string;
  freeDeliveryMinimum: string | null;
  taxRate: string;
  serviceFee?: ChargeInput;
  tax?: ChargeInput;
  promo: PromoFacts | null;
};

export type PriceResult = {
  subtotal: string;
  discount: string;
  deliveryFee: string;
  deliveryFeeSaved: string;
  serviceFee: string;
  /** Part of `tax` charged on delivery. */
  deliveryTax: string;
  tax: string;
  total: string;
  currency: 'BHD';
};

/** An order promo applies only when the customer's cart belongs to the merchant who owns the code. */
export function orderPromoForMerchant(
  promo: { purpose: string; merchantId: string | null; active?: boolean; deletedAt?: Date | null },
  cartMerchantId: string | null,
): boolean {
  if (promo.purpose !== 'ORDER' || promo.active === false || promo.deletedAt) return false;
  return promo.merchantId !== null && promo.merchantId === cartMerchantId;
}

export function quotePromoDiscount(subtotal: Money, promo: PromoFacts | null): Money {
  if (!promo) return zero();
  if (promo.now < promo.startsAt || promo.now > promo.endsAt) {
    throw new Error('Promo code is not active');
  }
  if (!promo.merchantAllowed || !promo.categoryAllowed) {
    throw new Error('Promo code does not apply to this order');
  }
  if (promo.minimumOrder && subtotal.lt(money(promo.minimumOrder))) {
    throw new Error('Order is below the promo minimum');
  }
  if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit) {
    throw new Error('Promo code has reached its usage limit');
  }
  if (promo.perCustomerLimit !== null && promo.customerUsed >= promo.perCustomerLimit) {
    throw new Error('You have already used this promo code');
  }
  if (promo.firstOrderOnly && promo.customerOrderCount > 0) {
    throw new Error('Promo code is only valid on the first order');
  }
  let discount =
    promo.discountType === 'PERCENTAGE'
      ? subtotal.mul(promo.discountValue).div(100)
      : money(promo.discountValue);
  if (promo.maxDiscount) discount = DecimalMin(discount, money(promo.maxDiscount));
  discount = DecimalMin(discount, subtotal);
  if (promo.budget) {
    const remaining = money(promo.budget).minus(promo.budgetSpent);
    if (remaining.lte(0)) throw new Error('Promo campaign budget is exhausted');
    discount = DecimalMin(discount, remaining);
  }
  assertNonNegative(discount, 'discount');
  return discount;
}

export function priceOrder(input: PriceInput): PriceResult {
  const subtotal = input.lines.reduce(
    (sum, line) => sum.plus(money(line.unitPrice).mul(line.quantity)),
    zero(),
  );
  assertNonNegative(subtotal, 'subtotal');
  const discount = quotePromoDiscount(subtotal, input.promo);
  const food = subtotal.minus(discount);
  let deliveryFee = input.fulfillment === 'DELIVERY' ? money(input.deliveryFee) : zero();
  let deliveryFeeSaved = zero();
  let deliveryTax = input.fulfillment === 'DELIVERY' && input.deliveryTax ? money(input.deliveryTax) : zero();
  if (
    input.fulfillment === 'DELIVERY' &&
    input.freeDeliveryMinimum &&
    food.gte(money(input.freeDeliveryMinimum))
  ) {
    deliveryFeeSaved = deliveryFee;
    deliveryFee = zero();
    deliveryTax = zero();
  }
  assertNonNegative(deliveryTax, 'delivery tax');
  const serviceFee = input.serviceFee ? chargeAmount(food, input.serviceFee) : zero();
  const tax = (input.tax ? chargeAmount(food, input.tax) : food.mul(input.taxRate)).plus(deliveryTax);
  const total = food.plus(deliveryFee).plus(serviceFee).plus(tax);
  return {
    subtotal: moneyString(subtotal),
    discount: moneyString(discount),
    deliveryFee: moneyString(deliveryFee),
    deliveryFeeSaved: moneyString(deliveryFeeSaved),
    serviceFee: moneyString(serviceFee),
    deliveryTax: moneyString(deliveryTax),
    tax: moneyString(tax),
    total: moneyString(total),
    currency: 'BHD',
  };
}

function chargeAmount(base: Money, rule: ChargeInput): Money {
  if (!rule.enabled) return zero();
  const amount = rule.mode === 'FIXED' ? money(rule.amount || '0') : base.mul(rule.amount || '0');
  assertNonNegative(amount, 'charge');
  return amount;
}

function DecimalMin(a: Money, b: Money): Money {
  return a.lt(b) ? a : b;
}
