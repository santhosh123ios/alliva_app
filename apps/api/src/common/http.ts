import type { NextFunction, Request, Response } from 'express';
import { ZodType } from 'zod';
import type { PrismaService } from '../prisma/prisma.service';
import { badRequest, forbidden, HttpError, unauthorized } from './errors';
import type { JwtService } from './jwt';

export type RequestUser = {
  id: string;
  kind: 'STAFF' | 'MERCHANT_USER' | 'CUSTOMER';
  merchantId: string | null;
  permissions: string[];
  roles: string[];
  sessionId: string;
  customerId: string | null;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  locale: 'en' | 'ar';
  status: string;
  twoFactorEnabled: boolean;
};

export type ApiRequest = Request & { user?: RequestUser };

const authCache = new Map<string, { at: number; user: RequestUser }>();
const AUTH_CACHE_MS = 20_000;

export function forgetAuthSession(sessionId: string) {
  authCache.delete(sessionId);
}

export function forgetAuthUser(userId: string) {
  for (const [sessionId, entry] of authCache) {
    if (entry.user.id === userId) authCache.delete(sessionId);
  }
}

function readToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return request.cookies?.alliva_access as string | undefined;
}

export function authenticate(deps: { jwt: JwtService; prisma: PrismaService }, isPublic: boolean) {
  return async (request: ApiRequest, _response: Response, next: NextFunction) => {
    const token = readToken(request);
    if (!token) {
      if (isPublic) return next();
      return next(unauthorized('Sign in required'));
    }
    try {
      const payload = await deps.jwt.verifyAsync<{ sub: string; sid: string }>(token);
      const cached = authCache.get(payload.sid);
      if (cached && cached.user.id === payload.sub && Date.now() - cached.at < AUTH_CACHE_MS) {
        request.user = cached.user;
        return next();
      }
      const [session, user] = await Promise.all([
        deps.prisma.session.findUnique({ where: { id: payload.sid }, select: { revokedAt: true, expiresAt: true, userId: true } }),
        loadActor(deps.prisma, payload.sub, payload.sid),
      ]);
      if (!session || session.revokedAt || session.expiresAt < new Date() || session.userId !== payload.sub) {
        throw unauthorized('Session expired');
      }
      authCache.set(payload.sid, { at: Date.now(), user });
      request.user = user;
      return next();
    } catch (error) {
      if (isPublic) return next();
      if (error instanceof HttpError && error.status === 401) return next(error);
      return next(unauthorized('Sign in required'));
    }
  };
}

export function requirePermissions(required: string[]) {
  return (request: ApiRequest, _response: Response, next: NextFunction) => {
    if (!required.length) return next();
    const user = request.user;
    if (!user) return next(unauthorized('Sign in required'));
    if (user.roles.includes('SUPER_ADMIN')) return next();
    const missing = required.filter((permission) => !user.permissions.includes(permission));
    if (missing.length) return next(forbidden('Missing permission'));
    return next();
  };
}

const csrfExempt = [
  '/auth/login',
  '/auth/customer',
  '/auth/2fa',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/otp',
  '/auth/refresh',
  '/guests',
  '/public/merchant-registration',
  '/public/subscription-quote',
  '/payments/webhooks',
];

export function csrf(request: Request, _response: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return next();
  const path = `${request.baseUrl}${request.path}`;
  if (csrfExempt.some((exempt) => path.includes(exempt))) return next();
  const cookie = request.cookies?.alliva_csrf;
  const header = request.header('x-csrf-token');
  if (!cookie || cookie !== header) return next(forbidden('CSRF token missing'));
  return next();
}

export async function loadActor(prisma: PrismaService, userId: string, sessionId: string): Promise<RequestUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      customer: true,
      userRoles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  });
  if (!user || user.deletedAt || user.status !== 'ACTIVE') {
    throw unauthorized('Account is not active');
  }
  const roles = user.userRoles.map((entry) => entry.role.key);
  const permissions = [
    ...new Set(
      user.userRoles.flatMap((entry) => entry.role.permissions.map((item) => item.permission.key)),
    ),
  ];
  return {
    id: user.id,
    kind: user.kind,
    merchantId: user.merchantId,
    permissions,
    roles,
    sessionId,
    customerId: user.customer?.id ?? null,
    email: user.email,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    locale: user.locale === 'ar' ? 'ar' : 'en',
    status: user.status,
    twoFactorEnabled: user.twoFactorEnabled,
  };
}

export function validate<T>(schema: ZodType, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw badRequest(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return parsed.data as T;
}

export const cookieBase = () => ({
  sameSite: 'lax' as const,
  secure: process.env.COOKIE_SECURE === 'true',
  path: '/',
});

export function setAuthCookies(
  response: Response,
  input: { access: string; refresh: string; csrf: string; remember: boolean },
) {
  const days = input.remember
    ? Number(process.env.REFRESH_TTL_REMEMBER_DAYS ?? 30)
    : Number(process.env.REFRESH_TTL_DAYS ?? 7);
  response.cookie('alliva_access', input.access, { ...cookieBase(), httpOnly: true, maxAge: 15 * 60 * 1000 });
  response.cookie('alliva_refresh', input.refresh, {
    ...cookieBase(),
    httpOnly: true,
    maxAge: days * 86400000,
  });
  response.cookie('alliva_csrf', input.csrf, { ...cookieBase(), httpOnly: false, maxAge: days * 86400000 });
}

export function clearAuthCookies(response: Response) {
  response.clearCookie('alliva_access', cookieBase());
  response.clearCookie('alliva_refresh', cookieBase());
}

export function scopedMerchantId(user: RequestUser, requested?: string | null): string | undefined {
  if (user.merchantId) {
    if (requested && requested !== user.merchantId) {
      throw forbidden('Cross-merchant access is not allowed');
    }
    return user.merchantId;
  }
  return requested ?? undefined;
}
