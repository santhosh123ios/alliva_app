import { Router, type RequestHandler, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { PrismaService } from '../prisma/prisma.service';
import { tooManyRequests } from './errors';
import { authenticate, csrf, requirePermissions, type ApiRequest } from './http';
import type { JwtService } from './jwt';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type RouteOptions = {
  public?: boolean;
  permissions?: string[];
  throttle?: number;
  before?: RequestHandler[];
};

export type RouteHandler = (request: ApiRequest, response: Response) => unknown;

export type RouteInfo = {
  method: Method;
  path: string;
  tag: string;
  public: boolean;
  permissions: string[];
};

const DEFAULT_LIMIT = 300;

function throttle(limit: number) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: false,
    legacyHeaders: true,
    handler: (_request, _response, next) => next(tooManyRequests()),
  });
}

function send(method: Method, response: Response, result: unknown) {
  if (response.headersSent) return;
  response.status(method === 'post' ? 201 : 200);
  if (result === undefined || result === null) response.send();
  else if (typeof result === 'object') response.json(result);
  else response.send(String(result));
}

export function createRoutes(deps: { jwt: JwtService; prisma: PrismaService }, tag: string, prefix = '') {
  const router = Router();
  const routes: RouteInfo[] = [];

  function add(method: Method, path: string, optionsOrHandler: RouteOptions | RouteHandler, maybeHandler?: RouteHandler) {
    const options = typeof optionsOrHandler === 'function' ? {} : optionsOrHandler;
    const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler!;
    const fullPath = `${prefix}${path}`;
    routes.push({ method, path: fullPath, tag, public: Boolean(options.public), permissions: options.permissions ?? [] });
    router[method](
      fullPath,
      throttle(options.throttle ?? DEFAULT_LIMIT),
      authenticate(deps, Boolean(options.public)),
      requirePermissions(options.permissions ?? []),
      csrf,
      ...(options.before ?? []),
      async (request, response) => {
        send(method, response, await handler(request as ApiRequest, response));
      },
    );
  }

  const verb = (method: Method) =>
    (path: string, optionsOrHandler: RouteOptions | RouteHandler, maybeHandler?: RouteHandler) =>
      add(method, path, optionsOrHandler, maybeHandler);

  return {
    router,
    routes,
    get: verb('get'),
    post: verb('post'),
    put: verb('put'),
    patch: verb('patch'),
    delete: verb('delete'),
  };
}
