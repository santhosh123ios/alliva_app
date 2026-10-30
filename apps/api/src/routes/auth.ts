import * as argon2 from 'argon2';
import type { Request, Response } from 'express';
import {
  customerRegisterSchema,
  firebasePhoneSchema,
  forgotPasswordSchema,
  loginSchema,
  otpRequestSchema,
  otpVerifySchema,
  resetPasswordSchema,
  twoFactorSchema,
  updateProfileSchema,
} from '@alliva/validation';
import { badRequest, serviceUnavailable, unauthorized } from '../common/errors';
import {
  clearAuthCookies,
  forgetAuthSession,
  forgetAuthUser,
  loadActor,
  readAuthCookie,
  RequestUser,
  setAuthCookies,
  validate,
} from '../common/http';
import { createRoutes } from '../common/routes';
import type { Container } from '../container';
import { firebaseWebConfig, verifyFirebasePhoneToken } from '../providers/firebase-auth';
import { numericOtp } from '../providers/whatsapp.otp';
import { customerResetUrl, marketingInviteUrl } from '../providers/welcome-email';

export function authRoutes({ prisma, jwt, crypto, audit, sms, email, commerce }: Container) {
  const routes = createRoutes({ jwt, prisma }, 'Authentication', '/auth');

  routes.post('/login', { public: true, throttle: 10 }, async (request, response) => {
    const body = validate<{ email: string; password: string; rememberDevice?: boolean }>(loginSchema, request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user?.passwordHash || user.deletedAt || user.status !== 'ACTIVE') {
      throw unauthorized('Email or password is incorrect');
    }
    const valid = await argon2.verify(user.passwordHash, body.password);
    if (!valid) throw unauthorized('Email or password is incorrect');
    if (user.twoFactorEnabled) {
      const challenge = await prisma.otpChallenge.create({
        data: {
          userId: user.id,
          purpose: 'TWO_FACTOR',
          codeHash: crypto.hash(process.env.TWO_FACTOR_DEV_CODE ?? '000000'),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });
      return { requiresTwoFactor: true, challengeId: challenge.id };
    }
    const issued = await issueSession(user.id, Boolean(body.rememberDevice), request, response);
    await audit.log({
      actorId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      ipAddress: request.ip,
    });
    return { user: present(issued.actor), csrfToken: issued.csrf };
  });

  routes.post('/2fa/verify', { public: true, throttle: 10 }, async (request, response) => {
    const body = validate<{ challengeId: string; code: string }>(twoFactorSchema, request.body);
    const challenge = await prisma.otpChallenge.findUnique({ where: { id: body.challengeId } });
    if (!challenge || challenge.purpose !== 'TWO_FACTOR' || challenge.consumedAt || challenge.expiresAt < new Date()) {
      throw new Error('Authentication code is not valid');
    }
    if (challenge.codeHash !== crypto.hash(body.code) || challenge.attempts > 5) {
      await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      throw new Error('Authentication code is not valid');
    }
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    const issued = await issueSession(challenge.userId!, false, request, response);
    return { user: present(issued.actor), csrfToken: issued.csrf };
  });

  routes.post('/logout', async (request, response) => {
    const user = request.user!;
    await prisma.session.update({ where: { id: user.sessionId }, data: { revokedAt: new Date() } });
    forgetAuthSession(user.sessionId);
    clearAuthCookies(response, request);
    await audit.log({ actorId: user.id, action: 'auth.logout', entityType: 'User', entityId: user.id });
    return { ok: true };
  });

  routes.post('/refresh', { public: true }, async (request, response) => {
    const raw = readAuthCookie(request, 'alliva_refresh');
    if (!raw) throw unauthorized('Session expired');
    const session = await prisma.session.findUnique({ where: { refreshTokenHash: crypto.hash(raw) } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) throw unauthorized('Session expired');
    const issued = await issueSession(session.userId, session.rememberDevice, request, response, session.id);
    return { user: present(issued.actor), csrfToken: issued.csrf };
  });

  routes.post('/forgot-password', { public: true, throttle: 5 }, async (request) => {
    const body = validate<{ email: string }>(forgotPasswordSchema, request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user) return { ok: true };
    const token = crypto.random();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: crypto.hash(token),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    const resetUrl = user.kind === 'CUSTOMER'
      ? customerResetUrl(token, user.locale === 'ar' ? 'ar' : 'en')
      : marketingInviteUrl(token);
    await email.send(
      user.email!,
      'Reset your Alliva password',
      `Set a new password with this link. It expires in 30 minutes:\n${resetUrl}`,
      `<p>Set a new password with the link below. It expires in 30 minutes.</p><p><a href="${resetUrl}">Reset your password</a></p>`,
    );
    return process.env.NODE_ENV === 'production' ? { ok: true } : { ok: true, devResetToken: token };
  });

  routes.post('/reset-password', { public: true }, async (request) => {
    const body = validate<{ token: string; password: string }>(resetPasswordSchema, request.body);
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: crypto.hash(body.token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new Error('Reset link is not valid');
    await prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash: await argon2.hash(body.password) },
    });
    await prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await prisma.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    forgetAuthUser(row.userId);
    await audit.log({ actorId: row.userId, action: 'auth.password_reset', entityType: 'User', entityId: row.userId });
    return { ok: true };
  });

  routes.get('/me', (request) => present(request.user!));

  routes.patch('/me', async (request) => {
    const user = request.user!;
    const body = validate<{ firstName?: string; lastName?: string; locale?: 'en' | 'ar'; email?: string }>(updateProfileSchema, request.body);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: body.firstName,
        lastName: body.lastName,
        locale: body.locale,
        email: body.email?.toLowerCase(),
        updatedById: user.id,
      },
    });
    return present(await loadActor(prisma, user.id, user.sessionId));
  });

  routes.get('/sessions', async (request) => {
    const user = request.user!;
    const rows = await prisma.session.findMany({
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
  });

  routes.delete('/sessions/:id', async (request) => {
    const id = request.params.id as string;
    await prisma.session.updateMany({
      where: { id, userId: request.user!.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    forgetAuthSession(id);
    return { ok: true };
  });

  routes.post('/otp/request', { public: true, throttle: 5 }, async (request) => {
    const body = validate<{ phone: string; locale?: 'en' | 'ar' }>(otpRequestSchema, request.body);
    const code = sms.channel === 'whatsapp' ? numericOtp() : (process.env.SMS_DEV_CODE ?? numericOtp());
    await sms.sendOtp(body.phone, code, body.locale);
    await prisma.otpChallenge.create({
      data: {
        phone: body.phone,
        purpose: 'CUSTOMER_LOGIN',
        codeHash: crypto.hash(code),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    return { ok: true as const, channel: sms.channel };
  });

  routes.post('/otp/verify', { public: true, throttle: 10 }, async (request, response) => {
    const body = validate<{ phone: string; code: string; firstName?: string; lastName?: string }>(otpVerifySchema, request.body);
    const challenge = await prisma.otpChallenge.findFirst({
      where: { phone: body.phone, purpose: 'CUSTOMER_LOGIN', consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge || challenge.expiresAt < new Date() || challenge.codeHash !== crypto.hash(body.code)) {
      throw new Error('The code is not valid');
    }
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    return completeCustomerLogin(body.phone, body, request, response);
  });

  routes.get('/firebase', { public: true }, () => firebaseWebConfig());

  routes.post('/customer/register', { public: true, throttle: 5 }, async (request, response) => {
    const body = validate<{
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      rememberDevice?: boolean;
    }>(customerRegisterSchema, request.body);
    const email = body.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw badRequest('An account with this email already exists');
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(body.password),
        kind: 'CUSTOMER',
        status: 'ACTIVE',
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        customer: { create: {} },
      },
    });
    const guestToken = request.cookies?.alliva_guest as string | undefined;
    if (guestToken) await mergeGuest(guestToken, user.id);
    const issued = await issueSession(user.id, Boolean(body.rememberDevice), request, response);
    await audit.log({
      actorId: user.id,
      action: 'auth.customer_register',
      entityType: 'User',
      entityId: user.id,
      ipAddress: request.ip,
    });
    return { user: present(issued.actor), csrfToken: issued.csrf };
  });

  routes.post('/firebase', { public: true, throttle: 10 }, async (request, response) => {
    const body = validate<{ idToken: string; firstName?: string; lastName?: string }>(firebasePhoneSchema, request.body);
    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (!projectId) throw serviceUnavailable('Firebase is not configured');
    let identity: { phone: string };
    try {
      identity = await verifyFirebasePhoneToken(body.idToken, projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The code is not valid';
      throw unauthorized(message);
    }
    return completeCustomerLogin(identity.phone, body, request, response);
  });

  routes.get('/socket-token', async (request) => {
    const user = request.user!;
    const token = await jwt.signAsync({ sub: user.id, sid: user.sessionId }, { expiresIn: '5m' });
    return { token };
  });

  async function completeCustomerLogin(
    phone: string,
    profile: { firstName?: string; lastName?: string },
    request: Request,
    response: Response,
  ) {
    let user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          phone,
          kind: 'CUSTOMER',
          status: 'ACTIVE',
          firstName: profile.firstName ?? 'Alliva',
          lastName: profile.lastName ?? 'Customer',
          customer: { create: {} },
        },
      });
    }
    if (user.status !== 'ACTIVE') throw new Error('Account is not active');
    const guestToken = request.cookies?.alliva_guest as string | undefined;
    if (guestToken) await mergeGuest(guestToken, user.id);
    const issued = await issueSession(user.id, true, request, response);
    return { user: present(issued.actor), csrfToken: issued.csrf };
  }

  async function mergeGuest(token: string, userId: string) {
    const guest = await prisma.guest.findUnique({ where: { tokenHash: crypto.hash(token) } });
    if (!guest || guest.mergedIntoCustomerId) return;
    const customer = await prisma.customer.findUnique({ where: { userId } });
    if (!customer) return;
    await commerce.mergeGuestCart(guest.id, customer.id);
  }

  async function issueSession(userId: string, remember: boolean, request: Request, response: Response, previousId?: string) {
    const refresh = crypto.random();
    const csrf = crypto.random(24);
    const days = remember ? Number(process.env.REFRESH_TTL_REMEMBER_DAYS ?? 30) : Number(process.env.REFRESH_TTL_DAYS ?? 7);
    const session = await prisma.session.create({
      data: {
        userId,
        refreshTokenHash: crypto.hash(refresh),
        rememberDevice: remember,
        userAgent: request.headers['user-agent'],
        ipAddress: request.ip,
        expiresAt: new Date(Date.now() + days * 86400000),
      },
    });
    if (previousId) {
      await prisma.session.update({ where: { id: previousId }, data: { revokedAt: new Date(), replacedById: session.id } });
      forgetAuthSession(previousId);
    }
    const access = await jwt.signAsync({ sub: userId, sid: session.id });
    setAuthCookies(response, { access, refresh, csrf, remember }, request);
    return { actor: await loadActor(prisma, userId, session.id), csrf };
  }

  function present(user: RequestUser) {
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

  return routes;
}
