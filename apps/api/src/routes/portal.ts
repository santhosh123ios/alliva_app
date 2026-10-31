import * as argon2 from 'argon2';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import {
  assignSubscriptionSchema,
  merchantAutoRenewSchema,
  merchantRenewalSchema,
  bankSchema,
  branchSchema,
  categorySchema,
  closureSchema,
  complaintSchema,
  complaintUpdateSchema,
  dispatchSchema,
  deliveryPreviewSchema,
  deliverySettingSchema,
  deliverySettingUpdateSchema,
  type DeliveryPreviewInput,
  type DeliverySettingInput,
  type DeliverySettingUpdateInput,
  emailAvailabilitySchema,
  floorSchema,
  hoursSchema,
  incidentSchema,
  merchantUpsertSchema,
  merchantRegistrationSchema,
  planSchema,
  reorderPlansSchema,
  offerSchema,
  productSchema,
  productUpdateSchema,
  merchantPromoActiveSchema,
  merchantPromoSchema,
  type MerchantPromoInput,
  refundDecisionSchema,
  reportQuerySchema,
  rolePermissionsSchema,
  paymentMethodsSettingSchema,
  type PaymentMethodCode,
  settingsSchema,
  subscriptionQuoteSchema,
  settlementDecisionSchema,
  shiftNoteSchema,
  staffSchema,
  tableSchema,
  tableStatusSchema,
  tableUpdateSchema,
} from '@alliva/validation';
import { dec, loc } from '../common/crypto';
import { badRequest, forbidden, HttpError, notFound } from '../common/errors';
import { businessSetupGaps, detailedDeliveryPricing } from '../domain/business-setup';
import { merchantOrderCharges, normalizeOrderCharges, platformPlanCharges, priceWithCharges } from '../domain/charges';
import { RequestUser, scopedMerchantId, validate } from '../common/http';
import { createRoutes } from '../common/routes';
import type { Container } from '../container';
import type { PlatformService } from '../modules/platform.service';
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from '../providers/interfaces';
import { paymentMethodsForRegistration, publicPaymentMethods } from '../modules/payment-methods';
import { importCatalogProducts } from '../modules/catalog-import';
import { deliverySettingData, presentDeliverySetting, previewDeliverySetting } from '../modules/delivery-settings';
import { categoryNameKey, mergeCatalogCategory, replaceMerchantCategory, resolveMerchantCategory } from '../modules/catalog-categories';
import { mergeCatalogProduct, resolveCatalogProduct } from '../modules/catalog-products';
import { customerRewardAvailable, customerWallet, merchantWallet, requestCustomerWithdrawal, requestMerchantWithdrawal } from '../modules/portal-wallet';
import { adminSignInUrl, merchantSignInUrl, roleLabel, sendWelcomeEmail } from '../providers/welcome-email';
import { extensionFor } from '../providers/mock.providers';
import { createStorageProvider } from '../providers/imagekit';

type OrderStatusChange = { status: 'ACCEPTED' | 'PREPARING' | 'READY_FOR_PICKUP' | 'ASSIGNED_TO_DRIVER' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED'; note?: string; preparationMinutes?: number; driverId?: string; cancellationReason?: string };

const upload = multer({ storage: multer.memoryStorage() }).single('file');

function singleFile(request: Request, response: Response, next: NextFunction) {
  upload(request, response, (error: unknown) => {
    if (error) return next(badRequest(error instanceof Error ? error.message : 'Upload failed'));
    next();
  });
}

export function portalRoutes({ prisma, jwt, crypto, audit, platform, commerce, marketing, email }: Container) {
  const routes = createRoutes({ jwt, prisma }, 'Platform');
  const param = (request: Request, name: string) => request.params[name] as string;

  routes.get('/admin/dashboard', { permissions: ['order.view'] }, () => platform.adminDashboard());

  routes.get('/merchant/dashboard', { permissions: ['order.view'] }, (request) => {
    const user = request.user!;
    if (!user.merchantId) throw badRequest('Merchant account required');
    const branchId = typeof request.query.branchId === 'string' ? request.query.branchId : undefined;
    return platform.merchantDashboard(user.merchantId, branchId);
  });

  routes.get('/merchant/wallet', async (request) => {
    const user = request.user!;
    if (!user.merchantId) throw badRequest('Merchant account required');
    const wallet = await merchantWallet(prisma, user.merchantId);
    return { ...wallet, canWithdraw: user.permissions.includes('payment.view') };
  });

  routes.post('/merchant/wallet/withdrawals', async (request) => {
    const user = request.user!;
    if (!user.merchantId) throw badRequest('Merchant account required');
    if (!user.permissions.includes('payment.view')) throw forbidden('You cannot request a withdrawal');
    const body = request.body as { amount?: unknown };
    const created = await requestMerchantWithdrawal(prisma, user.merchantId, user.id, body.amount);
    platform.forgetMerchantDashboard(user.merchantId);
    await audit.log({ actorId: user.id, action: 'merchant.withdrawal.request', entityType: 'Settlement', entityId: created.id, metadata: { amount: created.amount } });
    return created;
  });

  routes.get('/health', { public: true }, () => ({ ok: true, service: 'alliva-api', currency: 'BHD', timezone: 'Asia/Bahrain' }));

  routes.get('/public/plans', { public: true }, async () => {
    const plans = await platform.listPlans();
    return plans.filter((plan) => plan.status === 'ACTIVE');
  });

  routes.get('/public/payment-methods', { public: true }, () => publicPaymentMethods(prisma));

  routes.post('/public/merchant-email-availability', { public: true, throttle: 20 }, async (request) => {
    const { email } = validate<{ email: string }>(emailAvailabilitySchema, request.body);
    const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
    return { available: !existing };
  });

  routes.post('/public/merchant-registration', { public: true, throttle: 5 }, async (request) => {
    const body = validate<{
      businessName: string;
      businessNameAr?: string;
      website: string;
      businessType: string;
      categoryId?: string;
      city: string;
      phone: string;
      email: string;
      firstName: string;
      lastName: string;
      password: string;
      planId: string;
      billingInterval: 'MONTHLY' | 'ANNUAL';
      promoCode?: string;
      referralCode?: string;
      delivery: boolean;
      takeaway: boolean;
      paymentMethods?: PaymentMethodCode[];
    }>(merchantRegistrationSchema, request.body);
    const ownerEmail = body.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: ownerEmail } });
    if (existing) throw badRequest('An account with this email already exists');
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: body.planId } });
    if (!plan || plan.status !== 'ACTIVE') throw badRequest('Choose an available plan');
    // The referral code (who gets credit) and the promo code (who gets a discount) are separate inputs and are
    // validated independently. Neither is accepted unless the backend confirms it.
    const referral = body.referralCode?.trim() ? await marketing.referrals.resolve(body.referralCode) : null;
    const promo = body.promoCode?.trim() ? await marketing.promos.quote({ code: body.promoCode, planId: body.planId, interval: body.billingInterval }) : null;
    if (promo && !promo.valid) throw badRequest(promo.reason);
    const role = await prisma.role.findUnique({ where: { key: 'MERCHANT_OWNER' } });
    if (!role) throw badRequest('Merchant owner role is not configured');
    const slugBase = slugify(body.businessName) || 'merchant';
    let slug = slugBase;
    const taken = await prisma.merchant.findUnique({ where: { slug } });
    if (taken) slug = `${slugBase}-${Date.now().toString(36)}`;
    const passwordHash = await argon2.hash(body.password);
    const paymentMethods = await paymentMethodsForRegistration(prisma, body.paymentMethods);
    const created = await prisma
      .$transaction(async (tx) => {
        const owner = await tx.user.create({
          data: { email: ownerEmail, passwordHash, firstName: body.firstName, lastName: body.lastName, phone: body.phone, kind: 'MERCHANT_USER', status: 'ACTIVE' },
        });
        const merchant = await tx.merchant.create({
          data: {
            slug,
            name: { en: body.businessName, ar: body.businessNameAr?.trim() || body.businessName },
            description: { en: body.businessName, ar: body.businessNameAr?.trim() || body.businessName },
            businessType: body.businessType,
            phone: body.phone,
            email: ownerEmail,
            websiteUrl: body.website.trim(),
            registrationPromo: promo?.valid ? promo.code : null,
            acceptedPaymentMethods: paymentMethods,
            status: 'PENDING_APPROVAL',
            businessSetupCompleted: false,
            createdById: owner.id,
            categories: body.categoryId ? { create: { categoryId: body.categoryId } } : undefined,
            branches: { create: { name: { en: body.city, ar: body.city }, line1: body.city, city: body.city, latitude: '26.228500', longitude: '50.586000' } },
          },
        });
        await tx.user.update({ where: { id: owner.id }, data: { merchantId: merchant.id } });
        await tx.userRole.create({ data: { userId: owner.id, roleId: role.id, merchantId: merchant.id } });
        if (referral) await marketing.referrals.attribute(tx, { merchantId: merchant.id, resolved: referral, source: 'SIGNUP', actorId: owner.id, contact: { phone: body.phone, email: ownerEmail }, merchantName: body.businessName });
        if (promo?.valid) await marketing.promos.reserve(tx, { merchantId: merchant.id, promoCodeId: promo.promoCodeId });
        return { owner, merchant };
      })
      .catch((error: unknown) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw badRequest('An account with this email already exists');
        throw error;
      });
    await platform.assignSubscription(created.merchant.id, body.planId, body.billingInterval, created.owner.id, false);
    await audit.log({ actorId: created.owner.id, action: 'merchant.register', entityType: 'Merchant', entityId: created.merchant.id, metadata: { referralCode: referral?.code ?? null, promoCode: promo?.valid ? promo.code : null, paymentMethods } });
    await sendWelcomeEmail(email, {
      to: ownerEmail,
      firstName: body.firstName,
      role: 'Merchant Owner',
      signInUrl: merchantSignInUrl(),
      note: 'Your store is waiting for approval.',
    });
    return { id: created.merchant.id, slug };
  });

  routes.post('/public/subscription-quote', { public: true, throttle: 30 }, async (request) => {
    const body = validate<{ planId: string; billingInterval: 'MONTHLY' | 'ANNUAL'; promoCode?: string; referralCode?: string }>(subscriptionQuoteSchema, request.body);
    const { gross } = await marketing.promos.planPrice(body.planId, body.billingInterval);
    const promo = body.promoCode?.trim() ? await marketing.promos.quote({ code: body.promoCode, planId: body.planId, interval: body.billingInterval }) : null;
    const referral = body.referralCode?.trim() ? await marketing.referrals.validate(body.referralCode) : null;
    const discount = promo?.valid ? promo.discount : '0.000';
    const net = promo?.valid ? promo.payable : gross;
    const rows = await prisma.platformSetting.findMany({ where: { key: { in: ['serviceFee', 'taxCharge'] } } });
    const charges = platformPlanCharges(new Map(rows.map((row) => [row.key, row.value])));
    const priced = priceWithCharges(net, charges);
    return {
      gross,
      discount,
      serviceFee: priced.serviceFee,
      serviceFeeLabel: charges.serviceFee.label,
      tax: priced.tax,
      taxLabel: charges.tax.label,
      payable: priced.payable,
      promo: promo ? (promo.valid ? { valid: true, code: promo.code } : { valid: false, reason: promo.reason }) : null,
      referral: referral ? (referral.valid ? { valid: true, code: referral.code, staffName: referral.staffName } : { valid: false, reason: referral.reason }) : null,
    };
  });

  routes.get('/admin/merchants', { permissions: ['merchant.view'] }, async (request) => {
    const status = request.query.status as string | undefined;
    const rows = await prisma.merchant.findMany({
      where: { deletedAt: null, ...(status ? { status: status as never } : {}) },
      include: { branches: true, subscription: { include: { plan: true } }, categories: { include: { category: true } }, referral: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
    });
    // A subscription counts as paid once the payment for its current billing period has been verified.
    const periodKey = (subscription: { id: string; currentPeriodStart: Date }) => `sub:${subscription.id}:${subscription.currentPeriodStart.getTime()}`;
    const verifiedKeys = new Set(
      (
        await prisma.subscriptionPayment.findMany({
          where: { idempotencyKey: { in: rows.flatMap((merchant) => (merchant.subscription ? [periodKey(merchant.subscription)] : [])) } },
          select: { idempotencyKey: true },
        })
      ).map((payment) => payment.idempotencyKey),
    );
    return rows.map((merchant) => ({
      id: merchant.id,
      slug: merchant.slug,
      name: loc(merchant.name),
      status: merchant.status,
      phone: merchant.phone,
      email: merchant.email,
      websiteUrl: merchant.websiteUrl,
      city: merchant.branches[0]?.city ?? '',
      plan: merchant.subscription?.plan.code ?? null,
      planName: merchant.subscription ? loc(merchant.subscription.plan.name) : null,
      paymentVerified: merchant.subscription ? verifiedKeys.has(periodKey(merchant.subscription)) : null,
      referred: Boolean(merchant.referral),
      businessType: merchant.businessType,
      logoUrl: merchant.logoUrl,
      createdAt: merchant.createdAt.toISOString(),
      categories: merchant.categories.map((link) => loc(link.category.name)),
    }));
  });

  routes.post('/admin/merchants', { permissions: ['merchant.create'] }, async (request) => {
    const user = request.user!;
    const body = validate<Record<string, unknown>>(merchantUpsertSchema, request.body);
    const slug = String(body.slug ?? slugify((body.name as { en: string }).en));
    const merchant = await prisma.merchant.create({
      data: {
        slug,
        name: body.name as object,
        description: body.description as object,
        businessType: String(body.businessType),
        phone: String(body.phone),
        email: String(body.email),
        minimumOrder: String(body.minimumOrder),
        preparationMinutes: Number(body.preparationMinutes),
        taxNumber: body.taxNumber ? String(body.taxNumber) : null,
        deliveryEnabled: Boolean(body.delivery),
        takeawayEnabled: Boolean(body.takeaway),
        dineInEnabled: Boolean(body.dineIn),
        status: 'PENDING_APPROVAL',
        createdById: user.id,
        categories: { create: (body.categoryIds as string[]).map((categoryId) => ({ categoryId })) },
      },
    });
    if (body.planId) {
      await platform.assignSubscription(merchant.id, String(body.planId), (body.billingInterval as 'MONTHLY' | 'ANNUAL') ?? 'MONTHLY', user.id, false);
    }
    await audit.log({ actorId: user.id, action: 'merchant.create', entityType: 'Merchant', entityId: merchant.id });
    return merchant;
  });

  routes.post('/admin/merchants/:id/approve', { permissions: ['merchant.approve'] }, async (request) => {
    const user = request.user!;
    const id = param(request, 'id');
    const body = (request.body ?? {}) as { confirmPayment?: unknown };
    const confirmPayment = body.confirmPayment === true;
    if (!(await prisma.merchant.findFirst({ where: { id, deletedAt: null }, select: { id: true } }))) throw notFound('Merchant not found');
    // Approving can also record the subscription payment. That is what makes the referring staff's commission eligible.
    let payment: Awaited<ReturnType<typeof platform.verifySubscriptionPayment>> | null = null;
    if (confirmPayment) {
      if (!user.permissions.includes('subscription.manage')) throw forbidden('You need the subscription.manage permission to confirm a payment');
      const { currentPeriodVerified } = await platform.subscriptionPayments(id);
      if (!currentPeriodVerified) payment = await platform.verifySubscriptionPayment(id, user.id);
    }
    const merchant = await prisma.merchant.update({ where: { id }, data: { status: 'ACTIVE', updatedById: user.id } });
    await audit.log({ actorId: user.id, action: 'merchant.approve', entityType: 'Merchant', entityId: id, metadata: { paymentConfirmed: Boolean(payment) } });
    return { ...merchant, paymentConfirmed: Boolean(payment) };
  });

  routes.post('/admin/merchants/:id/suspend', { permissions: ['merchant.suspend'] }, async (request) => {
    const user = request.user!;
    const id = param(request, 'id');
    const merchant = await prisma.merchant.update({ where: { id }, data: { status: 'SUSPENDED', updatedById: user.id } });
    await audit.log({ actorId: user.id, action: 'merchant.suspend', entityType: 'Merchant', entityId: id });
    return merchant;
  });

  routes.get('/admin/merchants/:id', { permissions: ['merchant.view'] }, (request) => merchantDetail(param(request, 'id')));

  routes.get('/merchant/profile', async (request) => {
    const user = request.user!;
    if (!user.merchantId) throw badRequest('Merchant account required');
    const detail = await merchantDetail(user.merchantId);
    // Bank details are only for the people who manage the business.
    return user.permissions.includes('merchant.profile.manage') ? detail : { ...detail, bankAccounts: [] };
  });

  routes.patch('/merchant/profile', { permissions: ['merchant.profile.manage'] }, async (request) => {
    const user = request.user!;
    const body = request.body as Record<string, unknown>;
    const merchantId = scopedMerchantId(user, typeof body.merchantId === 'string' ? body.merchantId : undefined);
    if (!merchantId) throw badRequest('Merchant required');
    const deliveryKeys = ['delivery', 'freeDeliveryEnabled', 'freeDeliveryKm', 'baseDeliveryKm', 'baseDeliveryFee', 'beyondFreeDeliveryFee', 'beyondDeliveryFeeMode', 'maxDeliveryKm'];
    if (deliveryKeys.some((key) => Object.prototype.hasOwnProperty.call(body, key))) {
      const current = await prisma.merchant.findUniqueOrThrow({
        where: { id: merchantId },
        select: { deliveryEnabled: true, freeDeliveryEnabled: true, baseDeliveryKm: true, baseDeliveryFee: true, maxDeliveryKm: true },
      });
      const deliveryEnabled = typeof body.delivery === 'boolean' ? body.delivery : current.deliveryEnabled;
      const freeDeliveryEnabled = typeof body.freeDeliveryEnabled === 'boolean' ? body.freeDeliveryEnabled : current.freeDeliveryEnabled;
      const baseDeliveryKm = Number(body.baseDeliveryKm ?? current.baseDeliveryKm);
      const baseDeliveryFee = Number(body.baseDeliveryFee ?? current.baseDeliveryFee);
      const maxDeliveryKm = Number(body.maxDeliveryKm ?? current.maxDeliveryKm);
      // Stores priced through detailed delivery pricing do not also need the basic delivery fields.
      const detailed = deliveryEnabled && detailedDeliveryPricing({ deliverySettings: await prisma.deliverySetting.findMany({ where: { merchantId, active: true }, select: { maxRadiusKm: true, serviceAreaId: true, active: true } }) });
      if (deliveryEnabled && !detailed && (!Number.isFinite(maxDeliveryKm) || maxDeliveryKm <= 0)) throw badRequest('Enter a valid maximum delivery area');
      if (deliveryEnabled && !detailed && !freeDeliveryEnabled && (!Number.isFinite(baseDeliveryKm) || baseDeliveryKm <= 0 || !Number.isFinite(baseDeliveryFee) || baseDeliveryFee <= 0)) {
        throw badRequest('Enter a base delivery distance and price');
      }
    }
    const acceptedPaymentMethods = Array.isArray(body.paymentMethods)
      ? await paymentMethodsForRegistration(prisma, body.paymentMethods.filter((code): code is string => typeof code === 'string'))
      : undefined;
    let orderCharges: ReturnType<typeof normalizeOrderCharges> | undefined;
    if (body.orderCharges !== undefined) {
      try {
        orderCharges = normalizeOrderCharges(body.orderCharges);
      } catch (error) {
        throw badRequest(error instanceof Error ? error.message : 'Enter a valid service fee and tax');
      }
    }
    const merchant = await prisma.merchant.update({
      where: { id: merchantId },
      data: {
        phone: body.phone ? String(body.phone) : undefined,
        email: body.email ? String(body.email) : undefined,
        businessType: body.businessType ? String(body.businessType) : undefined,
        name: body.name && typeof body.name === 'object' ? body.name as object : undefined,
        description: body.description && typeof body.description === 'object' ? body.description as object : undefined,
        minimumOrder: body.minimumOrder !== undefined && body.minimumOrder !== '' ? String(body.minimumOrder) : undefined,
        freeDeliveryEnabled: typeof body.freeDeliveryEnabled === 'boolean' ? body.freeDeliveryEnabled : undefined,
        freeDeliveryKm: decimalSetting(body.freeDeliveryKm),
        baseDeliveryKm: decimalSetting(body.baseDeliveryKm),
        baseDeliveryFee: decimalSetting(body.baseDeliveryFee),
        beyondFreeDeliveryFee: decimalSetting(body.beyondFreeDeliveryFee),
        beyondDeliveryFeeMode: body.beyondDeliveryFeeMode === 'FIXED' || body.beyondDeliveryFeeMode === 'PER_KM' ? body.beyondDeliveryFeeMode : undefined,
        maxDeliveryKm: decimalSetting(body.maxDeliveryKm),
        preparationMinutes: preparationSetting(body.preparationMinutes),
        deliveryEnabled: typeof body.delivery === 'boolean' ? body.delivery : undefined,
        takeawayEnabled: typeof body.takeaway === 'boolean' ? body.takeaway : undefined,
        dineInEnabled: typeof body.dineIn === 'boolean' ? body.dineIn : undefined,
        inventoryMethod: body.inventoryMethod === 'DAILY' || body.inventoryMethod === 'STOCK' ? body.inventoryMethod : undefined,
        acceptedPaymentMethods,
        orderCharges,
        availability: body.availability === 'OPEN' || body.availability === 'CLOSED' || body.availability === 'BUSY' ? body.availability : undefined,
        temporaryClosedUntil: body.availability === 'CLOSED' ? new Date(Date.now() + 86_400_000) : body.availability === 'OPEN' || body.availability === 'BUSY' ? null : undefined,
        logoUrl: typeof body.logoUrl === 'string' ? body.logoUrl || null : undefined,
        coverUrl: typeof body.coverUrl === 'string' ? body.coverUrl || null : undefined,
        updatedById: user.id,
      },
    });
    if (body.availability === 'OPEN' || body.availability === 'CLOSED' || body.availability === 'BUSY') {
      platform.forgetMerchantDashboard(merchantId);
    }
    if (typeof body.address === 'string' || (body.latitude != null && body.longitude != null && body.latitude !== '' && body.longitude !== '')) {
      const branchId = typeof body.branchId === 'string' ? body.branchId : undefined;
      const branch = branchId
        ? await prisma.branch.findFirst({ where: { id: branchId, merchantId } })
        : await prisma.branch.findFirst({ where: { merchantId }, orderBy: { createdAt: 'asc' } });
      if (typeof body.address === 'string' && branch) {
        await prisma.branch.update({ where: { id: branch.id }, data: { line1: body.address, city: typeof body.city === 'string' ? body.city : branch.city, updatedById: user.id } });
      }
      const latitude = Number(body.latitude);
      const longitude = Number(body.longitude);
      if (body.latitude != null && body.longitude != null && body.latitude !== '' && body.longitude !== '' && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
        if (!branch) throw badRequest('Store location is not set up yet');
        await prisma.branch.update({
          where: { id: branch.id },
          data: { latitude: latitude.toFixed(6), longitude: longitude.toFixed(6), updatedById: user.id },
        });
      }
    }
    return merchant;
  });

  routes.post('/merchant/business-setup', { permissions: ['merchant.profile.manage'] }, async (request) => {
    const user = request.user!;
    if (!user.merchantId) throw badRequest('Merchant account required');
    const body = request.body as {
      delivery?: boolean;
      takeaway?: boolean;
      dineIn?: boolean;
      freeDeliveryEnabled?: boolean;
      freeDeliveryKm?: string;
      baseDeliveryKm?: string;
      baseDeliveryFee?: string;
      beyondFreeDeliveryFee?: string;
      beyondDeliveryFeeMode?: 'PER_KM' | 'FIXED';
      maxDeliveryKm?: string;
      minimumOrder?: string;
      latitude?: number;
      longitude?: number;
      hours?: { dayOfWeek: number; opensAt: string; closesAt: string; closed: boolean }[];
    };
    if (![body.delivery, body.takeaway, body.dineIn].some(Boolean)) throw badRequest('Choose at least one available order type');
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      throw badRequest('Choose a valid store location');
    }
    const decimal = (value: unknown, label: string, positive = false) => {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || (positive && number <= 0)) throw badRequest(`Enter a valid ${label}`);
      return number.toFixed(3);
    };
    // Stores priced through detailed delivery pricing do not also need the basic delivery fields.
    const detailed = detailedDeliveryPricing({ deliverySettings: await prisma.deliverySetting.findMany({ where: { merchantId: user.merchantId, active: true }, select: { maxRadiusKm: true, serviceAreaId: true, active: true } }) });
    const basicRequired = Boolean(body.delivery && !detailed);
    const freeDeliveryKm = decimal(body.freeDeliveryKm, 'free delivery distance');
    const baseDeliveryKm = decimal(body.baseDeliveryKm, 'base delivery distance', basicRequired && !body.freeDeliveryEnabled);
    const baseDeliveryFee = decimal(body.baseDeliveryFee, 'base delivery fee', basicRequired && !body.freeDeliveryEnabled);
    const beyondFreeDeliveryFee = decimal(body.beyondFreeDeliveryFee, 'delivery fee');
    const beyondDeliveryFeeMode = body.beyondDeliveryFeeMode === 'FIXED' ? 'FIXED' : 'PER_KM';
    const maxDeliveryKm = decimal(body.maxDeliveryKm, 'maximum delivery area', basicRequired);
    const minimumOrder = decimal(body.minimumOrder, 'minimum order');
    const hours = body.hours ?? [];
    const days = new Set(hours.map((hour) => hour.dayOfWeek));
    const validTime = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (hours.length !== 7 || days.size !== 7 || !hours.some((hour) => !hour.closed) || hours.some((hour) =>
      hour.dayOfWeek < 0 || hour.dayOfWeek > 6 || (!hour.closed && (!validTime.test(hour.opensAt) || !validTime.test(hour.closesAt) || hour.opensAt === hour.closesAt))
    )) {
      throw badRequest('Set valid operating hours for every day');
    }
    const branch = await prisma.branch.findFirst({ where: { merchantId: user.merchantId }, orderBy: { createdAt: 'asc' } });
    if (!branch) throw badRequest('Store location is not set up yet');
    await prisma.$transaction(async (tx) => {
      await tx.merchant.update({
        where: { id: user.merchantId! },
        data: {
          deliveryEnabled: Boolean(body.delivery),
          takeawayEnabled: Boolean(body.takeaway),
          dineInEnabled: Boolean(body.dineIn),
          freeDeliveryEnabled: Boolean(body.freeDeliveryEnabled),
          freeDeliveryKm,
          baseDeliveryKm,
          baseDeliveryFee,
          beyondFreeDeliveryFee,
          beyondDeliveryFeeMode,
          maxDeliveryKm,
          minimumOrder,
          businessSetupCompleted: true,
          updatedById: user.id,
        },
      });
      await tx.branch.update({
        where: { id: branch.id },
        data: { latitude: latitude.toFixed(6), longitude: longitude.toFixed(6), updatedById: user.id },
      });
      await tx.operatingHour.deleteMany({ where: { merchantId: user.merchantId! } });
      await tx.operatingHour.createMany({ data: hours.map((hour) => ({ ...hour, merchantId: user.merchantId! })) });
    });
    await audit.log({ actorId: user.id, action: 'merchant.business_setup.complete', entityType: 'Merchant', entityId: user.merchantId });
    return merchantDetail(user.merchantId);
  });

  routes.post('/merchant/closures', { permissions: ['merchant.profile.manage'] }, (request) => {
    const user = request.user!;
    const body = validate<{ reason: string; until: string }>(closureSchema, request.body);
    if (!user.merchantId) throw badRequest('Merchant account required');
    return prisma.merchant.update({
      where: { id: user.merchantId },
      data: { temporaryClosedUntil: new Date(body.until), closureReason: body.reason, updatedById: user.id },
    });
  });

  routes.post('/merchant/branches', { permissions: ['merchant.profile.manage'] }, async (request) => {
    const user = request.user!;
    const body = validate<{ name: { en: string; ar: string }; line1: string; city: string; latitude: string; longitude: string; phone?: string; managerId?: string }>(branchSchema, request.body);
    if (!user.merchantId) throw badRequest('Merchant account required');
    await platform.assertMerchantLimit(user.merchantId, 'branchLimit');
    const managerId = body.managerId ? await storeManagerId(user.merchantId, body.managerId) : undefined;
    return prisma.branch.create({
      data: { merchantId: user.merchantId, name: body.name, line1: body.line1, city: body.city, latitude: body.latitude, longitude: body.longitude, phone: body.phone, managerId, createdById: user.id },
    });
  });

  routes.patch('/merchant/branches/:id', { permissions: ['merchant.profile.manage'] }, async (request) => {
    const user = request.user!;
    const body = request.body as { managerId?: string | null };
    if (!user.merchantId) throw badRequest('Merchant account required');
    const branch = await prisma.branch.findFirst({ where: { id: param(request, 'id'), merchantId: user.merchantId } });
    if (!branch) throw badRequest('Branch not found');
    const managerId = body.managerId ? await storeManagerId(user.merchantId, body.managerId) : null;
    return prisma.branch.update({
      where: { id: branch.id },
      data: { managerId, updatedById: user.id },
      include: { manager: { select: { id: true, firstName: true, lastName: true } } },
    });
  });

  routes.get('/merchant/delivery-settings', async (request) => {
    const merchantId = request.user!.merchantId;
    if (!merchantId) throw badRequest('Merchant account required');
    const [merchant, settings, zones] = await Promise.all([
      prisma.merchant.findUniqueOrThrow({ where: { id: merchantId }, select: { deliveryEnabled: true, branches: { select: { id: true, name: true, city: true, active: true }, orderBy: { createdAt: 'asc' } } } }),
      prisma.deliverySetting.findMany({ where: { merchantId, active: true }, orderBy: { createdAt: 'asc' } }),
      prisma.serviceArea.findMany({ where: { active: true }, select: { id: true, name: true, city: true }, orderBy: { city: 'asc' } }),
    ]);
    return { storeDeliveryEnabled: merchant.deliveryEnabled, branches: merchant.branches, zones, settings: settings.map(presentDeliverySetting) };
  });

  routes.post('/merchant/delivery-settings/preview', { permissions: ['merchant.profile.manage'] }, (request) => {
    if (!request.user!.merchantId) throw badRequest('Merchant account required');
    return previewDeliverySetting(validate<DeliveryPreviewInput>(deliveryPreviewSchema, request.body));
  });

  routes.post('/merchant/delivery-settings', { permissions: ['merchant.profile.manage'] }, async (request) => {
    const user = request.user!;
    const merchantId = user.merchantId;
    if (!merchantId) throw badRequest('Merchant account required');
    const body = validate<DeliverySettingInput>(deliverySettingSchema, request.body);
    const branchId = body.branchId ?? null;
    const serviceAreaId = body.serviceAreaId ?? null;
    if (branchId && !(await prisma.branch.findFirst({ where: { id: branchId, merchantId }, select: { id: true } }))) throw badRequest('Branch not found');
    // Service areas are platform zones; any active one can carry a store-specific price.
    if (serviceAreaId && !(await prisma.serviceArea.findFirst({ where: { id: serviceAreaId, active: true }, select: { id: true } }))) throw badRequest('Delivery zone not found');
    const existing = await prisma.deliverySetting.findFirst({ where: { merchantId, branchId, serviceAreaId, active: true }, select: { id: true } });
    if (existing) throw new HttpError(409, { message: 'Delivery pricing already exists for this branch or zone', id: existing.id, statusCode: 409 });
    const created = await prisma.deliverySetting.create({
      data: { merchantId, branchId, serviceAreaId, ...deliverySettingData(body), version: 1, updatedById: user.id },
    });
    const view = presentDeliverySetting(created);
    await audit.log({ actorId: user.id, action: 'delivery_setting.create', entityType: 'DeliverySetting', entityId: created.id, metadata: { merchantId, after: view } });
    return view;
  });

  routes.patch('/merchant/delivery-settings/:id', { permissions: ['merchant.profile.manage'] }, async (request) => {
    const user = request.user!;
    const merchantId = user.merchantId;
    if (!merchantId) throw badRequest('Merchant account required');
    const body = validate<DeliverySettingUpdateInput>(deliverySettingUpdateSchema, request.body);
    const current = await prisma.deliverySetting.findFirst({ where: { id: param(request, 'id'), merchantId, active: true } });
    if (!current) throw notFound('Delivery pricing not found');
    if (body.version !== undefined && body.version !== current.version) throw new HttpError(409, { message: 'Someone else changed this delivery pricing. Reload and try again.', statusCode: 409 });
    const { version: _version, ...fields } = body;
    const saved = await prisma.deliverySetting.updateMany({
      where: { id: current.id, version: current.version },
      data: { ...deliverySettingData(fields), version: { increment: 1 }, updatedById: user.id },
    });
    if (!saved.count) throw new HttpError(409, { message: 'Someone else changed this delivery pricing. Reload and try again.', statusCode: 409 });
    const updated = await prisma.deliverySetting.findUniqueOrThrow({ where: { id: current.id } });
    const view = presentDeliverySetting(updated);
    await audit.log({ actorId: user.id, action: 'delivery_setting.update', entityType: 'DeliverySetting', entityId: current.id, metadata: { merchantId, before: presentDeliverySetting(current), after: view } });
    return view;
  });

  routes.delete('/merchant/delivery-settings/:id', { permissions: ['merchant.profile.manage'] }, async (request) => {
    const user = request.user!;
    const merchantId = user.merchantId;
    if (!merchantId) throw badRequest('Merchant account required');
    const current = await prisma.deliverySetting.findFirst({ where: { id: param(request, 'id'), merchantId, active: true } });
    if (!current) throw notFound('Delivery pricing not found');
    const updated = await prisma.deliverySetting.update({
      where: { id: current.id },
      data: { active: false, version: { increment: 1 }, updatedById: user.id },
    });
    await audit.log({ actorId: user.id, action: 'delivery_setting.deactivate', entityType: 'DeliverySetting', entityId: current.id, metadata: { merchantId, before: presentDeliverySetting(current) } });
    return presentDeliverySetting(updated);
  });

  routes.post('/merchant/hours', { permissions: ['merchant.profile.manage'] }, async (request) => {
    const user = request.user!;
    const body = validate<{ hours: { dayOfWeek: number; opensAt: string; closesAt: string; closed: boolean }[] }>(hoursSchema, request.body);
    if (!user.merchantId) throw badRequest('Merchant account required');
    await prisma.operatingHour.deleteMany({ where: { merchantId: user.merchantId } });
    await prisma.operatingHour.createMany({ data: body.hours.map((hour) => ({ ...hour, merchantId: user.merchantId! })) });
    return { ok: true };
  });

  routes.post('/merchant/bank', { permissions: ['merchant.profile.manage'] }, (request) => {
    const user = request.user!;
    const body = validate<{ bankName: string; accountName: string; iban: string }>(bankSchema, request.body);
    if (!user.merchantId) throw badRequest('Merchant account required');
    if (!user.roles.includes('MERCHANT_OWNER')) throw forbidden('Only the store owner can do this');
    return prisma.bankAccount.create({
      data: { merchantId: user.merchantId, bankName: body.bankName, accountName: body.accountName, ibanCipher: crypto.encrypt(body.iban) },
    });
  });

  routes.get('/admin/plans', { permissions: ['subscription.manage'] }, () => platform.listPlans());

  routes.get('/admin/subscriptions', { permissions: ['subscription.manage'] }, () => platform.subscriptionBoard());

  routes.patch('/admin/plans/:id', { permissions: ['subscription.manage'] }, (request) => {
    const body = validate<Parameters<PlatformService['updatePlan']>[1]>(planSchema, request.body);
    return platform.updatePlan(param(request, 'id'), body, request.user!.id);
  });

  routes.post('/admin/plans', { permissions: ['subscription.manage'] }, (request) => {
    const body = validate<Parameters<PlatformService['createPlan']>[0]>(planSchema, request.body);
    return platform.createPlan(body, request.user!.id);
  });

  routes.post('/admin/plans/reorder', { permissions: ['subscription.manage'] }, (request) => {
    const body = validate<{ ids: string[] }>(reorderPlansSchema, request.body);
    return platform.reorderPlans(body.ids, request.user!.id);
  });

  routes.post('/admin/plans/:id/duplicate', { permissions: ['subscription.manage'] }, (request) => platform.duplicatePlan(param(request, 'id'), request.user!.id));

  routes.get('/admin/merchants/:id/subscription/history', { permissions: ['subscription.manage'] }, (request) => platform.subscriptionHistory(param(request, 'id')));

  routes.post('/admin/merchants/:id/subscription', { permissions: ['subscription.manage'] }, (request) => {
    const body = validate<{ planId: string; billingInterval: 'MONTHLY' | 'ANNUAL'; markPaid?: boolean }>(assignSubscriptionSchema, request.body);
    return platform.assignSubscription(param(request, 'id'), body.planId, body.billingInterval, request.user!.id, body.markPaid !== false);
  });

  routes.get('/merchant/subscription', (request) => {
    const user = request.user!;
    if (!user.merchantId) throw badRequest('Merchant account required');
    return platform.entitlementUsage(user.merchantId);
  });

  routes.post('/merchant/subscription/renew', async (request) => {
    const user = request.user!;
    if (!user.merchantId) throw badRequest('Merchant account required');
    if (!user.roles.includes('MERCHANT_OWNER')) throw forbidden('Only the store owner can do this');
    const body = validate<{ planId: string; billingInterval: 'MONTHLY' | 'ANNUAL'; autoRenew: boolean; paymentMethod?: 'CARD' | 'BENEFIT' | 'BANK' }>(merchantRenewalSchema, request.body);
    return platform.renewSubscription(user.merchantId, user.id, body);
  });

  routes.post('/merchant/subscription/auto-renew', async (request) => {
    const user = request.user!;
    if (!user.merchantId) throw badRequest('Merchant account required');
    if (!user.roles.includes('MERCHANT_OWNER')) throw forbidden('Only the store owner can do this');
    const body = validate<{ autoRenew: boolean }>(merchantAutoRenewSchema, request.body);
    return platform.setAutoRenew(user.merchantId, body.autoRenew, user.id);
  });

  routes.get('/merchant/invoices', { permissions: ['payment.view'] }, async (request) => {
    const user = request.user!;
    if (!user.merchantId) throw badRequest('Merchant account required');
    const rows = await prisma.invoice.findMany({
      where: { merchantId: user.merchantId },
      orderBy: { issuedAt: 'desc' },
      take: 24,
    });
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      amount: dec(row.amount),
      currency: row.currency,
      status: row.status,
      kind: row.kind,
      issuedAt: row.issuedAt.toISOString(),
    }));
  });

  routes.get('/staff', { permissions: ['staff.manage'] }, async (request) => {
    const merchantId = scopedMerchantId(request.user!);
    const rows = await prisma.user.findMany({
      where: { deletedAt: null, kind: merchantId ? 'MERCHANT_USER' : { in: ['STAFF', 'MERCHANT_USER'] }, ...(merchantId ? { merchantId } : {}) },
      include: { userRoles: { include: { role: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      status: row.status,
      roles: row.userRoles.map((entry) => entry.role.key),
      merchantId: row.merchantId,
    }));
  });

  routes.post('/staff', { permissions: ['staff.manage'] }, async (request) => {
    const user = request.user!;
    const body = validate<{ email: string; password: string; firstName: string; lastName: string; phone?: string; roleKey: string; merchantId?: string }>(staffSchema, request.body);
    const merchantId = scopedMerchantId(user, body.merchantId);
    if (merchantId) await platform.assertMerchantLimit(merchantId, 'staffLimit');
    const role = await prisma.role.findUnique({ where: { key: body.roleKey } });
    if (!role) throw badRequest('Unknown role');
    const created = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        passwordHash: await argon2.hash(body.password),
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone,
        kind: merchantId ? 'MERCHANT_USER' : 'STAFF',
        status: 'ACTIVE',
        merchantId,
        createdById: user.id,
        userRoles: { create: { roleId: role.id, merchantId } },
        ...(body.roleKey === 'DELIVERY_STAFF' ? { driverProfile: { create: { merchantId, active: true } } } : {}),
      },
    });
    await audit.log({ actorId: user.id, action: 'staff.create', entityType: 'User', entityId: created.id, metadata: { role: body.roleKey } });
    if (created.email) {
      await sendWelcomeEmail(email, {
        to: created.email,
        firstName: created.firstName,
        role: roleLabel(body.roleKey),
        signInUrl: merchantId ? merchantSignInUrl() : adminSignInUrl(),
      });
    }
    return { id: created.id };
  });

  routes.post('/staff/:id/suspend', { permissions: ['staff.manage'] }, async (request) => {
    const user = request.user!;
    const id = param(request, 'id');
    await guardStaff(user, id);
    await prisma.user.update({ where: { id }, data: { status: 'SUSPENDED', updatedById: user.id } });
    await audit.log({ actorId: user.id, action: 'user.suspend', entityType: 'User', entityId: id });
    return { ok: true };
  });

  routes.post('/staff/:id/activate', { permissions: ['staff.manage'] }, async (request) => {
    const user = request.user!;
    const id = param(request, 'id');
    await guardStaff(user, id);
    await prisma.user.update({ where: { id }, data: { status: 'ACTIVE', updatedById: user.id } });
    await audit.log({ actorId: user.id, action: 'user.activate', entityType: 'User', entityId: id });
    return { ok: true };
  });

  routes.get('/roles', () => prisma.role.findMany({ include: { permissions: { include: { permission: true } } } }));

  routes.patch('/roles/:id/permissions', { permissions: ['staff.manage'] }, async (request) => {
    const user = request.user!;
    const id = param(request, 'id');
    const body = validate<{ permissionKeys: string[] }>(rolePermissionsSchema, request.body);
    const permissions = await prisma.permission.findMany({ where: { key: { in: body.permissionKeys } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: id } });
    await prisma.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: id, permissionId: permission.id })) });
    await audit.log({ actorId: user.id, action: 'user.role_change', entityType: 'Role', entityId: id });
    return { ok: true };
  });

  routes.get('/catalog/categories', async (request) => {
    const merchantId = request.user!.merchantId;
    if (!merchantId) throw badRequest('Merchant account required');
    const rows = await prisma.productCategory.findMany({
      where: { merchantId, deletedAt: null },
      include: { catalogCategory: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => ({
      ...row,
      name: row.catalogCategory?.name ?? row.name,
      icon: row.catalogCategory?.icon ?? null,
      reviewStatus: row.catalogCategory?.status ?? 'APPROVED',
      catalogCategoryId: row.catalogCategoryId,
      catalogCategory: undefined,
    }));
  });

  routes.get('/catalog/category-options', async (request) => {
    if (!request.user!.merchantId) throw badRequest('Merchant account required');
    const query = typeof request.query.q === 'string' ? categoryNameKey(request.query.q) : '';
    if (query.length < 1) return [];
    const rows = await prisma.catalogCategory.findMany({
      where: {
        status: { in: ['APPROVED', 'PENDING'] },
        mergedIntoId: null,
        OR: [
          { normalizedName: { contains: query, mode: 'insensitive' } },
          { aliases: { has: query } },
          { name: { path: ['ar'], string_contains: query } },
        ],
      },
      orderBy: [{ status: 'asc' }, { normalizedName: 'asc' }],
      take: 10,
    });
    return rows.map((row) => ({ id: row.id, name: loc(row.name), icon: row.icon, status: row.status }));
  });

  routes.post('/catalog/categories', { permissions: ['catalog.manage'] }, async (request) => {
    const user = request.user!;
    const body = validate<{ name: { en: string; ar: string }; sortOrder?: number }>(categorySchema, request.body);
    if (!user.merchantId) throw badRequest('Merchant account required');
    return prisma.$transaction((tx) =>
      resolveMerchantCategory(tx, {
        merchantId: user.merchantId!,
        name: body.name,
        sortOrder: body.sortOrder ?? 0,
      }),
    );
  });

  routes.patch('/catalog/categories/:id', { permissions: ['catalog.manage'] }, async (request) => {
    const user = request.user!;
    if (!user.merchantId) throw badRequest('Merchant account required');
    const id = param(request, 'id');
    const body = validate<{ name: { en: string; ar: string } }>(categorySchema.pick({ name: true }), request.body);
    return prisma.$transaction((tx) =>
      replaceMerchantCategory(tx, { merchantId: user.merchantId!, localCategoryId: id, name: body.name }),
    );
  });

  routes.delete('/catalog/categories/:id', { permissions: ['catalog.manage'] }, async (request) => {
    const user = request.user!;
    if (!user.merchantId) throw badRequest('Merchant account required');
    const id = param(request, 'id');
    const existing = await prisma.productCategory.findFirst({ where: { id, merchantId: user.merchantId, deletedAt: null } });
    if (!existing) throw badRequest('Category not found');
    const used = await prisma.product.count({ where: { categoryId: id, merchantId: user.merchantId, deletedAt: null } });
    if (used) throw badRequest('Move products out of this category before deleting it');
    await prisma.productCategory.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  });

  routes.get('/catalog/products', (request) => products(request.user!));

  routes.get('/catalog/product-options', async (request) => {
    if (!request.user!.merchantId) throw badRequest('Merchant account required');
    const query = typeof request.query.q === 'string' ? categoryNameKey(request.query.q) : '';
    if (query.length < 1) return [];
    const rows = await prisma.catalogProduct.findMany({
      where: {
        status: { in: ['APPROVED', 'PENDING'] },
        mergedIntoId: null,
        OR: [
          { normalizedName: { contains: query, mode: 'insensitive' } },
          { aliases: { has: query } },
          { name: { path: ['ar'], string_contains: query } },
        ],
      },
      orderBy: [{ status: 'asc' }, { normalizedName: 'asc' }],
      take: 10,
    });
    return rows.map((row) => ({
      id: row.id,
      name: loc(row.name),
      description: loc(row.description),
      imageUrl: row.imageUrl,
      status: row.status,
    }));
  });

  routes.post('/catalog/products', { permissions: ['catalog.manage'] }, async (request) => {
    const user = request.user!;
    const body = validate<{ categoryId: string; name: { en: string; ar: string }; description: { en: string; ar: string }; price: string; compareAtPrice?: string | null; imageUrl?: string | null; available?: boolean; stockQuantity?: number; lowStockThreshold?: number; variants?: { name: { en: string; ar: string }; price: string; available?: boolean }[]; addonGroupIds?: string[]; approvalStatus?: 'DRAFT' | 'PENDING' | 'APPROVED' }>(productSchema, request.body);
    if (!user.merchantId) throw badRequest('Merchant account required');
    await platform.assertMerchantLimit(user.merchantId, 'productLimit');
    const category = await prisma.productCategory.findFirst({
      where: { id: body.categoryId, merchantId: user.merchantId, deletedAt: null },
    });
    if (!category) throw badRequest('Category not found');
    const branch = await prisma.branch.findFirst({ where: { merchantId: user.merchantId } });
    if (!branch) throw badRequest('Create a branch first');
    const product = await prisma.$transaction(async (tx) => {
      const central = await resolveCatalogProduct(tx, {
        merchantId: user.merchantId!,
        name: body.name,
        description: body.description,
        imageUrl: body.imageUrl,
      });
      const alreadyAdded = await tx.product.findFirst({
        where: { merchantId: user.merchantId!, catalogProductId: central.id, deletedAt: null },
      });
      if (alreadyAdded) throw badRequest('This product is already in your store');
      const centralName = loc(central.name);
      const centralDescription = loc(central.description);
      return tx.product.create({
        data: {
          merchantId: user.merchantId!,
          catalogProductId: central.id,
          categoryId: body.categoryId,
          slug: slugify(centralName.en),
          name: centralName,
          description: centralDescription,
          price: body.price,
          compareAtPrice: body.compareAtPrice,
          imageUrl: body.imageUrl || central.imageUrl,
          available: body.available ?? true,
          approvalStatus: body.approvalStatus ?? 'PENDING',
          createdById: user.id,
          variants: { create: (body.variants ?? []).map((variant) => ({ merchantId: user.merchantId!, name: variant.name, price: variant.price, available: variant.available ?? true })) },
          addonGroups: { create: (body.addonGroupIds ?? []).map((addonGroupId) => ({ addonGroupId })) },
          inventory: { create: { merchantId: user.merchantId!, branchId: branch.id, quantity: body.stockQuantity ?? 20, lowStockThreshold: body.lowStockThreshold ?? 5 } },
        },
      });
    });
    return product;
  });

  routes.patch('/catalog/products/:id', { permissions: ['catalog.manage'] }, async (request) => {
    const user = request.user!;
    const id = param(request, 'id');
    const body = validate<{ categoryId?: string; name?: { en: string; ar: string }; description?: { en: string; ar: string }; price?: string; compareAtPrice?: string | null; imageUrl?: string | null; available?: boolean; approvalStatus?: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED'; stockQuantity?: number }>(productUpdateSchema, request.body);
    if (!user.merchantId) throw badRequest('Merchant account required');
    const existing = await prisma.product.findFirst({ where: { id, merchantId: user.merchantId, deletedAt: null } });
    if (!existing) throw badRequest('Product not found');
    if (body.categoryId) {
      const category = await prisma.productCategory.findFirst({ where: { id: body.categoryId, merchantId: user.merchantId, deletedAt: null } });
      if (!category) throw badRequest('Category not found');
    }
    const central = body.name && body.description
      ? await prisma.$transaction((tx) => resolveCatalogProduct(tx, {
          merchantId: user.merchantId!,
          name: body.name!,
          description: body.description!,
          imageUrl: body.imageUrl,
        }))
      : null;
    await prisma.product.update({
      where: { id },
      data: {
        catalogProductId: central?.id,
        categoryId: body.categoryId,
        name: central ? loc(central.name) : body.name,
        description: central ? loc(central.description) : body.description,
        price: body.price,
        compareAtPrice: body.compareAtPrice,
        imageUrl: body.imageUrl,
        available: body.available,
        approvalStatus: body.approvalStatus,
        updatedById: user.id,
      },
    });
    if (body.stockQuantity !== undefined) {
      const items = await prisma.inventoryItem.findMany({ where: { productId: id, merchantId: user.merchantId } });
      if (!items.length) {
        const branch = await prisma.branch.findFirst({ where: { merchantId: user.merchantId } });
        if (!branch) throw badRequest('Create a branch first');
        await prisma.inventoryItem.create({ data: { merchantId: user.merchantId, branchId: branch.id, productId: id, quantity: body.stockQuantity, lowStockThreshold: 5 } });
      } else if (body.stockQuantity === 0) {
        await prisma.inventoryItem.updateMany({ where: { productId: id, merchantId: user.merchantId }, data: { quantity: 0 } });
      } else {
        const first = items[0];
        if (first) await prisma.inventoryItem.update({ where: { id: first.id }, data: { quantity: body.stockQuantity } });
      }
    }
    return { ok: true };
  });

  routes.post('/catalog/offers', { permissions: ['catalog.manage'] }, async (request) => {
    const user = request.user!;
    const body = validate<{ title: { en: string; ar: string }; productId?: string }>(offerSchema, request.body);
    if (!user.merchantId) throw badRequest('Merchant account required');
    const offer = await prisma.offer.create({
      data: {
        merchantId: user.merchantId,
        title: body.title,
        active: true,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    if (body.productId) {
      const product = await prisma.product.findFirst({ where: { id: body.productId, merchantId: user.merchantId, deletedAt: null } });
      if (!product) throw badRequest('Product not found');
      if (!product.compareAtPrice) {
        await prisma.product.update({ where: { id: product.id }, data: { compareAtPrice: product.price } });
      }
    }
    return offer;
  });

  routes.post('/catalog/products/import', { permissions: ['catalog.manage'] }, async (request) => {
    const user = request.user!;
    if (!user.merchantId) throw badRequest('Merchant account required');
    const rows = (request.body as { rows?: unknown }).rows;
    return importCatalogProducts(prisma, platform, { id: user.id, merchantId: user.merchantId }, rows as unknown[]);
  });

  routes.get('/catalog/products/export', { permissions: ['catalog.manage'] }, async (request, response) => {
    const rows = await products(request.user!);
    const header = 'name,name_ar,description,description_ar,category,price,stock,status';
    const lines = rows.map((row) => [row.name.en, row.name.ar, row.description.en, row.description.ar, row.category.en, row.price, row.stock, catalogStatus(row)].map(csvCell).join(','));
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="products.csv"');
    response.send(`\uFEFF${[header, ...lines].join('\r\n')}\r\n`);
  });

  routes.post('/admin/products/:id/approve', { permissions: ['catalog.moderate'] }, (request) =>
    prisma.product.update({ where: { id: param(request, 'id') }, data: { approvalStatus: 'APPROVED' } }),
  );

  routes.get('/admin/catalog/categories', { permissions: ['catalog.moderate'] }, async () => {
    const rows = await prisma.catalogCategory.findMany({
      include: {
        mergedInto: { select: { id: true, name: true } },
        _count: { select: { merchantCategories: true } },
      },
      orderBy: [{ status: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      name: loc(row.name),
      normalizedName: row.normalizedName,
      icon: row.icon,
      status: row.status,
      reviewNote: row.reviewNote,
      submittedByMerchantId: row.submittedByMerchantId,
      stores: row._count.merchantCategories,
      mergedInto: row.mergedInto ? { id: row.mergedInto.id, name: loc(row.mergedInto.name) } : null,
      createdAt: row.createdAt,
    }));
  });

  routes.patch('/admin/catalog/categories/:id', { permissions: ['catalog.moderate'] }, async (request) => {
    const user = request.user!;
    const id = param(request, 'id');
    const body = request.body as {
      name?: { en?: string; ar?: string };
      icon?: string | null;
      status?: 'PENDING' | 'APPROVED' | 'REJECTED';
      reviewNote?: string | null;
    };
    const existing = await prisma.catalogCategory.findUnique({ where: { id } });
    if (!existing) throw notFound('Category not found');
    const currentName = loc(existing.name);
    const name = body.name
      ? { en: body.name.en?.trim() || currentName.en, ar: body.name.ar?.trim() || currentName.ar }
      : undefined;
    const normalizedName = name ? categoryNameKey(name.en || name.ar) : undefined;
    if (normalizedName && normalizedName !== existing.normalizedName) {
      const duplicate = await prisma.catalogCategory.findFirst({
        where: {
          id: { not: id },
          OR: [{ normalizedName }, { aliases: { has: normalizedName } }],
        },
      });
      if (duplicate) throw badRequest('This category already exists. Merge into the existing category instead.');
    }
    const aliases = name
      ? [...new Set([
          ...existing.aliases,
          existing.normalizedName,
          categoryNameKey(name.en),
          categoryNameKey(name.ar),
        ].filter(Boolean))]
      : undefined;
    const updated = await prisma.catalogCategory.update({
      where: { id },
      data: {
        name,
        normalizedName,
        aliases,
        icon: body.icon === undefined ? undefined : body.icon?.trim() || null,
        status: body.status,
        reviewNote: body.reviewNote === undefined ? undefined : body.reviewNote?.trim() || null,
        reviewedById: body.status && body.status !== 'PENDING' ? user.id : undefined,
      },
    });
    if (name) {
      await prisma.productCategory.updateMany({ where: { catalogCategoryId: id }, data: { name } });
    }
    return updated;
  });

  routes.post('/admin/catalog/categories/:id/merge', { permissions: ['catalog.moderate'] }, async (request) => {
    const user = request.user!;
    const body = request.body as { targetId?: string; note?: string };
    if (!body.targetId) throw badRequest('Choose a replacement category');
    return mergeCatalogCategory(prisma, {
      sourceId: param(request, 'id'),
      targetId: body.targetId,
      actorId: user.id,
      note: body.note,
    });
  });

  routes.get('/admin/catalog/products', { permissions: ['catalog.moderate'] }, async () => {
    const rows = await prisma.catalogProduct.findMany({
      include: {
        mergedInto: { select: { id: true, name: true } },
        _count: { select: { merchantProducts: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: loc(row.name),
      description: loc(row.description),
      normalizedName: row.normalizedName,
      imageUrl: row.imageUrl,
      status: row.status,
      reviewNote: row.reviewNote,
      submittedByMerchantId: row.submittedByMerchantId,
      stores: row._count.merchantProducts,
      mergedInto: row.mergedInto ? { id: row.mergedInto.id, name: loc(row.mergedInto.name) } : null,
      createdAt: row.createdAt,
    }));
  });

  routes.patch('/admin/catalog/products/:id', { permissions: ['catalog.moderate'] }, async (request) => {
    const user = request.user!;
    const id = param(request, 'id');
    const body = request.body as {
      name?: { en?: string; ar?: string };
      description?: { en?: string; ar?: string };
      imageUrl?: string | null;
      status?: 'PENDING' | 'APPROVED' | 'REJECTED';
      reviewNote?: string | null;
    };
    const existing = await prisma.catalogProduct.findUnique({ where: { id } });
    if (!existing) throw notFound('Product not found');
    const currentName = loc(existing.name);
    const currentDescription = loc(existing.description);
    const name = body.name ? { en: body.name.en?.trim() || currentName.en, ar: body.name.ar?.trim() || currentName.ar } : undefined;
    const description = body.description
      ? { en: body.description.en?.trim() || currentDescription.en, ar: body.description.ar?.trim() || currentDescription.ar }
      : undefined;
    const normalizedName = name ? categoryNameKey(name.en || name.ar) : undefined;
    if (normalizedName && normalizedName !== existing.normalizedName) {
      const duplicate = await prisma.catalogProduct.findFirst({
        where: { id: { not: id }, OR: [{ normalizedName }, { aliases: { has: normalizedName } }] },
      });
      if (duplicate) throw badRequest('This product already exists. Merge into the existing product instead.');
    }
    const aliases = name
      ? [...new Set([...existing.aliases, existing.normalizedName, categoryNameKey(name.en), categoryNameKey(name.ar)].filter(Boolean))]
      : undefined;
    const updated = await prisma.catalogProduct.update({
      where: { id },
      data: {
        name,
        description,
        normalizedName,
        aliases,
        imageUrl: body.imageUrl === undefined ? undefined : body.imageUrl?.trim() || null,
        status: body.status,
        reviewNote: body.reviewNote === undefined ? undefined : body.reviewNote?.trim() || null,
        reviewedById: body.status && body.status !== 'PENDING' ? user.id : undefined,
      },
    });
    await prisma.product.updateMany({
      where: { catalogProductId: id },
      data: { name, description },
    });
    if (body.imageUrl !== undefined) {
      const nextImage = body.imageUrl?.trim() || null;
      await prisma.product.updateMany({
        where: { catalogProductId: id, OR: [{ imageUrl: null }, { imageUrl: existing.imageUrl }] },
        data: { imageUrl: nextImage },
      });
    }
    return updated;
  });

  routes.post('/admin/catalog/products/:id/merge', { permissions: ['catalog.moderate'] }, async (request) => {
    const user = request.user!;
    const body = request.body as { targetId?: string; note?: string };
    if (!body.targetId) throw badRequest('Choose a replacement product');
    return mergeCatalogProduct(prisma, {
      sourceId: param(request, 'id'),
      targetId: body.targetId,
      actorId: user.id,
      note: body.note,
    });
  });

  routes.post('/orders/:id/transition', async (request) => {
    const view = await commerce.transition(request.user!, param(request, 'id'), request.body as OrderStatusChange);
    if (request.user?.merchantId) platform.forgetMerchantDashboard(request.user.merchantId);
    return view;
  });

  routes.get('/complaints', { permissions: ['complaint.view'] }, async (request) => {
    const user = request.user!;
    const rows = await prisma.complaint.findMany({
      where: user.merchantId ? { merchantId: user.merchantId } : {},
      include: { assignee: true, notes: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      source: row.source,
      category: row.category,
      priority: row.priority,
      status: row.status,
      subject: row.subject,
      description: row.description,
      orderId: row.orderId,
      assigneeName: row.assignee ? `${row.assignee.firstName} ${row.assignee.lastName}` : null,
      createdAt: row.createdAt.toISOString(),
      satisfaction: row.satisfaction,
      notes: row.notes,
    }));
  });

  routes.post('/complaints', (request) => {
    const user = request.user!;
    const body = validate<{ source: 'CUSTOMER' | 'MERCHANT' | 'DRIVER'; category: string; priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; subject: string; description: string; orderId?: string | null }>(complaintSchema, request.body);
    return prisma.complaint.create({
      data: { ...body, reporterId: user.id, merchantId: user.merchantId, createdById: user.id },
    });
  });

  routes.patch('/complaints/:id', { permissions: ['complaint.manage'] }, async (request) => {
    const user = request.user!;
    const id = param(request, 'id');
    const body = validate<{ status?: 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'ESCALATED' | 'RESOLVED' | 'CLOSED'; assigneeId?: string | null; priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; note?: string; internal?: boolean; satisfaction?: number; requestRefund?: boolean }>(complaintUpdateSchema, request.body);
    const complaint = await prisma.complaint.update({
      where: { id },
      data: { status: body.status, assigneeId: body.assigneeId, priority: body.priority, satisfaction: body.satisfaction, updatedById: user.id },
    });
    if (body.note) {
      await prisma.complaintNote.create({ data: { complaintId: id, authorId: user.id, body: body.note, internal: body.internal ?? true } });
    }
    if (body.requestRefund && complaint.orderId) {
      await commerce.refund(user, complaint.orderId, '0.000', body.note ?? complaint.subject);
    }
    return complaint;
  });

  routes.get('/finance/payments', { permissions: ['payment.view'] }, (request) => {
    const user = request.user!;
    return prisma.payment.findMany({ where: user.merchantId ? { merchantId: user.merchantId } : {}, orderBy: { createdAt: 'desc' }, take: 100 });
  });

  routes.get('/finance/ledger', { permissions: ['finance.view'] }, (request) => {
    const user = request.user!;
    return prisma.ledgerEntry.findMany({ where: user.merchantId ? { merchantId: user.merchantId } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
  });

  routes.get('/finance/settlements', { permissions: ['settlement.process'] }, () =>
    prisma.settlement.findMany({ include: { lines: true, merchant: true }, orderBy: { createdAt: 'desc' } }),
  );

  routes.post('/finance/settlements/:id/decision', { permissions: ['settlement.process'] }, async (request) => {
    const user = request.user!;
    const id = param(request, 'id');
    const body = validate<{ decision: 'APPROVED' | 'REJECTED'; note?: string }>(settlementDecisionSchema, request.body);
    const settlement = await prisma.settlement.update({ where: { id }, data: { status: body.decision, note: body.note, updatedById: user.id } });
    if (body.decision === 'APPROVED') {
      await prisma.ledgerEntry.create({
        data: {
          type: 'SETTLEMENT_ADJUSTMENT',
          amount: dec(settlement.amount),
          debitAccount: 'merchant_payable_net',
          creditAccount: 'merchant_bank',
          referenceType: 'SETTLEMENT',
          referenceId: settlement.id,
          merchantId: settlement.merchantId,
          idempotencyKey: `${settlement.id}:SETTLEMENT`,
          createdById: user.id,
        },
      });
    }
    await audit.log({ actorId: user.id, action: 'settlement.approve', entityType: 'Settlement', entityId: id });
    return settlement;
  });

  routes.post('/finance/refunds/:id/decision', { permissions: ['refund.approve'] }, async (request) => {
    const user = request.user!;
    const id = param(request, 'id');
    const body = validate<{ decision: 'APPROVED' | 'REJECTED' }>(refundDecisionSchema, request.body);
    const refund = await prisma.refund.update({ where: { id }, data: { status: body.decision === 'APPROVED' ? 'PROCESSED' : 'REJECTED', updatedById: user.id } });
    if (body.decision === 'APPROVED') {
      await prisma.ledgerEntry.create({
        data: {
          type: 'REFUND',
          amount: dec(refund.amount),
          debitAccount: 'refunds',
          creditAccount: 'gateway_clearing',
          referenceType: 'ORDER',
          referenceId: refund.orderId,
          merchantId: refund.merchantId,
          idempotencyKey: `${refund.orderId}:REFUND:${refund.id}`,
          createdById: user.id,
        },
      });
      await prisma.order.update({ where: { id: refund.orderId }, data: { status: 'REFUNDED' } });
    }
    await audit.log({ actorId: user.id, action: 'refund.approve', entityType: 'Refund', entityId: id });
    return refund;
  });

  // Merchant promo codes discount the customer's cart for this store only.
  // Platform subscription promo codes live under /marketing/promos.
  routes.get('/promos', { permissions: ['promo.manage'] }, async (request) => {
    const merchantId = request.user?.merchantId;
    if (!merchantId) throw badRequest('Subscription promo codes are managed under Marketing');
    const rows = await prisma.promoCode.findMany({
      where: { deletedAt: null, merchantId, purpose: 'ORDER' },
      include: { _count: { select: { redemptions: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(presentMerchantPromo);
  });

  routes.post('/promos', { permissions: ['promo.manage'] }, async (request) => {
    const user = request.user!;
    if (!user.merchantId) throw badRequest('Subscription promo codes are managed under Marketing');
    await platform.assertOptionalFeature(user.merchantId, 'merchantPromoCodes', 'Merchant promo codes');
    const body = validate<MerchantPromoInput>(merchantPromoSchema, request.body);
    try {
      const created = await prisma.promoCode.create({
        data: {
          code: body.code.toUpperCase(),
          description: { en: body.description, ar: body.descriptionAr?.trim() || body.description },
          scope: 'MERCHANT',
          merchantId: user.merchantId,
          purpose: 'ORDER',
          discountType: body.discountType,
          discountValue: body.discountValue,
          minimumOrder: body.minimumOrder ?? null,
          usageLimit: body.usageLimit ?? null,
          perCustomerLimit: body.perCustomerLimit ?? null,
          startsAt: new Date(body.startsAt),
          endsAt: new Date(body.endsAt),
          firstOrderOnly: Boolean(body.firstOrderOnly),
          createdById: user.id,
        },
        include: { _count: { select: { redemptions: true } } },
      });
      await audit.log({ actorId: user.id, action: 'promo.create', entityType: 'PromoCode', entityId: created.id, metadata: { code: created.code } });
      return presentMerchantPromo(created);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw badRequest('This promo code is already in use');
      throw error;
    }
  });

  routes.post('/promos/:id/active', { permissions: ['promo.manage'] }, async (request) => {
    const user = request.user!;
    if (!user.merchantId) throw badRequest('Subscription promo codes are managed under Marketing');
    const body = validate<{ active: boolean }>(merchantPromoActiveSchema, request.body);
    const existing = await prisma.promoCode.findFirst({ where: { id: param(request, 'id'), merchantId: user.merchantId, purpose: 'ORDER', deletedAt: null } });
    if (!existing) throw notFound('Promo code not found');
    if (body.active) await platform.assertOptionalFeature(user.merchantId, 'merchantPromoCodes', 'Merchant promo codes');
    const updated = await prisma.promoCode.update({
      where: { id: existing.id },
      data: { active: body.active },
      include: { _count: { select: { redemptions: true } } },
    });
    await audit.log({ actorId: user.id, action: 'promo.active', entityType: 'PromoCode', entityId: updated.id, metadata: { active: body.active } });
    return presentMerchantPromo(updated);
  });

  routes.get('/reports/overview', { permissions: ['report.export'] }, (request) => {
    const query = validate<{ from?: string; to?: string; merchantId?: string }>(reportQuerySchema, request.query);
    const merchantId = scopedMerchantId(request.user!, query.merchantId);
    return platform.report(query.from ? new Date(query.from) : undefined, query.to ? new Date(query.to) : undefined, merchantId);
  });

  routes.get('/reports/export.csv', { permissions: ['report.export'] }, async (request, response) => {
    const csv = await platform.reportCsv(undefined, undefined, scopedMerchantId(request.user!, request.query.merchantId as string | undefined));
    response.setHeader('Content-Type', 'text/csv');
    response.send(csv);
  });

  routes.get('/reports/export.pdf', { permissions: ['report.export'] }, async (request, response) => {
    const file = await platform.reportPdf(undefined, undefined, scopedMerchantId(request.user!, request.query.merchantId as string | undefined));
    response.setHeader('Content-Type', 'application/pdf');
    response.send(file);
  });

  routes.get('/settings', { permissions: ['settings.manage'] }, async () => {
    const [values, categories, areas, delivery, freeDelivery, gateways, templates] = await Promise.all([
      prisma.platformSetting.findMany(),
      prisma.businessCategory.findMany(),
      prisma.serviceArea.findMany(),
      prisma.deliveryPricingRule.findMany(),
      prisma.freeDeliveryRule.findMany(),
      prisma.paymentGatewayConfig.findMany(),
      prisma.notificationTemplate.findMany(),
    ]);
    return { values, categories, areas, delivery, freeDelivery, gateways, templates };
  });

  routes.patch('/settings', { permissions: ['settings.manage'] }, async (request) => {
    const user = request.user!;
    const body = validate<{ values: Record<string, unknown> }>(settingsSchema, request.body);
    if ('paymentMethods' in body.values) body.values.paymentMethods = validate(paymentMethodsSettingSchema, body.values.paymentMethods);
    for (const [key, value] of Object.entries(body.values)) {
      await prisma.platformSetting.upsert({ where: { key }, update: { value: value as object, updatedById: user.id }, create: { key, value: value as object, updatedById: user.id } });
    }
    await audit.log({ actorId: user.id, action: 'settings.update', entityType: 'PlatformSetting', metadata: body.values });
    return { ok: true };
  });

  routes.get('/audit', { permissions: ['audit.view'] }, () =>
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { actor: true } }),
  );

  routes.get('/operations/live', { permissions: ['dispatch.manage'] }, (request) =>
    commerce.listOrders({
      status: { in: ['PENDING', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER', 'OUT_FOR_DELIVERY'] },
      ...(request.user!.merchantId ? { merchantId: request.user!.merchantId } : {}),
    }),
  );

  routes.post('/operations/dispatch', { permissions: ['dispatch.manage'] }, async (request) => {
    const body = validate<{ orderId: string; driverId: string }>(dispatchSchema, request.body);
    const merchantId = request.user!.merchantId;
    if (merchantId) {
      const driver = await prisma.driverProfile.findFirst({ where: { id: body.driverId, merchantId, active: true } });
      if (!driver) throw badRequest('This rider does not work for your store');
    }
    return commerce.transition(request.user!, body.orderId, { status: 'ASSIGNED_TO_DRIVER', driverId: body.driverId, note: 'Manually assigned' });
  });

  routes.get('/operations/drivers', { permissions: ['dispatch.manage'] }, (request) =>
    prisma.driverProfile.findMany({
      where: { active: true, ...(request.user!.merchantId ? { merchantId: request.user!.merchantId } : {}) },
      include: { user: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, status: true } } },
    }),
  );

  routes.get('/operations/incidents', { permissions: ['order.view'] }, () =>
    prisma.incident.findMany({ orderBy: { createdAt: 'desc' }, include: { author: true } }),
  );

  routes.post('/operations/incidents', { permissions: ['order.update'] }, (request) => {
    const body = validate<{ title: string; details: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }>(incidentSchema, request.body);
    return prisma.incident.create({ data: { ...body, authorId: request.user!.id } });
  });

  routes.get('/operations/shifts', { permissions: ['order.view'] }, () =>
    prisma.shiftNote.findMany({ orderBy: { createdAt: 'desc' }, include: { author: true } }),
  );

  routes.post('/operations/shifts', { permissions: ['order.update'] }, (request) => {
    const body = validate<{ note: string }>(shiftNoteSchema, request.body);
    return prisma.shiftNote.create({ data: { note: body.note, authorId: request.user!.id } });
  });

  routes.get('/merchant/tables', { permissions: ['order.view'] }, async (request) => {
    const rows = await prisma.diningTable.findMany({
      where: { merchantId: request.user!.merchantId ?? undefined, deletedAt: null },
      include: {
        floor: true,
        qrCodes: { where: { active: true }, take: 1 },
        orders: {
          where: { status: { notIn: ['DELIVERED', 'CANCELLED', 'REFUNDED'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { items: { select: { quantity: true } } },
        },
      },
      orderBy: { number: 'asc' },
    });
    return rows.map((table) => {
      const order = table.orders[0];
      return {
        id: table.id,
        name: table.name,
        number: table.number,
        capacity: table.capacity,
        status: table.status,
        active: table.active,
        branchId: table.branchId,
        floor: { id: table.floor.id, name: loc(table.floor.name) },
        qrCode: table.qrCodes[0]?.code ?? null,
        order: order
          ? {
              id: order.id,
              number: order.number,
              status: order.status,
              total: dec(order.total),
              itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
            }
          : null,
      };
    });
  });

  routes.post('/merchant/floors', { permissions: ['table.manage'] }, (request) => {
    const user = request.user!;
    const body = validate<{ name: { en: string; ar: string } }>(floorSchema, request.body);
    if (!user.merchantId) throw badRequest('Merchant account required');
    return prisma.floor.create({ data: { merchantId: user.merchantId, name: body.name } });
  });

  routes.post('/merchant/tables', { permissions: ['table.manage'] }, async (request) => {
    const user = request.user!;
    const body = validate<{ floorId: string; name: string; number: string; capacity: number; active?: boolean }>(tableSchema, request.body);
    if (!user.merchantId) throw badRequest('Merchant account required');
    await platform.assertFeature(user.merchantId, 'tableOrdering', 'Table ordering');
    await platform.assertMerchantLimit(user.merchantId, 'tableCountLimit');
    const table = await prisma.diningTable.create({
      data: { merchantId: user.merchantId, floorId: body.floorId, name: body.name, number: body.number, capacity: body.capacity, active: body.active ?? true },
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('Unique constraint')) throw badRequest('A table with this number already exists');
      throw error;
    });
    const code = `TBL${table.number}${table.id.slice(0, 4)}`.toUpperCase();
    await prisma.qrCode.create({ data: { code, type: 'TABLE', merchantId: user.merchantId, tableId: table.id } });
    return prisma.diningTable.findUnique({ where: { id: table.id }, include: { qrCodes: true } });
  });

  routes.patch('/merchant/tables/:id', { permissions: ['table.manage'] }, async (request) => {
    const user = request.user!;
    const id = param(request, 'id');
    const body = validate<{ floorId?: string; name?: string; number?: string; capacity?: number; active?: boolean }>(tableUpdateSchema, request.body);
    if (!user.merchantId) throw badRequest('Merchant account required');
    const existing = await prisma.diningTable.findFirst({ where: { id, merchantId: user.merchantId, deletedAt: null } });
    if (!existing) throw badRequest('Table not found');
    if (body.floorId) {
      const floor = await prisma.floor.findFirst({ where: { id: body.floorId, merchantId: user.merchantId } });
      if (!floor) throw badRequest('Zone not found');
    }
    try {
      return await prisma.diningTable.update({
        where: { id },
        data: {
          name: body.name,
          number: body.number,
          capacity: body.capacity,
          floorId: body.floorId,
          active: body.active,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('Unique constraint')) throw badRequest('A table with this number already exists');
      throw error;
    }
  });

  routes.post('/merchant/tables/:id/status', (request) => {
    const user = request.user!;
    // Floor staff seat and clear tables; only managers add or edit them.
    if (!user.permissions.includes('table.manage') && !user.permissions.includes('order.update')) throw forbidden('Missing permission');
    const body = validate<{ status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'INACTIVE' }>(tableStatusSchema, request.body);
    return prisma.diningTable.updateMany({ where: { id: param(request, 'id'), merchantId: request.user!.merchantId ?? undefined }, data: { status: body.status } });
  });

  routes.get('/customers/me', async (request) => {
    const customer = await prisma.customer.findUnique({ where: { userId: request.user!.id }, include: { addresses: true, favourites: true, paymentMethods: true } });
    if (!customer) return null;
    return { ...customer, rewardAvailable: await customerRewardAvailable(prisma, customer.id, customer.rewardBalance) };
  });

  routes.get('/customers/me/wallet', (request) => customerWallet(prisma, request.user!.id));

  routes.post('/customers/me/wallet/withdrawals', async (request) => {
    const user = request.user!;
    const body = request.body as { amount?: unknown };
    const created = await requestCustomerWithdrawal(prisma, user.id, body.amount);
    await audit.log({ actorId: user.id, action: 'customer.withdrawal.request', entityType: 'CustomerWithdrawal', entityId: created.id, metadata: { amount: created.amount } });
    return created;
  });

  routes.post('/customers/me/favourites/:merchantId', async (request) => {
    const merchantId = param(request, 'merchantId');
    const customer = await prisma.customer.findUniqueOrThrow({ where: { userId: request.user!.id } });
    return prisma.favourite.upsert({ where: { customerId_merchantId: { customerId: customer.id, merchantId } }, update: {}, create: { customerId: customer.id, merchantId } });
  });

  routes.delete('/customers/me/favourites/:merchantId', async (request) => {
    const customer = await prisma.customer.findUniqueOrThrow({ where: { userId: request.user!.id } });
    await prisma.favourite.deleteMany({ where: { customerId: customer.id, merchantId: param(request, 'merchantId') } });
    return { ok: true };
  });

  routes.post('/customers/me/delete', async (request) => {
    const user = request.user!;
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED', deletedAt: new Date() } });
    await prisma.customer.updateMany({ where: { userId: user.id }, data: { deletedAt: new Date() } });
    await audit.log({ actorId: user.id, action: 'customer.delete', entityType: 'User', entityId: user.id });
    return { ok: true };
  });

  routes.post('/payments/webhooks/:provider', { public: true }, async (request) => {
    const provider = param(request, 'provider');
    const body = request.body as { externalId?: string; orderId?: string };
    const signature = request.query.signature as string;
    const gatewaySecret = provider === 'benefit' ? process.env.BENEFIT_WEBHOOK_SECRET : provider === 'paypal' ? process.env.PAYPAL_WEBHOOK_SECRET : process.env.TAP_WEBHOOK_SECRET;
    const raw = Buffer.from(JSON.stringify(body));
    const { createHmac, timingSafeEqual } = await import('crypto');
    const digest = createHmac('sha256', gatewaySecret ?? 'dev').update(raw).digest('hex');
    const valid = signature && digest.length === signature.length && timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
    if (!valid) throw badRequest('Invalid webhook signature');
    const externalId = body.externalId ?? `${provider}-missing`;
    try {
      await prisma.webhookEvent.create({ data: { provider, externalId, payload: body } });
    } catch {
      return { ok: true, duplicate: true };
    }
    if (body.orderId) {
      await prisma.payment.updateMany({ where: { orderId: body.orderId, externalId }, data: { status: 'CAPTURED' } });
    }
    return { ok: true };
  });

  routes.post('/uploads', { before: [singleFile] }, async (request) => {
    const user = request.user!;
    const file = request.file;
    if (!file) throw badRequest('File is required');
    if (!ALLOWED_UPLOAD_TYPES.has(file.mimetype) || file.size > MAX_UPLOAD_BYTES) {
      throw badRequest('File type or size is not allowed');
    }
    const saved = await createStorageProvider().save({ filename: `upload${extensionFor(file.mimetype)}`, mimeType: file.mimetype, bytes: file.buffer });
    return prisma.storedFile.create({
      data: { ownerId: user.id, merchantId: user.merchantId, filename: file.originalname.replace(/[^a-zA-Z0-9._-]/g, ''), mimeType: file.mimetype, sizeBytes: file.size, url: saved.url },
    });
  });

  routes.get('/business-categories', { public: true }, () =>
    prisma.businessCategory.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
  );

  routes.get('/service-areas', { public: true }, () => prisma.serviceArea.findMany({ where: { active: true } }));

  async function merchantDetail(id: string) {
    await platform.expireDueSubscription(id);
    const merchant = await prisma.merchant.findUnique({
      where: { id },
      include: {
        branches: { include: { manager: { select: { id: true, firstName: true, lastName: true } } } },
        documents: true,
        hours: true,
        bankAccounts: true,
        subscription: { include: { plan: { include: { entitlements: true } } } },
        categories: { include: { category: true } },
        referral: { include: { marketingUser: { select: { firstName: true, lastName: true } } } },
        deliverySettings: { where: { active: true }, select: { maxRadiusKm: true, serviceAreaId: true, active: true } },
      },
    });
    if (!merchant) throw badRequest('Merchant not found');
    const charges = merchantOrderCharges(merchant.orderCharges);
    const { referral, deliverySettings, ...merchantRest } = merchant;
    const setupMissing = businessSetupGaps(merchant);
    return {
      ...merchantRest,
      // Done only when the store finished setup and nothing required is missing now. Older stores
      // were marked done before every requirement existed, so their data decides.
      businessSetupCompleted: merchant.businessSetupCompleted && setupMissing.length === 0,
      /** The store went through setup before; the popup then only asks for what is missing. */
      businessSetupSaved: merchant.businessSetupCompleted,
      setupMissing,
      detailedDeliveryPricing: detailedDeliveryPricing({ deliverySettings }),
      referral: referral
        ? { code: referral.codeUsed, staffName: `${referral.marketingUser.firstName} ${referral.marketingUser.lastName}`.trim() }
        : null,
      name: loc(merchant.name),
      description: loc(merchant.description),
      minimumOrder: dec(merchant.minimumOrder),
      freeDeliveryKm: dec(merchant.freeDeliveryKm),
      baseDeliveryKm: dec(merchant.baseDeliveryKm),
      baseDeliveryFee: dec(merchant.baseDeliveryFee),
      beyondFreeDeliveryFee: dec(merchant.beyondFreeDeliveryFee),
      beyondDeliveryFeeMode: merchant.beyondDeliveryFeeMode,
      maxDeliveryKm: dec(merchant.maxDeliveryKm),
      orderCharges: { serviceFee: charges.serviceFee, taxCharge: charges.tax },
      bankAccounts: merchant.bankAccounts.map(({ ibanCipher, ...account }) => ({ ...account, iban: mask(crypto.decrypt(ibanCipher)) })),
      subscription: merchant.subscription ? { ...merchant.subscription, plan: platform.presentPlan(merchant.subscription.plan) } : null,
    };
  }

  async function products(user: RequestUser) {
    const rows = await prisma.product.findMany({
      where: { deletedAt: null, ...(user.merchantId ? { merchantId: user.merchantId } : {}) },
      include: { category: true, catalogProduct: true, variants: true, inventory: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((product) => ({
      id: product.id,
      name: loc(product.catalogProduct?.name ?? product.name),
      description: loc(product.catalogProduct?.description ?? product.description),
      price: dec(product.price),
      compareAtPrice: product.compareAtPrice ? dec(product.compareAtPrice) : null,
      imageUrl: product.imageUrl || product.catalogProduct?.imageUrl || null,
      catalogProductId: product.catalogProductId,
      reviewStatus: product.catalogProduct?.status ?? 'APPROVED',
      approvalStatus: product.approvalStatus,
      available: product.available,
      stock: product.inventory.reduce((sum, row) => sum + row.quantity, 0),
      categoryId: product.categoryId,
      category: loc(product.category.name),
    }));
  }

  async function storeManagerId(merchantId: string, userId: string) {
    const manager = await prisma.user.findFirst({
      where: {
        id: userId,
        merchantId,
        deletedAt: null,
        status: 'ACTIVE',
        userRoles: { some: { role: { key: 'MERCHANT_MANAGER' } } },
      },
    });
    if (!manager) throw badRequest('Choose an active store manager');
    return manager.id;
  }

  async function guardStaff(actor: RequestUser, userId: string) {
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw badRequest('Staff member not found');
    if (actor.merchantId && target.merchantId !== actor.merchantId) throw badRequest('Cross-merchant access is not allowed');
  }

  return routes;
}

function mask(iban: string) {
  return `${iban.slice(0, 4)}••••${iban.slice(-4)}`;
}

function catalogStatus(row: { approvalStatus: string; available: boolean; stock: number }) {
  if (row.approvalStatus !== 'APPROVED') return 'draft';
  if (!row.available || row.stock <= 0) return 'out';
  return 'active';
}

function csvCell(value: string | number) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function decimalSetting(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return undefined;
  return number.toFixed(3);
}

/** Whole minutes from 1 to 240. Anything else is refused so a typo cannot push every delivery estimate out by hours. */
function preparationSetting(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) throw badRequest('Preparation time must be between 1 and 240 minutes');
  return minutes;
}

function presentMerchantPromo(row: {
  id: string;
  code: string;
  description: unknown;
  discountType: 'FIXED' | 'PERCENTAGE';
  discountValue: { toFixed: (digits: number) => string };
  minimumOrder: { toFixed: (digits: number) => string } | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  startsAt: Date;
  endsAt: Date;
  firstOrderOnly: boolean;
  active: boolean;
  _count: { redemptions: number };
}) {
  return {
    id: row.id,
    code: row.code,
    description: loc(row.description),
    discountType: row.discountType,
    discountValue: dec(row.discountValue),
    minimumOrder: row.minimumOrder ? dec(row.minimumOrder) : null,
    usageLimit: row.usageLimit,
    perCustomerLimit: row.perCustomerLimit,
    usedCount: row._count.redemptions,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    firstOrderOnly: row.firstOrderOnly,
    active: row.active,
  };
}
