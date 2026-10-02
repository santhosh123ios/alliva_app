import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import type { Response } from 'express';
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
  marketingProfileSchema,
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
  settlementDecisionSchema,
  shiftNoteSchema,
  staffSchema,
  tableSchema,
  tableUpdateSchema,
} from '@alliva/validation';
import { AuditService } from '../common/audit';
import { CryptoService, dec, loc } from '../common/crypto';
import { CurrentUser, Public, RequirePermissions, RequestUser, scopedMerchantId, ZodValidationPipe } from '../common/http';
import { PrismaService } from '../prisma/prisma.service';
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from '../providers/interfaces';
import { extensionFor, LocalStorageProvider, S3StorageProvider } from '../providers/mock.providers';
import { CommerceService } from './commerce.service';
import { PlatformService } from './platform.service';

@ApiTags('Platform')
@Controller()
export class PortalController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlatformService) private readonly platform: PlatformService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
  ) {}

  @RequirePermissions('order.view')
  @Get('admin/dashboard')
  adminDashboard() {
    return this.platform.adminDashboard();
  }

  @RequirePermissions('order.view')
  @Get('merchant/dashboard')
  merchantDashboard(@CurrentUser() user: RequestUser) {
    if (!user.merchantId) throw new BadRequestException('Merchant account required');
    return this.platform.merchantDashboard(user.merchantId);
  }

  @Public()
  @Get('health')
  health() {
    return { ok: true, service: 'alliva-api', currency: 'BHD', timezone: 'Asia/Bahrain' };
  }

  @Public()
  @Get('public/plans')
  async publicPlans() {
    const plans = await this.platform.listPlans();
    return plans.filter((plan) => plan.status === 'ACTIVE');
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('public/merchant-registration')
  async registerMerchant(@Body(new ZodValidationPipe(merchantRegistrationSchema)) body: {
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
    delivery: boolean;
    takeaway: boolean;
  }) {
    const email = body.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException('An account with this email already exists');
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: body.planId } });
    if (!plan || plan.status !== 'ACTIVE') throw new BadRequestException('Choose an available plan');
    let promoCode: string | null = null;
    if (body.promoCode?.trim()) {
      const promo = await this.prisma.promoCode.findFirst({
        where: { code: { equals: body.promoCode.trim(), mode: 'insensitive' }, deletedAt: null, active: true },
      });
      const now = new Date();
      if (!promo || promo.startsAt > now || promo.endsAt < now) throw new BadRequestException('Promo code is not valid');
      promoCode = promo.code;
    }
    const role = await this.prisma.role.findUnique({ where: { key: 'MERCHANT_OWNER' } });
    if (!role) throw new BadRequestException('Merchant owner role is not configured');
    const slugBase = slugify(body.businessName) || 'merchant';
    let slug = slugBase;
    const taken = await this.prisma.merchant.findUnique({ where: { slug } });
    if (taken) slug = `${slugBase}-${Date.now().toString(36)}`;
    const owner = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(body.password),
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone,
        kind: 'MERCHANT_USER',
        status: 'ACTIVE',
      },
    });
    const merchant = await this.prisma.merchant.create({
      data: {
        slug,
        name: { en: body.businessName, ar: body.businessNameAr?.trim() || body.businessName },
        description: { en: body.businessName, ar: body.businessNameAr?.trim() || body.businessName },
        businessType: body.businessType,
        phone: body.phone,
        email,
        websiteUrl: body.website.trim(),
        registrationPromo: promoCode,
        status: 'PENDING_APPROVAL',
        createdById: owner.id,
        categories: body.categoryId ? { create: { categoryId: body.categoryId } } : undefined,
        branches: {
          create: {
            name: { en: body.city, ar: body.city },
            line1: body.city,
            city: body.city,
            latitude: '26.228500',
            longitude: '50.586000',
          },
        },
      },
    });
    await this.prisma.user.update({ where: { id: owner.id }, data: { merchantId: merchant.id } });
    await this.prisma.userRole.create({ data: { userId: owner.id, roleId: role.id, merchantId: merchant.id } });
    await this.platform.assignSubscription(merchant.id, body.planId, body.billingInterval, owner.id, false);
    await this.audit.log({ actorId: owner.id, action: 'merchant.register', entityType: 'Merchant', entityId: merchant.id, metadata: { promoCode } });
    return { id: merchant.id, slug };
  }

  @RequirePermissions('merchant.view')
  @Get('admin/merchants')
  async merchants(@Query('status') status?: string) {
    const rows = await this.prisma.merchant.findMany({
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
  }

  @RequirePermissions('merchant.create')
  @Post('admin/merchants')
  async createMerchant(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(merchantUpsertSchema)) body: Record<string, unknown>) {
    const slug = String(body.slug ?? slugify((body.name as { en: string }).en));
    const merchant = await this.prisma.merchant.create({
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
      await this.platform.assignSubscription(merchant.id, String(body.planId), (body.billingInterval as 'MONTHLY' | 'ANNUAL') ?? 'MONTHLY', user.id, false);
    }
    await this.audit.log({ actorId: user.id, action: 'merchant.create', entityType: 'Merchant', entityId: merchant.id });
    return merchant;
  }

  @RequirePermissions('merchant.approve')
  @Post('admin/merchants/:id/approve')
  async approve(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const merchant = await this.prisma.merchant.update({ where: { id }, data: { status: 'ACTIVE', updatedById: user.id } });
    await this.audit.log({ actorId: user.id, action: 'merchant.approve', entityType: 'Merchant', entityId: id });
    return merchant;
  }

  @RequirePermissions('merchant.suspend')
  @Post('admin/merchants/:id/suspend')
  async suspend(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const merchant = await this.prisma.merchant.update({ where: { id }, data: { status: 'SUSPENDED', updatedById: user.id } });
    await this.audit.log({ actorId: user.id, action: 'merchant.suspend', entityType: 'Merchant', entityId: id });
    return merchant;
  }

  @RequirePermissions('merchant.view')
  @Get('admin/merchants/:id')
  async merchantDetail(@Param('id') id: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id },
      include: { branches: { include: { manager: { select: { id: true, firstName: true, lastName: true } } } }, documents: true, hours: true, bankAccounts: true, subscription: { include: { plan: { include: { entitlements: true } } } }, categories: { include: { category: true } } },
    });
    if (!merchant) throw new BadRequestException('Merchant not found');
    return {
      ...merchant,
      name: loc(merchant.name),
      description: loc(merchant.description),
      minimumOrder: dec(merchant.minimumOrder),
      freeDeliveryKm: dec(merchant.freeDeliveryKm),
      beyondFreeDeliveryFee: dec(merchant.beyondFreeDeliveryFee),
      maxDeliveryKm: dec(merchant.maxDeliveryKm),
      bankAccounts: merchant.bankAccounts.map((account) => ({ ...account, iban: this.mask(this.crypto.decrypt(account.ibanCipher)) })),
      subscription: merchant.subscription ? { ...merchant.subscription, plan: this.platform.presentPlan(merchant.subscription.plan) } : null,
    };
  }

  @Get('merchant/profile')
  async myMerchant(@CurrentUser() user: RequestUser) {
    if (!user.merchantId) throw new BadRequestException('Merchant account required');
    return this.merchantDetail(user.merchantId);
  }

  @Patch('merchant/profile')
  async updateMerchant(@CurrentUser() user: RequestUser, @Body() body: Record<string, unknown>) {
    const merchantId = scopedMerchantId(user, typeof body.merchantId === 'string' ? body.merchantId : undefined);
    if (!merchantId) throw new BadRequestException('Merchant required');
    const merchant = await this.prisma.merchant.update({
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
        ? await this.prisma.branch.findFirst({ where: { id: branchId, merchantId } })
        : await this.prisma.branch.findFirst({ where: { merchantId }, orderBy: { createdAt: 'asc' } });
      if (typeof body.address === 'string' && branch) {
        await this.prisma.branch.update({ where: { id: branch.id }, data: { line1: body.address, city: typeof body.city === 'string' ? body.city : branch.city, updatedById: user.id } });
      }
      const latitude = Number(body.latitude);
      const longitude = Number(body.longitude);
      if (body.latitude != null && body.longitude != null && body.latitude !== '' && body.longitude !== '' && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
        if (!branch) throw new BadRequestException('Store location is not set up yet');
        await this.prisma.branch.update({
          where: { id: branch.id },
          data: { latitude: latitude.toFixed(6), longitude: longitude.toFixed(6), updatedById: user.id },
        });
      }
    }
    return merchant;
  }

  @Post('merchant/closures')
  async closeStore(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(closureSchema)) body: { reason: string; until: string }) {
    if (!user.merchantId) throw new BadRequestException('Merchant account required');
    return this.prisma.merchant.update({
      where: { id: user.merchantId },
      data: { temporaryClosedUntil: new Date(body.until), closureReason: body.reason, updatedById: user.id },
    });
  }

  @Post('merchant/branches')
  async addBranch(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(branchSchema)) body: { name: { en: string; ar: string }; line1: string; city: string; latitude: string; longitude: string; phone?: string; managerId?: string }) {
    if (!user.merchantId) throw new BadRequestException('Merchant account required');
    await this.platform.assertMerchantLimit(user.merchantId, 'branchLimit');
    const managerId = body.managerId ? await this.storeManagerId(user.merchantId, body.managerId) : undefined;
    return this.prisma.branch.create({
      data: { merchantId: user.merchantId, name: body.name, line1: body.line1, city: body.city, latitude: body.latitude, longitude: body.longitude, phone: body.phone, managerId, createdById: user.id },
    });
  }

  @Patch('merchant/branches/:id')
  async updateBranch(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() body: { managerId?: string | null }) {
    if (!user.merchantId) throw new BadRequestException('Merchant account required');
    const branch = await this.prisma.branch.findFirst({ where: { id, merchantId: user.merchantId } });
    if (!branch) throw new BadRequestException('Branch not found');
    const managerId = body.managerId ? await this.storeManagerId(user.merchantId, body.managerId) : null;
    return this.prisma.branch.update({
      where: { id: branch.id },
      data: { managerId, updatedById: user.id },
      include: { manager: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  @PutHours()
  @Post('merchant/hours')
  async hours(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(hoursSchema)) body: { hours: { dayOfWeek: number; opensAt: string; closesAt: string; closed: boolean }[] }) {
    if (!user.merchantId) throw new BadRequestException('Merchant account required');
    await this.prisma.operatingHour.deleteMany({ where: { merchantId: user.merchantId } });
    await this.prisma.operatingHour.createMany({ data: body.hours.map((hour) => ({ ...hour, merchantId: user.merchantId! })) });
    return { ok: true };
  }

  @Post('merchant/bank')
  async bank(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(bankSchema)) body: { bankName: string; accountName: string; iban: string }) {
    if (!user.merchantId) throw new BadRequestException('Merchant account required');
    return this.prisma.bankAccount.create({
      data: { merchantId: user.merchantId, bankName: body.bankName, accountName: body.accountName, ibanCipher: this.crypto.encrypt(body.iban) },
    });
  }

  @RequirePermissions('subscription.manage')
  @Get('admin/plans')
  plans() {
    return this.platform.listPlans();
  }

  @RequirePermissions('subscription.manage')
  @Get('admin/subscriptions')
  subscriptionBoard() {
    return this.platform.subscriptionBoard();
  }

  @RequirePermissions('subscription.manage')
  @Patch('admin/plans/:id')
  updatePlan(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body(new ZodValidationPipe(planSchema)) body: Parameters<PlatformService['updatePlan']>[1]) {
    return this.platform.updatePlan(id, body, user.id);
  }

  @RequirePermissions('subscription.manage')
  @Post('admin/plans')
  createPlan(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(planSchema)) body: Parameters<PlatformService['createPlan']>[0]) {
    return this.platform.createPlan(body, user.id);
  }

  @RequirePermissions('subscription.manage')
  @Post('admin/plans/reorder')
  reorderPlans(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(reorderPlansSchema)) body: { ids: string[] }) {
    return this.platform.reorderPlans(body.ids, user.id);
  }

  @RequirePermissions('subscription.manage')
  @Post('admin/plans/:id/duplicate')
  duplicatePlan(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.platform.duplicatePlan(id, user.id);
  }

  @RequirePermissions('subscription.manage')
  @Get('admin/merchants/:id/subscription/history')
  subscriptionHistory(@Param('id') id: string) {
    return this.platform.subscriptionHistory(id);
  }

  @RequirePermissions('subscription.manage')
  @Post('admin/merchants/:id/subscription')
  assignPlan(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignSubscriptionSchema)) body: { planId: string; billingInterval: 'MONTHLY' | 'ANNUAL'; markPaid?: boolean },
  ) {
    return this.platform.assignSubscription(id, body.planId, body.billingInterval, user.id, body.markPaid !== false);
  }

  @Get('merchant/subscription')
  subscription(@CurrentUser() user: RequestUser) {
    if (!user.merchantId) throw new BadRequestException('Merchant account required');
    return this.platform.entitlementUsage(user.merchantId);
  }

  @Get('merchant/invoices')
  async merchantInvoices(@CurrentUser() user: RequestUser) {
    if (!user.merchantId) throw new BadRequestException('Merchant account required');
    const rows = await this.prisma.invoice.findMany({
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
  }

  @RequirePermissions('staff.manage')
  @Get('staff')
  async staff(@CurrentUser() user: RequestUser) {
    const merchantId = scopedMerchantId(user);
    const rows = await this.prisma.user.findMany({
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
  }

  @RequirePermissions('staff.manage')
  @Post('staff')
  async createStaff(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(staffSchema)) body: { email: string; password: string; firstName: string; lastName: string; phone?: string; roleKey: string; merchantId?: string }) {
    const merchantId = scopedMerchantId(user, body.merchantId);
    if (merchantId) await this.platform.assertMerchantLimit(merchantId, 'staffLimit');
    const role = await this.prisma.role.findUnique({ where: { key: body.roleKey } });
    if (!role) throw new BadRequestException('Unknown role');
    const created = await this.prisma.user.create({
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
    await this.audit.log({ actorId: user.id, action: 'staff.create', entityType: 'User', entityId: created.id, metadata: { role: body.roleKey } });
    return { id: created.id };
  }

  @RequirePermissions('staff.manage')
  @Post('staff/:id/suspend')
  async suspendStaff(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.guardStaff(user, id);
    await this.prisma.user.update({ where: { id }, data: { status: 'SUSPENDED', updatedById: user.id } });
    await this.audit.log({ actorId: user.id, action: 'user.suspend', entityType: 'User', entityId: id });
    return { ok: true };
  }

  @RequirePermissions('staff.manage')
  @Post('staff/:id/activate')
  async activateStaff(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.guardStaff(user, id);
    await this.prisma.user.update({ where: { id }, data: { status: 'ACTIVE', updatedById: user.id } });
    await this.audit.log({ actorId: user.id, action: 'user.activate', entityType: 'User', entityId: id });
    return { ok: true };
  }

  @Get('roles')
  roles() {
    return this.prisma.role.findMany({ include: { permissions: { include: { permission: true } } } });
  }

  @RequirePermissions('staff.manage')
  @Patch('roles/:id/permissions')
  async setPermissions(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body(new ZodValidationPipe(rolePermissionsSchema)) body: { permissionKeys: string[] }) {
    const permissions = await this.prisma.permission.findMany({ where: { key: { in: body.permissionKeys } } });
    await this.prisma.rolePermission.deleteMany({ where: { roleId: id } });
    await this.prisma.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: id, permissionId: permission.id })) });
    await this.audit.log({ actorId: user.id, action: 'user.role_change', entityType: 'Role', entityId: id });
    return { ok: true };
  }

  @Get('catalog/categories')
  categories(@CurrentUser() user: RequestUser) {
    return this.prisma.productCategory.findMany({
      where: { merchantId: user.merchantId ?? undefined, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Post('catalog/categories')
  async createCategory(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(categorySchema)) body: { name: { en: string; ar: string }; sortOrder?: number }) {
    if (!user.merchantId) throw new BadRequestException('Merchant account required');
    return this.prisma.productCategory.create({ data: { merchantId: user.merchantId, name: body.name, sortOrder: body.sortOrder ?? 0 } });
  }

  @Get('catalog/products')
  async products(@CurrentUser() user: RequestUser) {
    const rows = await this.prisma.product.findMany({
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

  @Post('catalog/products')
  async createProduct(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(productSchema)) body: { categoryId: string; name: { en: string; ar: string }; description: { en: string; ar: string }; price: string; compareAtPrice?: string | null; imageUrl?: string | null; available?: boolean; stockQuantity?: number; lowStockThreshold?: number; variants?: { name: { en: string; ar: string }; price: string; available?: boolean }[]; addonGroupIds?: string[]; approvalStatus?: 'DRAFT' | 'PENDING' | 'APPROVED' }) {
    if (!user.merchantId) throw new BadRequestException('Merchant account required');
    await this.platform.assertMerchantLimit(user.merchantId, 'productLimit');
    const branch = await this.prisma.branch.findFirst({ where: { merchantId: user.merchantId } });
    if (!branch) throw new BadRequestException('Create a branch first');
    const product = await this.prisma.product.create({
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
  }

  @Patch('catalog/products/:id')
  async updateProduct(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body(new ZodValidationPipe(productUpdateSchema)) body: { categoryId?: string; name?: { en: string; ar: string }; description?: { en: string; ar: string }; price?: string; compareAtPrice?: string | null; imageUrl?: string | null; available?: boolean; approvalStatus?: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED'; stockQuantity?: number }) {
    if (!user.merchantId) throw new BadRequestException('Merchant account required');
    const existing = await this.prisma.product.findFirst({ where: { id, merchantId: user.merchantId, deletedAt: null } });
    if (!existing) throw new BadRequestException('Product not found');
    if (body.categoryId) {
      const category = await this.prisma.productCategory.findFirst({ where: { id: body.categoryId, merchantId: user.merchantId, deletedAt: null } });
      if (!category) throw new BadRequestException('Category not found');
    }
    await this.prisma.product.update({
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
      const items = await this.prisma.inventoryItem.findMany({ where: { productId: id, merchantId: user.merchantId } });
      if (!items.length) {
        const branch = await this.prisma.branch.findFirst({ where: { merchantId: user.merchantId } });
        if (!branch) throw new BadRequestException('Create a branch first');
        await this.prisma.inventoryItem.create({ data: { merchantId: user.merchantId, branchId: branch.id, productId: id, quantity: body.stockQuantity, lowStockThreshold: 5 } });
      } else if (body.stockQuantity === 0) {
        await this.prisma.inventoryItem.updateMany({ where: { productId: id, merchantId: user.merchantId }, data: { quantity: 0 } });
      } else {
        const first = items[0];
        if (first) await this.prisma.inventoryItem.update({ where: { id: first.id }, data: { quantity: body.stockQuantity } });
      }
    }
    return { ok: true };
  }

  @Post('catalog/offers')
  async createOffer(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(offerSchema)) body: { title: { en: string; ar: string }; productId?: string }) {
    if (!user.merchantId) throw new BadRequestException('Merchant account required');
    const offer = await this.prisma.offer.create({
      data: {
        merchantId: user.merchantId,
        title: body.title,
        active: true,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    if (body.productId) {
      const product = await this.prisma.product.findFirst({ where: { id: body.productId, merchantId: user.merchantId, deletedAt: null } });
      if (!product) throw new BadRequestException('Product not found');
      if (!product.compareAtPrice) {
        await this.prisma.product.update({ where: { id: product.id }, data: { compareAtPrice: product.price } });
      }
    }
    return offer;
  }

  @Get('catalog/products/export')
  async exportProducts(@CurrentUser() user: RequestUser, @Res() response: Response) {
    const rows = await this.products(user);
    const csv = ['name,price,stock,status', ...rows.map((row) => `"${row.name.en}",${row.price},${row.stock},${row.approvalStatus}`)].join('\n');
    response.setHeader('Content-Type', 'text/csv');
    response.send(csv);
  }

  @RequirePermissions('catalog.moderate')
  @Post('admin/products/:id/approve')
  approveProduct(@Param('id') id: string) {
    return this.prisma.product.update({ where: { id }, data: { approvalStatus: 'APPROVED' } });
  }

  @Post('orders/:id/transition')
  transition(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() body: { status: 'ACCEPTED' | 'PREPARING' | 'READY_FOR_PICKUP' | 'ASSIGNED_TO_DRIVER' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED'; note?: string; preparationMinutes?: number; driverId?: string; cancellationReason?: string }) {
    return this.commerce.transition(user, id, body);
  }

  @RequirePermissions('complaint.view')
  @Get('complaints')
  async complaints(@CurrentUser() user: RequestUser) {
    const rows = await this.prisma.complaint.findMany({
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
  }

  @Post('complaints')
  async createComplaint(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(complaintSchema)) body: { source: 'CUSTOMER' | 'MERCHANT' | 'DRIVER'; category: string; priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; subject: string; description: string; orderId?: string | null }) {
    return this.prisma.complaint.create({
      data: { ...body, reporterId: user.id, merchantId: user.merchantId, createdById: user.id },
    });
  }

  @RequirePermissions('complaint.manage')
  @Patch('complaints/:id')
  async updateComplaint(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body(new ZodValidationPipe(complaintUpdateSchema)) body: { status?: 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'ESCALATED' | 'RESOLVED' | 'CLOSED'; assigneeId?: string | null; priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; note?: string; internal?: boolean; satisfaction?: number; requestRefund?: boolean }) {
    const complaint = await this.prisma.complaint.update({
      where: { id },
      data: { status: body.status, assigneeId: body.assigneeId, priority: body.priority, satisfaction: body.satisfaction, updatedById: user.id },
    });
    if (body.note) {
      await this.prisma.complaintNote.create({ data: { complaintId: id, authorId: user.id, body: body.note, internal: body.internal ?? true } });
    }
    if (body.requestRefund && complaint.orderId) {
      await this.commerce.refund(user, complaint.orderId, '0.000', body.note ?? complaint.subject);
    }
    return complaint;
  }

  @RequirePermissions('payment.view')
  @Get('finance/payments')
  payments(@CurrentUser() user: RequestUser) {
    return this.prisma.payment.findMany({ where: user.merchantId ? { merchantId: user.merchantId } : {}, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  @RequirePermissions('finance.view')
  @Get('finance/ledger')
  ledger(@CurrentUser() user: RequestUser) {
    return this.prisma.ledgerEntry.findMany({ where: user.merchantId ? { merchantId: user.merchantId } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  @RequirePermissions('settlement.process')
  @Get('finance/settlements')
  settlements() {
    return this.prisma.settlement.findMany({ include: { lines: true, merchant: true }, orderBy: { createdAt: 'desc' } });
  }

  @RequirePermissions('settlement.process')
  @Post('finance/settlements/:id/decision')
  async decideSettlement(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body(new ZodValidationPipe(settlementDecisionSchema)) body: { decision: 'APPROVED' | 'REJECTED'; note?: string }) {
    const settlement = await this.prisma.settlement.update({ where: { id }, data: { status: body.decision, note: body.note, updatedById: user.id } });
    if (body.decision === 'APPROVED') {
      await this.prisma.ledgerEntry.create({
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
    await this.audit.log({ actorId: user.id, action: 'settlement.approve', entityType: 'Settlement', entityId: id });
    return settlement;
  }

  @RequirePermissions('refund.approve')
  @Post('finance/refunds/:id/decision')
  async decideRefund(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body(new ZodValidationPipe(refundDecisionSchema)) body: { decision: 'APPROVED' | 'REJECTED' }) {
    const refund = await this.prisma.refund.update({ where: { id }, data: { status: body.decision === 'APPROVED' ? 'PROCESSED' : 'REJECTED', updatedById: user.id } });
    if (body.decision === 'APPROVED') {
      await this.prisma.ledgerEntry.create({
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
      await this.prisma.order.update({ where: { id: refund.orderId }, data: { status: 'REFUNDED' } });
    }
    await this.audit.log({ actorId: user.id, action: 'refund.approve', entityType: 'Refund', entityId: id });
    return refund;
  }

  @RequirePermissions('promo.manage')
  @Get('promos')
  promos() {
    return this.prisma.promoCode.findMany({ where: { deletedAt: null }, include: { redemptions: true } });
  }

  @RequirePermissions('promo.manage')
  @Post('promos')
  async createPromo(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(promoSchema)) body: Record<string, unknown>) {
    if (user.merchantId) await this.platform.assertOptionalFeature(user.merchantId, 'merchantPromoCodes', 'Merchant promo codes');
    return this.prisma.promoCode.create({
      data: {
        code: String(body.code).toUpperCase(),
        description: body.description as object,
        scope: body.scope as 'GLOBAL' | 'MERCHANT',
        merchantId: (body.merchantId as string | null) ?? null,
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
  }

  @RequirePermissions('marketing.manage')
  @Get('marketing')
  async marketing() {
    const profiles = await this.prisma.marketingProfile.findMany({ include: { user: true, parent: true } });
    const referrals = await this.prisma.merchantReferral.findMany({ include: { merchant: true, marketingUser: true } });
    const commissions = await this.prisma.commissionEntry.findMany({ orderBy: { createdAt: 'desc' } });
    return { profiles, referrals, commissions };
  }

  @RequirePermissions('marketing.manage')
  @Post('marketing/profiles')
  profile(@Body(new ZodValidationPipe(marketingProfileSchema)) body: { userId: string; parentUserId?: string | null; staffCommissionPercent: string; headOverridePercent: string; renewalCommissionEnabled: boolean; maxCommission?: string | null }) {
    return this.prisma.marketingProfile.upsert({
      where: { userId: body.userId },
      update: body,
      create: { ...body, referralCode: `ALV${body.userId.slice(0, 6).toUpperCase()}` },
    });
  }

  @RequirePermissions('report.export')
  @Get('reports/overview')
  overview(@Query(new ZodValidationPipe(reportQuerySchema)) query: { from?: string; to?: string; merchantId?: string }, @CurrentUser() user: RequestUser) {
    const merchantId = scopedMerchantId(user, query.merchantId);
    return this.platform.report(query.from ? new Date(query.from) : undefined, query.to ? new Date(query.to) : undefined, merchantId);
  }

  @RequirePermissions('report.export')
  @Get('reports/export.csv')
  async csv(@Query('merchantId') merchantId: string | undefined, @CurrentUser() user: RequestUser, @Res() response: Response) {
    const csv = await this.platform.reportCsv(undefined, undefined, scopedMerchantId(user, merchantId));
    response.setHeader('Content-Type', 'text/csv');
    response.send(csv);
  }

  @RequirePermissions('report.export')
  @Get('reports/export.pdf')
  async pdf(@Query('merchantId') merchantId: string | undefined, @CurrentUser() user: RequestUser, @Res() response: Response) {
    const file = await this.platform.reportPdf(undefined, undefined, scopedMerchantId(user, merchantId));
    response.setHeader('Content-Type', 'application/pdf');
    response.send(file);
  }

  @RequirePermissions('settings.manage')
  @Get('settings')
  async settings() {
    const [values, categories, areas, delivery, freeDelivery, gateways, templates] = await Promise.all([
      this.prisma.platformSetting.findMany(),
      this.prisma.businessCategory.findMany(),
      this.prisma.serviceArea.findMany(),
      this.prisma.deliveryPricingRule.findMany(),
      this.prisma.freeDeliveryRule.findMany(),
      this.prisma.paymentGatewayConfig.findMany(),
      this.prisma.notificationTemplate.findMany(),
    ]);
    return { values, categories, areas, delivery, freeDelivery, gateways, templates };
  }

  @RequirePermissions('settings.manage')
  @Patch('settings')
  async updateSettings(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(settingsSchema)) body: { values: Record<string, unknown> }) {
    for (const [key, value] of Object.entries(body.values)) {
      await this.prisma.platformSetting.upsert({ where: { key }, update: { value: value as object, updatedById: user.id }, create: { key, value: value as object, updatedById: user.id } });
    }
    await this.audit.log({ actorId: user.id, action: 'settings.update', entityType: 'PlatformSetting', metadata: body.values });
    return { ok: true };
  }

  @RequirePermissions('audit.view')
  @Get('audit')
  auditLog() {
    return this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { actor: true } });
  }

  @RequirePermissions('dispatch.manage')
  @Get('operations/live')
  live() {
    return this.commerce.listOrders({ status: { in: ['PENDING', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER', 'OUT_FOR_DELIVERY'] } });
  }

  @RequirePermissions('dispatch.manage')
  @Post('operations/dispatch')
  dispatch(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(dispatchSchema)) body: { orderId: string; driverId: string }) {
    return this.commerce.transition(user, body.orderId, { status: 'ASSIGNED_TO_DRIVER', driverId: body.driverId, note: 'Manually assigned' });
  }

  @RequirePermissions('dispatch.manage')
  @Get('operations/drivers')
  drivers() {
    return this.prisma.driverProfile.findMany({ where: { active: true }, include: { user: true } });
  }

  @RequirePermissions('order.view')
  @Get('operations/incidents')
  incidents() {
    return this.prisma.incident.findMany({ orderBy: { createdAt: 'desc' }, include: { author: true } });
  }

  @RequirePermissions('order.update')
  @Post('operations/incidents')
  createIncident(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(incidentSchema)) body: { title: string; details: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }) {
    return this.prisma.incident.create({ data: { ...body, authorId: user.id } });
  }

  @RequirePermissions('order.view')
  @Get('operations/shifts')
  shifts() {
    return this.prisma.shiftNote.findMany({ orderBy: { createdAt: 'desc' }, include: { author: true } });
  }

  @RequirePermissions('order.update')
  @Post('operations/shifts')
  shift(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(shiftNoteSchema)) body: { note: string }) {
    return this.prisma.shiftNote.create({ data: { note: body.note, authorId: user.id } });
  }

  @Get('merchant/tables')
  async tables(@CurrentUser() user: RequestUser) {
    const rows = await this.prisma.diningTable.findMany({
      where: { merchantId: user.merchantId ?? undefined, deletedAt: null },
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
  }

  @Post('merchant/floors')
  floor(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(floorSchema)) body: { name: { en: string; ar: string } }) {
    if (!user.merchantId) throw new BadRequestException('Merchant account required');
    return this.prisma.floor.create({ data: { merchantId: user.merchantId, name: body.name } });
  }

  @Post('merchant/tables')
  async table(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(tableSchema)) body: { floorId: string; name: string; number: string; capacity: number; active?: boolean }) {
    if (!user.merchantId) throw new BadRequestException('Merchant account required');
    await this.platform.assertFeature(user.merchantId, 'tableOrdering', 'Table ordering');
    await this.platform.assertMerchantLimit(user.merchantId, 'tableCountLimit');
    const table = await this.prisma.diningTable.create({
      data: { merchantId: user.merchantId, floorId: body.floorId, name: body.name, number: body.number, capacity: body.capacity, active: body.active ?? true },
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('Unique constraint')) throw new BadRequestException('A table with this number already exists');
      throw error;
    });
    const code = `TBL${table.number}${table.id.slice(0, 4)}`.toUpperCase();
    await this.prisma.qrCode.create({ data: { code, type: 'TABLE', merchantId: user.merchantId, tableId: table.id } });
    return this.prisma.diningTable.findUnique({ where: { id: table.id }, include: { qrCodes: true } });
  }

  @Patch('merchant/tables/:id')
  async updateTable(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(tableUpdateSchema)) body: { floorId?: string; name?: string; number?: string; capacity?: number; active?: boolean },
  ) {
    if (!user.merchantId) throw new BadRequestException('Merchant account required');
    const existing = await this.prisma.diningTable.findFirst({ where: { id, merchantId: user.merchantId, deletedAt: null } });
    if (!existing) throw new BadRequestException('Table not found');
    if (body.floorId) {
      const floor = await this.prisma.floor.findFirst({ where: { id: body.floorId, merchantId: user.merchantId } });
      if (!floor) throw new BadRequestException('Zone not found');
    }
    try {
      return await this.prisma.diningTable.update({
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
      if (message.includes('Unique constraint')) throw new BadRequestException('A table with this number already exists');
      throw error;
    }
  }

  @Post('merchant/tables/:id/status')
  setTable(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() body: { status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'INACTIVE' }) {
    return this.prisma.diningTable.updateMany({ where: { id, merchantId: user.merchantId ?? undefined }, data: { status: body.status } });
  }

  @Get('customers/me')
  async meCustomer(@CurrentUser() user: RequestUser) {
    return this.prisma.customer.findUnique({ where: { userId: user.id }, include: { addresses: true, favourites: true, paymentMethods: true } });
  }

  @Post('customers/me/addresses')
  async address(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(addressSchema)) body: { label: string; line1: string; line2?: string; city: string; latitude: string; longitude: string; instructions?: string; isDefault?: boolean }) {
    const customer = await this.prisma.customer.findUnique({ where: { userId: user.id } });
    if (!customer) throw new BadRequestException('Customer profile missing');
    return this.prisma.address.create({ data: { ...body, customerId: customer.id } });
  }

  @Post('customers/me/favourites/:merchantId')
  async favourite(@CurrentUser() user: RequestUser, @Param('merchantId') merchantId: string) {
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { userId: user.id } });
    return this.prisma.favourite.upsert({ where: { customerId_merchantId: { customerId: customer.id, merchantId } }, update: {}, create: { customerId: customer.id, merchantId } });
  }

  @Delete('customers/me/favourites/:merchantId')
  async unfavourite(@CurrentUser() user: RequestUser, @Param('merchantId') merchantId: string) {
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { userId: user.id } });
    await this.prisma.favourite.deleteMany({ where: { customerId: customer.id, merchantId } });
    return { ok: true };
  }

  @Post('customers/me/delete')
  async deleteAccount(@CurrentUser() user: RequestUser) {
    await this.prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED', deletedAt: new Date() } });
    await this.prisma.customer.updateMany({ where: { userId: user.id }, data: { deletedAt: new Date() } });
    await this.audit.log({ actorId: user.id, action: 'customer.delete', entityType: 'User', entityId: user.id });
    return { ok: true };
  }

  @Public()
  @Post('payments/webhooks/:provider')
  async webhook(@Param('provider') provider: string, @Body() body: { externalId?: string; orderId?: string }, @Query('signature') signature: string) {
    const gatewaySecret = provider === 'benefit' ? process.env.BENEFIT_WEBHOOK_SECRET : process.env.TAP_WEBHOOK_SECRET;
    const raw = Buffer.from(JSON.stringify(body));
    const { createHmac, timingSafeEqual } = await import('crypto');
    const digest = createHmac('sha256', gatewaySecret ?? 'dev').update(raw).digest('hex');
    const valid = signature && digest.length === signature.length && timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
    if (!valid) throw new BadRequestException('Invalid webhook signature');
    const externalId = body.externalId ?? `${provider}-missing`;
    try {
      await this.prisma.webhookEvent.create({ data: { provider, externalId, payload: body } });
    } catch {
      return { ok: true, duplicate: true };
    }
    if (body.orderId) {
      await this.prisma.payment.updateMany({ where: { orderId: body.orderId, externalId }, data: { status: 'CAPTURED' } });
    }
    return { ok: true };
  }

  @Post('uploads')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@CurrentUser() user: RequestUser, @UploadedFile() file?: { mimetype: string; size: number; buffer: Buffer; originalname: string }) {
    if (!file) throw new BadRequestException('File is required');
    if (!ALLOWED_UPLOAD_TYPES.has(file.mimetype) || file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('File type or size is not allowed');
    }
    const storage = process.env.STORAGE_DRIVER === 's3' ? new S3StorageProvider() : new LocalStorageProvider();
    const saved = await storage.save({ filename: `upload${extensionFor(file.mimetype)}`, mimeType: file.mimetype, bytes: file.buffer });
    return this.prisma.storedFile.create({
      data: { ownerId: user.id, merchantId: user.merchantId, filename: file.originalname.replace(/[^a-zA-Z0-9._-]/g, ''), mimeType: file.mimetype, sizeBytes: file.size, url: saved.url },
    });
  }

  @Get('business-categories')
  @Public()
  businessCategories() {
    return this.prisma.businessCategory.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  }

  @Get('service-areas')
  @Public()
  areas() {
    return this.prisma.serviceArea.findMany({ where: { active: true } });
  }

  private async storeManagerId(merchantId: string, userId: string) {
    const manager = await this.prisma.user.findFirst({
      where: {
        id: userId,
        merchantId,
        deletedAt: null,
        status: 'ACTIVE',
        userRoles: { some: { role: { key: 'MERCHANT_MANAGER' } } },
      },
    });
    if (!manager) throw new BadRequestException('Choose an active store manager');
    return manager.id;
  }

  private async guardStaff(actor: RequestUser, userId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new BadRequestException('Staff member not found');
    if (actor.merchantId && target.merchantId !== actor.merchantId) throw new BadRequestException('Cross-merchant access is not allowed');
  }

  private mask(iban: string) {
    return `${iban.slice(0, 4)}••••${iban.slice(-4)}`;
  }
}

function PutHours(): MethodDecorator {
  return (_target, _key, descriptor) => descriptor;
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
