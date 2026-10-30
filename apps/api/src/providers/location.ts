import { Logger } from '../common/logger';
import { haversineKm, type Point } from '../domain/geo';
import type { DistanceMethod } from '../domain/delivery-quote';

export type Measured = { km: number; method: DistanceMethod };

/** Travel distance between a branch and a customer. Swap the implementation without touching pricing. */
export interface DistanceProvider {
  measure(from: Point, to: Point): Promise<Measured>;
}

export type ReverseGeocoded = {
  label: string;
  road: string | null;
  block: string | null;
  area: string | null;
  city: string | null;
  country: string | null;
};

export interface ReverseGeocoder {
  reverse(point: Point, locale: 'en' | 'ar'): Promise<ReverseGeocoded | null>;
}

export class HaversineDistance implements DistanceProvider {
  async measure(from: Point, to: Point): Promise<Measured> {
    return { km: haversineKm(from, to), method: 'HAVERSINE' };
  }
}

/** Google road distance, falling back to straight-line distance whenever the call fails. */
export class GoogleRoadDistance implements DistanceProvider {
  private readonly logger = new Logger('GoogleRoadDistance');
  private readonly fallback = new HaversineDistance();
  private readonly cache = new Map<string, { at: number; value: Measured }>();

  constructor(private readonly apiKey: string) {}

  async measure(from: Point, to: Point): Promise<Measured> {
    const key = [from.latitude, from.longitude, to.latitude, to.longitude].map((value) => value.toFixed(5)).join(',');
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < 10 * 60_000) return cached.value;
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
      url.searchParams.set('origins', `${from.latitude},${from.longitude}`);
      url.searchParams.set('destinations', `${to.latitude},${to.longitude}`);
      url.searchParams.set('mode', 'driving');
      url.searchParams.set('key', this.apiKey);
      const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const body = (await response.json()) as { rows?: { elements?: { status?: string; distance?: { value?: number } }[] }[] };
      const element = body.rows?.[0]?.elements?.[0];
      if (!response.ok || element?.status !== 'OK' || typeof element.distance?.value !== 'number') throw new Error(element?.status ?? `HTTP ${response.status}`);
      const value: Measured = { km: element.distance.value / 1000, method: 'ROAD' };
      this.cache.set(key, { at: Date.now(), value });
      return value;
    } catch (error) {
      this.logger.warn(`Road distance unavailable, using straight-line distance: ${error instanceof Error ? error.message : error}`);
      return this.fallback.measure(from, to);
    }
  }
}

/** OpenStreetMap Nominatim, cached because its usage policy allows about one request a second. */
export class NominatimGeocoder implements ReverseGeocoder {
  private readonly logger = new Logger('NominatimGeocoder');
  private readonly cache = new Map<string, { at: number; value: ReverseGeocoded | null }>();
  private last = 0;

  async reverse(point: Point, locale: 'en' | 'ar'): Promise<ReverseGeocoded | null> {
    const key = `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)},${locale}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < 24 * 3600_000) return cached.value;
    const wait = this.last + 1100 - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.last = Date.now();
    try {
      const url = new URL('https://nominatim.openstreetmap.org/reverse');
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('lat', String(point.latitude));
      url.searchParams.set('lon', String(point.longitude));
      url.searchParams.set('zoom', '18');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('accept-language', locale);
      const response = await fetch(url, {
        headers: { 'user-agent': 'Alliva/1.0 (delivery address lookup)' },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { display_name?: string; address?: Record<string, string> };
      const address = body.address ?? {};
      const area = address.suburb ?? address.neighbourhood ?? address.quarter ?? address.village ?? address.town ?? null;
      const city = address.city ?? address.town ?? address.state ?? address.county ?? null;
      const road = address.road ?? null;
      const value: ReverseGeocoded = {
        label: [area, city].filter(Boolean).join(', ') || body.display_name?.split(',').slice(0, 2).join(',').trim() || '',
        road,
        block: blockFrom(address),
        area,
        city,
        country: address.country_code?.toUpperCase() ?? null,
      };
      this.cache.set(key, { at: Date.now(), value });
      return value;
    } catch (error) {
      this.logger.warn(`Reverse geocoding failed: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }
}

/** Google reverse geocoding when a server key is configured. */
export class GoogleGeocoder implements ReverseGeocoder {
  private readonly logger = new Logger('GoogleGeocoder');
  constructor(private readonly apiKey: string) {}

  async reverse(point: Point, locale: 'en' | 'ar'): Promise<ReverseGeocoded | null> {
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      url.searchParams.set('latlng', `${point.latitude},${point.longitude}`);
      url.searchParams.set('language', locale);
      url.searchParams.set('key', this.apiKey);
      const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const body = (await response.json()) as { status?: string; results?: { formatted_address?: string; address_components?: { long_name: string; types: string[] }[] }[] };
      const first = body.results?.[0];
      if (!response.ok || body.status !== 'OK' || !first) throw new Error(body.status ?? `HTTP ${response.status}`);
      const part = (type: string) => first.address_components?.find((component) => component.types.includes(type))?.long_name ?? null;
      const area = part('sublocality') ?? part('neighborhood') ?? part('locality');
      const city = part('locality') ?? part('administrative_area_level_1');
      return {
        label: [area, city].filter((value, index, list) => value && list.indexOf(value) === index).join(', ') || first.formatted_address || '',
        road: part('route'),
        block: null,
        area,
        city,
        country: first.address_components?.find((component) => component.types.includes('country'))?.long_name ?? null,
      };
    } catch (error) {
      this.logger.warn(`Google reverse geocoding failed: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }
}

export function createDistanceProvider(): DistanceProvider {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  return process.env.DISTANCE_PROVIDER === 'google' && key ? new GoogleRoadDistance(key) : new HaversineDistance();
}

export function createReverseGeocoder(): ReverseGeocoder {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  return process.env.GEOCODER === 'google' && key ? new GoogleGeocoder(key) : new NominatimGeocoder();
}

function blockFrom(address: Record<string, string>) {
  const text = [address.neighbourhood, address.quarter, address.suburb].find((value) => value && /block\s*\d+/i.test(value));
  return text?.match(/block\s*(\d+)/i)?.[1] ?? null;
}
