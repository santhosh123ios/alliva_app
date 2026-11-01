import { haversineKm } from '../domain/geo';
import { createDistanceProvider, GoogleRouter, HaversineDistance, OsrmRouter, RoadDistance, type RoadRouter } from './road-distance';

const branch = { latitude: 26.2285, longitude: 50.586 };
const other = { latitude: 26.24, longitude: 50.6 };
const customer = { latitude: 26.2572, longitude: 50.6119 };
const straight = haversineKm(branch, customer);

/** A router for one destination at a time: `answer` gives kilometres per origin. */
function stubRouter(answer: (origins: number) => Promise<(number | null)[]>, maxOrigins = 100) {
  const calls: number[] = [];
  const router: RoadRouter = {
    name: 'stub',
    maxDestinations: 50,
    maxOrigins: () => maxOrigins,
    route: async (origins) => {
      calls.push(origins.length);
      return (await answer(origins.length)).map((km) => [km]);
    },
  };
  return { router, calls };
}

describe('road distance', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('returns road kilometres for every origin in one lookup', async () => {
    const { router, calls } = stubRouter(async () => [6.6, 3.6]);
    const distance = new RoadDistance(router);
    await expect(distance.measureMany([branch, other], customer)).resolves.toEqual([
      { km: 6.6, method: 'ROAD' },
      { km: 3.6, method: 'ROAD' },
    ]);
    expect(calls).toEqual([2]);
  });

  it('falls back to straight-line times the factor when the router fails', async () => {
    const { router } = stubRouter(async () => {
      throw new Error('down');
    });
    const [measured] = await new RoadDistance(router, { fallbackFactor: 1.3 }).measureMany([branch], customer);
    expect(measured!.method).toBe('HAVERSINE');
    expect(measured!.km).toBeCloseTo(straight * 1.3, 6);
  });

  it('falls back for an origin the router has no route for', async () => {
    const { router } = stubRouter(async () => [null, 3.6]);
    const [first, second] = await new RoadDistance(router, { fallbackFactor: 1 }).measureMany([branch, other], customer);
    expect(first).toEqual({ km: straight, method: 'HAVERSINE' });
    expect(second).toEqual({ km: 3.6, method: 'ROAD' });
  });

  it('falls back when the router is slower than the timeout', async () => {
    const router: RoadRouter = {
      name: 'slow',
      maxDestinations: 50,
      maxOrigins: () => 50,
      route: (_origins, _to, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')))),
    };
    const measured = await new RoadDistance(router, { timeoutMs: 20 }).measure(branch, customer);
    expect(measured.method).toBe('HAVERSINE');
  });

  it('caches by point rounded to about 11 m and shares in-flight lookups', async () => {
    const { router, calls } = stubRouter(async () => [6.6]);
    const distance = new RoadDistance(router);
    const nudged = { latitude: customer.latitude + 0.00002, longitude: customer.longitude - 0.00002 };
    await Promise.all([distance.measure(branch, customer), distance.measure(branch, customer)]);
    await expect(distance.measure(branch, nudged)).resolves.toEqual({ km: 6.6, method: 'ROAD' });
    expect(calls).toEqual([1]);
    expect(distance.peek(branch, customer)).toEqual({ km: 6.6, method: 'ROAD' });
  });

  it('expires road results after the TTL and remembers failures only briefly', async () => {
    let clock = 0;
    let fail = true;
    const { router, calls } = stubRouter(async () => {
      if (fail) throw new Error('down');
      return [6.6];
    });
    const distance = new RoadDistance(router, { now: () => clock, ratePerSecond: 100, failureTtlMs: 60_000, ttlMs: 3600_000 });
    expect((await distance.measure(branch, customer)).method).toBe('HAVERSINE');
    fail = false;
    clock = 30_000;
    expect((await distance.measure(branch, customer)).method).toBe('HAVERSINE');
    expect(calls).toHaveLength(1);
    clock = 61_000;
    expect((await distance.measure(branch, customer)).method).toBe('ROAD');
    clock = 61_000 + 3600_000;
    await distance.measure(branch, customer);
    expect(calls).toHaveLength(3);
  });

  it('uses the fallback instead of queueing once the rate limit is spent, without caching it', async () => {
    let clock = 0;
    const { router, calls } = stubRouter(async () => [6.6]);
    const distance = new RoadDistance(router, { now: () => clock, ratePerSecond: 1 });
    const third = { latitude: 26.21, longitude: 50.59 };
    // A burst of two requests is allowed, then one a second.
    expect((await distance.measure(branch, customer)).method).toBe('ROAD');
    expect((await distance.measure(other, customer)).method).toBe('ROAD');
    expect((await distance.measure(third, customer)).method).toBe('HAVERSINE');
    clock = 1000;
    expect((await distance.measure(third, customer)).method).toBe('ROAD');
    expect(calls).toEqual([1, 1, 1]);
  });

  it('evicts the least recently used entry beyond the cache size', async () => {
    const { router, calls } = stubRouter(async () => [5]);
    const distance = new RoadDistance(router, { maxEntries: 1, ratePerSecond: 100 });
    await distance.measure(branch, customer);
    await distance.measure(other, customer);
    expect(distance.peek(branch, customer)).toBeNull();
    expect(distance.peek(other, customer)).toEqual({ km: 5, method: 'ROAD' });
    expect(calls).toHaveLength(2);
  });

  it('parses an OSRM table response', async () => {
    let requested = '';
    global.fetch = (async (url: URL) => {
      requested = String(url);
      return new Response(JSON.stringify({ code: 'Ok', distances: [[6600], [null]] }));
    }) as typeof fetch;
    await expect(new OsrmRouter('http://osrm.test/').route([branch, other], [customer], AbortSignal.timeout(1000))).resolves.toEqual([[6.6], [null]]);
    expect(requested).toContain('http://osrm.test/table/v1/driving/50.586,26.2285;50.6,26.24;50.6119,26.2572?');
    expect(requested).toContain('sources=0%3B1&destinations=2');
  });

  it('parses a Google Distance Matrix response and rejects an error status', async () => {
    global.fetch = (async () =>
      new Response(JSON.stringify({ status: 'OK', rows: [{ elements: [{ status: 'OK', distance: { value: 6600 } }] }, { elements: [{ status: 'ZERO_RESULTS' }] }] }))) as typeof fetch;
    await expect(new GoogleRouter('key').route([branch, other], [customer], AbortSignal.timeout(1000))).resolves.toEqual([[6.6], [null]]);
    global.fetch = (async () => new Response(JSON.stringify({ status: 'REQUEST_DENIED' }))) as typeof fetch;
    await expect(new GoogleRouter('key').route([branch], [customer], AbortSignal.timeout(1000))).rejects.toThrow('REQUEST_DENIED');
  });

  it('sends each place once to OSRM for a square table', async () => {
    let requested = '';
    global.fetch = (async (url: URL) => {
      requested = String(url);
      return new Response(JSON.stringify({ code: 'Ok', distances: [[0, 6600], [6400, 0]] }));
    }) as typeof fetch;
    await expect(new OsrmRouter('http://osrm.test').route([branch, customer], [branch, customer], AbortSignal.timeout(1000))).resolves.toEqual([[0, 6.6], [6.4, 0]]);
    expect(requested).toContain('/driving/50.586,26.2285;50.6119,26.2572?');
    expect(requested).toContain('sources=0%3B1&destinations=0%3B1');
  });

  it('keeps Google requests inside its element limits', () => {
    const router = new GoogleRouter('key');
    expect(router.maxOrigins(1)).toBe(25);
    expect(router.maxOrigins(10)).toBe(10);
    expect(router.maxOrigins(25)).toBe(4);
  });

  it('splits a long list into as many requests as the router needs', async () => {
    const { router, calls } = stubRouter(async (origins) => Array.from({ length: origins }, () => 2), 2);
    const measured = await new RoadDistance(router, { ratePerSecond: 100 }).measureMany([branch, other, { latitude: 26.21, longitude: 50.59 }], customer);
    expect(measured.map((row) => row.method)).toEqual(['ROAD', 'ROAD', 'ROAD']);
    expect(calls).toEqual([2, 1]);
  });

  it('measures every pair for a route in one request and answers synchronously after', async () => {
    const calls: { origins: number; destinations: number }[] = [];
    const router: RoadRouter = {
      name: 'square',
      maxDestinations: 50,
      maxOrigins: () => 50,
      route: async (origins, destinations) => {
        calls.push({ origins: origins.length, destinations: destinations.length });
        // A made-up road distance that depends only on the two places.
        return origins.map((from) => destinations.map((to) => Math.abs(from.latitude - to.latitude) * 1000 + Math.abs(from.longitude - to.longitude) * 100));
      },
    };
    const distance = await new RoadDistance(router).lookup([branch, other, customer, { ...customer }]);
    expect(calls).toEqual([{ origins: 3, destinations: 3 }]);
    expect(distance(branch, other)).toBeCloseTo(11.5 + 1.4, 6);
    expect(distance(other, customer)).toBeCloseTo(17.2 + 1.19, 6);
    expect(distance(customer, customer)).toBe(0);
    // A place outside the measured set uses the straight-line fallback.
    const far = { latitude: 26.1, longitude: 50.5 };
    expect(distance(branch, far)).toBeCloseTo(haversineKm(branch, far) * 1.3, 6);
  });

  it('answers straight line from the haversine provider for every method', async () => {
    const provider = new HaversineDistance();
    await expect(provider.table([branch], [customer, branch])).resolves.toEqual([[{ km: straight, method: 'HAVERSINE' }, { km: 0, method: 'HAVERSINE' }]]);
    expect((await provider.lookup())(branch, customer)).toBe(straight);
    expect(provider.peek()).toBeNull();
  });

  it('picks the provider from the environment', async () => {
    expect(createDistanceProvider({})).toBeInstanceOf(HaversineDistance);
    expect(createDistanceProvider({ DISTANCE_PROVIDER: 'google' })).toBeInstanceOf(HaversineDistance);
    expect(createDistanceProvider({ DISTANCE_PROVIDER: 'osrm' })).toBeInstanceOf(RoadDistance);
    expect(createDistanceProvider({ DISTANCE_PROVIDER: 'google', GOOGLE_MAPS_API_KEY: 'k' })).toBeInstanceOf(RoadDistance);
    // Straight-line mode keeps exact distances; the factor only applies when a road lookup fails.
    await expect(createDistanceProvider({ ROAD_DISTANCE_FACTOR: '2' }).measure(branch, customer)).resolves.toEqual({ km: straight, method: 'HAVERSINE' });
  });
});
