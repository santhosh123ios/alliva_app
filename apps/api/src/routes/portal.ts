import * as argon2 from 'argon2';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import {
  addressSchema,
  assignSubscriptionSchema,
  bankSchema,
  branchSchema,
  categorySchema,
  closureSchema,
  complaintSchema,
  complaintUpdateSchema,
  dispatchSchema,
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
  promoSchema,
  refundDecisionSchema,
  reportQuerySchema,
  rolePermissionsSchema,
  settingsSchema,
  subscriptionQuoteSchema,
  settlementDecisionSchema,
  shiftNoteSchema,
  staffSchema,
  tableSchema,
  tableUpdateSchema,
} from '@alliva/validation';
import { dec, loc } from '../common/crypto';
import { badRequest } from '../common/errors';
import { RequestUser, scopedMerchantId, validate } from '../common/http';
import { createRoutes } from '../common/routes';
import type { Container } from '../container';
import type { PlatformService } from '../modules/platform.service';
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from '../providers/interfaces';
import { extensionFor, LocalStorageProvider, S3StorageProvider } from '../providers/mock.providers';

type OrderStatusChange = { status: 'ACCEPTED' | 'PREPARING' | 'READY_FOR_PICKUP' | 'ASSIGNED_TO_DRIVER' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED'; note?: string; preparationMinutes?: number; driverId?: string; cancellationReason?: string };

const upload = multer({ storage: multer.memoryStorage() }).single('file');

function singleFile(request: Request, response: Response, next: NextFunction) {
  upload(request, response, (error: unknown) => {
    if (error) return next(badRequest(error instanceof Error ? error.message : 'Upload failed'));
    next();
  });
}

export function portalRoutes({ prisma, jwt, crypto, audit, platform, commerce, marketing }: Container) {
  const routes = createRoutes({ jwt, prisma }, 'Platform');
  const param = (request: Request, name: string) => request.params[name] as string;

  routes.get('/admin/dashboard', { permissions: ['order.view'] }, () => platform.adminDashboard());

  routes.get('/merchant/dashboard', { permissions: ['order.view'] }, (request) => {
    const user = request.user!;
    if (!user.merchantId) throw badRequest('Merchant account required');
    return platform.merchantDashboard(user.merchantId);
  });

  routes.get('/health', { public: true }, () => ({ ok: true, service: 'alliva-api', currency: 'BHD', timezone: 'Asia/Bahrain' }));

  routes.get('/public/plans', { public: true }, async () => {
    const plans = await platform.listPlans();
    return plans.filter((plan) => plan.status === 'ACTIVE');
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
    }>(merchantRegistrationSchema, request.body);
    const email = body.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
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
    const created = await prisma
      .$transaction(async (tx) => {
        const owner = await tx.user.create({
          data: { email, passwordHash, firstName: body.firstName, lastName: body.lastName, phone: body.phone, kind: 'MERCHANT_USER', status: 'ACTIVE' },
        });
        const merchant = await tx.merchant.create({
          data: {
            slug,
            name: { en: body.businessName, ar: body.businessNameAr?.trim() || body.businessName },
            description: { en: body.businessName, ar: body.businessNameAr?.trim() || body.businessName },
            businessType: body.businessType,
            phone: body.phone,
            email,
            websiteUrl: body.website.trim(),
            registrationPromo: promo?.valid ? promo.code : null,
            status: 'PENDING_APPROVAL',
            createdById: owner.id,
            categories: body.categoryId ? { create: { categoryId: body.categoryId } } : undefined,
            branches: { create: { name: { en: body.city, ar: body.city }, line1: body.city, city: body.city, latitude: '26.228500', longitude: '50.586000' } },
          },
        });
        await tx.user.update({ where: { id: owner.id }, data: { merchantId: merchant.id } });
        await tx.userRole.create({ data: { userId: owner.id, roleId: role.id, merchantId: merchant.id } });
        if (referral) await marketing.referrals.attribute(tx, { merchantId: merchant.id, resolved: referral, source: 'SIGNUP', actorId: owner.id, contact: { phone: body.phone, email }, merchantName: body.businessName });
        if (promo?.valid) await marketing.promos.reserve(tx, { merchantId: merchant.id, promoCodeId: promo.promoCodeId });
        return { owner, merchant };
      })
      .catch((error: unknown) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw badRequest('An account with this email already exists');
        throw error;
      });
    await platform.assignSubscription(created.merchant.id, body.planId, body.billingInterval, created.owner.id, false);
    await audit.log({ actorId: created.owner.id, action: 'merchant.register', entityType: 'Merchant', entityId: created.merchant.id, metadata: { referralCode: referral?.code ?? null, promoCode: promo?.valid ? promo.code : null } });
    return { id: created.merchant.id, slug };
  });

  routes.post('/public/subscription-quote', { public: true, throttle: 30 }, async (request) => {
    const body = validate<{ planId: string; billingInterval: 'MONTHLY' | 'ANNUAL'; promoCode?: string; referralCode?: string }>(subscriptionQuoteSchema, request.body);
    const { gross } = await marketing.promos.planPrice(body.planId, body.billingInterval);
    const promo = body.promoCode?.trim() ? await marketing.promos.quote({ code: body.promoCode, planId: body.planId, interval: body.billingInterval }) : null;
    const referral = body.referralCode?.trim() ? await marketing.referrals.validate(body.referralCode) : null;
    return {
      gross,
      discount: promo?.valid ? promo.discount : '0.000',
      payable: promo?.valid ? promo.payable : gross,
      promo: promo ? (promo.valid ? { valid: true, code: promo.code } : { valid: false, reason: promo.reason }) : null,
      referral: referral ? (referral.valid ? { valid: true, code: referral.code, staffName: referral.staffName } : { valid: false, reason: referral.reason }) : null,
    };
  });

  routes.get('/admin/merchants', { permissions: ['merchant.view'] }, async (request) => {
    const status = request.query.status as string | undefined;
    const rows = await prisma.merchant.findMany({
      where: { deletedAt: null, ...(status ? { status: status as never } : {}) },
      include: { branches: true, subscription: { include: { plan: true } }, categories: { include: { category: true } } },
      orderBy: { createdAt: 'desc' },
    });
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
    const merchant = await prisma.merchant.update({ where: { id }, data: { status: 'ACTIVE', updatedById: user.id } });
    await audit.log({ actorId: user.id, action: 'merchant.approve', entityType: 'Merchant', entityId: id });
    return merchant;
  });

  routes.post('/admin/merchants/:id/suspend', { permissions: ['merchant.suspend'] }, async (request) => {
    const user = request.user!;
    const id = param(request, 'id');
    const merchant = await prisma.merchant.update({ where: { id }, data: { status: 'SUSPENDED', updatedById: user.id } });
    await audit.log({ actorId: user.id, action: 'merchant.suspend', entityType: 'Merchant', entityId: id });
    return merchant;
  });

  routes.get('/admin/merchants/:id', { permissions: ['merchant.view'] }, (request) => merchantDetail(param(request, 'id')));

  routes.get('/merchant/profile', (request) => {
    const user = request.user!;
    if (!user.merchantId) throw badRequest('Merchant account required');
    return merchantDetail(user.merchantId);
  });

  routes.patch('/merchant/profile', async (request) => {
    const user = request.user!;
    const body = request.body as Record<string, unknown>;
    const merchantId = scopedMerchantId(user, typeof body.merchantId === 'string' ? body.merchantId : undefined);
    if (!merchantId) throw badRequest('Merchant required');
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
        beyondFreeDeliveryFee: decimalSetting(body.beyondFreeDeliveryFee),
        maxDeliveryKm: decimalSetting(body.maxDeliveryKm),
        preparationMinutes: body.preparationMinutes ? Number(body.preparationMinutes) : undefined,
        deliveryEnabled: typeof body.delivery === 'boolean' ? body.delivery : undefined,
        takeawayEnabled: typeof body.takeaway === 'boolean' ? body.takeaway : undefined,
        dineInEnabled: typeof body.dineIn === 'boolean' ? body.dineIn : undefined,
        availability: body.availability === 'OPEN' || body.availability === 'CLOSED' || body.availability === 'BUSY' ? body.availability : undefined,
        temporaryClosedUntil: body.availability === 'CLOSED' ? new Date(Date.now() + 86_400_000) : body.availability === 'OPEN' || body.availability === 'BUSY' ? null : undefined,
        logoUrl: typeof body.logoUrl === 'string' ? body.logoUrl || null : undefined,
        coverUrl: typeof body.coverUrl === 'string' ? body.coverUrl || null : undefined,
        updatedById: user.id,
      },
    });
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

  routes.post('/merchant/closures', (request) => {
    const user = request.user!;
    const body = validate<{ reason: string; until: string }>(closureSchema, request.body);
    if (!user.merchantId) throw badRequest('Merchant account required');
    return prisma.merchant.update({
      where: { id: user.merchantId },
      data: { temporaryClosedUntil: new Date(body.until), closureReason: body.reason, updatedById: user.id },
    });
  });

  routes.post('/merchant/branches', async (request) => {
    const user = request.user!;
    const body = validate<{ name: { en: string; ar: string }; line1: string; city: string; latitude: string; longitude: string; phone?: string; managerId?: string }>(branchSchema, request.body);
    if (!user.merchantId) throw badRequest('Merchant account required');
    await platform.assertMerchantLimit(user.merchantId, 'branchLimit');
    const managerId = body.managerId ? await storeManagerId(user.merchantId, body.managerId) : undefined;
    return prisma.branch.create({
      data: { merchantId: user.merchantId, name: body.name, line1: body.line1, city: body.city, latitude: body.latitude, longitude: body.longitude, phone: body.phone, managerId, createdById: user.id },
    });
  });

  routes.patch('/merchant/branches/:id', async (request) => {
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

  routes.post('/merchant/hours', async (request) => {
    const user = request.user!;
    const body = validate<{ hours: { dayOfWeek: number; opensAt: string; closesAt: string; closed: boolean }[] }>(hoursSchema, request.body);
    if (!user.merchantId) throw badRequest('Merchant account required');
    await prisma.operatingHour.deleteMany({ where: { merchantId: user.merchantId } });
    await prisma.operatingHour.createMany({ data: body.hours.map((hour) => ({ ...hour, merchantId: user.merchantId! })) });
    return { ok: true };
  });

  routes.post('/merchant/bank', (request) => {
    const user = request.user!;
    const body = validate<{ bankName: string; accountName: string; iban: string }>(bankSchema, request.body);
    if (!user.merchantId) throw badRequest('Merchant account required');
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

  routes.get('/merchant/invoices', async (request) => {
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

  routes.get('/catalog/categories', (request) =>
    prisma.productCategory.findMany({
      where: { merchantId: request.user!.merchantId ?? undefined, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
  );

  routes.post('/catalog/categories', (request) => {
    const user = request.user!;
    const body = validate<{ name: { en: string; ar: string }; sortOrder?: number }>(categorySchema, request.body);
    if (!user.merchantId) throw badRequest('Merchant account required');
    return prisma.productCategory.create({ data: { merchantId: user.merchantId, name: body.name, sortOrder: body.sortOrder ?? 0 } });
  });

  routes.get('/catalog/products', (request) => products(request.user!));

  routes.post('/catalog/products', async (request) => {
    const user = request.user!;
    const body = validate<{ categoryId: string; name: { en: string; ar: string }; description: { en: string; ar: string }; price: string; compareAtPrice?: string | null; imageUrl?: string | null; available?: boolean; stockQuantity?: number; lowStockThreshold?: number; variants?: { name: { en: string; ar: string }; price: string; available?: boolean }[]; addonGroupIds?: string[]; approvalStatus?: 'DRAFT' | 'PENDING' | 'APPROVED' }>(productSchema, request.body);
    if (!user.merchantId) throw badRequest('Merchant account required');
    await platform.assertMerchantLimit(user.merchantId, 'productLimit');
    const branch = await prisma.branch.findFirst({ where: { merchantId: user.merchantId } });
    if (!branch) throw badRequest('Create a branch first');
    const product = await prisma.product.create({
      data: {
        merchantId: user.merchantId,
        categoryId: body.categoryId,
        slug: slugify(body.name.en),
        name: body.name,
        description: body.description,
        price: body.price,
        compareAtPrice: body.compareAtPrice,
        imageUrl: body.imageUrl,
        available: body.available ?? true,
        approvalStatus: body.approvalStatus ?? 'PENDING',
        createdById: user.id,
        variants: { create: (body.variants ?? []).map((variant) => ({ merchantId: user.merchantId!, name: variant.name, price: variant.price, available: variant.available ?? true })) },
        addonGroups: { create: (body.addonGroupIds ?? []).map((addonGroupId) => ({ addonGroupId })) },
        inventory: { create: { merchantId: user.merchantId, branchId: branch.id, quantity: body.stockQuantity ?? 20, lowStockThreshold: body.lowStockThreshold ?? 5 } },
      },
    });
    return product;
  });

  routes.patch('/catalog/products/:id', async (request) => {
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
    await prisma.product.update({
      where: { id },
      data: {
        categoryId: body.categoryId,
        name: body.name,
        description: body.description,
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

  routes.post('/catalog/offers', async (request) => {
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

  routes.get('/catalog/products/export', async (request, response) => {
    const rows = await products(request.user!);
    const csv = ['name,price,stock,status', ...rows.map((row) => `"${row.name.en}",${row.price},${row.stock},${row.approvalStatus}`)].join('\n');
    response.setHeader('Content-Type', 'text/csv');
    response.send(csv);
  });

  routes.post('/admin/products/:id/approve', { permissions: ['catalog.moderate'] }, (request) =>
    prisma.product.update({ where: { id: param(request, 'id') }, data: { approvalStatus: 'APPROVED' } }),
  );

  routes.post('/orders/:id/transition', (request) => commerce.transition(request.user!, param(request, 'id'), request.body as OrderStatusChange));

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

  // Merchant promo codes (customer discounts). Platform subscription promo codes live under /marketing/promos.
  routes.get('/promos', { permissions: ['promo.manage'] }, (request) => {
    if (!request.user?.merchantId) throw badRequest('Subscription promo codes are managed under Marketing');
    return prisma.promoCode.findMany({ where: { deletedAt: null, merchantId: request.user.merchantId, purpose: 'ORDER' }, include: { redemptions: true } });
  });

  routes.post('/promos', { permissions: ['promo.manage'] }, async (request) => {
    const user = request.user!;
    if (!user.merchantId) throw badRequest('Subscription promo codes are managed under Marketing');
    await platform.assertOptionalFeature(user.merchantId, 'merchantPromoCodes', 'Merchant promo codes');
    const body = validate<Record<string, unknown>>(promoSchema, request.body);
    return prisma.promoCode.create({
      data: {
        code: String(body.code).toUpperCase(),
        description: body.description as object,
        scope: body.scope as 'GLOBAL' | 'MERCHANT',
        merchantId: (body.merchantId as string | null) ?? user.merchantId,
        discountType: body.discountType as 'FIXED' | 'PERCENTAGE',
        discountValue: String(body.discountValue),
        maxDiscount: body.maxDiscount ? String(body.maxDiscount) : null,
        minimumOrder: body.minimumOrder ? String(body.minimumOrder) : null,
        usageLimit: (body.usageLimit as number | null) ?? null,
        perCustomerLimit: (body.perCustomerLimit as number | null) ?? null,
        startsAt: new Date(String(body.startsAt)),
        endsAt: new Date(String(body.endsAt)),
        firstOrderOnly: Boolean(body.firstOrderOnly),
        budget: body.budget ? String(body.budget) : null,
        categoryIds: body.categoryIds as object | undefined,
        merchantIds: body.merchantIds as object | undefined,
        createdById: user.id,
      },
    });
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
    for (const [key, value] of Object.entries(body.values)) {
      await prisma.platformSetting.upsert({ where: { key }, update: { value: value as object, updatedById: user.id }, create: { key, value: value as object, updatedById: user.id } });
    }
    await audit.log({ actorId: user.id, action: 'settings.update', entityType: 'PlatformSetting', metadata: body.values });
    return { ok: true };
  });

  routes.get('/audit', { permissions: ['audit.view'] }, () =>
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { actor: true } }),
  );

  routes.get('/operations/live', { permissions: ['dispatch.manage'] }, () =>
    commerce.listOrders({ status: { in: ['PENDING', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER', 'OUT_FOR_DELIVERY'] } }),
  );

  routes.post('/operations/dispatch', { permissions: ['dispatch.manage'] }, (request) => {
    const body = validate<{ orderId: string; driverId: string }>(dispatchSchema, request.body);
    return commerce.transition(request.user!, body.orderId, { status: 'ASSIGNED_TO_DRIVER', driverId: body.driverId, note: 'Manually assigned' });
  });

  routes.get('/operations/drivers', { permissions: ['dispatch.manage'] }, () =>
    prisma.driverProfile.findMany({ where: { active: true }, include: { user: true } }),
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

  routes.get('/merchant/tables', async (request) => {
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

  routes.post('/merchant/floors', (request) => {
    const user = request.user!;
    const body = validate<{ name: { en: string; ar: string } }>(floorSchema, request.body);
    if (!user.merchantId) throw badRequest('Merchant account required');
    return prisma.floor.create({ data: { merchantId: user.merchantId, name: body.name } });
  });

  routes.post('/merchant/tables', async (request) => {
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

  routes.patch('/merchant/tables/:id', async (request) => {
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
    const body = request.body as { status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'INACTIVE' };
    return prisma.diningTable.updateMany({ where: { id: param(request, 'id'), merchantId: request.user!.merchantId ?? undefined }, data: { status: body.status } });
  });

  routes.get('/customers/me', (request) =>
    prisma.customer.findUnique({ where: { userId: request.user!.id }, include: { addresses: true, favourites: true, paymentMethods: true } }),
  );

  routes.post('/customers/me/addresses', async (request) => {
    const body = validate<{ label: string; line1: string; line2?: string; city: string; latitude: string; longitude: string; instructions?: string; isDefault?: boolean }>(addressSchema, request.body);
    const customer = await prisma.customer.findUnique({ where: { userId: request.user!.id } });
    if (!customer) throw badRequest('Customer profile missing');
    return prisma.address.create({ data: { ...body, customerId: customer.id } });
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
    const gatewaySecret = provider === 'benefit' ? process.env.BENEFIT_WEBHOOK_SECRET : process.env.TAP_WEBHOOK_SECRET;
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
    const storage = process.env.STORAGE_DRIVER === 's3' ? new S3StorageProvider() : new LocalStorageProvider();
    const saved = await storage.save({ filename: `upload${extensionFor(file.mimetype)}`, mimeType: file.mimetype, bytes: file.buffer });
    return prisma.storedFile.create({
      data: { ownerId: user.id, merchantId: user.merchantId, filename: file.originalname.replace(/[^a-zA-Z0-9._-]/g, ''), mimeType: file.mimetype, sizeBytes: file.size, url: saved.url },
    });
  });

  routes.get('/business-categories', { public: true }, () =>
    prisma.businessCategory.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
  );

  routes.get('/service-areas', { public: true }, () => prisma.serviceArea.findMany({ where: { active: true } }));

  async function merchantDetail(id: string) {
    const merchant = await prisma.merchant.findUnique({
      where: { id },
      include: { branches: { include: { manager: { select: { id: true, firstName: true, lastName: true } } } }, documents: true, hours: true, bankAccounts: true, subscription: { include: { plan: { include: { entitlements: true } } } }, categories: { include: { category: true } } },
    });
    if (!merchant) throw badRequest('Merchant not found');
    return {
      ...merchant,
      name: loc(merchant.name),
      description: loc(merchant.description),
      minimumOrder: dec(merchant.minimumOrder),
      freeDeliveryKm: dec(merchant.freeDeliveryKm),
      beyondFreeDeliveryFee: dec(merchant.beyondFreeDeliveryFee),
      maxDeliveryKm: dec(merchant.maxDeliveryKm),
      bankAccounts: merchant.bankAccounts.map((account) => ({ ...account, iban: mask(crypto.decrypt(account.ibanCipher)) })),
      subscription: merchant.subscription ? { ...merchant.subscription, plan: platform.presentPlan(merchant.subscription.plan) } : null,
    };
  }

  async function products(user: RequestUser) {
    const rows = await prisma.product.findMany({
      where: { deletedAt: null, ...(user.merchantId ? { merchantId: user.merchantId } : {}) },
      include: { category: true, variants: true, inventory: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((product) => ({
      id: product.id,
      name: loc(product.name),
      description: loc(product.description),
      price: dec(product.price),
      compareAtPrice: product.compareAtPrice ? dec(product.compareAtPrice) : null,
      imageUrl: product.imageUrl,
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

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function decimalSetting(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return undefined;
  return number.toFixed(3);
}
