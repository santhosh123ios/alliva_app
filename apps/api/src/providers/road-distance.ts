import { Logger } from '../common/logger';
import { haversineKm, type DistanceFn, type Point } from '../domain/geo';
import type { DistanceMethod } from '../domain/delivery-quote';

export type Measured = { km: number; method: DistanceMethod };

/** Travel distance between places. Swap the implementation without touching pricing or routing. */
export interface DistanceProvider {
  measure(from: Point, to: Point): Promise<Measured>;
  /** Distance from each origin to one destination, in the same order, in as few lookups as possible. */
  measureMany(origins: Point[], to: Point): Promise<Measured[]>;
  /** Distance from every origin to every destination: `result[origin][destination]`. */
  table(origins: Point[], destinations: Point[]): Promise<Measured[][]>;
  /** Measures every pair among the points up front, then answers synchronously, for route planning. */
  lookup(points: Point[]): Promise<DistanceFn>;
  /** A road distance already in the cache, without any lookup. */
  peek(from: Point, to: Point): Measured | null;
}

/** A road-routing backend. Returns kilometres per origin and destination, or null where it found no route. */
export interface RoadRouter {
  readonly name: string;
  /** Largest number of destinations in one request. */
  readonly maxDestinations: number;
  /** Largest number of origins in one request alongside this many destinations. */
  maxOrigins(destinations: number): number;
  route(origins: Point[], destinations: Point[], signal: AbortSignal): Promise<(number | null)[][]>;
}

export class HaversineDistance implements DistanceProvider {
  constructor(private readonly factor = 1) {}

  async measure(from: Point, to: Point): Promise<Measured> {
    return this.straight(from, to);
  }

  async measureMany(origins: Point[], to: Point): Promise<Measured[]> {
    return origins.map((from) => this.straight(from, to));
  }

  async table(origins: Point[], destinations: Point[]): Promise<Measured[][]> {
    return origins.map((from) => destinations.map((to) => this.straight(from, to)));
  }

  async lookup(): Promise<DistanceFn> {
    return (from, to) => this.straight(from, to).km;
  }

  peek(): Measured | null {
    return null;
  }

  straight(from: Point, to: Point): Measured {
    return { km: haversineKm(from, to) * this.factor, method: 'HAVERSINE' };
  }
}

/** OSRM table service. The public demo server allows about one request a second; self-host it for production. */
export class OsrmRouter implements RoadRouter {
  readonly name = 'osrm';
  readonly maxDestinations = 50;
  constructor(private readonly baseUrl = 'https://router.project-osrm.org') {}

  maxOrigins(destinations: number) {
    // The demo server caps a table at 100 coordinates.
    return Math.max(1, 100 - destinations);
  }

  async route(origins: Point[], destinations: Point[], signal: AbortSignal): Promise<(number | null)[][]> {
    // Each place is sent once, so a square table (route planning) costs no more coordinates than it has points.
    const coordinates: Point[] = [];
    const index = new Map<string, number>();
    const at = (point: Point) => {
      const key = `${point.longitude},${point.latitude}`;
      if (!index.has(key)) {
        index.set(key, coordinates.length);
        coordinates.push(point);
      }
      return index.get(key)!;
    };
    const sources = origins.map(at);
    const targets = destinations.map(at);
    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}/table/v1/driving/${coordinates.map((point) => `${point.longitude},${point.latitude}`).join(';')}`);
    url.searchParams.set('sources', sources.join(';'));
    url.searchParams.set('destinations', targets.join(';'));
    url.searchParams.set('annotations', 'distance');
    const response = await fetch(url, { signal });
    const body = (await response.json()) as { code?: string; distances?: (number | null)[][] };
    if (!response.ok || body.code !== 'Ok' || !Array.isArray(body.distances)) throw new Error(body.code ?? `HTTP ${response.status}`);
    return origins.map((_, row) => destinations.map((_, column) => metres(body.distances![row]?.[column])));
  }
}

/** Google Distance Matrix, billed per origin–destination element (at most 25 × 25 and 100 elements a request). */
export class GoogleRouter implements RoadRouter {
  readonly name = 'google';
  readonly maxDestinations = 25;
  constructor(private readonly apiKey: string) {}

  maxOrigins(destinations: number) {
    return Math.max(1, Math.min(25, Math.floor(100 / Math.max(1, destinations))));
  }

  async route(origins: Point[], destinations: Point[], signal: AbortSignal): Promise<(number | null)[][]> {
    const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
    url.searchParams.set('origins', origins.map((point) => `${point.latitude},${point.longitude}`).join('|'));
    url.searchParams.set('destinations', destinations.map((point) => `${point.latitude},${point.longitude}`).join('|'));
    url.searchParams.set('mode', 'driving');
    url.searchParams.set('key', this.apiKey);
    const response = await fetch(url, { signal });
    const body = (await response.json()) as { status?: string; rows?: { elements?: { status?: string; distance?: { value?: number } }[] }[] };
    if (!response.ok || body.status !== 'OK' || !body.rows) throw new Error(body.status ?? `HTTP ${response.status}`);
    return origins.map((_, row) =>
      destinations.map((_, column) => {
        const element = body.rows![row]?.elements?.[column];
        return element?.status === 'OK' ? metres(element.distance?.value) : null;
      }),
    );
  }
}

export type RoadDistanceOptions = {
  /** Straight-line multiplier used whenever the road lookup is unavailable. */
  fallbackFactor?: number;
  /** Lookups allowed per second; over that, distances use the fallback instead of queueing. */
  ratePerSecond?: number;
  timeoutMs?: number;
  ttlMs?: number;
  failureTtlMs?: number;
  maxEntries?: number;
  now?: () => number;
};

type Entry = { at: number; value: Measured | null };

/**
 * Road distance with a cache, request coalescing, a rate limit and a straight-line fallback.
 * Points are rounded to about 11 m, so a customer nudging the pin does not cost another lookup.
 */
export class RoadDistance implements DistanceProvider {
  private readonly logger = new Logger('RoadDistance');
  private readonly fallback: HaversineDistance;
  private readonly cache = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<Measured | null>>();
  private readonly rate: number;
  private readonly burst: number;
  private readonly timeoutMs: number;
  private readonly ttlMs: number;
  private readonly failureTtlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private tokens: number;
  private refilledAt: number;

  constructor(private readonly router: RoadRouter, options: RoadDistanceOptions = {}) {
    this.fallback = new HaversineDistance(options.fallbackFactor ?? 1.3);
    this.rate = options.ratePerSecond ?? 1;
    // A store list or route plan may need two requests at once; allow that much burst.
    this.burst = Math.max(2, this.rate);
    this.timeoutMs = options.timeoutMs ?? 4000;
    this.ttlMs = options.ttlMs ?? 24 * 3600_000;
    this.failureTtlMs = options.failureTtlMs ?? 60_000;
    this.maxEntries = options.maxEntries ?? 5000;
    this.now = options.now ?? Date.now;
    this.tokens = this.burst;
    this.refilledAt = this.now();
  }

  async measure(from: Point, to: Point): Promise<Measured> {
    return (await this.table([from], [to]))[0]![0]!;
  }

  async measureMany(origins: Point[], to: Point): Promise<Measured[]> {
    return (await this.table(origins, [to])).map((row) => row[0]!);
  }

  async table(origins: Point[], destinations: Point[]): Promise<Measured[][]> {
    const cells: (Promise<Measured | null> | Measured | null)[][] = origins.map(() => []);
    const wantedOrigins = new Map<string, Point>();
    const wantedDestinations = new Map<string, Point>();
    origins.forEach((from, row) => {
      destinations.forEach((to, column) => {
        const key = cacheKey(from, to);
        if (samePlace(from, to)) cells[row]![column] = { km: 0, method: 'ROAD' };
        else if (this.fresh(key)) cells[row]![column] = this.fresh(key)!.value;
        else if (this.pending.has(key)) cells[row]![column] = this.pending.get(key)!;
        else {
          wantedOrigins.set(pointKey(from), from);
          wantedDestinations.set(pointKey(to), to);
        }
      });
    });
    if (wantedOrigins.size) {
      const fetched = this.fetch([...wantedOrigins.values()], [...wantedDestinations.values()]);
      origins.forEach((from, row) => {
        destinations.forEach((to, column) => {
          if (cells[row]![column] !== undefined) return;
          const key = cacheKey(from, to);
          const one = this.pending.get(key) ?? fetched.then((values) => values.get(key) ?? null);
          if (!this.pending.has(key)) {
            this.pending.set(key, one);
            void one.finally(() => this.pending.delete(key));
          }
          cells[row]![column] = one;
        });
      });
    }
    const settled = await Promise.all(cells.map((row) => Promise.all(row)));
    return settled.map((row, rowIndex) => row.map((value, column) => value ?? this.fallback.straight(origins[rowIndex]!, destinations[column]!)));
  }

  async lookup(points: Point[]): Promise<DistanceFn> {
    const unique = [...new Map(points.map((point) => [pointKey(point), point])).values()];
    const measured = new Map<string, number>();
    if (unique.length > 1) {
      const table = await this.table(unique, unique);
      unique.forEach((from, row) => unique.forEach((to, column) => measured.set(cacheKey(from, to), table[row]![column]!.km)));
    }
    return (from, to) => measured.get(cacheKey(from, to)) ?? this.peek(from, to)?.km ?? this.fallback.straight(from, to).km;
  }

  peek(from: Point, to: Point): Measured | null {
    if (samePlace(from, to)) return { km: 0, method: 'ROAD' };
    return this.fresh(cacheKey(from, to))?.value ?? null;
  }

  /** Looks up the missing cells in as few requests as the router allows. Missing or failed cells come back absent. */
  private async fetch(origins: Point[], destinations: Point[]): Promise<Map<string, Measured | null>> {
    const found = new Map<string, Measured | null>();
    const requests: Promise<void>[] = [];
    for (const targets of chunk(destinations, this.router.maxDestinations)) {
      for (const sources of chunk(origins, this.router.maxOrigins(targets.length))) {
        if (!this.take()) continue;
        requests.push(this.request(sources, targets, found));
      }
    }
    await Promise.all(requests);
    return found;
  }

  private async request(origins: Point[], destinations: Point[], found: Map<string, Measured | null>) {
    let km: (number | null)[][] | null = null;
    try {
      km = await this.router.route(origins, destinations, AbortSignal.timeout(this.timeoutMs));
    } catch (error) {
      this.logger.warn(`Road distance from ${this.router.name} unavailable, using straight-line estimate: ${error instanceof Error ? error.message : error}`);
    }
    origins.forEach((from, row) => {
      destinations.forEach((to, column) => {
        const value = km?.[row]?.[column];
        const measured: Measured | null = typeof value === 'number' ? { km: value, method: 'ROAD' } : null;
        const key = cacheKey(from, to);
        found.set(key, measured);
        this.remember(key, measured);
      });
    });
  }

  private fresh(key: string): Entry | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    const ttl = entry.value ? this.ttlMs : this.failureTtlMs;
    if (this.now() - entry.at >= ttl) {
      this.cache.delete(key);
      return null;
    }
    // Map order doubles as recency, so the oldest key is the least recently used.
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  private remember(key: string, value: Measured | null) {
    this.cache.delete(key);
    this.cache.set(key, { at: this.now(), value });
    while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value!);
  }

  private take() {
    const now = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.refilledAt) / 1000) * this.rate);
    this.refilledAt = now;
    if (this.tokens < 1) {
      this.logger.warn(`Road distance rate limit (${this.rate}/s) reached, using straight-line estimate`);
      return false;
    }
    this.tokens -= 1;
    return true;
  }
}

/**
 * DISTANCE_PROVIDER picks the source: `osrm`, `google` (needs GOOGLE_MAPS_SERVER_KEY or GOOGLE_MAPS_API_KEY),
 * or anything else for straight-line distance. A Google key also wins over `osrm`, so adding one upgrades it.
 */
export function createDistanceProvider(env: NodeJS.ProcessEnv = process.env): DistanceProvider {
  const mode = env.DISTANCE_PROVIDER?.trim().toLowerCase();
  const googleKey = env.GOOGLE_MAPS_SERVER_KEY?.trim() || env.GOOGLE_MAPS_API_KEY?.trim();
  const options: RoadDistanceOptions = {
    fallbackFactor: positive(env.ROAD_DISTANCE_FACTOR) ?? 1.3,
    ratePerSecond: positive(env.ROAD_DISTANCE_RPS),
  };
  if ((mode === 'google' || mode === 'osrm') && googleKey) return new RoadDistance(new GoogleRouter(googleKey), { ratePerSecond: 10, ...defined(options) });
  if (mode === 'osrm') return new RoadDistance(new OsrmRouter(env.OSRM_URL?.trim() || undefined), { ratePerSecond: 1, ...defined(options) });
  return new HaversineDistance();
}

function pointKey(point: Point) {
  return `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`;
}

function cacheKey(from: Point, to: Point) {
  return `${pointKey(from)},${pointKey(to)}`;
}

function samePlace(from: Point, to: Point) {
  return pointKey(from) === pointKey(to);
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function metres(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value / 1000 : null;
}

function positive(value: string | undefined) {
  const number = Number(value);
  return value && Number.isFinite(number) && number > 0 ? number : undefined;
}

function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}
