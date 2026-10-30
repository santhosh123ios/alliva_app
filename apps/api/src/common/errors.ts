const reasons: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  429: 'Too Many Requests',
  503: 'Service Unavailable',
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(typeof body.message === 'string' ? body.message : (reasons[status] ?? 'Error'));
  }
}

function standard(status: number, message: unknown) {
  return new HttpError(status, { message, error: reasons[status], statusCode: status });
}

export const badRequest = (message: unknown) => standard(400, message);
export const unauthorized = (message: string) => standard(401, message);
export const forbidden = (message: string) => standard(403, message);
export const notFound = (message: string) => standard(404, message);
export const serviceUnavailable = (message: string) => standard(503, message);
export const tooManyRequests = () => new HttpError(429, { message: 'ThrottlerException: Too Many Requests' });

/** Checkout failures the customer app turns into its own wording, keyed by `code`. */
export type CheckoutErrorCode =
  | 'AUTH_REQUIRED'
  | 'CART_EMPTY'
  | 'CART_CHANGED'
  | 'STORE_UNAVAILABLE'
  | 'MERCHANT_CLOSED'
  | 'PRODUCT_UNAVAILABLE'
  | 'ADDRESS_REQUIRED'
  | 'ADDRESS_INVALID'
  | 'ADDRESS_OUT_OF_RANGE'
  | 'DELIVERY_DISABLED'
  | 'DELIVERY_CONFIG_MISSING'
  | 'DELIVERY_QUOTE_FAILED'
  | 'FULFILLMENT_UNAVAILABLE'
  | 'PAYMENT_METHOD_UNAVAILABLE'
  | 'PROMO_INVALID'
  | 'TOTAL_CHANGED';

export function checkoutError(code: CheckoutErrorCode, message: string, extra: Record<string, unknown> = {}) {
  const status = code === 'CART_CHANGED' || code === 'TOTAL_CHANGED' ? 409 : code === 'AUTH_REQUIRED' ? 401 : 400;
  return new HttpError(status, { message, code, error: reasons[status] ?? 'Conflict', statusCode: status, ...extra });
}
