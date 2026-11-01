import type { OrderStatus } from '@alliva/types';
import { dec, loc } from '../common/crypto';
import { badRequest, notFound } from '../common/errors';
import type { RequestUser } from '../common/http';
import { dispatchPriority, isColdItem, planDispatch, type PriorityReason } from '../domain/dispatch';
import { haversineKm, type DistanceFn, type Point } from '../domain/geo';
import type { DistanceProvider } from '../providers/location';
import type { PrismaService } from '../prisma/prisma.service';
import type { CommerceService } from './commerce.service';
import { recordedKm } from './delivery.service';

const ON_ROAD: OrderStatus[] = ['ASSIGNED_TO_DRIVER', 'OUT_FOR_DELIVERY'];
const UPCOMING: OrderStatus[] = ['ACCEPTED', 'PREPARING'];

type Snapshot = { line1?: string | null; area?: string | null; city?: string | null; latitude?: unknown; longitude?: unknown };

/** Store-side dispatch: what is ready, who is free, a suggested plan, and assigning it. */
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerce: CommerceService,
    private readonly distance: DistanceProvider,
  ) {}

  async board(merchantId: string, branchId?: string, now = new Date()) {
    const branches = await this.prisma.branch.findMany({ where: { merchantId, active: true }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, line1: true, latitude: true, longitude: true } });
    if (!branches.length) throw badRequest('Add an active branch before planning deliveries');
    const branch = branches.find((row) => row.id === branchId) ?? branches[0]!;
    const store = { latitude: Number(branch.latitude.toString()), longitude: Number(branch.longitude.toString()) };

    const [waiting, drivers] = await Promise.all([
      this.prisma.order.findMany({
        where: { merchantId, branchId: branch.id, fulfillmentType: 'DELIVERY', status: { in: ['READY_FOR_PICKUP', ...UPCOMING] }, dispatch: null },
        include: {
          items: { select: { name: true, quantity: true, productId: true } },
          events: { where: { status: 'READY_FOR_PICKUP' }, orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
          customer: { include: { user: { select: { firstName: true, lastName: true } } } },
          payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { method: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
      this.prisma.driverProfile.findMany({
        where: { merchantId, active: true, user: { status: 'ACTIVE' } },
        include: {
          user: { select: { firstName: true, lastName: true, phone: true } },
          assignments: {
            where: { order: { status: { in: ON_ROAD } } },
            include: { order: { select: { id: true, number: true, status: true, addressSnapshot: true } } },
          },
        },
      }),
    ]);

    const productIds = [...new Set(waiting.flatMap((order) => order.items.map((item) => item.productId)).filter((id): id is string => Boolean(id)))];
    const categories = new Map(
      (productIds.length ? await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, category: { select: { name: true } } } }) : [])
        .map((row) => [row.id, Object.values(loc(row.category.name)).join(' ')]),
    );

    // Road distance from the store to each drop: the one charged at checkout, else measured together in one lookup.
    const drops = waiting.map((order) => toPoint((order.addressSnapshot ?? {}) as Snapshot));
    const unrecorded = drops.flatMap((point, index) => (point && recordedKm(waiting[index]!.deliveryQuote, point) === null ? [point] : []));
    const measured = unrecorded.length ? (await this.distance.table([store], unrecorded))[0]! : [];
    const fromStore = new Map(unrecorded.map((point, index) => [pointKey(point), measured[index]!.km]));

    const orders = waiting.map((order, index) => {
      const snapshot = (order.addressSnapshot ?? {}) as Snapshot;
      const point = drops[index]!;
      const storeKm: DistanceFn = (from, to) => recordedKm(order.deliveryQuote, to) ?? fromStore.get(pointKey(to)) ?? haversineKm(from, to);
      // An order is hot unless every item looks like a drink, dessert or salad.
      const hot = order.items.some((item) => !isColdItem([...Object.values(loc(item.name)), item.productId ? categories.get(item.productId) ?? '' : '']));
      const readyAt = order.events[0]?.createdAt ?? null;
      const priority = dispatchPriority({ point, createdAt: order.createdAt, readyAt: order.status === 'READY_FOR_PICKUP' ? readyAt ?? order.updatedAt : null, scheduledFor: order.scheduledFor, hot }, store, now, storeKm);
      return {
        id: order.id,
        number: order.number,
        status: order.status,
        ready: order.status === 'READY_FOR_PICKUP',
        customerName: `${order.customer.user.firstName} ${order.customer.user.lastName}`.trim(),
        address: { line1: snapshot.line1 ?? null, area: snapshot.area ?? snapshot.city ?? null },
        latitude: point?.latitude ?? null,
        longitude: point?.longitude ?? null,
        distanceKm: priority.km,
        items: order.items.reduce((total, item) => total + item.quantity, 0),
        total: dec(order.total),
        cash: order.payments[0]?.method === 'CASH',
        hot,
        createdAt: order.createdAt.toISOString(),
        readyAt: readyAt?.toISOString() ?? null,
        estimatedReadyAt: order.estimatedReadyAt?.toISOString() ?? null,
        scheduledFor: order.scheduledFor?.toISOString() ?? null,
        score: priority.score,
        reasons: priority.reasons as PriorityReason[],
      };
    });

    const riders = drivers
      .map((driver) => {
        const active = driver.assignments
          .map((row) => {
            const point = toPoint((row.order.addressSnapshot ?? {}) as Snapshot);
            return {
              orderId: row.order.id,
              number: row.order.number,
              status: row.order.status,
              sequence: row.sequence,
              pickedUp: Boolean(row.pickupVerifiedAt),
              assignedAt: row.assignedAt.toISOString(),
              latitude: point?.latitude ?? null,
              longitude: point?.longitude ?? null,
            };
          })
          .sort((a, b) => (a.sequence || 999) - (b.sequence || 999) || a.assignedAt.localeCompare(b.assignedAt));
        return {
          id: driver.id,
          name: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
          phone: driver.user.phone,
          vehicle: driver.vehicle,
          onShift: driver.onShift,
          lastLatitude: driver.lastLatitude ? Number(driver.lastLatitude.toString()) : null,
          lastLongitude: driver.lastLongitude ? Number(driver.lastLongitude.toString()) : null,
          lastSeenAt: driver.lastSeenAt?.toISOString() ?? null,
          active,
        };
      })
      .sort((a, b) => Number(b.onShift) - Number(a.onShift) || a.active.length - b.active.length || a.name.localeCompare(b.name));

    const ready = orders.filter((order) => order.ready).sort((a, b) => b.score - a.score);
    // Every place a plan can route between: the store, ready drops and the riders' current stops.
    // Sent as a table so the board can show road legs while the merchant rearranges routes.
    const places = uniquePoints([
      store,
      ...ready.flatMap((order) => (order.latitude !== null && order.longitude !== null ? [{ latitude: order.latitude, longitude: order.longitude }] : [])),
      ...riders.flatMap((rider) => rider.active.flatMap((stop) => (stop.latitude !== null && stop.longitude !== null ? [{ latitude: stop.latitude, longitude: stop.longitude }] : []))),
    ]).slice(0, MAX_ROUTE_PLACES);
    const road = await this.distance.lookup(places);

    return {
      branch: { id: branch.id, name: loc(branch.name), line1: branch.line1, latitude: store.latitude, longitude: store.longitude },
      branches: branches.map((row) => ({ id: row.id, name: loc(row.name) })),
      ready,
      upcoming: orders.filter((order) => !order.ready).sort((a, b) => (a.estimatedReadyAt ?? a.createdAt).localeCompare(b.estimatedReadyAt ?? b.createdAt)),
      riders,
      roadKm: { points: places, km: places.map((from) => places.map((to) => Math.round(road(from, to) * 100) / 100)) },
      generatedAt: now.toISOString(),
    };
  }

  async plan(merchantId: string, input: { branchId?: string; riderIds: string[]; orderIds?: string[]; maxPerRider: number }) {
    const board = await this.board(merchantId, input.branchId);
    const store = { latitude: board.branch.latitude, longitude: board.branch.longitude };
    const riders = board.riders.filter((rider) => input.riderIds.includes(rider.id));
    if (!riders.length) throw badRequest('None of these riders can take orders');
    const orders = board.ready.filter((order) => !input.orderIds || input.orderIds.includes(order.id));
    const result = planDispatch({
      store,
      riders: riders.map((rider) => ({
        id: rider.id,
        capacity: Math.max(0, input.maxPerRider - rider.active.length),
        anchors: rider.active.flatMap((stop) => (stop.latitude !== null && stop.longitude !== null ? [{ latitude: stop.latitude, longitude: stop.longitude }] : [])),
      })),
      orders: orders.map((order) => ({ id: order.id, point: order.latitude !== null && order.longitude !== null ? { latitude: order.latitude, longitude: order.longitude } : null, score: order.score })),
      distance: tableDistance(board.roadKm),
    });
    return { ...result, board };
  }

  /**
   * Applies a reviewed plan. Ready orders are handed to the rider; an order already with a rider who has not
   * collected it moves to the new rider. Stop numbers continue after the rider's current stops.
   */
  async assign(actor: RequestUser, merchantId: string, input: { routes: { riderId: string; orderIds: string[] }[] }) {
    const riderIds = input.routes.map((route) => route.riderId);
    const orderIds = input.routes.flatMap((route) => route.orderIds);
    const [riders, orders] = await Promise.all([
      this.prisma.driverProfile.findMany({ where: { id: { in: riderIds }, merchantId, active: true } }),
      this.prisma.order.findMany({ where: { id: { in: orderIds }, merchantId }, include: { dispatch: true } }),
    ]);
    for (const id of riderIds) if (!riders.some((rider) => rider.id === id)) throw badRequest('A rider in this plan does not work for your store');
    for (const id of orderIds) {
      const order = orders.find((row) => row.id === id);
      if (!order) throw notFound('An order in this plan was not found');
      if (order.fulfillmentType !== 'DELIVERY') throw badRequest(`Order ${order.number} is not a delivery`);
      const movable = order.status === 'READY_FOR_PICKUP' || (order.status === 'ASSIGNED_TO_DRIVER' && !order.dispatch?.pickupVerifiedAt);
      if (!movable) throw badRequest(`Order ${order.number} can no longer be planned`);
    }

    let assigned = 0;
    for (const route of input.routes) {
      const current = await this.prisma.dispatchAssignment.findMany({
        where: { driverId: route.riderId, orderId: { notIn: route.orderIds }, order: { status: { in: ON_ROAD } } },
        orderBy: { assignedAt: 'asc' },
      });
      // Number the rider's current stops first so new ones come after them.
      const ordered = [...current].sort((a, b) => (a.sequence || 999) - (b.sequence || 999) || a.assignedAt.getTime() - b.assignedAt.getTime());
      for (const [index, row] of ordered.entries()) {
        if (row.sequence !== index + 1) await this.prisma.dispatchAssignment.update({ where: { id: row.id }, data: { sequence: index + 1 } });
      }
      for (const [index, orderId] of route.orderIds.entries()) {
        const order = orders.find((row) => row.id === orderId)!;
        if (order.status === 'READY_FOR_PICKUP') {
          await this.commerce.transition(actor, order.id, { status: 'ASSIGNED_TO_DRIVER', driverId: route.riderId, note: 'Dispatch plan' });
        } else if (order.dispatch?.driverId !== route.riderId) {
          await this.prisma.dispatchAssignment.update({
            where: { orderId: order.id },
            data: { driverId: route.riderId, assignedById: actor.id, assignedAt: new Date(), pickupVerifiedAt: null, pickupMethod: null },
          });
          await this.prisma.cashCollection.updateMany({ where: { orderId: order.id }, data: { driverId: route.riderId } });
          await this.prisma.orderStatusEvent.create({ data: { orderId: order.id, status: order.status, note: 'Moved to another rider', actorId: actor.id } });
        }
        await this.prisma.dispatchAssignment.update({ where: { orderId: order.id }, data: { sequence: ordered.length + index + 1 } });
        assigned += 1;
      }
    }
    return { assigned };
  }
}

/** Caps the road table the board sends; past this many places, the rest use straight-line distance. */
const MAX_ROUTE_PLACES = 60;

function pointKey(point: Point) {
  return `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`;
}

function uniquePoints(points: Point[]) {
  return [...new Map(points.map((point) => [pointKey(point), point])).values()];
}

/** Reads distances back out of the board's road table, with straight line for places it does not hold. */
export function tableDistance(table: { points: Point[]; km: number[][] }): DistanceFn {
  const index = new Map(table.points.map((point, position) => [pointKey(point), position]));
  return (from, to) => {
    const row = index.get(pointKey(from));
    const column = index.get(pointKey(to));
    return row !== undefined && column !== undefined ? table.km[row]![column]! : haversineKm(from, to);
  };
}

function toPoint(snapshot: Snapshot): Point | null {
  const latitude = Number(snapshot.latitude);
  const longitude = Number(snapshot.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) return null;
  return { latitude, longitude };
}
