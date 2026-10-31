import type { Request } from 'express';
import { cartContextSchema, cartItemSchema, checkoutSchema, promoApplySchema, reviewSchema, serviceRequestCreateSchema } from '@alliva/validation';
import { checkoutError, forbidden, notFound } from '../common/errors';
import { authCookieName, authPortal, cookieBase, RequestUser, validate } from '../common/http';
import { createRoutes } from '../common/routes';
import type { Container } from '../container';
import type { CheckoutRequest } from '../modules/commerce.service';

export function storefrontRoutes({ prisma, jwt, crypto, commerce, floor }: Container) {
  const routes = createRoutes({ jwt, prisma }, 'Storefront');

  routes.post('/guests', { public: true }, async (request, response) => {
    const current = request.cookies?.alliva_guest as string | undefined;
    const existing = current
      ? await prisma.guest.findUnique({ where: { tokenHash: crypto.hash(current) } })
      : null;
    if (existing && !existing.mergedIntoCustomerId) {
      // A restored guest whose readable CSRF cookie was cleared could never change its cart again; hand out a fresh one.
      const csrfName = authCookieName('alliva_csrf', authPortal(request));
      if (request.cookies?.[csrfName]) return { id: existing.id };
      const csrf = crypto.random(24);
      response.cookie(csrfName, csrf, { ...cookieBase(), httpOnly: false, maxAge: 180 * 86400000 });
      return { id: existing.id, csrfToken: csrf };
    }
    const token = crypto.random();
    const guest = await prisma.guest.create({ data: { tokenHash: crypto.hash(token) } });
    response.cookie('alliva_guest', token, { ...cookieBase(), httpOnly: true, maxAge: 180 * 86400000 });
    const csrf = crypto.random(24);
    response.cookie(authCookieName('alliva_csrf', authPortal(request)), csrf, { ...cookieBase(), httpOnly: false, maxAge: 180 * 86400000 });
    return { id: guest.id, csrfToken: csrf };
  });

  routes.get('/storefront/home', { public: true }, async (request) => {
    const query = request.query as { lat?: string; lng?: string; q?: string };
    const viewer = await viewerFor(request, request.user);
    return commerce.home({
      lat: query.lat,
      lng: query.lng,
      q: query.q,
      exclusiveSlug: request.cookies?.alliva_storefront,
      customerId: viewer.customerId,
      guestId: viewer.guestId,
    });
  });

  routes.get('/storefront/merchants/:slug', { public: true }, (request) => commerce.merchantBySlug(request.params.slug as string));

  routes.get('/storefront/products/:id', { public: true }, async (request) => {
    const viewer = await viewerFor(request, request.user);
    return commerce.product(request.params.id as string, viewer);
  });

  routes.get('/qr/:code', { public: true }, (request) => commerce.resolveQr(request.params.code as string));

  routes.post('/qr/:code/enter', { public: true }, async (request, response) => {
    const resolved = await commerce.resolveQr(request.params.code as string);
    response.cookie('alliva_storefront', resolved.merchantSlug, { ...cookieBase(), httpOnly: false, maxAge: 12 * 3600000 });
    if (resolved.tableId) {
      response.cookie('alliva_table', resolved.tableId, { ...cookieBase(), httpOnly: false, maxAge: 12 * 3600000 });
    }
    return resolved;
  });

  /** The table the diner scanned in at, and whether staff are on the way. */
  routes.get('/table-service', { public: true }, (request) => floor.tableService(request.cookies?.alliva_table as string | undefined));

  routes.post('/table-service/calls', { public: true, throttle: 10 }, (request) => {
    const body = validate<{ kind: 'WAITER' | 'BILL' | 'HELP' }>(serviceRequestCreateSchema, request.body);
    return floor.callStaff(request.cookies?.alliva_table as string | undefined, body.kind);
  });

  routes.get('/cart', { public: true }, async (request) => commerce.cartFor(await viewerFor(request, request.user)));

  routes.post('/cart/items', { public: true }, async (request) => {
    const body = validate<{ productId: string; variantId?: string | null; addonIds?: string[]; quantity: number; notes?: string; replace?: boolean }>(cartItemSchema, request.body);
    return commerce.addItem(await viewerFor(request, request.user), body);
  });

  routes.patch('/cart/items/:id', { public: true }, async (request) => {
    const body = request.body as { quantity: number; variantId?: string | null };
    return commerce.updateItem(await viewerFor(request, request.user), request.params.id as string, Number(body.quantity), body.variantId);
  });

  routes.delete('/cart/items/:id', { public: true }, async (request) =>
    commerce.removeItem(await viewerFor(request, request.user), request.params.id as string),
  );

  routes.put('/cart/context', { public: true }, async (request) => {
    const body = validate<{ fulfillmentType: 'DELIVERY' | 'TAKEAWAY' | 'DINE_IN'; addressId?: string | null; tableId?: string | null; scheduledFor?: string | null; notes?: string | null }>(cartContextSchema, request.body);
    return commerce.setContext(await viewerFor(request, request.user), body);
  });

  routes.post('/cart/promo', { public: true, throttle: 10 }, async (request) => {
    const body = validate<{ code: string }>(promoApplySchema, request.body);
    return commerce.applyPromo(await viewerFor(request, request.user), body.code);
  });

  routes.delete('/cart/promo', { public: true }, async (request) => commerce.clearPromo(await viewerFor(request, request.user)));

  routes.post('/orders', { throttle: 20 }, (request) => {
    const user = request.user!;
    const body = validate<CheckoutRequest>(checkoutSchema, request.body);
    const key = request.header('idempotency-key');
    if (!user.customerId) throw checkoutError('AUTH_REQUIRED', 'A customer account is required');
    return commerce.checkout(
      { customerId: user.customerId, userId: user.id, roles: user.roles },
      { ...body, idempotencyKey: key || `order-${user.customerId}-${Date.now()}` },
    );
  });

  routes.get('/orders', (request) => {
    const user = request.user!;
    if (user.customerId) return commerce.listOrders({ customerId: user.customerId });
    if (user.merchantId) return commerce.listOrders({ merchantId: user.merchantId });
    return commerce.listOrders({});
  });

  routes.get('/orders/:id', async (request) => {
    const user = request.user!;
    const id = request.params.id as string;
    const row = await prisma.order.findUnique({ where: { id }, select: { customerId: true, merchantId: true } });
    if (!row) throw notFound('Order not found');
    const staff = user.permissions.includes('order.view') && !user.merchantId && !user.customerId;
    const merchant = user.merchantId && user.merchantId === row.merchantId;
    const customer = user.customerId && user.customerId === row.customerId;
    if (!staff && !merchant && !customer) throw forbidden('You cannot view this order');
    return commerce.presentOrder(id);
  });

  routes.post('/orders/:id/cancel', (request) => {
    const body = request.body as { reason?: string };
    return commerce.transition(request.user!, request.params.id as string, { status: 'CANCELLED', cancellationReason: body.reason ?? 'Cancelled by customer', note: body.reason });
  });

  routes.post('/orders/:id/review', async (request) => {
    const user = request.user!;
    const id = request.params.id as string;
    const body = validate<{ rating: number; comment?: string }>(reviewSchema, request.body);
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    if (!user.customerId || order.customerId !== user.customerId) throw new Error('You can only review your own order');
    const review = await prisma.review.create({
      data: { orderId: id, merchantId: order.merchantId, customerId: user.customerId, authorId: user.id, rating: body.rating, comment: body.comment },
    });
    const aggregate = await prisma.review.aggregate({ where: { merchantId: order.merchantId }, _avg: { rating: true }, _count: true });
    await prisma.merchant.update({
      where: { id: order.merchantId },
      data: { ratingAverage: aggregate._avg.rating ?? 0, ratingCount: aggregate._count },
    });
    return review;
  });

  routes.post('/orders/:id/reorder', async (request) => {
    const user = request.user!;
    const order = await prisma.order.findUniqueOrThrow({ where: { id: request.params.id as string }, include: { items: { include: { addons: true } } } });
    for (const item of order.items) {
      if (!item.productId) continue;
      await commerce.addItem(
        { customerId: user.customerId },
        { productId: item.productId, variantId: item.variantId, quantity: item.quantity, addonIds: item.addons.map((addon) => addon.addonId).filter((value): value is string => Boolean(value)) },
      );
    }
    return commerce.cartFor({ customerId: user.customerId });
  });

  async function viewerFor(request: Request, user?: RequestUser) {
    const token = request.cookies?.alliva_guest as string | undefined;
    const guest = token ? await prisma.guest.findUnique({ where: { tokenHash: crypto.hash(token) } }) : null;
    return { customerId: user?.customerId ?? null, guestId: guest?.id ?? null };
  }

  return routes;
}
