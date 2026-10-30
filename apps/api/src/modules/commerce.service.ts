import { createHash } from 'crypto';
import type { FulfillmentType, OrderStatus } from '@alliva/types';
import { isOfflinePaymentMethod, type PaymentMethodCode } from '@alliva/validation';
import { money, moneyString } from '../domain/money';
import { orderPromoForMerchant, priceOrder, type PromoFacts } from '../domain/pricing';
import { assertTransition, riderOnly } from '../domain/order-machine';
import { handoffCode, handoffToken } from '../domain/dispatch';
import { assertFeatureAllowed, assertWithinLimit, commissionPercent, readEntitlement, suggestionMode } from '../domain/entitlements';
import { subscriptionIsLive, subscriptionShouldExpire, suggestedMerchants } from '../domain/subscriptions';
import { buildCaptureLedger, buildRefundLedger } from '../domain/ledger';
import { isOpenAt } from '../domain/hours';
import { badRequest, checkoutError, forbidden, notFound, type CheckoutErrorCode } from '../common/errors';
import { dec, loc } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformService } from './platform.service';
import { BenefitGateway, MockPushProvider, PaypalGateway, TapGateway } from '../providers/mock.providers';
import { OrdersGateway } from './orders.gateway';
import { storePaymentChoices } from './payment-methods';
import { deliveryFeeForDistance } from '../domain/delivery-pricing';
import { merchantOrderCharges } from '../domain/charges';
import { planCartMerge, mergeLineKey } from '../domain/cart-merge';
import { haversineKm, parsePoint, type Point } from '../domain/geo';
import { branchPoint, deliveryInclude, deliverySnapshot, presentBranchQuote, type BranchQuote, type DeliveryContext, type DeliveryService } from './delivery.service';

type CartRecord = NonNullable<Awaited<ReturnType<CommerceService['loadCartRecord']>>>;

export class CommerceService {
  postgis: boolean | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tap: TapGateway,
    private readonly benefit: BenefitGateway,
    private readonly paypal: PaypalGateway,
    private readonly push: MockPushProvider,
    private readonly gateway: OrdersGateway,
    private readonly platform: PlatformService,
    private readonly delivery: DeliveryService,
  ) {}

  async ensureGuest(tokenHash: string | null, create: () => Promise<{ id: string; token: string }>) {
    if (!tokenHash) return create();
    const guest = await this.prisma.guest.findUnique({ where: { tokenHash } });
    if (!guest) return create();
    return { id: guest.id, token: null as string | null };
  }

  async home(input: { lat?: string; lng?: string; q?: string; exclusiveSlug?: string | null; customerId?: string | null; guestId?: string | null }) {
    const point = parsePoint(input.lat, input.lng);
    // Each query is a network round trip to the database, so independent ones run together.
    const [entry, categories, catalog, context, recentIds] = await Promise.all([
      input.exclusiveSlug
        ? this.prisma.merchant.findFirst({
            where: { slug: input.exclusiveSlug, deletedAt: null, status: 'ACTIVE' },
            include: { subscription: { include: { plan: { include: { entitlements: true } } } } },
          })
        : null,
      this.prisma.businessCategory.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
      input.exclusiveSlug
        ? this.prisma.merchant.findMany({ where: { status: 'ACTIVE', deletedAt: null }, select: { id: true, businessType: true } })
        : [],
      point ? this.delivery.context(point) : null,
      input.customerId || input.guestId
        ? this.prisma.recentlyViewed.findMany({
            where: input.customerId ? { customerId: input.customerId } : { guestId: input.guestId! },
            orderBy: { viewedAt: 'desc' },
            take: 8,
          })
        : [],
    ]);
    const mode = entry ? (entry.subscription ? safeSuggestion(paidEntitlements(entry.subscription)) : 'ALL_STORES') : null;
    const visible = entry && mode
      ? suggestedMerchants({ mode, current: { id: entry.id, businessType: entry.businessType }, candidates: catalog }).map((merchant) => merchant.id)
      : null;
    const scoped = visible ? { merchantId: { in: visible } } : {};
    const [merchants, offers, banners, products] = await Promise.all([
      this.merchantCards(visible ? { id: { in: visible } } : { status: 'ACTIVE', deletedAt: null }, point && context ? { point, context } : undefined),
      this.prisma.offer.findMany({
        where: { active: true, endsAt: { gt: new Date() }, ...scoped },
        include: { merchant: true },
        take: 8,
      }),
      this.prisma.banner.findMany({
        where: { status: 'ACTIVE', ...scoped },
        include: { merchant: true },
        take: 6,
      }),
      this.productCards(visible ? { merchantId: { in: visible }, deletedAt: null, available: true, approvalStatus: 'APPROVED' } : { deletedAt: null, available: true, approvalStatus: 'APPROVED' }),
    ]);
    const listed = visible ? [...merchants].sort((a, b) => visible.indexOf(a.id) - visible.indexOf(b.id)) : merchants;
    // With a location, stores that cannot deliver there drop out. A store opened from its own QR or link always stays.
    const reachable = point ? listed.filter((merchant) => merchant.id === entry?.id || deliverableFrom(merchant)) : listed;
    const nearby = point ? sortNearby(reachable) : reachable;
    const entryCard = entry ? nearby.find((merchant) => merchant.id === entry.id) : undefined;
    const ordered = entryCard ? [entryCard, ...nearby.filter((merchant) => merchant.id !== entryCard.id)] : nearby;
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
    const unavailableIds = new Set(sorted.filter((merchant) => merchant.temporarilyUnavailable).map((merchant) => merchant.id));
    const unavailableSlugs = new Set(sorted.filter((merchant) => merchant.temporarilyUnavailable).map((merchant) => merchant.slug));
    const orderableProducts = visibleProducts.filter((product) => !unavailableIds.has(product.merchantId));
    const recent = orderableProducts.filter((product) => recentIds.some((row) => row.productId === product.id));
    return {
      exclusiveMerchant: mode === 'CURRENT_STORE_ONLY' ? sorted[0] ?? null : null,
      categories: categories.map((category) => ({ id: category.id, slug: category.slug, name: loc(category.name) })),
      located: Boolean(point),
      merchants: sorted,
      openMerchants: sorted.filter((merchant) => merchant.isOpen && !merchant.temporarilyUnavailable),
      closedMerchants: sorted.filter((merchant) => !merchant.isOpen || merchant.temporarilyUnavailable),
      featured: sorted.slice(0, 4),
      offers: offers
        .filter((offer) => !unavailableSlugs.has(offer.merchant.slug))
        .map((offer) => ({
          id: offer.id,
          title: loc(offer.title),
          merchantSlug: offer.merchant.slug,
          merchantName: loc(offer.merchant.name),
        })),
      banners: banners
        .filter((banner) => !unavailableSlugs.has(banner.merchant.slug))
        .map((banner) => ({
          id: banner.id,
          title: loc(banner.title),
          imageUrl: banner.imageUrl,
          merchantSlug: banner.merchant.slug,
        })),
      topProducts: [...orderableProducts].sort((a, b) => Number(b.rating) - Number(a.rating) || b.reviewCount - a.reviewCount).slice(0, 8),
      recommended: orderableProducts.slice(0, 8),
      recentlyViewed: recent,
      freeDelivery: sorted.filter((merchant) => merchant.freeDelivery || Number(merchant.deliveryFee) === 0),
    };
  }

  async merchantBySlug(slug: string) {
    const now = new Date();
    // Slug is unique, so the card and offers can load alongside the merchant instead of after it.
    const [merchant, card, offers] = await Promise.all([
      this.prisma.merchant.findFirst({
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
      }),
      this.merchantCards({ slug, deletedAt: null, status: 'ACTIVE' }).then((cards) => cards[0]),
      this.prisma.offer.findMany({
        where: { merchant: { slug }, active: true, startsAt: { lte: now }, endsAt: { gt: now } },
        orderBy: { endsAt: 'asc' },
        take: 3,
      }),
    ]);
    if (!merchant || merchant.status !== 'ACTIVE') throw notFound('Merchant not found');
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
      categories: card?.temporarilyUnavailable
        ? []
        : merchant.productCategories.map((category) => ({
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
      offers: card?.temporarilyUnavailable ? [] : offers.map((offer) => ({ id: offer.id, title: loc(offer.title) })),
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
    if (!product || product.approvalStatus !== 'APPROVED') throw notFound('Product not found');
    const live = await this.storeIsOpen(product.merchantId);
    if (live && (viewer?.customerId || viewer?.guestId)) {
      await this.prisma.recentlyViewed.create({
        data: { productId: product.id, customerId: viewer.customerId, guestId: viewer.guestId },
      });
    }
    const card = this.toProductCard(product, product.merchant);
    const gallery = [product.imageUrl, ...product.images.map((image) => image.url)].filter((url): url is string => Boolean(url));
    return {
      ...card,
      temporarilyUnavailable: !live,
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
        paymentMethods: [],
        delivery: null,
        version: '',
      };
    }
    const collapsed = await this.collapseDuplicateLines(cart);
    return this.presentCart(collapsed ? (await this.loadCartRecord(owner)) ?? cart : cart);
  }

  async addItem(owner: { customerId?: string | null; guestId?: string | null }, input: { productId: string; variantId?: string | null; addonIds?: string[]; quantity: number; notes?: string; replace?: boolean }) {
    const product = await this.prisma.product.findFirst({ where: { id: input.productId, deletedAt: null, available: true } });
    if (!product) throw notFound('Product not found');
    if (!(await this.storeIsOpen(product.merchantId))) throw badRequest('This store is temporarily unavailable');
    let cart = await this.loadCartRecord(owner);
    if (cart?.merchantId && cart.merchantId !== product.merchantId) {
      if (cart.items.length && !input.replace) {
        throw badRequest('Your cart already contains another merchant. Clear it before switching.');
      }
      if (cart.items.length) await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
      await this.prisma.cart.update({
        where: { id: cart.id },
        data: { merchantId: product.merchantId, promoCodeId: null, notes: null, tableId: null, branchId: null, scheduledFor: null },
      });
    } else if (!cart) {
      cart = await this.prisma.cart.create({
        data: { customerId: owner.customerId, guestId: owner.guestId, merchantId: product.merchantId },
        include: cartInclude,
      });
    } else if (!cart.merchantId) {
      await this.prisma.cart.update({ where: { id: cart.id }, data: { merchantId: product.merchantId } });
    }
    const switched = Boolean(cart.merchantId && cart.merchantId !== product.merchantId);
    const lines = switched ? [] : cart.items;
    const addonIds = [...new Set(input.addonIds ?? [])].sort();
    const notes = input.notes?.trim() || null;
    const variantId = input.variantId || null;
    const matches = lines.filter((item) => sameCartLine(item, { productId: product.id, variantId, notes, addonIds }));
    if (matches.length) {
      const [keep, ...duplicates] = matches;
      await this.prisma.cartItem.update({
        where: { id: keep!.id },
        data: { quantity: matches.reduce((sum, item) => sum + item.quantity, 0) + input.quantity },
      });
      if (duplicates.length) await this.prisma.cartItem.deleteMany({ where: { id: { in: duplicates.map((item) => item.id) } } });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: product.id,
          variantId,
          quantity: input.quantity,
          notes,
          addons: { create: addonIds.map((addonId) => ({ addonId })) },
        },
      });
    }
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
    if (!cart.merchantId) throw badRequest('Promo code is not valid for this store');
    const promo = await this.prisma.promoCode.findFirst({
      where: { code: code.trim().toUpperCase(), active: true, deletedAt: null, purpose: 'ORDER', merchantId: cart.merchantId },
    });
    if (!promo || !orderPromoForMerchant(promo, cart.merchantId)) throw badRequest('Promo code is not valid for this store');
    try {
      await this.price({ ...cart, promoCode: promo, promoCodeId: promo.id }, owner.customerId ?? cart.customerId);
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : 'Promo code is not valid');
    }
    await this.prisma.cart.update({ where: { id: cart.id }, data: { promoCodeId: promo.id } });
    return this.cartFor(owner);
  }

  async clearPromo(owner: { customerId?: string | null; guestId?: string | null }) {
    const cart = await this.requireCart(owner);
    await this.prisma.cart.update({ where: { id: cart.id }, data: { promoCodeId: null } });
    return this.cartFor(owner);
  }

  /**
   * Re-check everything the customer cannot be trusted to send: address ownership, coordinates, store and branch status,
   * products, prices, delivery range and charge, payment method and the final total.
   * Returns every problem found so the checkout screen can show them together; `checkout` refuses on the first one.
   */
  async validateCheckout(customerId: string, input: CheckoutRequest) {
    const cart = await this.loadCartRecord({ customerId });
    if (!cart || !cart.merchantId || !cart.items.length) throw checkoutError('CART_EMPTY', 'Your cart is empty');
    const problems: { code: CheckoutErrorCode; message: string }[] = [];
    const fail = (code: CheckoutErrorCode, message: string) => {
      if (!problems.some((problem) => problem.code === code)) problems.push({ code, message });
    };
    const version = cartVersion(cart);
    if (input.cartVersion && input.cartVersion !== version) fail('CART_CHANGED', 'Your cart changed. Review it before placing the order.');

    const merchant = await this.prisma.merchant.findUniqueOrThrow({ where: { id: cart.merchantId }, include: { ...deliveryInclude, hours: true } });
    const live = merchant.status === 'ACTIVE' && !merchant.deletedAt && (await this.storeIsOpen(merchant.id));
    if (!live) fail('STORE_UNAVAILABLE', 'This store is not accepting orders right now');
    const paused = merchant.availability !== 'OPEN' || Boolean(merchant.temporaryClosedUntil && merchant.temporaryClosedUntil > new Date());
    const open = !paused && isOpenAt(merchant.hours, new Date());
    if (live && !open && !input.scheduledFor) fail('MERCHANT_CLOSED', 'This store is closed right now');

    const fulfillment = input.fulfillmentType;
    const offered = { DELIVERY: merchant.deliveryEnabled, TAKEAWAY: merchant.takeawayEnabled, DINE_IN: merchant.dineInEnabled }[fulfillment];
    if (!offered) fail(fulfillment === 'DELIVERY' ? 'DELIVERY_DISABLED' : 'FULFILLMENT_UNAVAILABLE', fulfillment === 'DELIVERY' ? 'This store does not deliver right now' : 'This store does not offer that order type');
    if (fulfillment === 'DINE_IN' && !input.tableId) fail('FULFILLMENT_UNAVAILABLE', 'A table is required for dine-in');

    let address: Awaited<ReturnType<typeof this.prisma.address.findFirst>> = null;
    let point: Point | null = null;
    if (fulfillment === 'DELIVERY') {
      if (!input.addressId) fail('ADDRESS_REQUIRED', 'Please add a delivery address to continue.');
      else {
        address = await this.prisma.address.findFirst({ where: { id: input.addressId, customerId, deletedAt: null } });
        point = address ? parsePoint(address.latitude.toString(), address.longitude.toString()) : null;
        if (!address || !point) fail('ADDRESS_INVALID', 'This address is no longer available. Choose another one.');
      }
    }

    const working = { ...cart, fulfillmentType: fulfillment, addressId: address?.id ?? null };
    let priced: Awaited<ReturnType<CommerceService['price']>> | null = null;
    try {
      priced = await this.price(working, customerId, point);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/promo/i.test(message)) fail('PROMO_INVALID', message);
      else if (/unavailable/i.test(message)) fail('PRODUCT_UNAVAILABLE', 'An item in your cart is no longer available');
      else fail('DELIVERY_QUOTE_FAILED', 'We could not calculate this order. Try again.');
    }

    const delivery = priced?.delivery ?? null;
    if (fulfillment === 'DELIVERY' && point && priced) {
      const reason = delivery?.result.reason ?? (delivery ? null : 'QUOTE_FAILED');
      if (reason === 'OUT_OF_RANGE') fail('ADDRESS_OUT_OF_RANGE', 'This address is outside the store’s delivery range');
      else if (reason === 'DELIVERY_DISABLED' || reason === 'BRANCH_INACTIVE') fail('DELIVERY_DISABLED', 'This store does not deliver to this address right now');
      else if (reason === 'CONFIG_MISSING') fail('DELIVERY_CONFIG_MISSING', 'This store has not finished setting up delivery');
      else if (reason === 'INVALID_COORDINATES') fail('ADDRESS_INVALID', 'This address is missing its map location');
      else if (reason) fail('DELIVERY_QUOTE_FAILED', 'We could not calculate the delivery charge. Try again.');
    }

    const paymentMethods = await storePaymentChoices(this.prisma, merchant.id);
    if (input.paymentMethod && !paymentMethods.some((method) => method.code === input.paymentMethod)) {
      fail('PAYMENT_METHOD_UNAVAILABLE', 'This store does not accept that payment method');
    }
    if (priced && input.expectedTotal && money(input.expectedTotal).cmp(priced.pricing.total) !== 0 && !problems.length) {
      fail('TOTAL_CHANGED', 'The order total changed. Check the new total before placing the order.');
    }

    const branch = delivery?.result.branch ?? merchant.branches.find((row) => row.id === cart.branchId && row.active) ?? merchant.branches.find((row) => row.active) ?? null;
    if (!branch) fail('STORE_UNAVAILABLE', 'This store is not accepting orders right now');
    const card = (await this.merchantCards({ id: merchant.id }))[0] ?? null;
    return {
      cartVersion: version,
      merchant: card,
      branch: branch ? { id: branch.id, name: loc(branch.name), address: `${branch.line1}, ${branch.city}`, latitude: branchPoint(branch).latitude.toFixed(6), longitude: branchPoint(branch).longitude.toFixed(6) } : null,
      fulfillmentType: fulfillment,
      address: address ? presentAddress(address) : null,
      delivery: delivery ? presentBranchQuote(delivery.result) : null,
      items: priced?.lines.map((line) => ({ id: line.id, productId: line.productId, name: line.name, variantName: line.variantName, quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: line.lineTotal, addons: line.addons, notes: line.notes, imageUrl: line.imageUrl })) ?? [],
      pricing: priced
        ? { ...priced.pricing, promoCode: cart.promoCode && orderPromoForMerchant(cart.promoCode, cart.merchantId) ? cart.promoCode.code : null }
        : null,
      paymentMethods,
      problems,
      canPlace: problems.length === 0,
      // Internal: used by checkout, stripped before the response leaves the API.
      internal: { cart, merchant, priced, branch, address, point, delivery },
    };
  }

  async checkout(owner: { customerId: string; userId: string; roles: string[] }, input: CheckoutRequest & { idempotencyKey: string }) {
    const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { order: true } });
    if (existing?.order) return this.presentOrder(existing.order.id);
    if (input.promoCode) {
      try {
        await this.applyPromo({ customerId: owner.customerId }, input.promoCode);
      } catch (error) {
        throw checkoutError('PROMO_INVALID', error instanceof Error ? error.message : 'Promo code is not valid');
      }
    }
    await this.setContext({ customerId: owner.customerId }, input);
    const checked = await this.validateCheckout(owner.customerId, input);
    const first = checked.problems[0];
    if (first) throw checkoutError(first.code, first.message, first.code === 'TOTAL_CHANGED' ? { total: checked.pricing?.total } : {});
    const { cart, merchant, branch, address, point, delivery } = checked.internal;
    const priced = checked.internal.priced!;
    if (!branch) throw checkoutError('STORE_UNAVAILABLE', 'This store is not accepting orders right now');
    const rows = await this.platform.entitlementUsage(merchant.id);
    if (!rows.length) throw checkoutError('STORE_UNAVAILABLE', 'This store is not accepting orders right now');
    if (input.fulfillmentType === 'DELIVERY') assertFeatureAllowed(readEntitlement(rows, 'deliveryOrdering'), 'Delivery ordering');
    if (input.fulfillmentType === 'TAKEAWAY') assertFeatureAllowed(readEntitlement(rows, 'takeawayOrdering'), 'Takeaway ordering');
    if (input.fulfillmentType === 'DINE_IN') assertFeatureAllowed(readEntitlement(rows, 'tableOrdering'), 'Table ordering');
    if (!isOfflinePaymentMethod(input.paymentMethod)) assertFeatureAllowed(readEntitlement(rows, 'paymentIntegration'), 'Online payment');
    const orderUsage = rows.find((row) => row.key === 'monthlyOrderLimit');
    assertWithinLimit(orderUsage?.value, orderUsage?.usage ?? 0, 1, 'monthly order limit');
    const percent = commissionPercent(readEntitlement(rows, 'merchantCommissionPercent'));
    const food = money(priced.pricing.subtotal).minus(priced.pricing.discount);
    const commission = food.mul(percent).div(100);
    const promoCodeId = cart.promoCode && orderPromoForMerchant(cart.promoCode, cart.merchantId) ? cart.promoCodeId : null;
    // `charge` is the branch quote; `finalCharge` is what the customer paid after platform-wide free-delivery rules.
    const deliveryQuote = input.fulfillmentType === 'DELIVERY' && delivery && point
      ? { ...deliverySnapshot(delivery.result, point), finalCharge: priced.pricing.deliveryFee, finalTax: priced.pricing.deliveryTax, waivedByPlatform: priced.pricing.deliveryFeeSaved }
      : undefined;
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
          addressSnapshot: address && input.fulfillmentType === 'DELIVERY' ? addressSnapshot(address) : undefined,
          deliveryQuote,
          tableId: input.tableId,
          scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
          notes: input.notes,
          subtotal: priced.pricing.subtotal,
          discount: priced.pricing.discount,
          deliveryFee: priced.pricing.deliveryFee,
          deliveryFeeSaved: priced.pricing.deliveryFeeSaved,
          serviceFee: priced.pricing.serviceFee,
          tax: priced.pricing.tax,
          total: priced.pricing.total,
          promoCodeId,
          commissionPercent: percent,
          platformCommission: moneyString(commission),
          merchantNet: moneyString(food.minus(commission)),
          preparationMinutes: merchant.preparationMinutes,
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
      if (promoCodeId && money(priced.pricing.discount).gt(0)) {
        await tx.promoRedemption.create({ data: { promoCodeId, customerId: owner.customerId, orderId: created.id, amount: priced.pricing.discount } });
        await tx.promoCode.update({ where: { id: promoCodeId }, data: { budgetSpent: { increment: priced.pricing.discount } } });
      }
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.cart.update({ where: { id: cart.id }, data: { promoCodeId: null, merchantId: null, branchId: null } });
      return created;
    });
    await this.capturePayment(order.id, input.paymentMethod, input.idempotencyKey, owner.userId);
    if (input.tableId) {
      await this.prisma.diningTable.update({ where: { id: input.tableId }, data: { status: 'OCCUPIED' } });
      await this.prisma.tableSession.create({ data: { tableId: input.tableId, merchantId: merchant.id } });
    }
    return this.publish(order.id);
  }

  /** Delivery quote for the current cart, a saved address or a map point. */
  async deliveryQuote(owner: { customerId?: string | null; guestId?: string | null }, input: { addressId?: string | null; latitude?: unknown; longitude?: unknown; merchantId?: string | null; branchId?: string | null }) {
    let point = parsePoint(input.latitude, input.longitude);
    if (!point && input.addressId) {
      if (!owner.customerId) throw checkoutError('AUTH_REQUIRED', 'Sign in to use a saved address');
      const address = await this.prisma.address.findFirst({ where: { id: input.addressId, customerId: owner.customerId, deletedAt: null } });
      if (!address) throw checkoutError('ADDRESS_INVALID', 'This address is no longer available');
      point = parsePoint(address.latitude.toString(), address.longitude.toString());
    }
    const cart = await this.loadCartRecord(owner);
    if (!point && cart) point = await this.cartDeliveryPoint(cart);
    if (!point) throw checkoutError('ADDRESS_INVALID', 'Choose a delivery location first');
    const merchantId = input.merchantId ?? cart?.merchantId;
    if (!merchantId) throw notFound('Choose a store first');
    const merchant = await this.prisma.merchant.findFirst({ where: { id: merchantId, deletedAt: null, status: 'ACTIVE' }, include: deliveryInclude });
    if (!merchant) throw notFound('Store not found');
    let orderAmount: string | null = null;
    if (cart && cart.merchantId === merchant.id && cart.items.length) {
      const food = await this.price({ ...cart, fulfillmentType: 'TAKEAWAY' }, owner.customerId ?? cart.customerId).catch(() => null);
      if (food) orderAmount = moneyString(money(food.pricing.subtotal).minus(food.pricing.discount));
    }
    const result = await this.delivery.checkoutQuote(merchant, point, { orderAmount, branchId: input.branchId });
    return presentBranchQuote(result);
  }

  /** Stores near a point, split into those open now and those closed. */
  async nearby(input: { lat?: string; lng?: string; customerId?: string | null; guestId?: string | null; exclusiveSlug?: string | null }) {
    const home = await this.home(input);
    return { located: home.located, merchants: home.openMerchants, closedMerchants: home.closedMerchants };
  }

  /** Remember where a guest is shopping from, so carts can price delivery before sign-in. */
  async setGuestLocation(guestId: string, input: { latitude: unknown; longitude: unknown; label?: string | null; source?: string | null }) {
    const point = parsePoint(input.latitude, input.longitude);
    if (!point) throw badRequest('Choose a valid location');
    await this.prisma.guest.update({
      where: { id: guestId },
      data: {
        latitude: point.latitude.toFixed(6),
        longitude: point.longitude.toFixed(6),
        locationLabel: input.label?.slice(0, 200) || null,
        locationSource: input.source?.slice(0, 20) || null,
        locationUpdatedAt: new Date(),
      },
    });
    return { latitude: point.latitude.toFixed(6), longitude: point.longitude.toFixed(6), label: input.label ?? null };
  }

  /**
   * Move a guest's cart onto the customer who just signed in. Runs in one transaction, keeps variants, add-ons and notes,
   * and never stores the same line twice. Safe to call more than once: a merged guest is skipped.
   */
  async mergeGuestCart(guestId: string, customerId: string) {
    await this.prisma.$transaction(async (tx) => {
      const guest = await tx.guest.findUnique({ where: { id: guestId } });
      if (!guest || guest.mergedIntoCustomerId) return;
      const [guestCart, customerCart] = await Promise.all([
        tx.cart.findUnique({ where: { guestId }, include: cartInclude }),
        tx.cart.findUnique({ where: { customerId }, include: cartInclude }),
      ]);
      const asMerge = (cart: NonNullable<typeof guestCart>) => ({
        id: cart.id,
        merchantId: cart.merchantId,
        items: cart.items.map((item) => ({ id: item.id, productId: item.productId, variantId: item.variantId, notes: item.notes, quantity: item.quantity, addonIds: item.addons.map((addon) => addon.addonId) })),
      });
      const plan = planCartMerge(guestCart ? asMerge(guestCart) : null, customerCart ? asMerge(customerCart) : null);
      if (plan.kind === 'ADOPT_GUEST' && guestCart) {
        if (plan.dropCustomerCartId) await tx.cart.delete({ where: { id: plan.dropCustomerCartId } });
        await tx.cart.update({ where: { id: guestCart.id }, data: { guestId: null, customerId, addressId: null } });
      } else if (plan.kind === 'COMBINE' && guestCart && customerCart) {
        for (const update of plan.updates) await tx.cartItem.update({ where: { id: update.id }, data: { quantity: update.quantity } });
        for (const copy of plan.copies) {
          await tx.cartItem.create({
            data: {
              cartId: customerCart.id,
              productId: copy.productId,
              variantId: copy.variantId,
              quantity: copy.quantity,
              notes: copy.notes,
              addons: { create: [...new Set(copy.addonIds)].map((addonId) => ({ addonId })) },
            },
          });
        }
        await tx.cart.update({
          where: { id: customerCart.id },
          data: {
            notes: guestCart.notes ?? customerCart.notes,
            promoCodeId: guestCart.promoCodeId ?? customerCart.promoCodeId,
            fulfillmentType: guestCart.fulfillmentType ?? customerCart.fulfillmentType,
          },
        });
        await tx.cart.delete({ where: { id: guestCart.id } });
      }
      await tx.recentlyViewed.updateMany({ where: { guestId }, data: { customerId, guestId: null } });
      await tx.guest.update({ where: { id: guestId }, data: { mergedIntoCustomerId: customerId } });
    });
  }

  async capturePayment(orderId: string, method: PaymentMethodCode, idempotencyKey: string, actorId?: string) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const offline = isOfflinePaymentMethod(method);
    const provider = method === 'CASH' ? 'CASH' : method === 'BANK_TRANSFER' ? 'BANK_TRANSFER' : method === 'PAYPAL' ? 'PAYPAL' : method === 'TAP_PAY' ? 'TAP' : 'BENEFIT';
    const gatewayRate = offline ? '0' : '0.025';
    let externalId: string | null = null;
    // A bank transfer is settled outside a gateway, so the payment stays pending until the money is confirmed.
    let status: 'PENDING' | 'CAPTURED' = offline ? 'PENDING' : 'CAPTURED';
    if (!offline) {
      const gateway = method === 'TAP_PAY' ? this.tap : method === 'PAYPAL' ? this.paypal : this.benefit;
      const charge = await gateway.createCharge({ amount: dec(order.total), reference: order.number, method });
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
      await this.prisma.cashCollection.create({
        data: { orderId: order.id, merchantId: order.merchantId, amount: dec(order.total) },
      });
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
      serviceFee: dec(order.serviceFee),
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
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { dispatch: { include: { driver: { select: { userId: true } } } } } });
    if (!order) throw notFound('Order not found');
    if (actor.merchantId && actor.merchantId !== order.merchantId) throw badRequest('Cross-merchant access is not allowed');
    assertTransition({ from: order.status, to: input.status, fulfillment: order.fulfillmentType, roles: actor.roles });
    if (input.status === 'CANCELLED' && !input.cancellationReason && !input.note) {
      throw badRequest('A cancellation reason is required');
    }
    if (riderOnly(actor.roles)) {
      if (order.dispatch?.driver.userId !== actor.id) throw forbidden('This order is not assigned to you');
      if (input.status === 'OUT_FOR_DELIVERY' && !order.dispatch.pickupVerifiedAt) throw badRequest('Verify the pickup before starting the delivery');
    }
    const handoff = input.status === 'READY_FOR_PICKUP' && order.fulfillmentType === 'DELIVERY' && !order.handoffToken
      ? { handoffCode: handoffCode(), handoffToken: handoffToken() }
      : {};
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        ...handoff,
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
        update: {
          driverId: input.driverId,
          assignedById: actor.id,
          assignedAt: new Date(),
          ...(order.dispatch?.driverId !== input.driverId ? { pickupVerifiedAt: null, pickupMethod: null } : {}),
        },
        create: { orderId: order.id, driverId: input.driverId, merchantId: order.merchantId, assignedById: actor.id },
      });
      await this.prisma.cashCollection.updateMany({ where: { orderId: order.id }, data: { driverId: input.driverId } });
    }
    if (input.status === 'DELIVERED') {
      const payment = await this.prisma.payment.findFirst({ where: { orderId: order.id } });
      if (payment?.method === 'CASH') {
        await this.prisma.cashCollection.updateMany({ where: { orderId: order.id }, data: { status: 'COLLECTED' } });
        if (payment.status === 'PENDING') {
          await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'CAPTURED' } });
        }
      }
      const hasDriver = Boolean(order.dispatch || input.driverId);
      const existing = await this.prisma.ledgerEntry.findFirst({ where: { referenceId: order.id, type: 'CUSTOMER_PAYMENT' } });
      const collected = payment?.status === 'CAPTURED' || payment?.method === 'CASH';
      if (!existing && collected) await this.postLedger(order.id, payment?.method === 'CASH' ? '0' : '0.025', hasDriver);
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
        serviceFee: dec(order.serviceFee),
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
    if (!qr || !qr.active) throw notFound('QR code not found');
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
    const delivery = priced.delivery ? presentBranchQuote(priced.delivery.result) : null;
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
      pricing: { ...priced.pricing, promoCode: cart.promoCode && orderPromoForMerchant(cart.promoCode, cart.merchantId) ? cart.promoCode.code : null },
      notes: cart.notes,
      scheduledFor: cart.scheduledFor?.toISOString() ?? null,
      addressId: cart.addressId,
      tableId: cart.tableId,
      paymentMethods: cart.merchantId ? await storePaymentChoices(this.prisma, cart.merchantId) : [],
      delivery,
      version: cartVersion(cart),
    };
  }

  private async price(cart: CartRecord, customerId?: string | null, deliveryPoint?: Point | null) {
    const rules = await this.platformRules(cart.merchantId);
    const lines = [];
    for (const item of cart.items) {
      const product = await this.prisma.product.findFirst({
        where: { id: item.productId, deletedAt: null },
        include: { variants: true, addonGroups: { include: { addonGroup: { include: { addons: true } } } } },
      });
      if (!product || !product.available) throw badRequest('A product in your cart is unavailable');
      const variant = item.variantId ? product.variants.find((entry) => entry.id === item.variantId) : null;
      if (item.variantId && (!variant || !variant.available)) throw badRequest('A variant in your cart is unavailable');
      let unit = money(variant ? dec(variant.price) : dec(product.price));
      const addons = [];
      for (const link of item.addons) {
        const addon = product.addonGroups.flatMap((group) => group.addonGroup.addons).find((entry) => entry.id === link.addonId);
        if (!addon || !addon.available) throw badRequest('An add-on in your cart is unavailable');
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
    const fulfillment = cart.fulfillmentType ?? 'DELIVERY';
    const priceInput = {
      lines: lines.map((line) => ({ unitPrice: line.unitPrice, quantity: line.quantity })),
      fulfillment,
      freeDeliveryMinimum: rules.freeDeliveryMinimum,
      taxRate: '0',
      serviceFee: rules.serviceFee,
      tax: rules.tax,
      promo,
    };
    // Free-delivery thresholds compare against the food total after discounts, so price the food first.
    const food = priceOrder({ ...priceInput, deliveryFee: '0' });
    const delivery = fulfillment === 'DELIVERY' && cart.merchantId
      ? await this.cartDelivery(cart, moneyString(money(food.subtotal).minus(food.discount)), deliveryPoint)
      : null;
    const deliveryFee = delivery
      ? delivery.result.quote?.available ? delivery.result.quote.charge : '0.000'
      : await this.unlocatedDeliveryFee(cart, rules.deliveryFee);
    const pricing = priceOrder({ ...priceInput, deliveryFee, deliveryTax: delivery?.result.quote?.available ? delivery.result.quote.tax : '0' });
    return {
      lines,
      pricing: { ...pricing, serviceFeeLabel: rules.serviceFee.label, taxLabel: rules.tax.label },
      delivery,
    };
  }

  /** Where this cart delivers to: an explicit point, else its saved address, else the guest's chosen location. */
  private async cartDeliveryPoint(cart: CartRecord, explicit?: Point | null): Promise<Point | null> {
    if (explicit) return explicit;
    if (cart.addressId && cart.customerId) {
      const address = await this.prisma.address.findFirst({ where: { id: cart.addressId, customerId: cart.customerId, deletedAt: null }, select: { latitude: true, longitude: true } });
      if (address) return parsePoint(address.latitude.toString(), address.longitude.toString());
    }
    if (cart.guestId) {
      const guest = await this.prisma.guest.findUnique({ where: { id: cart.guestId }, select: { latitude: true, longitude: true } });
      if (guest?.latitude && guest.longitude) return parsePoint(guest.latitude.toString(), guest.longitude.toString());
    }
    return null;
  }

  private async cartDelivery(cart: CartRecord, orderAmount: string, explicit?: Point | null): Promise<{ result: BranchQuote; point: Point } | null> {
    const point = await this.cartDeliveryPoint(cart, explicit);
    if (!point || !cart.merchantId) return null;
    const merchant = await this.prisma.merchant.findUnique({ where: { id: cart.merchantId }, include: deliveryInclude });
    if (!merchant) return null;
    const result = await this.delivery.checkoutQuote(merchant, point, { orderAmount });
    return { result, point };
  }

  /** Before the customer gives a location, show the store's starting delivery price. */
  private async unlocatedDeliveryFee(cart: CartRecord, fallbackFee: string) {
    if (cart.fulfillmentType && cart.fulfillmentType !== 'DELIVERY') return fallbackFee;
    if (!cart.merchantId) return fallbackFee;
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: cart.merchantId },
      select: { freeDeliveryEnabled: true, freeDeliveryKm: true, baseDeliveryKm: true, baseDeliveryFee: true, beyondFreeDeliveryFee: true, beyondDeliveryFeeMode: true, maxDeliveryKm: true },
    });
    if (!merchant) return fallbackFee;
    return deliveryFeeForDistance({
      freeDeliveryEnabled: merchant.freeDeliveryEnabled,
      freeDeliveryKm: dec(merchant.freeDeliveryKm),
      baseDeliveryKm: dec(merchant.baseDeliveryKm),
      baseDeliveryFee: dec(merchant.baseDeliveryFee),
      beyondFreeDeliveryFee: dec(merchant.beyondFreeDeliveryFee),
      beyondDeliveryFeeMode: merchant.beyondDeliveryFeeMode === 'FIXED' ? 'FIXED' : 'PER_KM',
      maxDeliveryKm: dec(merchant.maxDeliveryKm),
    }, null, fallbackFee);
  }

  private async promoFacts(cart: CartRecord, customerId?: string | null): Promise<PromoFacts | null> {
    const promo = cart.promoCode;
    if (!promo || !orderPromoForMerchant(promo, cart.merchantId)) return null;
    const usedCount = await this.prisma.promoRedemption.count({ where: { promoCodeId: promo.id } });
    const customerUsed = customerId ? await this.prisma.promoRedemption.count({ where: { promoCodeId: promo.id, customerId } }) : 0;
    const customerOrderCount = customerId ? await this.prisma.order.count({ where: { customerId, merchantId: cart.merchantId!, status: { not: 'CANCELLED' } } }) : 0;
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
      merchantAllowed: true,
      categoryAllowed: true,
      now: new Date(),
    };
  }

  private async platformRules(merchantId: string | null) {
    const [merchant, rule, free] = await Promise.all([
      merchantId ? this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { orderCharges: true } }) : Promise.resolve(null),
      this.prisma.deliveryPricingRule.findFirst({ where: { active: true, OR: [{ merchantId }, { merchantId: null }] }, orderBy: { merchantId: 'desc' } }),
      this.prisma.freeDeliveryRule.findFirst({ where: { active: true, OR: [{ merchantId }, { merchantId: null }] }, orderBy: { merchantId: 'desc' } }),
    ]);
    const charges = merchantOrderCharges(merchant?.orderCharges);
    return {
      serviceFee: charges.serviceFee,
      tax: charges.tax,
      deliveryFee: rule ? dec(rule.baseFee) : '0.500',
      freeDeliveryMinimum: free ? dec(free.minimumOrder) : null,
    };
  }

  private async storeIsOpen(merchantId: string) {
    const subscription = await this.prisma.merchantSubscription.findUnique({ where: { merchantId } });
    if (subscription && subscriptionShouldExpire(subscription)) {
      await this.prisma.merchantSubscription.update({ where: { id: subscription.id }, data: { status: 'EXPIRED' } });
    }
    return subscriptionIsLive(subscription);
  }

  private async merchantCards(where: Record<string, unknown>, located?: { point: Point; context: DeliveryContext }) {
    const merchants = await this.prisma.merchant.findMany({
      where,
      include: { hours: true, ...deliveryInclude, categories: { include: { category: true } }, subscription: { include: { plan: { include: { entitlements: true } } } } },
    });
    const due = merchants.flatMap((merchant) =>
      merchant.subscription && subscriptionShouldExpire(merchant.subscription) ? [merchant.subscription.id] : [],
    );
    if (due.length) {
      await this.prisma.merchantSubscription.updateMany({ where: { id: { in: due } }, data: { status: 'EXPIRED' } });
    }
    return merchants.map((merchant) => {
      const visibility = merchant.subscription ? safeSuggestion(paidEntitlements(merchant.subscription)) : 'ALL_STORES';
      const live = subscriptionIsLive(merchant.subscription);
      const fulfillment: FulfillmentType[] = [];
      if (merchant.deliveryEnabled) fulfillment.push('DELIVERY');
      if (merchant.takeawayEnabled) fulfillment.push('TAKEAWAY');
      if (merchant.dineInEnabled) fulfillment.push('DINE_IN');
      const paused = merchant.availability === 'CLOSED' || merchant.availability === 'BUSY' || (merchant.temporaryClosedUntil && merchant.temporaryClosedUntil > new Date());
      const open = paused ? false : isOpenAt(merchant.hours, new Date());
      const reach = located ? this.delivery.listingQuote(merchant, located.point, located.context) : null;
      const nearestBranch = reach?.branch ?? merchant.branches.find((branch) => branch.active) ?? merchant.branches[0];
      const legacyFee = deliveryFeeForDistance({
        freeDeliveryEnabled: merchant.freeDeliveryEnabled,
        freeDeliveryKm: dec(merchant.freeDeliveryKm),
        baseDeliveryKm: dec(merchant.baseDeliveryKm),
        baseDeliveryFee: dec(merchant.baseDeliveryFee),
        beyondFreeDeliveryFee: dec(merchant.beyondFreeDeliveryFee),
        beyondDeliveryFeeMode: merchant.beyondDeliveryFeeMode === 'FIXED' ? 'FIXED' : 'PER_KM',
        maxDeliveryKm: dec(merchant.maxDeliveryKm),
      }, null, '0.500');
      return {
        id: merchant.id,
        slug: merchant.slug,
        name: loc(merchant.name),
        description: loc(merchant.description),
        logoUrl: merchant.logoUrl,
        coverUrl: merchant.coverUrl,
        rating: dec(merchant.ratingAverage),
        reviewCount: merchant.ratingCount,
        deliveryMinutes: reach ? reach.minutes : merchant.preparationMinutes + 15,
        deliveryFee: reach?.quote?.available ? reach.quote.total : legacyFee,
        branchId: nearestBranch?.id ?? null,
        distanceKm: reach?.quote && reach.reason !== 'INVALID_COORDINATES' ? reach.quote.distanceKm : null,
        deliveryAvailable: reach ? Boolean(reach.quote?.available) : merchant.deliveryEnabled,
        deliveryUnavailableReason: reach?.reason ?? null,
        freeDeliveryAbove: reach?.quote?.freeAboveOrder ?? null,
        minimumOrder: dec(merchant.minimumOrder),
        isOpen: live && open,
        temporarilyUnavailable: !live,
        visibility,
        fulfillment,
        categories: merchant.categories.map((link) => loc(link.category.name)),
        categorySlugs: merchant.categories.map((link) => link.category.slug),
        city: merchant.branches.find((branch) => branch.active)?.city ?? merchant.branches[0]?.city ?? null,
        freeDelivery: reach?.quote?.available ? reach.quote.free : merchant.freeDeliveryEnabled,
        latitude: nearestBranch ? Number(nearestBranch.latitude) : null,
        longitude: nearestBranch ? Number(nearestBranch.longitude) : null,
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

  private async collapseDuplicateLines(cart: CartRecord) {
    const groups = new Map<string, CartRecord['items']>();
    for (const item of cart.items) {
      const key = cartLineKey(item);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    let changed = false;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      changed = true;
      const [keep, ...duplicates] = group;
      await this.prisma.cartItem.update({
        where: { id: keep!.id },
        data: { quantity: group.reduce((sum, item) => sum + item.quantity, 0) },
      });
      await this.prisma.cartItem.deleteMany({ where: { id: { in: duplicates.map((item) => item.id) } } });
    }
    return changed;
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
    if (!cart) throw badRequest('Your cart is empty');
    return cart;
  }
}

const cartInclude = {
  items: { include: { addons: true } },
  promoCode: true,
} as const;

/** Changes whenever a line, quantity, option or promo in the cart changes. Checkout compares it to spot edits made elsewhere. */
function cartVersion(cart: { promoCodeId: string | null; items: { id: string; productId: string; variantId: string | null; notes: string | null; quantity: number; addons: { addonId: string }[] }[] }) {
  const lines = cart.items
    .map((item) => `${item.id}:${item.quantity}:${mergeLineKey({ productId: item.productId, variantId: item.variantId, notes: item.notes, addonIds: item.addons.map((addon) => addon.addonId) })}`)
    .sort();
  return createHash('sha1').update([cart.promoCodeId ?? '', ...lines].join(';')).digest('hex').slice(0, 16);
}

function cartLineKey(item: { productId: string; variantId: string | null; notes: string | null; addons: { addonId: string }[] }) {
  const addons = item.addons.map((addon) => addon.addonId).sort().join(',');
  return [item.productId, item.variantId ?? '', item.notes?.trim() || '', addons].join('|');
}

function sameCartLine(
  item: { productId: string; variantId: string | null; notes: string | null; addons: { addonId: string }[] },
  next: { productId: string; variantId: string | null; notes: string | null; addonIds: string[] },
) {
  return cartLineKey(item) === cartLineKey({ ...next, variantId: next.variantId, addons: next.addonIds.map((addonId) => ({ addonId })) });
}

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

/** Out of range, delivery switched off, or no active branch: the store cannot serve this location. */
function deliverableFrom(merchant: { deliveryAvailable: boolean; deliveryUnavailableReason: string | null; fulfillment: FulfillmentType[] }) {
  if (merchant.deliveryAvailable) return true;
  return merchant.deliveryUnavailableReason === 'INVALID_COORDINATES';
}

/** Open stores first, then the closest, the quickest and the best rated. */
export function sortNearby<T extends { isOpen: boolean; temporarilyUnavailable: boolean; distanceKm: string | null; deliveryMinutes: number; rating: string }>(rows: T[]) {
  const rank = (row: T) => (row.isOpen && !row.temporarilyUnavailable ? 0 : 1);
  const km = (row: T) => (row.distanceKm === null ? Number.POSITIVE_INFINITY : Number(row.distanceKm));
  return [...rows].sort((a, b) => rank(a) - rank(b) || km(a) - km(b) || a.deliveryMinutes - b.deliveryMinutes || Number(b.rating) - Number(a.rating));
}

export type CheckoutRequest = {
  paymentMethod: PaymentMethodCode;
  fulfillmentType: FulfillmentType;
  addressId?: string | null;
  tableId?: string | null;
  scheduledFor?: string | null;
  notes?: string | null;
  promoCode?: string | null;
  expectedTotal?: string | null;
  cartVersion?: string | null;
};

type AddressRow = {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  latitude: { toString(): string };
  longitude: { toString(): string };
  building: string | null;
  flat: string | null;
  road: string | null;
  block: string | null;
  area: string | null;
  landmark: string | null;
  contactName: string | null;
  contactPhone: string | null;
  instructions: string | null;
  isDefault: boolean;
};

export function presentAddress(address: AddressRow) {
  return {
    id: address.id,
    label: address.label,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    latitude: Number(address.latitude.toString()).toFixed(6),
    longitude: Number(address.longitude.toString()).toFixed(6),
    building: address.building,
    flat: address.flat,
    road: address.road,
    block: address.block,
    area: address.area,
    landmark: address.landmark,
    contactName: address.contactName,
    contactPhone: address.contactPhone,
    instructions: address.instructions,
    isDefault: address.isDefault,
  };
}

function addressSnapshot(address: AddressRow) {
  const view = presentAddress(address);
  const { id, isDefault: _default, ...rest } = view;
  return { addressId: id, ...rest };
}

function emptyPrice() {
  return {
    subtotal: '0.000',
    discount: '0.000',
    deliveryFee: '0.000',
    deliveryFeeSaved: '0.000',
    serviceFee: '0.000',
    deliveryTax: '0.000',
    tax: '0.000',
    total: '0.000',
    currency: 'BHD' as const,
    promoCode: null,
    serviceFeeLabel: { en: 'Service fee', ar: 'رسوم الخدمة' },
    taxLabel: { en: 'Tax', ar: 'الضريبة' },
  };
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
