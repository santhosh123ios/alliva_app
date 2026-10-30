export type Point = { latitude: number; longitude: number };

/** Bahrain with a small margin, so a pin dropped just offshore on a reclaimed island still counts. */
const BAHRAIN = { minLat: 25.5, maxLat: 26.45, minLng: 50.3, maxLng: 50.85 };

export function parsePoint(latitude: unknown, longitude: unknown): Point | null {
  if (latitude === null || latitude === undefined || latitude === '' || longitude === null || longitude === undefined || longitude === '') return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { latitude: lat, longitude: lng };
}

export function insideBahrain(point: Point) {
  return point.latitude >= BAHRAIN.minLat && point.latitude <= BAHRAIN.maxLat && point.longitude >= BAHRAIN.minLng && point.longitude <= BAHRAIN.maxLng;
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: Point, b: Point) {
  const r = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when the point lies inside a GeoJSON Polygon or MultiPolygon (or a Feature wrapping one). */
export function pointInGeoJson(point: Point, geoJson: unknown): boolean {
  const geometry = unwrapGeometry(geoJson);
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return inPolygon(point, geometry.coordinates as number[][][]);
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates as number[][][][]).some((polygon) => inPolygon(point, polygon));
  return false;
}

function unwrapGeometry(value: unknown): { type: string; coordinates: unknown } | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { type?: unknown; geometry?: unknown; coordinates?: unknown; features?: unknown };
  if (row.type === 'Feature') return unwrapGeometry(row.geometry);
  if (row.type === 'FeatureCollection' && Array.isArray(row.features)) return unwrapGeometry(row.features[0]);
  if ((row.type === 'Polygon' || row.type === 'MultiPolygon') && Array.isArray(row.coordinates)) {
    return { type: row.type, coordinates: row.coordinates };
  }
  return null;
}

function inPolygon(point: Point, rings: number[][][]) {
  const [outer, ...holes] = rings;
  if (!outer || !inRing(point, outer)) return false;
  return !holes.some((hole) => inRing(point, hole));
}

function inRing(point: Point, ring: number[][]) {
  let inside = false;
  const x = point.longitude;
  const y = point.latitude;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}
