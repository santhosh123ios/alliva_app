import { randomBytes, randomInt } from 'crypto';
import { haversineKm, type Point } from './geo';

/** No 0/O or 1/I so a rider can read the code off a ticket without guessing. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const PICKUP_QR_PREFIX = 'alliva:pickup:';

export function handoffCode(length = 6) {
  let code = '';
  for (let index = 0; index < length; index += 1) code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  return code;
}

export function handoffToken() {
  return randomBytes(18).toString('base64url');
}

/** Reads a scanned QR. Accepts the full `alliva:pickup:<token>` text or a bare token. */
export function parsePickupQr(text: string): string | null {
  const value = text.trim();
  const token = value.startsWith(PICKUP_QR_PREFIX) ? value.slice(PICKUP_QR_PREFIX.length) : value;
  return /^[A-Za-z0-9_-]{16,64}$/.test(token) ? token : null;
}

export function normalizeHandoffCode(text: string) {
  return text.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export type RouteStop<T> = { item: T; point: Point | null };

/**
 * Orders stops for one rider: nearest unvisited stop first, starting at `origin`.
 * Stops without a pin go last, in the order given.
 */
export function nearestNeighbourRoute<T>(origin: Point | null, stops: RouteStop<T>[]): { item: T; legKm: number | null; cumulativeKm: number | null }[] {
  const located = stops.filter((stop): stop is { item: T; point: Point } => stop.point !== null);
  const unlocated = stops.filter((stop) => stop.point === null);
  const result: { item: T; legKm: number | null; cumulativeKm: number | null }[] = [];
  let here = origin ?? located[0]?.point ?? null;
  let total = 0;
  const left = [...located];
  while (left.length && here) {
    let best = 0;
    let bestKm = Infinity;
    for (let index = 0; index < left.length; index += 1) {
      const km = haversineKm(here, left[index]!.point);
      if (km < bestKm) {
        bestKm = km;
        best = index;
      }
    }
    const [stop] = left.splice(best, 1);
    total += bestKm;
    result.push({ item: stop!.item, legKm: round(bestKm), cumulativeKm: round(total) });
    here = stop!.point;
  }
  for (const stop of unlocated) result.push({ item: stop.item, legKm: null, cumulativeKm: null });
  return result;
}

function round(km: number) {
  return Math.round(km * 10) / 10;
}

/** Words that mark an item as cold or room temperature. Anything else from a kitchen counts as hot. */
const COLD_WORDS = [
  'drink', 'juice', 'water', 'soda', 'cola', 'pepsi', 'iced', 'ice cream', 'gelato', 'frozen', 'smoothie', 'shake', 'milkshake',
  'laban', 'dessert', 'cake', 'cookie', 'salad', 'yogurt', 'sweets', 'chocolate', 'bottle', 'can ',
  'عصير', 'ماء', 'مياه', 'مشروب', 'مشروبات', 'آيس', 'ايس', 'مثلج', 'بوظة', 'حلويات', 'حلى', 'كيك', 'سلطة', 'لبن', 'زبادي', 'شوكولاتة',
];

export function isColdItem(texts: string[]) {
  const text = ` ${texts.join(' ').toLowerCase()} `;
  return COLD_WORDS.some((word) => text.includes(word));
}

export type PriorityReason =
  | { code: 'WAITING'; minutes: number }
  | { code: 'LATE'; minutes: number }
  | { code: 'HOT' }
  | { code: 'DUE_SOON'; minutes: number }
  | { code: 'SCHEDULED_LATER'; minutes: number }
  | { code: 'FAR'; km: number }
  | { code: 'NO_PIN' };

export type PriorityInput = {
  point: Point | null;
  createdAt: Date;
  readyAt: Date | null;
  scheduledFor: Date | null;
  hot: boolean;
};

/**
 * How urgently an order should leave the store. Higher goes first.
 * Time waiting on the counter matters most, then how old the order is, hot food, scheduled time and trip length.
 */
export function dispatchPriority(order: PriorityInput, store: Point, now = new Date()): { score: number; reasons: PriorityReason[]; km: number | null } {
  const reasons: PriorityReason[] = [];
  let score = 0;
  const waiting = Math.max(0, Math.round((now.getTime() - (order.readyAt ?? order.createdAt).getTime()) / 60_000));
  score += Math.min(waiting, 60);
  if (waiting >= 5) reasons.push({ code: 'WAITING', minutes: waiting });
  const age = Math.max(0, Math.round((now.getTime() - order.createdAt.getTime()) / 60_000));
  score += Math.min(age, 90) * 0.3;
  if (age >= 45) reasons.push({ code: 'LATE', minutes: age });
  if (order.hot) {
    score += 15;
    reasons.push({ code: 'HOT' });
  }
  if (order.scheduledFor) {
    const due = Math.round((order.scheduledFor.getTime() - now.getTime()) / 60_000);
    if (due <= 20) {
      score += 25;
      reasons.push({ code: 'DUE_SOON', minutes: Math.max(due, 0) });
    } else if (due > 45) {
      score -= 30;
      reasons.push({ code: 'SCHEDULED_LATER', minutes: due });
    }
  }
  const km = order.point ? round(haversineKm(store, order.point)) : null;
  if (km !== null) {
    // Long trips take a rider out of rotation for longer, so start them a little earlier.
    score += Math.min(km, 10);
    if (km >= 6) reasons.push({ code: 'FAR', km });
  } else {
    reasons.push({ code: 'NO_PIN' });
  }
  return { score: Math.round(score), reasons, km };
}

export type PlanRider = { id: string; capacity: number; anchors: Point[] };
export type PlanOrder = { id: string; point: Point | null; score: number };
export type PlannedRoute = {
  riderId: string;
  stops: { orderId: string; legKm: number | null; cumulativeKm: number | null }[];
  totalKm: number;
  etaMinutes: number;
};

/** Average speed in town and time spent at each door, for route estimates. */
const SPEED_KMH = 22;
const MINUTES_PER_STOP = 4;

export function routeEstimate(totalKm: number, stops: number) {
  return Math.round((totalKm / SPEED_KMH) * 60 + stops * MINUTES_PER_STOP);
}

/**
 * Groups ready orders into one route per rider.
 * Orders are taken most urgent first. Each joins the rider whose route already passes nearest (within `joinKm`),
 * otherwise starts a route for a free rider, so riders are spread out before routes get long.
 * A rider's current stops count as part of their route. Orders that fit nowhere are left over.
 */
export function planDispatch(input: { store: Point; riders: PlanRider[]; orders: PlanOrder[]; joinKm?: number }): { routes: PlannedRoute[]; leftover: string[] } {
  const joinKm = input.joinKm ?? 2.5;
  const groups = input.riders.map((rider) => ({ rider, orders: [] as PlanOrder[] }));
  const leftover: string[] = [];
  const open = (group: (typeof groups)[number]) => group.orders.length < group.rider.capacity;
  const points = (group: (typeof groups)[number]) => [...group.rider.anchors, ...group.orders.flatMap((order) => (order.point ? [order.point] : []))];

  for (const order of [...input.orders].sort((a, b) => b.score - a.score)) {
    const candidates = groups.filter(open);
    if (!candidates.length) {
      leftover.push(order.id);
      continue;
    }
    if (!order.point) {
      const lightest = [...candidates].sort((a, b) => a.orders.length + a.rider.anchors.length - (b.orders.length + b.rider.anchors.length))[0]!;
      lightest.orders.push(order);
      continue;
    }
    let nearest: (typeof groups)[number] | null = null;
    let nearestKm = Infinity;
    for (const group of candidates) {
      for (const point of points(group)) {
        const km = haversineKm(point, order.point);
        if (km < nearestKm) {
          nearestKm = km;
          nearest = group;
        }
      }
    }
    const free = candidates
      .filter((group) => points(group).length === 0)
      .sort((a, b) => a.rider.anchors.length - b.rider.anchors.length)[0];
    const pick = nearest && (nearestKm <= joinKm || !free) ? nearest : free ?? nearest!;
    pick.orders.push(order);
  }

  const routes = groups
    .filter((group) => group.orders.length)
    .map((group) => {
      const start = group.rider.anchors.at(-1) ?? input.store;
      const route = nearestNeighbourRoute(start, group.orders.map((order) => ({ item: order.id, point: order.point })));
      const totalKm = route.reduce((total, stop) => total + (stop.legKm ?? 0), 0);
      return {
        riderId: group.rider.id,
        stops: route.map((stop) => ({ orderId: stop.item, legKm: stop.legKm, cumulativeKm: stop.cumulativeKm })),
        totalKm: round(totalKm),
        etaMinutes: routeEstimate(totalKm, route.length),
      };
    });
  return { routes, leftover };
}
