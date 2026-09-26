import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import type { Request, Response } from 'express';
import {
  forgotPasswordSchema,
  loginSchema,
  otpRequestSchema,
  otpVerifySchema,
  resetPasswordSchema,
  twoFactorSchema,
  updateProfileSchema,
} from '@alliva/validation';
import { AuditService } from '../common/audit';
import { CryptoService } from '../common/crypto';
import {
  clearAuthCookies,
  CurrentUser,
  forgetAuthSession,
  forgetAuthUser,
  loadActor,
  Public,
  RequestUser,
  setAuthCookies,
  ZodValidationPipe,
} from '../common/http';
import { PrismaService } from '../prisma/prisma.service';
import { MockEmailProvider, MockSmsProvider } from '../providers/mock.providers';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MockSmsProvider) private readonly sms: MockSmsProvider,
    @Inject(MockEmailProvider) private readonly email: MockEmailProvider,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: { email: string; password: string; rememberDevice?: boolean },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = await this.prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user?.passwordHash || user.deletedAt || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Email or password is incorrect');
    }
    const valid = await argon2.verify(user.passwordHash, body.password);
    if (!valid) throw new UnauthorizedException('Email or password is incorrect');
    if (user.twoFactorEnabled) {
      const challenge = await this.prisma.otpChallenge.create({
        data: {
          userId: user.id,
          purpose: 'TWO_FACTOR',
          codeHash: this.crypto.hash(process.env.TWO_FACTOR_DEV_CODE ?? '000000'),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });
      return { requiresTwoFactor: true, challengeId: challenge.id };
    }
    const issued = await this.issueSession(user.id, Boolean(body.rememberDevice), request, response);
    await this.audit.log({
      actorId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      ipAddress: request.ip,
    });
    return { user: this.present(issued.actor), csrfToken: issued.csrf };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('2fa/verify')
  async verifyTwoFactor(
    @Body(new ZodValidationPipe(twoFactorSchema)) body: { challengeId: string; code: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const challenge = await this.prisma.otpChallenge.findUnique({ where: { id: body.challengeId } });
    if (!challenge || challenge.purpose !== 'TWO_FACTOR' || challenge.consumedAt || challenge.expiresAt < new Date()) {
      throw new Error('Authentication code is not valid');
    }
    if (challenge.codeHash !== this.crypto.hash(body.code) || challenge.attempts > 5) {
      await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      throw new Error('Authentication code is not valid');
    }
    await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    const issued = await this.issueSession(challenge.userId!, false, request, response);
    return { user: this.present(issued.actor), csrfToken: issued.csrf };
  }

  @Post('logout')
  async logout(@CurrentUser() user: RequestUser, @Res({ passthrough: true }) response: Response) {
    await this.prisma.session.update({ where: { id: user.sessionId }, data: { revokedAt: new Date() } });
    forgetAuthSession(user.sessionId);
    clearAuthCookies(response);
    await this.audit.log({ actorId: user.id, action: 'auth.logout', entityType: 'User', entityId: user.id });
    return { ok: true };
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const raw = request.cookies?.alliva_refresh as string | undefined;
    if (!raw) throw new UnauthorizedException('Session expired');
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: this.crypto.hash(raw) } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) throw new UnauthorizedException('Session expired');
    const issued = await this.issueSession(session.userId, session.rememberDevice, request, response, session.id);
    return { user: this.present(issued.actor), csrfToken: issued.csrf };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  async forgot(@Body(new ZodValidationPipe(forgotPasswordSchema)) body: { email: string }) {
    const user = await this.prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user) return { ok: true };
    const token = this.crypto.random();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.crypto.hash(token),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    await this.email.send(user.email!, 'Reset your Alliva password', `Reset token: ${token}`);
    return process.env.NODE_ENV === 'production' ? { ok: true } : { ok: true, devResetToken: token };
  }

  @Public()
  @Post('reset-password')
  async reset(@Body(new ZodValidationPipe(resetPasswordSchema)) body: { token: string; password: string }) {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: this.crypto.hash(body.token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new Error('Reset link is not valid');
    await this.prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash: await argon2.hash(body.password) },
    });
    await this.prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await this.prisma.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    forgetAuthUser(row.userId);
    await this.audit.log({ actorId: row.userId, action: 'auth.password_reset', entityType: 'User', entityId: row.userId });
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return this.present(user);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateProfileSchema))
    body: { firstName?: string; lastName?: string; locale?: 'en' | 'ar'; email?: string },
  ) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: body.firstName,
        lastName: body.lastName,
        locale: body.locale,
        email: body.email?.toLowerCase(),
        updatedById: user.id,
      },
    });
    return this.present(await loadActor(this.prisma, user.id, user.sessionId));
  }

  @Get('sessions')
  async sessions(@CurrentUser() user: RequestUser) {
    const rows = await this.prisma.session.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      userAgent: row.userAgent,
      ipAddress: row.ipAddress,
      rememberDevice: row.rememberDevice,
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      current: row.id === user.sessionId,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  @Delete('sessions/:id')
  async revoke(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.prisma.session.updateMany({
      where: { id, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    forgetAuthSession(id);
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('otp/request')
  async requestOtp(@Body(new ZodValidationPipe(otpRequestSchema)) body: { phone: string }) {
    const code = process.env.SMS_DEV_CODE ?? this.crypto.random(3);
    await this.sms.sendOtp(body.phone, code);
    await this.prisma.otpChallenge.create({
      data: {
        phone: body.phone,
        purpose: 'CUSTOMER_LOGIN',
        codeHash: this.crypto.hash(code),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('otp/verify')
  async verifyOtp(
    @Body(new ZodValidationPipe(otpVerifySchema))
    body: { phone: string; code: string; firstName?: string; lastName?: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { phone: body.phone, purpose: 'CUSTOMER_LOGIN', consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge || challenge.expiresAt < new Date() || challenge.codeHash !== this.crypto.hash(body.code)) {
      throw new Error('The code is not valid');
    }
    await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    let user = await this.prisma.user.findUnique({ where: { phone: body.phone } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone: body.phone,
          kind: 'CUSTOMER',
          status: 'ACTIVE',
          firstName: body.firstName ?? 'Alliva',
          lastName: body.lastName ?? 'Customer',
          customer: { create: {} },
        },
      });
    }
    if (user.status !== 'ACTIVE') throw new Error('Account is not active');
    const guestToken = request.cookies?.alliva_guest as string | undefined;
    if (guestToken) await this.mergeGuest(guestToken, user.id);
    const issued = await this.issueSession(user.id, true, request, response);
    return { user: this.present(issued.actor), csrfToken: issued.csrf };
  }

  @Get('socket-token')
  async socketToken(@CurrentUser() user: RequestUser) {
    const token = await this.jwt.signAsync({ sub: user.id, sid: user.sessionId }, { expiresIn: '5m' });
    return { token };
  }

  private async mergeGuest(token: string, userId: string) {
    const guest = await this.prisma.guest.findUnique({ where: { tokenHash: this.crypto.hash(token) } });
    if (!guest || guest.mergedIntoCustomerId) return;
    const customer = await this.prisma.customer.findUnique({ where: { userId } });
    if (!customer) return;
    const guestCart = await this.prisma.cart.findUnique({ where: { guestId: guest.id }, include: { items: { include: { addons: true } } } });
    if (guestCart) {
      const existing = await this.prisma.cart.findUnique({ where: { customerId: customer.id } });
      if (!existing) {
        await this.prisma.cart.update({ where: { id: guestCart.id }, data: { guestId: null, customerId: customer.id } });
      } else if (guestCart.items.length && existing.merchantId === guestCart.merchantId) {
        for (const item of guestCart.items) {
          const created = await this.prisma.cartItem.create({
            data: { cartId: existing.id, productId: item.productId, variantId: item.variantId, quantity: item.quantity, notes: item.notes },
          });
          if (item.addons.length) {
            await this.prisma.cartItemAddon.createMany({
              data: item.addons.map((addon) => ({ cartItemId: created.id, addonId: addon.addonId })),
            });
          }
        }
        await this.prisma.cart.delete({ where: { id: guestCart.id } });
      }
    }
    await this.prisma.recentlyViewed.updateMany({ where: { guestId: guest.id }, data: { customerId: customer.id, guestId: null } });
    await this.prisma.guest.update({ where: { id: guest.id }, data: { mergedIntoCustomerId: customer.id } });
  }

  private async issueSession(userId: string, remember: boolean, request: Request, response: Response, previousId?: string) {
    const refresh = this.crypto.random();
    const csrf = this.crypto.random(24);
    const days = remember ? Number(process.env.REFRESH_TTL_REMEMBER_DAYS ?? 30) : Number(process.env.REFRESH_TTL_DAYS ?? 7);
    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: this.crypto.hash(refresh),
        rememberDevice: remember,
        userAgent: request.headers['user-agent'],
        ipAddress: request.ip,
        expiresAt: new Date(Date.now() + days * 86400000),
      },
    });
    if (previousId) {
      await this.prisma.session.update({ where: { id: previousId }, data: { revokedAt: new Date(), replacedById: session.id } });
      forgetAuthSession(previousId);
    }
    const access = await this.jwt.signAsync({ sub: userId, sid: session.id });
    setAuthCookies(response, { access, refresh, csrf, remember });
    return { actor: await loadActor(this.prisma, userId, session.id), csrf };
  }

  private present(user: RequestUser) {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      kind: user.kind,
      status: user.status,
      merchantId: user.merchantId,
      locale: user.locale,
      permissions: user.permissions,
      roles: user.roles,
      twoFactorEnabled: user.twoFactorEnabled,
      csrfToken: undefined,
    };
  }
}
