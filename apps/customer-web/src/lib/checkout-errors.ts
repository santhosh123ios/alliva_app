import { ApiError, type ApiClient } from '@alliva/api-client';

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
