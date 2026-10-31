import { ApiError, type ApiClient } from '@alliva/api-client';
import { formatMoney } from '@alliva/design-tokens';

type CheckoutProblemCode = Awaited<ReturnType<ApiClient['validateCheckout']>>['problems'][number]['code'];
type DeliveryUnavailableReason = NonNullable<Awaited<ReturnType<ApiClient['deliveryQuote']>>['reason']>;

/** Keys under `customer.checkoutErrors`. Customers only ever see these, never the raw API text. */
export type CheckoutMessageKey =
  | 'authExpired'
  | 'cartEmpty'
  | 'cartChanged'
  | 'storeUnavailable'
  | 'merchantClosed'
  | 'productUnavailable'
  | 'addressRequired'
  | 'addressInvalid'
  | 'outOfRange'
  | 'noDelivery'
  | 'configMissing'
  | 'quoteFailed'
  | 'fulfillmentUnavailable'
  | 'paymentUnavailable'
  | 'promoInvalid'
  | 'belowMinimum'
  | 'totalChanged'
  | 'network'
  | 'generic';

const byCode: Record<CheckoutProblemCode, CheckoutMessageKey> = {
  AUTH_REQUIRED: 'authExpired',
  CART_EMPTY: 'cartEmpty',
  CART_CHANGED: 'cartChanged',
  STORE_UNAVAILABLE: 'storeUnavailable',
  MERCHANT_CLOSED: 'merchantClosed',
  PRODUCT_UNAVAILABLE: 'productUnavailable',
  ADDRESS_REQUIRED: 'addressRequired',
  ADDRESS_INVALID: 'addressInvalid',
  ADDRESS_OUT_OF_RANGE: 'outOfRange',
  DELIVERY_DISABLED: 'noDelivery',
  DELIVERY_CONFIG_MISSING: 'configMissing',
  DELIVERY_QUOTE_FAILED: 'quoteFailed',
  FULFILLMENT_UNAVAILABLE: 'fulfillmentUnavailable',
  PAYMENT_METHOD_UNAVAILABLE: 'paymentUnavailable',
  PROMO_INVALID: 'promoInvalid',
  BELOW_MINIMUM_ORDER: 'belowMinimum',
  TOTAL_CHANGED: 'totalChanged',
};

export function problemMessage(code: CheckoutProblemCode): CheckoutMessageKey {
  return byCode[code] ?? 'generic';
}

export function deliveryProblem(reason: DeliveryUnavailableReason | null | undefined): CheckoutMessageKey | null {
  if (!reason) return null;
  if (reason === 'OUT_OF_RANGE') return 'outOfRange';
  if (reason === 'CONFIG_MISSING') return 'configMissing';
  if (reason === 'INVALID_COORDINATES') return 'addressInvalid';
  return 'noDelivery';
}

/** How much more the items must come to for delivery, or null when the store's minimum is met. */
export function deliveryShortfall(minimum: string | null | undefined, subtotal: string) {
  const gap = Math.round(Number(minimum ?? 0) * 1000) - Math.round(Number(subtotal) * 1000);
  return gap > 0 ? (gap / 1000).toFixed(3) : null;
}

/** Amounts some messages mention, such as the delivery minimum. Safe to pass with any message. */
export function messageValues(source: unknown, locale: 'en' | 'ar') {
  const body = (source instanceof ApiError ? source.body : source) as { minimum?: unknown; shortBy?: unknown } | undefined;
  const amount = (value: unknown) => formatMoney(typeof value === 'string' ? value : '0', locale);
  return { minimum: amount(body?.minimum), shortBy: amount(body?.shortBy) };
}

/** The code the API attached to a failed request, if any. */
export function errorCode(error: unknown): CheckoutProblemCode | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body as { code?: unknown } | undefined;
  if (typeof body?.code === 'string' && body.code in byCode) return body.code as CheckoutProblemCode;
  if (error.status === 401) return 'AUTH_REQUIRED';
  return null;
}

export function errorMessage(error: unknown): CheckoutMessageKey {
  const code = errorCode(error);
  if (code) return problemMessage(code);
  if (!(error instanceof ApiError)) return 'network';
  return 'generic';
}
