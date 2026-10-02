import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { FulfillmentType, OrderStatus } from '@alliva/types';
import { money, moneyString } from '../domain/money';
import { priceOrder, type PromoFacts } from '../domain/pricing';
import { assertTransition } from '../domain/order-machine';
import { assertFeatureAllowed, assertWithinLimit, commissionPercent, readEntitlement, suggestionMode } from '../domain/entitlements';
import { suggestedMerchants } from '../domain/subscriptions';
import { buildCaptureLedger, buildRefundLedger } from '../domain/ledger';
import { isOpenAt } from '../domain/hours';
import { dec, loc } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformService } from './platform.service';
import { BenefitGateway, MockPushProvider, TapGateway } from '../providers/mock.providers';
import { OrdersGateway } from './orders.gateway';

type CartRecord = NonNullable<Awaited<ReturnType<CommerceService['loadCartRecord']>>>;

@Injectable()
export class CommerceService {
  postgis: boolean | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TapGateway) private readonly tap: TapGateway,
    @Inject(BenefitGateway) private readonly benefit: BenefitGateway,
    @Inject(MockPushProvider) private readonly push: MockPushProvider,
    @Inject(OrdersGateway) private readonly gateway: OrdersGateway,
    @Inject(PlatformService) private readonly platform: PlatformService,
  ) {}

  async ensureGuest(tokenHash: string | null, create: () => Promise<{ id: string; token: string }>) {
    if (!tokenHash) return create();
    const guest = await this.prisma.guest.findUnique({ where: { tokenHash } });
    if (!guest) return create();
    return { id: guest.id, token: null as string | null };
  }

  async home(input: { lat?: string; lng?: string; q?: string; exclusiveSlug?: string | null; customerId?: string | null; guestId?: string | null }) {
    const entry = input.exclusiveSlug
      ? await this.prisma.merchant.findFirst({
          where: { slug: input.exclusiveSlug, deletedAt: null, status: 'ACTIVE' },
          include: { subscription: { include: { plan: { include: { entitlements: true } } } } },
        })
      : null;
    const categories = await this.prisma.businessCategory.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
    const mode = entry ? (entry.subscription ? safeSuggestion(paidEntitlements(entry.subscription)) : 'ALL_STORES') : null;
    const catalog = await this.prisma.merchant.findMany({ where: { status: 'ACTIVE', deletedAt: null }, select: { id: true, businessType: true } });
    const visible = entry && mode
      ? suggestedMerchants({ mode, current: { id: entry.id, businessType: entry.businessType }, candidates: catalog }).map((merchant) => merchant.id)
      : null;
    const merchants = await this.merchantCards(visible ? { id: { in: visible } } : { status: 'ACTIVE', deletedAt: null });
    const listed = visible ? [...merchants].sort((a, b) => visible.indexOf(a.id) - visible.indexOf(b.id)) : merchants;
    const nearby = this.sortNearby(listed, input.lat, input.lng);
    const entryCard = entry ? nearby.find((merchant) => merchant.id === entry.id) : undefined;
    const ordered = entryCard ? [entryCard, ...nearby.filter((merchant) => merchant.id !== entryCard.id)] : nearby;
    const scoped = visible ? { merchantId: { in: visible } } : {};
    const offers = await this.prisma.offer.findMany({
      where: { active: true, endsAt: { gt: new Date() }, ...scoped },
      include: { merchant: true },
      take: 8,
    });
    const banners = await this.prisma.banner.findMany({
      where: { status: 'ACTIVE', ...scoped },
      include: { merchant: true },
      take: 6,
    });
    const products = await this.productCards(visible ? { merchantId: { in: visible }, deletedAt: null, available: true, approvalStatus: 'APPROVED' } : { deletedAt: null, available: true, approvalStatus: 'APPROVED' });
    const needle = input.q?.trim().toLowerCase() ?? '';
    const matchesText = (value: { en?: string; ar?: string } | null | undefined) =>
      `${value?.en ?? ''} ${value?.ar ?? ''}`.toLowerCase().includes(needle);
    const directMerchant = (merchant: (typeof ordered)[number]) =>
      matchesText(merchant.name) ||
      matchesText(merchant.description) ||
      (merchant.city ?? '').toLowerCase().includes(needle) ||
      merchant.categories.some((category) => matchesText(category)) ||
      merchant.categorySlugs.some((slug) => slug.includes(needle));
    const sorted = needle
      ? ordered.filter(
          (merchant) =>
            directMerchant(merchant) ||
            products.some(
              (product) =>
                product.merchantId === merchant.id &&
                (matchesText(product.name) || matchesText(product.description) || matchesText(product.merchantName)),
            ),
        )
      : ordered;
    const visibleProducts = needle
      ? products.filter(
          (product) =>
            matchesText(product.name) ||
            matchesText(product.description) ||
            matchesText(product.merchantName) ||
            sorted.some((merchant) => merchant.id === product.merchantId && directMerchant(merchant)),
        )
      : products;
    const recentIds =
      input.customerId || input.guestId
        ? await this.prisma.recentlyViewed.findMany({
            where: input.customerId ? { customerId: input.customerId } : { guestId: input.guestId! },
            orderBy: { viewedAt: 'desc' },
            take: 8,
          })
        : [];
    const recent = visibleProducts.filter((product) => recentIds.some((row) => row.productId === product.id));
    return {
      exclusiveMerchant: mode === 'CURRENT_STORE_ONLY' ? sorted[0] ?? null : null,
      categories: categories.map((category) => ({ id: category.id, slug: category.slug, name: loc(category.name) })),
      merchants: sorted,
      featured: sorted.slice(0, 4),
      offers: offers.map((offer) => ({
        id: offer.id,
        title: loc(offer.title),
        merchantSlug: offer.merchant.slug,
        merchantName: loc(offer.merchant.name),
      })),
      banners: banners.map((banner) => ({
        id: banner.id,
        title: loc(banner.title),
        imageUrl: banner.imageUrl,
        merchantSlug: banner.merchant.slug,
      })),
      topProducts: [...visibleProducts].sort((a, b) => Number(b.rating) - Number(a.rating) || b.reviewCount - a.reviewCount).slice(0, 8),
      recommended: visibleProducts.slice(0, 8),
      recentlyViewed: recent,
      freeDelivery: sorted.filter((merchant) => merchant.freeDelivery || Number(merchant.deliveryFee) === 0),
    };
  }

  async merchantBySlug(slug: string) {
    const merchant = await this.prisma.merchant.findFirst({
      where: { slug, deletedAt: null },
      include: {
        hours: true,
        branches: true,
        categories: { include: { category: true } },
        reviews: { include: { author: true }, orderBy: { createdAt: 'desc' }, take: 12 },
        productCategories: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          include: { products: { where: { deletedAt: null, approvalStatus: 'APPROVED' }, include: { inventory: true, addonGroups: { select: { productId: true } } } } },
        },
      },
    });
    if (!merchant || merchant.status !== 'ACTIVE') throw new NotFoundException('Merchant not found');
    const now = new Date();
    const [card, offers] = await Promise.all([
      this.merchantCards({ id: merchant.id }).then((cards) => cards[0]),
      this.prisma.offer.findMany({
        where: { merchantId: merchant.id, active: true, startsAt: { lte: now }, endsAt: { gt: now } },
        orderBy: { endsAt: 'asc' },
        take: 3,
      }),
    ]);
    const branch = merchant.branches[0];
    return {
      ...card,
      address: branch ? `${branch.line1}, ${branch.city}` : '',
      latitude: branch ? dec(branch.latitude) : '0.000000',
      longitude: branch ? dec(branch.longitude) : '0.000000',
      businessCategories: card?.categories ?? [],
      preparationMinutes: merchant.preparationMinutes,
      hours: merchant.hours.map((hour) => ({
        dayOfWeek: hour.dayOfWeek,
        opensAt: hour.opensAt,
        closesAt: hour.closesAt,
        closed: hour.closed,
      })),
      categories: merchant.productCategories.map((category) => ({
        id: category.id,
        name: loc(category.name),
        products: category.products.map((product) => this.toProductCard(product, merchant)),
      })),
      reviews: merchant.reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        author: review.author.firstName,
        createdAt: review.createdAt.toISOString(),
      })),
      offers: offers.map((offer) => ({ id: offer.id, title: loc(offer.title) })),
    };
  }

  async product(id: string, viewer?: { customerId?: string | null; guestId?: string | null }) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: {
        merchant: true,
        variants: true,
        inventory: true,
        images: { orderBy: { sortOrder: 'asc' } },
        addonGroups: { include: { addonGroup: { include: { addons: true } } } },
      },
    });
    if (!product || product.approvalStatus !== 'APPROVED') throw new NotFoundException('Product not found');
    if (viewer?.customerId || viewer?.guestId) {
      await this.prisma.recentlyViewed.create({
        data: { productId: product.id, customerId: viewer.customerId, guestId: viewer.guestId },
      });
    }
    const card = this.toProductCard(product, product.merchant);
    const gallery = [product.imageUrl, ...product.images.map((image) => image.url)].filter((url): url is string => Boolean(url));
    return {
      ...card,
      images: [...new Set(gallery)],
      variants: product.variants.map((variant) => ({
        id: variant.id,
        name: loc(variant.name),
        price: dec(variant.price),
        available: variant.available,
      })),
      addonGroups: product.addonGroups.map((link) => ({
        id: link.addonGroup.id,
        name: loc(link.addonGroup.name),
        minSelect: link.addonGroup.minSelect,
        maxSelect: link.addonGroup.maxSelect,
        addons: link.addonGroup.addons.map((addon) => ({ id: addon.id, name: loc(addon.name), price: dec(addon.price) })),
      })),
    };
  }

  async cartFor(owner: { customerId?: string | null; guestId?: string | null }) {
    const cart = await this.loadCartRecord(owner);
    if (!cart) {
      return {
        id: null,
        merchant: null,
        fulfillmentType: null,
        items: [],
        pricing: emptyPrice(),
        notes: null,
        scheduledFor: null,
        addressId: null,
        tableId: null,
      };
    }
    return this.presentCart(cart);
  }

  async addItem(owner: { customerId?: string | null; guestId?: string | null }, input: { productId: string; variantId?: string | null; addonIds?: string[]; quantity: number; notes?: string }) {
    const product = await this.prisma.product.findFirst({ where: { id: input.productId, deletedAt: null, available: true } });
    if (!product) throw new NotFoundException('Product not found');
    let cart = await this.loadCartRecord(owner);
    if (cart && cart.merchantId && cart.merchantId !== product.merchantId && cart.items.length) {
      throw new BadRequestException('Your cart already contains another merchant. Clear it before switching.');
    }
    if (!cart) {
      cart = await this.prisma.cart.create({
        data: { customerId: owner.customerId, guestId: owner.guestId, merchantId: product.merchantId },
        include: cartInclude,
      });
    } else if (!cart.merchantId) {
      await this.prisma.cart.update({ where: { id: cart.id }, data: { merchantId: product.merchantId } });
    }
    const item = await this.prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId: product.id,
        variantId: input.variantId,
        quantity: input.quantity,
        notes: input.notes,
        addons: { create: (input.addonIds ?? []).map((addonId) => ({ addonId })) },
      },
    });
    return this.cartFor(owner);
  }

  async updateItem(owner: { customerId?: string | null; guestId?: string | null }, itemId: string, quantity: number, variantId?: string | null) {
    const cart = await this.requireCart(owner);
    await this.prisma.cartItem.updateMany({
      where: { id: itemId, cartId: cart.id },
      data: { quantity, ...(variantId !== undefined ? { variantId } : {}) },
    });
    return this.cartFor(owner);
  }

  async removeItem(owner: { customerId?: string | null; guestId?: string | null }, itemId: string) {
    const cart = await this.requireCart(owner);
    await this.prisma.cartItem.deleteMany({ where: { id: itemId, cartId: cart.id } });
    return this.cartFor(owner);
  }

  async setContext(owner: { customerId?: string | null; guestId?: string | null }, input: { fulfillmentType: FulfillmentType; addressId?: string | null; tableId?: string | null; scheduledFor?: string | null; notes?: string | null }) {
    const cart = await this.requireCart(owner);
    await this.prisma.cart.update({
      where: { id: cart.id },
      data: {
        fulfillmentType: input.fulfillmentType,
        addressId: input.addressId,
        tableId: input.tableId,
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
        notes: input.notes,
      },
    });
    return this.cartFor(owner);
  }

  async applyPromo(owner: { customerId?: string | null; guestId?: string | null }, code: string) {
    const cart = await this.requireCart(owner);
    const promo = await this.prisma.promoCode.findFirst({ where: { code: code.toUpperCase(), active: true, deletedAt: null } });
    if (!promo) throw new BadRequestException('Promo code is not valid');
    await this.prisma.cart.update({ where: { id: cart.id }, data: { promoCodeId: promo.id } });
    return this.cartFor(owner);
  }

  async clearPromo(owner: { customerId?: string | null; guestId?: string | null }) {
    const cart = await this.requireCart(owner);
    await this.prisma.cart.update({ where: { id: cart.id }, data: { promoCodeId: null } });
    return this.cartFor(owner);
  }

  async checkout(owner: { customerId: string; userId: string; roles: string[] }, input: { paymentMethod: 'CARD' | 'BENEFIT' | 'BENEFIT_PAY' | 'CASH'; fulfillmentType: FulfillmentType; addressId?: string | null; tableId?: string | null; scheduledFor?: string | null; notes?: string | null; promoCode?: string | null; idempotencyKey: string }) {
    if (input.promoCode) await this.applyPromo({ customerId: owner.customerId }, input.promoCode);
    await this.setContext({ customerId: owner.customerId }, input);
    const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { order: true } });
    if (existing?.order) return this.presentOrder(existing.order.id);
    const cart = await this.requireCart({ customerId: owner.customerId });
    if (!cart.merchantId || !cart.items.length) throw new BadRequestException('Your cart is empty');
    const priced = await this.price(cart, owner.customerId);
    const merchant = await this.prisma.merchant.findUniqueOrThrow({ where: { id: cart.merchantId }, include: { branches: true, subscription: { include: { plan: { include: { entitlements: true } } } } } });
    if (merchant.status !== 'ACTIVE') throw new BadRequestException('This merchant is not accepting orders');
    if (input.fulfillmentType === 'DELIVERY' && !merchant.deliveryEnabled) throw new BadRequestException('Delivery is unavailable');
    if (input.fulfillmentType === 'TAKEAWAY' && !merchant.takeawayEnabled) throw new BadRequestException('Takeaway is unavailable');
    if (input.fulfillmentType === 'DINE_IN' && !merchant.dineInEnabled) throw new BadRequestException('Dine-in is unavailable');
    if (input.fulfillmentType === 'DELIVERY' && !input.addressId) throw new BadRequestException('Choose a delivery address');
    if (input.fulfillmentType === 'DINE_IN' && !input.tableId) throw new BadRequestException('A table is required for dine-in');
    const rows = await this.platform.entitlementUsage(merchant.id);
    if (!rows.length) throw new BadRequestException('An active subscription is required');
    if (input.fulfillmentType === 'DELIVERY') assertFeatureAllowed(readEntitlement(rows, 'deliveryOrdering'), 'Delivery ordering');
    if (input.fulfillmentType === 'TAKEAWAY') assertFeatureAllowed(readEntitlement(rows, 'takeawayOrdering'), 'Takeaway ordering');
    if (input.fulfillmentType === 'DINE_IN') assertFeatureAllowed(readEntitlement(rows, 'tableOrdering'), 'Table ordering');
    if (input.paymentMethod !== 'CASH') assertFeatureAllowed(readEntitlement(rows, 'paymentIntegration'), 'Online payment');
    const orderUsage = rows.find((row) => row.key === 'monthlyOrderLimit');
    assertWithinLimit(orderUsage?.value, orderUsage?.usage ?? 0, 1, 'monthly order limit');
    const percent = commissionPercent(readEntitlement(rows, 'merchantCommissionPercent'));
    const food = money(priced.pricing.subtotal).minus(priced.pricing.discount);
    const commission = food.mul(percent).div(100);
    const branch = merchant.branches[0];
    if (!branch) throw new BadRequestException('Merchant has no branch');
    const address = input.addressId ? await this.prisma.address.findFirst({ where: { id: input.addressId, customerId: owner.customerId } }) : null;
    const order = await this.prisma.$transaction(async (tx) => {
      const count = await tx.order.count();
      const created = await tx.order.create({
        data: {
          number: `ALV-${10001 + count}`,
          customerId: owner.customerId,
          merchantId: merchant.id,
          branchId: branch.id,
          fulfillmentType: input.fulfillmentType,
          status: 'PENDING',
          addressSnapshot: address ? { line1: address.line1, city: address.city, latitude: dec(address.latitude), longitude: dec(address.longitude) } : undefined,
          tableId: input.tableId,
          scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
          notes: input.notes,
          subtotal: priced.pricing.subtotal,
          discount: priced.pricing.discount,
          deliveryFee: priced.pricing.deliveryFee,
          deliveryFeeSaved: priced.pricing.deliveryFeeSaved,
          tax: priced.pricing.tax,
          total: priced.pricing.total,
          promoCodeId: cart.promoCodeId,
          commissionPercent: percent,
          platformCommission: moneyString(commission),
          merchantNet: moneyString(food.minus(commission)),
          createdById: owner.userId,
          items: {
            create: priced.lines.map((line) => ({
              merchantId: merchant.id,
              productId: line.productId,
              variantId: line.variantId,
              name: line.name,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
              notes: line.notes,
              addons: { create: line.addons.map((addon) => ({ addonId: addon.id, name: addon.name, price: addon.price })) },
            })),
          },
          events: { create: { status: 'PENDING', actorId: owner.userId, note: 'Order placed' } },
        },
      });
      for (const line of priced.lines) {
        await tx.inventoryItem.updateMany({
          where: { productId: line.productId, branchId: branch.id, quantity: { gte: line.quantity } },
          data: { quantity: { decrement: line.quantity } },
        });
      }
      if (cart.promoCodeId && money(priced.pricing.discount).gt(0)) {
        await tx.promoRedemption.create({ data: { promoCodeId: cart.promoCodeId, customerId: owner.customerId, orderId: created.id, amount: priced.pricing.discount } });
        await tx.promoCode.update({ where: { id: cart.promoCodeId }, data: { budgetSpent: { increment: priced.pricing.discount } } });
      }
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.cart.update({ where: { id: cart.id }, data: { promoCodeId: null, merchantId: null } });
      return created;
    });
    await this.capturePayment(order.id, input.paymentMethod, input.idempotencyKey, owner.userId);
    if (input.tableId) {
      await this.prisma.diningTable.update({ where: { id: input.tableId }, data: { status: 'OCCUPIED' } });
      await this.prisma.tableSession.create({ data: { tableId: input.tableId, merchantId: merchant.id } });
    }
    return this.publish(order.id);
  }

  async capturePayment(orderId: string, method: 'CARD' | 'BENEFIT' | 'BENEFIT_PAY' | 'CASH', idempotencyKey: string, actorId?: string) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const provider = method === 'CASH' ? 'CASH' : method === 'CARD' ? 'TAP' : 'BENEFIT';
    const gatewayRate = method === 'CASH' ? '0' : '0.025';
    let externalId: string | null = null;
    let status: 'PENDING' | 'CAPTURED' = method === 'CASH' ? 'PENDING' : 'CAPTURED';
    if (method === 'CARD') {
      const charge = await this.tap.createCharge({ amount: dec(order.total), reference: order.number, method });
      externalId = charge.externalId;
      status = charge.status === 'CAPTURED' ? 'CAPTURED' : 'PENDING';
    }
    if (method === 'BENEFIT' || method === 'BENEFIT_PAY') {
      const charge = await this.benefit.createCharge({ amount: dec(order.total), reference: order.number, method });
      externalId = charge.externalId;
      status = charge.status === 'CAPTURED' ? 'CAPTURED' : 'PENDING';
    }
    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        customerId: order.customerId,
        merchantId: order.merchantId,
        provider,
        method,
        status,
        amount: dec(order.total),
        gatewayFee: moneyString(money(dec(order.total)).mul(gatewayRate)),
        externalId,
        idempotencyKey,
        createdById: actorId,
      },
    });
    if (method === 'CASH') {
      await this.prisma.cashCollection.create({ data: { orderId: order.id, merchantId: order.merchantId, amount: dec(order.total), status: 'PENDING' } });
    }
    if (status === 'CAPTURED') await this.postLedger(order.id, gatewayRate, false);
    return payment;
  }

  async postLedger(orderId: string, gatewayRate: string, payDriver: boolean) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const food = money(dec(order.subtotal)).minus(dec(order.discount));
    const lines = buildCaptureLedger({
      total: dec(order.total),
      foodAfterDiscount: moneyString(food),
      tax: dec(order.tax),
      deliveryFee: dec(order.deliveryFee),
      commissionRate: money(dec(order.commissionPercent)).div(100).toFixed(6),
      gatewayRate,
      payDriver,
      referenceId: order.id,
    });
    for (const line of lines) {
      await this.prisma.ledgerEntry.create({
        data: {
          ...line,
          merchantId: order.merchantId,
          idempotencyKey: `${order.id}:${line.type}`,
        },
      });
    }
  }

  async transition(actor: { id: string; roles: string[]; merchantId: string | null }, orderId: string, input: { status: OrderStatus; note?: string; preparationMinutes?: number; driverId?: string; cancellationReason?: string }) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { dispatch: true } });
    if (!order) throw new NotFoundException('Order not found');
    if (actor.merchantId && actor.merchantId !== order.merchantId) throw new BadRequestException('Cross-merchant access is not allowed');
    assertTransition({ from: order.status, to: input.status, fulfillment: order.fulfillmentType, roles: actor.roles });
    if (input.status === 'CANCELLED' && !input.cancellationReason && !input.note) {
      throw new BadRequestException('A cancellation reason is required');
    }
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: input.status,
        preparationMinutes: input.preparationMinutes ?? order.preparationMinutes,
        estimatedReadyAt: input.preparationMinutes ? new Date(Date.now() + input.preparationMinutes * 60000) : order.estimatedReadyAt,
        cancellationReason: input.cancellationReason ?? order.cancellationReason,
        updatedById: actor.id,
        events: { create: { status: input.status, note: input.note, actorId: actor.id } },
      },
    });
    if (input.status === 'ASSIGNED_TO_DRIVER' && input.driverId) {
      await this.prisma.dispatchAssignment.upsert({
        where: { orderId: order.id },
        update: { driverId: input.driverId, assignedById: actor.id },
        create: { orderId: order.id, driverId: input.driverId, merchantId: order.merchantId, assignedById: actor.id },
      });
    }
    if (input.status === 'DELIVERED') {
      const payment = await this.prisma.payment.findFirst({ where: { orderId: order.id } });
      if (payment?.method === 'CASH') {
        await this.prisma.cashCollection.updateMany({ where: { orderId: order.id }, data: { status: 'COLLECTED' } });
      }
      const hasDriver = Boolean(order.dispatch || input.driverId);
      const existing = await this.prisma.ledgerEntry.findFirst({ where: { referenceId: order.id, type: 'CUSTOMER_PAYMENT' } });
      if (!existing && payment?.status === 'CAPTURED') await this.postLedger(order.id, '0.025', hasDriver);
    }
    if (input.status === 'REFUNDED') await this.refund(actor, order.id, dec(order.total), input.note ?? 'Refund');
    const merchantUsers = await this.prisma.user.findMany({ where: { merchantId: order.merchantId, status: 'ACTIVE' } });
    for (const user of merchantUsers) {
      await this.prisma.notification.create({
        data: { userId: user.id, channel: 'IN_APP', title: `Order ${updated.number}`, body: `Status is now ${input.status}` },
      });
      await this.push.send(user.id, `Order ${updated.number}`, input.status);
    }
    return this.publish(order.id);
  }

  async refund(actor: { id: string; roles: string[] }, orderId: string, amount: string, reason: string) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
    const refund = await this.prisma.refund.create({
      data: {
        orderId,
        paymentId: order.payments[0]?.id,
        merchantId: order.merchantId,
        amount,
        reason,
        status: actor.roles.includes('FINANCE_MANAGER') || actor.roles.includes('SUPER_ADMIN') || actor.roles.includes('ADMIN') ? 'PROCESSED' : 'REQUESTED',
        createdById: actor.id,
      },
    });
    if (refund.status === 'PROCESSED') {
      const line = buildRefundLedger(amount, order.id);
      await this.prisma.ledgerEntry.create({
        data: { ...line, merchantId: order.merchantId, idempotencyKey: `${order.id}:REFUND:${refund.id}` },
      });
      await this.prisma.payment.updateMany({ where: { orderId }, data: { status: 'REFUNDED' } });
    }
    return refund;
  }

  async presentOrder(id: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      include: {
        merchant: true,
        branch: { select: { latitude: true, longitude: true } },
        items: { include: { addons: true } },
        events: { orderBy: { createdAt: 'asc' } },
        dispatch: { include: { driver: { include: { user: true } } } },
        customer: { include: { user: true } },
        table: { select: { number: true } },
        payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { method: true } },
      },
    });
    const productIds = order.items.map((item) => item.productId).filter((value): value is string => Boolean(value));
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, imageUrl: true } })
      : [];
    const images = new Map(products.map((product) => [product.id, product.imageUrl]));
    return {
      id: order.id,
      merchantId: order.merchantId,
      number: order.number,
      status: order.status,
      fulfillmentType: order.fulfillmentType,
      merchantName: loc(order.merchant.name),
      merchantSlug: order.merchant.slug,
      merchantPhone: order.merchant.phone,
      merchantLogoUrl: order.merchant.logoUrl,
      merchantCoverUrl: order.merchant.coverUrl,
      driverName: order.dispatch ? `${order.dispatch.driver.user.firstName} ${order.dispatch.driver.user.lastName}`.trim() : null,
      driverPhone: order.dispatch?.driver.user.phone ?? null,
      driverVehicle: order.dispatch?.driver.vehicle ?? null,
      items: order.items.map((item) => ({
        name: loc(item.name),
        quantity: item.quantity,
        lineTotal: dec(item.lineTotal),
        imageUrl: item.productId ? images.get(item.productId) ?? null : null,
      })),
      pricing: {
        subtotal: dec(order.subtotal),
        discount: dec(order.discount),
        deliveryFee: dec(order.deliveryFee),
        deliveryFeeSaved: dec(order.deliveryFeeSaved),
        tax: dec(order.tax),
        total: dec(order.total),
        currency: 'BHD' as const,
        promoCode: null,
      },
      notes: order.notes,
      cancellationReason: order.cancellationReason,
      preparationMinutes: order.preparationMinutes,
      estimatedArrival: order.estimatedReadyAt?.toISOString() ?? null,
      scheduledFor: order.scheduledFor?.toISOString() ?? null,
      distanceKm: routeDistance(order.branch, order.addressSnapshot),
      createdAt: order.createdAt.toISOString(),
      events: order.events.map((event) => ({ status: event.status, createdAt: event.createdAt.toISOString(), note: event.note })),
      customerName: `${order.customer.user.firstName} ${order.customer.user.lastName}`.trim(),
      tableNumber: order.table?.number ?? null,
      address: formatAddress(order.addressSnapshot),
      paymentMethod: order.payments[0]?.method ?? null,
    };
  }

  private async publish(id: string) {
    const view = await this.presentOrder(id);
    this.gateway.emit(view);
    return view;
  }

  async listOrders(where: Record<string, unknown>) {
    const orders = await this.prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
    return Promise.all(orders.map((order) => this.presentOrder(order.id)));
  }

  async resolveQr(code: string) {
    const qr = await this.prisma.qrCode.findUnique({ where: { code }, include: { merchant: { include: { subscription: { include: { plan: { include: { entitlements: true } } } } } }, table: true } });
    if (!qr || !qr.active) throw new NotFoundException('QR code not found');
    const visibility = qr.merchant.subscription ? safeSuggestion(paidEntitlements(qr.merchant.subscription)) : 'ALL_STORES';
    return {
      code: qr.code,
      type: qr.type,
      merchantSlug: qr.merchant.slug,
      merchantName: loc(qr.merchant.name),
      tableId: qr.tableId,
      tableNumber: qr.table?.number ?? null,
      fulfillment: qr.type === 'TABLE' ? 'DINE_IN' : null,
      suggestionMode: visibility,
      exclusive: visibility === 'CURRENT_STORE_ONLY',
    };
  }

  private async presentCart(cart: CartRecord) {
    const priced = await this.price(cart, cart.customerId);
    const merchant = cart.merchantId ? (await this.merchantCards({ id: cart.merchantId }))[0] ?? null : null;
    return {
      id: cart.id,
      merchant,
      fulfillmentType: cart.fulfillmentType,
      items: priced.lines.map((line) => ({
        id: line.id,
        productId: line.productId,
        variantId: line.variantId,
        name: line.name,
        description: line.description,
        imageUrl: line.imageUrl,
        variantName: line.variantName,
        variants: line.variants,
        customizable: line.customizable,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
        addons: line.addons,
        notes: line.notes,
      })),
      pricing: { ...priced.pricing, promoCode: cart.promoCode?.code ?? null },
      notes: cart.notes,
      scheduledFor: cart.scheduledFor?.toISOString() ?? null,
      addressId: cart.addressId,
      tableId: cart.tableId,
    };
  }

  private async price(cart: CartRecord, customerId?: string | null) {
    const rules = await this.platformRules(cart.merchantId);
    const lines = [];
    for (const item of cart.items) {
      const product = await this.prisma.product.findFirst({
        where: { id: item.productId, deletedAt: null },
        include: { variants: true, addonGroups: { include: { addonGroup: { include: { addons: true } } } } },
      });
      if (!product || !product.available) throw new BadRequestException('A product in your cart is unavailable');
      const variant = item.variantId ? product.variants.find((entry) => entry.id === item.variantId) : null;
      if (item.variantId && (!variant || !variant.available)) throw new BadRequestException('A variant in your cart is unavailable');
      let unit = money(variant ? dec(variant.price) : dec(product.price));
      const addons = [];
      for (const link of item.addons) {
        const addon = product.addonGroups.flatMap((group) => group.addonGroup.addons).find((entry) => entry.id === link.addonId);
        if (!addon || !addon.available) throw new BadRequestException('An add-on in your cart is unavailable');
        unit = unit.plus(dec(addon.price));
        addons.push({ id: addon.id, name: loc(addon.name), price: dec(addon.price) });
      }
      const variants = product.variants.filter((entry) => entry.available).map((entry) => ({ id: entry.id, name: loc(entry.name) }));
      lines.push({
        id: item.id,
        productId: product.id,
        variantId: variant?.id ?? null,
        name: loc(product.name),
        description: loc(product.description),
        imageUrl: product.imageUrl,
        variantName: variant ? loc(variant.name) : null,
        variants,
        customizable: variants.length > 0 || product.addonGroups.some((group) => group.addonGroup.addons.some((addon) => addon.available)),
        quantity: item.quantity,
        unitPrice: moneyString(unit),
        lineTotal: moneyString(unit.mul(item.quantity)),
        addons,
        notes: item.notes,
      });
    }
    const promo = await this.promoFacts(cart, customerId);
    const pricing = priceOrder({
      lines: lines.map((line) => ({ unitPrice: line.unitPrice, quantity: line.quantity })),
      fulfillment: cart.fulfillmentType ?? 'DELIVERY',
      deliveryFee: rules.deliveryFee,
      freeDeliveryMinimum: rules.freeDeliveryMinimum,
      taxRate: rules.taxRate,
      promo,
    });
    return { lines, pricing };
  }

  private async promoFacts(cart: CartRecord, customerId?: string | null): Promise<PromoFacts | null> {
    if (!cart.promoCode) return null;
    const promo = cart.promoCode;
    const usedCount = await this.prisma.promoRedemption.count({ where: { promoCodeId: promo.id } });
    const customerUsed = customerId ? await this.prisma.promoRedemption.count({ where: { promoCodeId: promo.id, customerId } }) : 0;
    const customerOrderCount = customerId ? await this.prisma.order.count({ where: { customerId, status: { not: 'CANCELLED' } } }) : 0;
    const merchantIds = (promo.merchantIds as string[] | null) ?? [];
    const merchantAllowed = !cart.merchantId || promo.merchantId === cart.merchantId || promo.scope === 'GLOBAL' && (merchantIds.length === 0 || merchantIds.includes(cart.merchantId));
    return {
      code: promo.code,
      discountType: promo.discountType,
      discountValue: dec(promo.discountValue),
      maxDiscount: promo.maxDiscount ? dec(promo.maxDiscount) : null,
      minimumOrder: promo.minimumOrder ? dec(promo.minimumOrder) : null,
      usageLimit: promo.usageLimit,
      usedCount,
      perCustomerLimit: promo.perCustomerLimit,
      customerUsed,
      startsAt: promo.startsAt,
      endsAt: promo.endsAt,
      firstOrderOnly: promo.firstOrderOnly,
      customerOrderCount,
      budget: promo.budget ? dec(promo.budget) : null,
      budgetSpent: dec(promo.budgetSpent),
      merchantAllowed,
      categoryAllowed: true,
      now: new Date(),
    };
  }

  private async platformRules(merchantId: string | null) {
    const settings = await this.prisma.platformSetting.findMany();
    const map = new Map(settings.map((setting) => [setting.key, setting.value]));
    const rule = await this.prisma.deliveryPricingRule.findFirst({ where: { active: true, OR: [{ merchantId }, { merchantId: null }] }, orderBy: { merchantId: 'desc' } });
    const free = await this.prisma.freeDeliveryRule.findFirst({ where: { active: true, OR: [{ merchantId }, { merchantId: null }] }, orderBy: { merchantId: 'desc' } });
    return {
      taxRate: String(map.get('taxRate') ?? '0.100'),
      deliveryFee: rule ? dec(rule.baseFee) : '0.500',
      freeDeliveryMinimum: free ? dec(free.minimumOrder) : null,
    };
  }

  private async merchantCards(where: Record<string, unknown>) {
    const merchants = await this.prisma.merchant.findMany({
      where,
      include: { hours: true, branches: true, categories: { include: { category: true } }, subscription: { include: { plan: { include: { entitlements: true } } } } },
    });
    return merchants.map((merchant) => {
      const visibility = merchant.subscription ? safeSuggestion(paidEntitlements(merchant.subscription)) : 'ALL_STORES';
      const fulfillment: FulfillmentType[] = [];
      if (merchant.deliveryEnabled) fulfillment.push('DELIVERY');
      if (merchant.takeawayEnabled) fulfillment.push('TAKEAWAY');
      if (merchant.dineInEnabled) fulfillment.push('DINE_IN');
      const paused = merchant.availability === 'CLOSED' || merchant.availability === 'BUSY' || (merchant.temporaryClosedUntil && merchant.temporaryClosedUntil > new Date());
      const open = paused ? false : isOpenAt(merchant.hours, new Date());
      return {
        id: merchant.id,
        slug: merchant.slug,
        name: loc(merchant.name),
        description: loc(merchant.description),
        logoUrl: merchant.logoUrl,
        coverUrl: merchant.coverUrl,
        rating: dec(merchant.ratingAverage),
        reviewCount: merchant.ratingCount,
        deliveryMinutes: merchant.preparationMinutes + 15,
        deliveryFee: '0.500',
        minimumOrder: dec(merchant.minimumOrder),
        isOpen: open,
        visibility,
        fulfillment,
        categories: merchant.categories.map((link) => loc(link.category.name)),
        categorySlugs: merchant.categories.map((link) => link.category.slug),
        city: merchant.branches.find((branch) => branch.active)?.city ?? merchant.branches[0]?.city ?? null,
        freeDelivery: merchant.freeDeliveryEnabled,
        latitude: merchant.branches[0] ? Number(merchant.branches[0].latitude) : null,
        longitude: merchant.branches[0] ? Number(merchant.branches[0].longitude) : null,
      };
    });
  }

  private toProductCard(product: { id: string; name: unknown; description: unknown; imageUrl: string | null; price: { toFixed: (n: number) => string }; compareAtPrice: { toFixed: (n: number) => string } | null; ratingAverage: { toFixed: (n: number) => string }; ratingCount: number; available: boolean; inventory?: { quantity: number }[]; addonGroups?: unknown[]; variants?: unknown[] }, merchant: { id: string; slug: string; name: unknown }) {
    const stock = product.inventory?.reduce((sum, row) => sum + row.quantity, 0);
    return {
      id: product.id,
      merchantId: merchant.id,
      merchantSlug: merchant.slug,
      merchantName: loc(merchant.name),
      name: loc(product.name),
      description: loc(product.description),
      imageUrl: product.imageUrl,
      price: dec(product.price),
      compareAtPrice: product.compareAtPrice ? dec(product.compareAtPrice) : null,
      rating: dec(product.ratingAverage),
      reviewCount: product.ratingCount,
      available: product.available && (stock === undefined || stock > 0),
      customizable: (product.addonGroups?.length ?? 0) > 0 || (product.variants?.length ?? 0) > 0,
    };
  }

  private async productCards(where: Record<string, unknown>) {
    const products = await this.prisma.product.findMany({ where, include: { merchant: true, inventory: true }, take: 24 });
    return products.map((product) => this.toProductCard(product, product.merchant));
  }

  private sortNearby<T extends { latitude: number | null; longitude: number | null }>(rows: T[], lat?: string, lng?: string) {
    if (!lat || !lng) return rows;
    const latitude = Number(lat);
    const longitude = Number(lng);
    return [...rows].sort((a, b) => distance(latitude, longitude, a.latitude ?? latitude, a.longitude ?? longitude) - distance(latitude, longitude, b.latitude ?? latitude, b.longitude ?? longitude));
  }

  private async loadCartRecord(owner: { customerId?: string | null; guestId?: string | null }) {
    if (!owner.customerId && !owner.guestId) return null;
    return this.prisma.cart.findFirst({
      where: owner.customerId ? { customerId: owner.customerId } : { guestId: owner.guestId },
      include: cartInclude,
    });
  }

  private async requireCart(owner: { customerId?: string | null; guestId?: string | null }) {
    const cart = await this.loadCartRecord(owner);
    if (!cart) throw new BadRequestException('Your cart is empty');
    return cart;
  }
}

const cartInclude = {
  items: { include: { addons: true } },
  promoCode: true,
} as const;

function routeDistance(branch: { latitude: unknown; longitude: unknown }, snapshot: unknown) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const row = snapshot as { latitude?: unknown; longitude?: unknown };
  const lat1 = Number(branch.latitude);
  const lng1 = Number(branch.longitude);
  const lat2 = Number(row.latitude);
  const lng2 = Number(row.longitude);
  if (![lat1, lng1, lat2, lng2].every((value) => Number.isFinite(value))) return null;
  const km = distance(lat1, lng1, lat2, lng2);
  if (!Number.isFinite(km) || km <= 0 || km > 80) return null;
  return km.toFixed(1);
}

function formatAddress(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const row = value as { line1?: string; city?: string };
  const parts = [row.line1, row.city].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(', ') : null;
}

function emptyPrice() {
  return { subtotal: '0.000', discount: '0.000', deliveryFee: '0.000', deliveryFeeSaved: '0.000', tax: '0.000', total: '0.000', currency: 'BHD' as const, promoCode: null };
}

function paidEntitlements(subscription: { entitlementSnapshot: unknown; plan: { entitlements: { key: string; value: unknown }[] } }) {
  if (Array.isArray(subscription.entitlementSnapshot)) return subscription.entitlementSnapshot as { key: string; value: unknown }[];
  return subscription.plan.entitlements;
}

function safeSuggestion(rows: { key: string; value: unknown }[]) {
  try {
    return suggestionMode(readEntitlement(rows, 'visibility'));
  } catch {
    return 'ALL_STORES' as const;
  }
}

function distance(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}
