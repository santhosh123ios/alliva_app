import { dispatchPriority, handoffCode, handoffToken, isColdItem, nearestNeighbourRoute, normalizeHandoffCode, parsePickupQr, PICKUP_QR_PREFIX, planDispatch } from './dispatch';
import { riderOnly } from './order-machine';

describe('pickup codes', () => {
  it('makes readable six-character codes', () => {
    const code = handoffCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it('reads the QR with or without the prefix', () => {
    const token = handoffToken();
    expect(parsePickupQr(`${PICKUP_QR_PREFIX}${token}`)).toBe(token);
    expect(parsePickupQr(` ${token} `)).toBe(token);
    expect(parsePickupQr('https://example.com')).toBeNull();
  });

  it('normalizes typed codes', () => {
    expect(normalizeHandoffCode(' ab-12 cd ')).toBe('AB12CD');
  });
});

describe('nearestNeighbourRoute', () => {
  it('visits the closest stop next and puts unpinned stops last', () => {
    const origin = { latitude: 26.2, longitude: 50.5 };
    const route = nearestNeighbourRoute(origin, [
      { item: 'far', point: { latitude: 26.3, longitude: 50.6 } },
      { item: 'none', point: null },
      { item: 'near', point: { latitude: 26.21, longitude: 50.51 } },
    ]);
    expect(route.map((stop) => stop.item)).toEqual(['near', 'far', 'none']);
    expect(route[0]!.legKm).toBeGreaterThan(0);
    expect(route[1]!.cumulativeKm).toBeGreaterThan(route[0]!.cumulativeKm!);
    expect(route[2]!.legKm).toBeNull();
  });
});

describe('riderOnly', () => {
  it('is true only for delivery staff without a store-wide role', () => {
    expect(riderOnly(['DELIVERY_STAFF'])).toBe(true);
    expect(riderOnly(['DELIVERY_STAFF', 'MERCHANT_MANAGER'])).toBe(false);
    expect(riderOnly(['KITCHEN_STAFF'])).toBe(false);
  });
});

describe('dispatchPriority', () => {
  const store = { latitude: 26.2285, longitude: 50.586 };
  const now = new Date('2026-10-30T10:00:00Z');
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  it('ranks a hot order waiting on the counter above a fresh cold one', () => {
    const waitingHot = dispatchPriority({ point: { latitude: 26.23, longitude: 50.59 }, createdAt: minutesAgo(30), readyAt: minutesAgo(12), scheduledFor: null, hot: true }, store, now);
    const freshCold = dispatchPriority({ point: { latitude: 26.23, longitude: 50.59 }, createdAt: minutesAgo(5), readyAt: minutesAgo(1), scheduledFor: null, hot: false }, store, now);
    expect(waitingHot.score).toBeGreaterThan(freshCold.score);
    expect(waitingHot.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(['WAITING', 'HOT']));
  });

  it('holds back orders scheduled well ahead and flags missing pins', () => {
    const later = dispatchPriority({ point: null, createdAt: minutesAgo(10), readyAt: minutesAgo(5), scheduledFor: new Date(now.getTime() + 120 * 60_000), hot: true }, store, now);
    expect(later.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(['SCHEDULED_LATER', 'NO_PIN']));
    expect(later.km).toBeNull();
  });
});

describe('isColdItem', () => {
  it('spots drinks and desserts in English and Arabic', () => {
    expect(isColdItem(['Fresh orange juice'])).toBe(true);
    expect(isColdItem(['عصير برتقال'])).toBe(true);
    expect(isColdItem(['Chicken biryani'])).toBe(false);
  });
});

describe('planDispatch', () => {
  const store = { latitude: 26.2285, longitude: 50.586 };
  const seef = { latitude: 26.2361, longitude: 50.5452 };
  const seefNext = { latitude: 26.2370, longitude: 50.5470 };
  const muharraq = { latitude: 26.2572, longitude: 50.6119 };

  it('keeps nearby orders together and sends a far one with another rider', () => {
    const plan = planDispatch({
      store,
      riders: [{ id: 'r1', capacity: 3, anchors: [] }, { id: 'r2', capacity: 3, anchors: [] }],
      orders: [
        { id: 'seef', point: seef, score: 50 },
        { id: 'muharraq', point: muharraq, score: 40 },
        { id: 'seefNext', point: seefNext, score: 10 },
      ],
    });
    const byRider = Object.fromEntries(plan.routes.map((route) => [route.riderId, route.stops.map((stop) => stop.orderId)]));
    expect(byRider.r1).toEqual(['seefNext', 'seef']);
    expect(byRider.r2).toEqual(['muharraq']);
    expect(plan.leftover).toEqual([]);
    expect(plan.routes[0]!.etaMinutes).toBeGreaterThan(0);
  });

  it('respects capacity and leaves the least urgent order over', () => {
    const plan = planDispatch({
      store,
      riders: [{ id: 'r1', capacity: 1, anchors: [] }],
      orders: [{ id: 'low', point: seef, score: 1 }, { id: 'high', point: muharraq, score: 9 }],
    });
    expect(plan.routes[0]!.stops.map((stop) => stop.orderId)).toEqual(['high']);
    expect(plan.leftover).toEqual(['low']);
  });

  it('adds to a rider already heading that way', () => {
    const plan = planDispatch({
      store,
      riders: [{ id: 'busy', capacity: 2, anchors: [seef] }, { id: 'idle', capacity: 2, anchors: [] }],
      orders: [{ id: 'nearSeef', point: seefNext, score: 5 }],
    });
    expect(plan.routes.map((route) => route.riderId)).toEqual(['busy']);
  });
});
