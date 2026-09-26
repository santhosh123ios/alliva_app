import {
  BadRequestException,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { ZodType } from 'zod';
import { PrismaService } from '../prisma/prisma.service';

export const IS_PUBLIC = 'isPublic';
export const PERMISSIONS = 'permissions';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS, permissions);

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

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<Request & { user?: RequestUser }>().user;
});

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

type AuthedRequest = Request & { user?: RequestUser; guestId?: string };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = this.readToken(request);
    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Sign in required');
    }
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; sid: string }>(token);
      const cached = authCache.get(payload.sid);
      if (cached && cached.user.id === payload.sub && Date.now() - cached.at < AUTH_CACHE_MS) {
        request.user = cached.user;
        return true;
      }
      const [session, user] = await Promise.all([
        this.prisma.session.findUnique({ where: { id: payload.sid }, select: { revokedAt: true, expiresAt: true, userId: true } }),
        loadActor(this.prisma, payload.sub, payload.sid),
      ]);
      if (!session || session.revokedAt || session.expiresAt < new Date() || session.userId !== payload.sub) {
        throw new UnauthorizedException('Session expired');
      }
      authCache.set(payload.sid, { at: Date.now(), user });
      request.user = user;
      return true;
    } catch (error) {
      if (isPublic) return true;
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Sign in required');
    }
  }

  private readToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return request.cookies?.alliva_access as string | undefined;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) throw new UnauthorizedException('Sign in required');
    if (user.roles.includes('SUPER_ADMIN')) return true;
    const missing = required.filter((permission) => !user.permissions.includes(permission));
    if (missing.length) throw new ForbiddenException('Missing permission');
    return true;
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return true;
    const path = request.path || request.url;
    if (
      path.includes('/auth/login') ||
      path.includes('/auth/2fa') ||
      path.includes('/auth/forgot-password') ||
      path.includes('/auth/reset-password') ||
      path.includes('/auth/otp') ||
      path.includes('/auth/refresh') ||
      path.includes('/guests') ||
      path.includes('/public/merchant-registration') ||
      path.includes('/payments/webhooks')
    ) {
      return true;
    }
    const cookie = request.cookies?.alliva_csrf;
    const header = request.header('x-csrf-token');
    if (!cookie || cookie !== header) throw new ForbiddenException('CSRF token missing');
    return true;
  }
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
    throw new UnauthorizedException('Account is not active');
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

export class ZodValidationPipe {
  constructor(private readonly schema: ZodType) {}
  transform(value: unknown) {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }
    return parsed.data;
  }
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
      throw new ForbiddenException('Cross-merchant access is not allowed');
    }
    return user.merchantId;
  }
  return requested ?? undefined;
}
