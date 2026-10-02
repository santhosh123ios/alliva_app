import { Body, Controller, Delete, ForbiddenException, Get, Headers, Inject, NotFoundException, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { cartContextSchema, cartItemSchema, checkoutSchema, promoApplySchema, reviewSchema } from '@alliva/validation';
import { CryptoService } from '../common/crypto';
import { cookieBase, CurrentUser, Public, RequestUser, ZodValidationPipe } from '../common/http';
import { PrismaService } from '../prisma/prisma.service';
import { CommerceService } from './commerce.service';

@ApiTags('Storefront')
@Controller()
export class StorefrontController {
  constructor(
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
  ) {}

  @Public()
  @Post('guests')
  async guest(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const current = request.cookies?.alliva_guest as string | undefined;
    const existing = current
      ? await this.prisma.guest.findUnique({ where: { tokenHash: this.crypto.hash(current) } })
      : null;
    if (existing && !existing.mergedIntoCustomerId) return { id: existing.id };
    const token = this.crypto.random();
    const guest = await this.prisma.guest.create({ data: { tokenHash: this.crypto.hash(token) } });
    response.cookie('alliva_guest', token, { ...cookieBase(), httpOnly: true, maxAge: 180 * 86400000 });
    const csrf = this.crypto.random(24);
    response.cookie('alliva_csrf', csrf, { ...cookieBase(), httpOnly: false, maxAge: 180 * 86400000 });
    return { id: guest.id, csrfToken: csrf };
  }

  @Public()
  @Get('storefront/home')
  home(
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('q') q?: string,
    @Req() request?: Request,
    @CurrentUser() user?: RequestUser,
  ) {
    return this.withViewer(request, user, (viewer) =>
      this.commerce.home({
        lat,
        lng,
        q,
        exclusiveSlug: request?.cookies?.alliva_storefront,
        customerId: viewer.customerId,
        guestId: viewer.guestId,
      }),
    );
  }

  @Public()
  @Get('storefront/merchants/:slug')
  merchant(@Param('slug') slug: string) {
    return this.commerce.merchantBySlug(slug);
  }

  @Public()
  @Get('storefront/products/:id')
  async product(@Param('id') id: string, @Req() request: Request, @CurrentUser() user?: RequestUser) {
    const viewer = await this.viewer(request, user);
    return this.commerce.product(id, viewer);
  }

  @Public()
  @Get('qr/:code')
  qr(@Param('code') code: string) {
    return this.commerce.resolveQr(code);
  }

  @Public()
  @Post('qr/:code/enter')
  async enter(@Param('code') code: string, @Res({ passthrough: true }) response: Response) {
    const resolved = await this.commerce.resolveQr(code);
    response.cookie('alliva_storefront', resolved.merchantSlug, { ...cookieBase(), httpOnly: false, maxAge: 12 * 3600000 });
    if (resolved.tableId) {
      response.cookie('alliva_table', resolved.tableId, { ...cookieBase(), httpOnly: false, maxAge: 12 * 3600000 });
    }
    return resolved;
  }

  @Public()
  @Get('cart')
  async cart(@Req() request: Request, @CurrentUser() user?: RequestUser) {
    return this.commerce.cartFor(await this.viewer(request, user));
  }

  @Public()
  @Post('cart/items')
  async add(
    @Body(new ZodValidationPipe(cartItemSchema)) body: { productId: string; variantId?: string | null; addonIds?: string[]; quantity: number; notes?: string },
    @Req() request: Request,
    @CurrentUser() user?: RequestUser,
  ) {
    return this.commerce.addItem(await this.viewer(request, user), body);
  }

  @Public()
  @Patch('cart/items/:id')
  async updateItem(@Param('id') id: string, @Body() body: { quantity: number; variantId?: string | null }, @Req() request: Request, @CurrentUser() user?: RequestUser) {
    return this.commerce.updateItem(await this.viewer(request, user), id, Number(body.quantity), body.variantId);
  }

  @Public()
  @Delete('cart/items/:id')
  async remove(@Param('id') id: string, @Req() request: Request, @CurrentUser() user?: RequestUser) {
    return this.commerce.removeItem(await this.viewer(request, user), id);
  }

  @Public()
  @Put('cart/context')
  async context(
    @Body(new ZodValidationPipe(cartContextSchema)) body: { fulfillmentType: 'DELIVERY' | 'TAKEAWAY' | 'DINE_IN'; addressId?: string | null; tableId?: string | null; scheduledFor?: string | null; notes?: string | null },
    @Req() request: Request,
    @CurrentUser() user?: RequestUser,
  ) {
    return this.commerce.setContext(await this.viewer(request, user), body);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('cart/promo')
  async promo(@Body(new ZodValidationPipe(promoApplySchema)) body: { code: string }, @Req() request: Request, @CurrentUser() user?: RequestUser) {
    return this.commerce.applyPromo(await this.viewer(request, user), body.code);
  }

  @Public()
  @Delete('cart/promo')
  async clearPromo(@Req() request: Request, @CurrentUser() user?: RequestUser) {
    return this.commerce.clearPromo(await this.viewer(request, user));
  }

  @Post('orders')
  checkout(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(checkoutSchema))
    body: { paymentMethod: 'CARD' | 'BENEFIT' | 'BENEFIT_PAY' | 'CASH'; fulfillmentType: 'DELIVERY' | 'TAKEAWAY' | 'DINE_IN'; addressId?: string | null; tableId?: string | null; scheduledFor?: string | null; notes?: string | null; promoCode?: string | null },
    @Headers('idempotency-key') key?: string,
  ) {
    if (!user.customerId) throw new Error('A customer account is required');
    return this.commerce.checkout(
      { customerId: user.customerId, userId: user.id, roles: user.roles },
      { ...body, idempotencyKey: key || `order-${user.customerId}-${Date.now()}` },
    );
  }

  @Get('orders')
  orders(@CurrentUser() user: RequestUser) {
    if (user.customerId) return this.commerce.listOrders({ customerId: user.customerId });
    if (user.merchantId) return this.commerce.listOrders({ merchantId: user.merchantId });
    return this.commerce.listOrders({});
  }

  @Get('orders/:id')
  async order(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const row = await this.prisma.order.findUnique({ where: { id }, select: { customerId: true, merchantId: true } });
    if (!row) throw new NotFoundException('Order not found');
    const staff = user.permissions.includes('order.view') && !user.merchantId && !user.customerId;
    const merchant = user.merchantId && user.merchantId === row.merchantId;
    const customer = user.customerId && user.customerId === row.customerId;
    if (!staff && !merchant && !customer) throw new ForbiddenException('You cannot view this order');
    return this.commerce.presentOrder(id);
  }

  @Post('orders/:id/cancel')
  cancel(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.commerce.transition(user, id, { status: 'CANCELLED', cancellationReason: body.reason ?? 'Cancelled by customer', note: body.reason });
  }

  @Post('orders/:id/review')
  async review(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body(new ZodValidationPipe(reviewSchema)) body: { rating: number; comment?: string }) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id } });
    if (!user.customerId || order.customerId !== user.customerId) throw new Error('You can only review your own order');
    const review = await this.prisma.review.create({
      data: { orderId: id, merchantId: order.merchantId, customerId: user.customerId, authorId: user.id, rating: body.rating, comment: body.comment },
    });
    const aggregate = await this.prisma.review.aggregate({ where: { merchantId: order.merchantId }, _avg: { rating: true }, _count: true });
    await this.prisma.merchant.update({
      where: { id: order.merchantId },
      data: { ratingAverage: aggregate._avg.rating ?? 0, ratingCount: aggregate._count },
    });
    return review;
  }

  @Post('orders/:id/reorder')
  async reorder(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id }, include: { items: { include: { addons: true } } } });
    for (const item of order.items) {
      if (!item.productId) continue;
      await this.commerce.addItem(
        { customerId: user.customerId },
        { productId: item.productId, variantId: item.variantId, quantity: item.quantity, addonIds: item.addons.map((addon) => addon.addonId).filter((value): value is string => Boolean(value)) },
      );
    }
    return this.commerce.cartFor({ customerId: user.customerId });
  }

  private async withViewer<T>(request: Request | undefined, user: RequestUser | undefined, run: (viewer: { customerId: string | null; guestId: string | null }) => Promise<T>) {
    return run(await this.viewer(request, user));
  }

  private async viewer(request?: Request, user?: RequestUser) {
    const token = request?.cookies?.alliva_guest as string | undefined;
    const guest = token ? await this.prisma.guest.findUnique({ where: { tokenHash: this.crypto.hash(token) } }) : null;
    return { customerId: user?.customerId ?? null, guestId: guest?.id ?? null };
  }
}