import type { ProductReviews } from '@alliva/types';
import type { Prisma } from '@prisma/client';
import { badRequest, notFound } from '../common/errors';
import type { PrismaService } from '../prisma/prisma.service';

/** A paid table can still rate what it ate for a while after leaving. */
const AFTER_VISIT_MS = 24 * 3600000;
const RECENT = 6;

export type Rater = {
  customerId: string | null;
  guestId: string | null;
  /** The diner's table visit, from the QR they scanned. */
  visit: { tableId: string; openedAt: Date; closedAt: Date | null } | null;
};

/**
 * Ratings for one dish, and whether this viewer may rate it: only someone whose order with the dish was served
 * (or delivered), either at their table during their visit or as a signed-in customer.
 */
export async function productReviews(prisma: PrismaService, productId: string, rater: Rater): Promise<ProductReviews> {
  const [summary, recent, order] = await Promise.all([
    prisma.productReview.aggregate({ where: { productId }, _avg: { rating: true }, _count: true }),
    prisma.productReview.findMany({ where: { productId }, orderBy: { createdAt: 'desc' }, take: RECENT }),
    rateableOrder(prisma, productId, rater),
  ]);
  const names = await authorNames(prisma, recent.map((row) => row.customerId));
  const mine = order ? await prisma.productReview.findUnique({ where: { orderId_productId: { orderId: order.id, productId } } }) : null;
  return {
    average: summary._count ? Math.round((summary._avg.rating ?? 0) * 10) / 10 : null,
    count: summary._count,
    recent: recent.map((row) => ({ id: row.id, rating: row.rating, comment: row.comment, author: (row.customerId && names.get(row.customerId)) || null, createdAt: row.createdAt.toISOString() })),
    mine: order ? { orderNumber: order.number, rating: mine?.rating ?? null, comment: mine?.comment ?? null } : null,
  };
}

/** Saves the viewer's rating for the dish; rating it again for the same order replaces the earlier one. */
export async function rateProduct(prisma: PrismaService, productId: string, rater: Rater, input: { rating: number; comment?: string | null }) {
  const order = await rateableOrder(prisma, productId, rater);
  if (!order) throw badRequest('You can rate a dish once it has been served to you');
  const data = { rating: input.rating, comment: input.comment?.trim() || null, customerId: rater.customerId, guestId: rater.guestId };
  await prisma.productReview.upsert({
    where: { orderId_productId: { orderId: order.id, productId } },
    update: data,
    create: { ...data, productId, orderId: order.id, merchantId: order.merchantId },
  });
  return productReviews(prisma, productId, rater);
}

/** The latest served order with this dish that the viewer ate from. */
async function rateableOrder(prisma: PrismaService, productId: string, rater: Rater) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) throw notFound('Product not found');
  const served: Prisma.OrderWhereInput = { OR: [{ status: 'DELIVERED' }, { billId: { not: null }, status: { notIn: ['CANCELLED', 'REFUNDED'] } }] };
  const ways: Prisma.OrderWhereInput[] = [];
  if (rater.customerId) ways.push({ customerId: rater.customerId });
  if (rater.visit && (!rater.visit.closedAt || Date.now() - rater.visit.closedAt.getTime() < AFTER_VISIT_MS)) {
    ways.push({ tableId: rater.visit.tableId, createdAt: { gte: rater.visit.openedAt, ...(rater.visit.closedAt ? { lte: rater.visit.closedAt } : {}) } });
  }
  if (!ways.length) return null;
  return prisma.order.findFirst({
    where: { AND: [served, { OR: ways }, { items: { some: { productId } } }] },
    orderBy: { createdAt: 'desc' },
    select: { id: true, number: true, merchantId: true },
  });
}

/** First name and last initial, so a signed-in reviewer is recognisable without showing their full name. */
async function authorNames(prisma: PrismaService, customerIds: (string | null)[]) {
  const ids = [...new Set(customerIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map<string, string>();
  const rows = await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } });
  return new Map(rows.map((row) => [row.id, `${row.user.firstName} ${row.user.lastName ? `${row.user.lastName[0]}.` : ''}`.trim()]));
}
