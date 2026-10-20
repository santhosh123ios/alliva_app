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
