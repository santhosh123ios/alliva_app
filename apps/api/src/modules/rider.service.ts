import type { OrderStatus } from '@alliva/types';
import { dec, loc } from '../common/crypto';
import { badRequest, forbidden, notFound } from '../common/errors';
import type { RequestUser } from '../common/http';
import { handoffCode, handoffToken, optimiseRoute, routeEstimate, normalizeHandoffCode, parsePickupQr, PICKUP_QR_PREFIX } from '../domain/dispatch';
import { haversineKm, type Point } from '../domain/geo';
import { money, moneyString } from '../domain/money';
import { startOfDay } from '../domain/store-day';
import type { PrismaService } from '../prisma/prisma.service';
import type { CommerceService } from './commerce.service';

/** Orders a rider still has to act on. Delivered ones show for the rest of the day. */
const ACTIVE: OrderStatus[] = ['ASSIGNED_TO_DRIVER', 'OUT_FOR_DELIVERY'];

type Snapshot = {
  label?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  building?: string | null;
  flat?: string | null;
  road?: string | null;
  block?: string | null;
  area?: string | null;
  landmark?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  instructions?: string | null;
  pinCorrectedAt?: string | null;
};

const riderOrderInclude = {
  merchant: { select: { name: true, phone: true } },
  branch: { select: { id: true, name: true, line1: true, city: true, latitude: true, longitude: true, phone: true } },
  items: { include: { addons: true } },
  customer: { include: { user: { select: { firstName: true, lastName: true, phone: true } } } },
  payments: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { method: true, status: true } },
  dispatch: true,
  cashCollection: true,
  deliveryIssues: { orderBy: { createdAt: 'desc' as const } },
  events: { orderBy: { createdAt: 'asc' as const }, select: { status: true, createdAt: true, note: true } },
} as const;

type RiderOrderRow = NonNullable<Awaited<ReturnType<PrismaService['order']['findFirst']>>> & {
  merchant: { name: unknown; phone: string | null };
  branch: { id: string; name: unknown; line1: string; city: string; latitude: { toString(): string }; longitude: { toString(): string }; phone: string | null };
  items: { name: unknown; quantity: number; lineTotal: { toFixed(digits: number): string }; notes: string | null; addons: { name: unknown; quantity: number }[] }[];
  customer: { user: { firstName: string; lastName: string; phone: string | null } };
  payments: { method: string; status: string }[];
  dispatch: { sequence: number; pickupVerifiedAt: Date | null; pickupMethod: string | null; assignedAt: Date } | null;
  cashCollection: { amount: { toFixed(digits: number): string }; collectedAmount: { toFixed(digits: number): string } | null; status: string; depositId: string | null } | null;
  deliveryIssues: { id: string; type: string; note: string | null; status: string; createdAt: Date }[];
  events: { status: string; createdAt: Date; note: string | null }[];
};

export class RiderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerce: CommerceService,
  ) {}

  /** The rider's driver profile. Every rider endpoint goes through this, so a rider never sees another store. */
  async driver(user: RequestUser) {
    const driver = await this.prisma.driverProfile.findUnique({ where: { userId: user.id } });
    if (!driver || !driver.active) throw forbidden('No active delivery profile for this account');
    if (!user.merchantId || driver.merchantId !== user.merchantId) throw forbidden('This delivery profile belongs to another store');
    return driver;
  }

  async profile(user: RequestUser) {
    const driver = await this.driver(user);
    const merchant = await this.prisma.merchant.findUnique({ where: { id: driver.merchantId! }, select: { name: true, logoUrl: true, phone: true } });
    const today = startOfDay();
    const [deliveredToday, active] = await Promise.all([
      this.prisma.dispatchAssignment.count({ where: { driverId: driver.id, order: { status: 'DELIVERED', updatedAt: { gte: today } } } }),
      this.prisma.dispatchAssignment.count({ where: { driverId: driver.id, order: { status: { in: ACTIVE } } } }),
    ]);
    return {
      id: driver.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      vehicle: driver.vehicle,
      onShift: driver.onShift,
      shiftStartedAt: driver.shiftStartedAt?.toISOString() ?? null,
      store: merchant ? { name: loc(merchant.name), logoUrl: merchant.logoUrl, phone: merchant.phone } : null,
      deliveredToday,
      activeOrders: active,
    };
  }

  async setShift(user: RequestUser, input: { onShift: boolean; latitude?: number; longitude?: number }) {
    const driver = await this.driver(user);
    if (!input.onShift) {
      const open = await this.prisma.dispatchAssignment.count({ where: { driverId: driver.id, order: { status: 'OUT_FOR_DELIVERY' } } });
      if (open) throw badRequest('Finish your deliveries on the road before going off shift');
    }
    await this.prisma.driverProfile.update({
      where: { id: driver.id },
      data: {
        onShift: input.onShift,
        shiftStartedAt: input.onShift ? (driver.onShift ? driver.shiftStartedAt : new Date()) : null,
        ...(input.latitude !== undefined && input.longitude !== undefined ? { lastLatitude: input.latitude, lastLongitude: input.longitude, lastSeenAt: new Date() } : {}),
      },
    });
    return this.profile(user);
  }

  async ping(user: RequestUser, point: Point) {
    const driver = await this.driver(user);
    await this.prisma.driverProfile.update({ where: { id: driver.id }, data: { lastLatitude: point.latitude, lastLongitude: point.longitude, lastSeenAt: new Date() } });
    return { ok: true };
  }

  /**
   * Active orders first, in the order to drive them: the shortest route we can find through every drop.
   * While any order still has to be collected the route starts at the store; once all are on board it starts where the rider is.
   */
  async orders(user: RequestUser, from: Point | null) {
    const driver = await this.driver(user);
    const rows = (await this.prisma.order.findMany({
      where: {
        merchantId: driver.merchantId!,
        dispatch: { driverId: driver.id },
        OR: [{ status: { in: ACTIVE } }, { status: 'DELIVERED', updatedAt: { gte: startOfDay() } }],
      },
      include: riderOrderInclude,
    })) as unknown as RiderOrderRow[];
    const active = rows
      .filter((row) => ACTIVE.includes(row.status))
      // The store's planned order breaks ties and places stops without a pin.
      .sort((a, b) => (a.dispatch?.sequence || 999) - (b.dispatch?.sequence || 999) || a.createdAt.getTime() - b.createdAt.getTime());
    const done = rows.filter((row) => !ACTIVE.includes(row.status)).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const store = active[0] ? branchPoint(active[0].branch) : null;
    const toCollect = active.filter((row) => !row.dispatch?.pickupVerifiedAt).length;
    const start = toCollect || !from ? 'store' : 'rider';
    const origin = start === 'rider' ? from : store ?? from;
    const route = optimiseRoute(origin, active.map((row) => ({ item: row, point: dropoffPoint(row) })));
    const totalKm = route.reduce((total, stop) => total + (stop.legKm ?? 0), 0);
    return {
      origin,
      route: active.length ? { start, toCollect, totalKm: round1(totalKm), etaMinutes: routeEstimate(totalKm, route.length) } : null,
      active: route.map((stop, index) =>
        this.present(stop.item, { stop: index + 1, from, legKm: stop.legKm, etaMinutes: stop.cumulativeKm === null ? null : routeEstimate(stop.cumulativeKm, index + 1) }),
      ),
      delivered: done.map((row) => this.present(row, { stop: null, from: null })),
    };
  }

  async order(user: RequestUser, id: string) {
    const driver = await this.driver(user);
    const row = (await this.prisma.order.findFirst({ where: { id, merchantId: driver.merchantId!, dispatch: { driverId: driver.id } }, include: riderOrderInclude })) as unknown as RiderOrderRow | null;
    if (!row) throw notFound('Order not found');
    return this.present(row, { stop: null, from: null });
  }

  async verifyPickup(user: RequestUser, input: { qr?: string; code?: string; orderId?: string; manual?: boolean }) {
    const driver = await this.driver(user);
    const scope = { merchantId: driver.merchantId!, fulfillmentType: 'DELIVERY' as const, status: { in: ['READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER'] as OrderStatus[] } };
    let order: { id: string; status: OrderStatus; dispatch: { driverId: string; pickupVerifiedAt: Date | null } | null } | null = null;
    let method: 'QR' | 'CODE' = 'CODE';
    if (input.manual && input.orderId) {
      // Ticket lost or unreadable: the rider marks one of their own orders by hand. Stored as a code pickup, noted as manual.
      order = await this.prisma.order.findFirst({ where: { ...scope, id: input.orderId }, include: { dispatch: true } });
    } else if (input.qr) {
      const token = parsePickupQr(input.qr);
      if (!token) throw badRequest('This QR is not an Alliva pickup code');
      order = await this.prisma.order.findFirst({ where: { ...scope, handoffToken: token }, include: { dispatch: true } });
      method = 'QR';
    } else if (input.code) {
      const code = normalizeHandoffCode(input.code);
      const matches = await this.prisma.order.findMany({
        where: { ...scope, handoffCode: code, ...(input.orderId ? { id: input.orderId } : {}) },
        include: { dispatch: true },
        take: 2,
      });
      // Codes are short, so prefer the order already dispatched to this rider.
      order = matches.find((row) => row.dispatch?.driverId === driver.id) ?? matches[0] ?? null;
    }
    if (!order) throw notFound('No order ready for pickup matches this code');
    if (!order.dispatch || order.dispatch.driverId !== driver.id) throw forbidden('This order is not assigned to you. Ask the store to assign it.');
    if (order.status !== 'ASSIGNED_TO_DRIVER') throw badRequest('The store has not handed this order to a rider yet');
    if (!order.dispatch.pickupVerifiedAt) {
      await this.prisma.dispatchAssignment.update({ where: { orderId: order.id }, data: { pickupVerifiedAt: new Date(), pickupMethod: method } });
      await this.prisma.orderStatusEvent.create({ data: { orderId: order.id, status: order.status, note: input.manual ? 'Pickup marked by rider' : method === 'QR' ? 'Pickup verified by QR' : 'Pickup verified by code', actorId: user.id } });
    }
    return this.order(user, order.id);
  }

  async updateStatus(user: RequestUser, id: string, input: { status: 'OUT_FOR_DELIVERY' | 'DELIVERED'; collectedAmount?: string; note?: string }) {
    const driver = await this.driver(user);
    const order = await this.prisma.order.findFirst({ where: { id, merchantId: driver.merchantId!, dispatch: { driverId: driver.id } }, include: { cashCollection: true, payments: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (!order) throw notFound('Order not found');
    const cash = order.payments[0]?.method === 'CASH' ? order.cashCollection : null;
    let note = input.note;
    if (input.status === 'DELIVERED' && cash) {
      if (!input.collectedAmount) throw badRequest('Enter the cash you collected');
      const due = money(dec(cash.amount));
      const got = money(input.collectedAmount);
      if (!got.eq(due) && !input.note) throw badRequest('The amount differs from what is due. Add a note for the store.');
      if (!got.eq(due)) note = `Cash collected ${moneyString(got)} of ${moneyString(due)}: ${input.note}`;
    }
    const view = await this.commerce.transition(user, order.id, { status: input.status, note });
    if (input.status === 'DELIVERED' && cash) {
      await this.prisma.cashCollection.update({
        where: { id: cash.id },
        data: { driverId: driver.id, collectedAmount: input.collectedAmount, collectedAt: new Date(), status: 'COLLECTED' },
      });
    }
    return { order: await this.order(user, order.id), view };
  }

  async correctDropoff(user: RequestUser, id: string, input: { latitude: string; longitude: string; note?: string }) {
    const driver = await this.driver(user);
    const order = await this.prisma.order.findFirst({ where: { id, merchantId: driver.merchantId!, dispatch: { driverId: driver.id }, status: { in: ACTIVE } } });
    if (!order) throw notFound('Order not found');
    const snapshot = (order.addressSnapshot ?? {}) as Snapshot;
    await this.prisma.$transaction([
      this.prisma.deliveryLocationCorrection.create({
        data: { orderId: order.id, merchantId: order.merchantId, driverId: driver.id, latitude: input.latitude, longitude: input.longitude, note: input.note },
      }),
      this.prisma.order.update({
        where: { id: order.id },
        data: {
          addressSnapshot: {
            ...snapshot,
            originalLatitude: (snapshot as { originalLatitude?: unknown }).originalLatitude ?? snapshot.latitude ?? null,
            originalLongitude: (snapshot as { originalLongitude?: unknown }).originalLongitude ?? snapshot.longitude ?? null,
            latitude: input.latitude,
            longitude: input.longitude,
            pinCorrectedAt: new Date().toISOString(),
          },
        },
      }),
    ]);
    return this.order(user, order.id);
  }

  async reportIssue(user: RequestUser, id: string, input: { type: 'CUSTOMER_UNREACHABLE' | 'WRONG_ADDRESS' | 'ITEM_MISSING' | 'DAMAGED' | 'PAYMENT_REFUSED' | 'OTHER'; note?: string }) {
    const driver = await this.driver(user);
    const order = await this.prisma.order.findFirst({ where: { id, merchantId: driver.merchantId!, dispatch: { driverId: driver.id } } });
    if (!order) throw notFound('Order not found');
    await this.prisma.deliveryIssue.create({ data: { orderId: order.id, merchantId: order.merchantId, driverId: driver.id, type: input.type, note: input.note } });
    const staff = await this.prisma.user.findMany({
      where: { merchantId: order.merchantId, status: 'ACTIVE', userRoles: { some: { role: { key: { in: ['MERCHANT_OWNER', 'MERCHANT_MANAGER'] } } } } },
      select: { id: true },
    });
    await this.prisma.notification.createMany({
      data: staff.map((row) => ({ userId: row.id, channel: 'IN_APP' as const, title: `Delivery issue on ${order.number}`, body: `${input.type}${input.note ? `: ${input.note}` : ''}` })),
    });
    return this.order(user, order.id);
  }

  /** Cash in hand, deposits and the rider's recent deliveries with how each was paid. */
  async collections(user: RequestUser) {
    const driver = await this.driver(user);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [cash, deposits, delivered] = await Promise.all([
      this.prisma.cashCollection.findMany({
        where: { driverId: driver.id, status: { in: ['COLLECTED', 'CONFIRMED', 'DISPUTED'] } },
        include: { order: { select: { id: true, number: true } } },
        orderBy: { collectedAt: 'desc' },
        take: 200,
      }),
      this.prisma.cashDeposit.findMany({ where: { driverId: driver.id }, orderBy: { createdAt: 'desc' }, include: { collections: { select: { id: true } } }, take: 50 }),
      this.prisma.order.findMany({
        where: { dispatch: { driverId: driver.id }, status: 'DELIVERED', updatedAt: { gte: since } },
        select: { id: true, number: true, total: true, updatedAt: true, payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { method: true } }, cashCollection: { select: { collectedAmount: true, status: true, depositId: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
    ]);
    const inHand = cash.filter((row) => row.status === 'COLLECTED' && !row.depositId);
    const today = startOfDay();
    const sum = (rows: { collectedAmount: { toFixed(digits: number): string } | null; amount: { toFixed(digits: number): string } }[]) =>
      moneyString(rows.reduce((total, row) => total.plus(dec(row.collectedAmount ?? row.amount)), money('0')));
    return {
      cashInHand: sum(inHand),
      pendingDeposit: moneyString(deposits.filter((row) => row.status === 'SUBMITTED').reduce((total, row) => total.plus(dec(row.amount)), money('0'))),
      collectedToday: sum(cash.filter((row) => row.collectedAt && row.collectedAt >= today)),
      deliveredToday: delivered.filter((row) => row.updatedAt >= today).length,
      inHand: inHand.map((row) => ({
        id: row.id,
        orderId: row.order.id,
        orderNumber: row.order.number,
        amount: dec(row.collectedAmount ?? row.amount),
        collectedAt: row.collectedAt?.toISOString() ?? null,
      })),
      transactions: delivered.map((row) => ({
        orderId: row.id,
        orderNumber: row.number,
        total: dec(row.total),
        method: row.payments[0]?.method ?? null,
        collected: row.cashCollection?.collectedAmount ? dec(row.cashCollection.collectedAmount) : null,
        cashStatus: row.cashCollection ? (row.cashCollection.depositId && row.cashCollection.status === 'COLLECTED' ? 'DEPOSIT_PENDING' : row.cashCollection.status) : null,
        deliveredAt: row.updatedAt.toISOString(),
      })),
      deposits: deposits.map(presentDeposit),
    };
  }

  async deposit(user: RequestUser, input: { collectionIds?: string[]; note?: string }) {
    const driver = await this.driver(user);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.cashCollection.findMany({
        where: { driverId: driver.id, status: 'COLLECTED', depositId: null, ...(input.collectionIds ? { id: { in: input.collectionIds } } : {}) },
      });
      if (!rows.length) throw badRequest('No collected cash to deposit');
      if (input.collectionIds && rows.length !== input.collectionIds.length) throw badRequest('Some of these collections are already deposited');
      const amount = rows.reduce((total, row) => total.plus(dec(row.collectedAmount ?? row.amount)), money('0'));
      const deposit = await tx.cashDeposit.create({ data: { merchantId: driver.merchantId!, driverId: driver.id, amount: moneyString(amount), note: input.note } });
      await tx.cashCollection.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { depositId: deposit.id } });
      return presentDeposit({ ...deposit, collections: rows.map((row) => ({ id: row.id })) });
    });
  }

  /** Store side: deposits waiting for the cashier, newest first. */
  async storeDeposits(merchantId: string) {
    const rows = await this.prisma.cashDeposit.findMany({
      where: { merchantId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { driver: { include: { user: { select: { firstName: true, lastName: true, phone: true } } } }, collections: { include: { order: { select: { number: true } } } } },
      take: 100,
    });
    const outstanding = await this.prisma.cashCollection.findMany({
      where: { merchantId, status: 'COLLECTED', depositId: null, driverId: { not: null } },
      select: { driverId: true, amount: true, collectedAmount: true },
    });
    const drivers = await this.prisma.driverProfile.findMany({ where: { merchantId }, include: { user: { select: { firstName: true, lastName: true } } } });
    return {
      deposits: rows.map((row) => ({
        ...presentDeposit(row),
        rider: { id: row.driver.id, name: `${row.driver.user.firstName} ${row.driver.user.lastName}`.trim(), phone: row.driver.user.phone },
        orders: row.collections.map((collection) => ({ number: collection.order.number, amount: dec(collection.collectedAmount ?? collection.amount) })),
      })),
      inHand: drivers
        .map((driver) => ({
          riderId: driver.id,
          name: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
          amount: moneyString(outstanding.filter((row) => row.driverId === driver.id).reduce((total, row) => total.plus(dec(row.collectedAmount ?? row.amount)), money('0'))),
        }))
        .filter((row) => money(row.amount).gt(0)),
    };
  }

  async decideDeposit(actor: RequestUser, merchantId: string, id: string, input: { decision: 'CONFIRMED' | 'REJECTED'; note?: string }) {
    const deposit = await this.prisma.cashDeposit.findFirst({ where: { id, merchantId } });
    if (!deposit) throw notFound('Deposit not found');
    if (deposit.status !== 'SUBMITTED') throw badRequest('This deposit is already reviewed');
    await this.prisma.$transaction([
      this.prisma.cashDeposit.update({ where: { id }, data: { status: input.decision, reviewNote: input.note, reviewedById: actor.id, reviewedAt: new Date() } }),
      input.decision === 'CONFIRMED'
        ? this.prisma.cashCollection.updateMany({ where: { depositId: id }, data: { status: 'CONFIRMED' } })
        // A rejected deposit puts the cash back in the rider's hands so they can deposit it again.
        : this.prisma.cashCollection.updateMany({ where: { depositId: id }, data: { depositId: null } }),
    ]);
    return this.storeDeposits(merchantId);
  }

  /** Store side: the pickup QR and code for an order ticket. Created on first ask for orders that were ready before this existed. */
  async handoff(merchantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, merchantId }, select: { id: true, number: true, fulfillmentType: true, handoffCode: true, handoffToken: true } });
    if (!order) throw notFound('Order not found');
    if (order.fulfillmentType !== 'DELIVERY') throw badRequest('Only delivery orders have a pickup code');
    let { handoffCode: code, handoffToken: token } = order;
    if (!code || !token) {
      code = handoffCode();
      token = handoffToken();
      await this.prisma.order.update({ where: { id: order.id }, data: { handoffCode: code, handoffToken: token } });
    }
    return { orderId: order.id, number: order.number, code, qr: `${PICKUP_QR_PREFIX}${token}` };
  }

  private present(row: RiderOrderRow, options: { stop: number | null; from: Point | null; legKm?: number | null; etaMinutes?: number | null }) {
    const snapshot = (row.addressSnapshot ?? {}) as Snapshot;
    const drop = dropoffPoint(row);
    const store = branchPoint(row.branch);
    const payment = row.payments[0] ?? null;
    const cashDue = payment?.method === 'CASH' && row.cashCollection ? dec(row.cashCollection.amount) : null;
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      stop: options.stop,
      legKm: options.legKm ?? null,
      etaMinutes: options.etaMinutes ?? null,
      sequence: row.dispatch?.sequence ?? 0,
      createdAt: row.createdAt.toISOString(),
      scheduledFor: row.scheduledFor?.toISOString() ?? null,
      assignedAt: row.dispatch?.assignedAt.toISOString() ?? null,
      pickupVerifiedAt: row.dispatch?.pickupVerifiedAt?.toISOString() ?? null,
      pickupMethod: row.dispatch?.pickupMethod ?? null,
      pickupCode: row.handoffCode ?? null,
      notes: row.notes,
      customer: {
        name: snapshot.contactName || `${row.customer.user.firstName} ${row.customer.user.lastName}`.trim(),
        phone: snapshot.contactPhone || row.customer.user.phone,
      },
      address: {
        label: snapshot.label ?? null,
        line1: snapshot.line1 ?? null,
        line2: snapshot.line2 ?? null,
        city: snapshot.city ?? null,
        building: snapshot.building ?? null,
        flat: snapshot.flat ?? null,
        road: snapshot.road ?? null,
        block: snapshot.block ?? null,
        area: snapshot.area ?? null,
        landmark: snapshot.landmark ?? null,
        instructions: snapshot.instructions ?? null,
        latitude: drop?.latitude ?? null,
        longitude: drop?.longitude ?? null,
        pinCorrectedAt: snapshot.pinCorrectedAt ?? null,
      },
      store: {
        name: loc(row.merchant.name),
        branch: loc(row.branch.name),
        line1: row.branch.line1,
        city: row.branch.city,
        phone: row.branch.phone ?? row.merchant.phone,
        latitude: store.latitude,
        longitude: store.longitude,
      },
      distanceKm: drop ? round1(haversineKm(store, drop)) : null,
      fromHereKm: drop && options.from ? round1(haversineKm(options.from, drop)) : null,
      items: row.items.map((item) => ({
        name: loc(item.name),
        quantity: item.quantity,
        lineTotal: dec(item.lineTotal),
        notes: item.notes,
        addons: item.addons.map((addon) => ({ name: loc(addon.name), quantity: addon.quantity })),
      })),
      total: dec(row.total as never),
      deliveryFee: dec(row.deliveryFee as never),
      paymentMethod: payment?.method ?? null,
      paid: payment ? payment.status === 'CAPTURED' : false,
      cashDue,
      cashCollected: row.cashCollection?.collectedAmount ? dec(row.cashCollection.collectedAmount) : null,
      issues: row.deliveryIssues.map((issue) => ({ id: issue.id, type: issue.type, note: issue.note, status: issue.status, createdAt: issue.createdAt.toISOString() })),
      events: row.events.map((event) => ({ status: event.status, note: event.note, createdAt: event.createdAt.toISOString() })),
    };
  }
}

export type RiderOrder = ReturnType<RiderService['present']>;

function presentDeposit(row: { id: string; amount: { toFixed(digits: number): string }; status: string; note: string | null; reviewNote: string | null; createdAt: Date; reviewedAt: Date | null; collections: { id: string }[] }) {
  return {
    id: row.id,
    amount: dec(row.amount),
    status: row.status,
    note: row.note,
    reviewNote: row.reviewNote,
    orders: row.collections.length,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

function dropoffPoint(row: { addressSnapshot: unknown }): Point | null {
  const snapshot = (row.addressSnapshot ?? {}) as Snapshot;
  const latitude = Number(snapshot.latitude);
  const longitude = Number(snapshot.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) return null;
  return { latitude, longitude };
}

function branchPoint(branch: { latitude: { toString(): string }; longitude: { toString(): string } }): Point {
  return { latitude: Number(branch.latitude.toString()), longitude: Number(branch.longitude.toString()) };
}

function round1(km: number) {
  return Math.round(km * 10) / 10;
}
