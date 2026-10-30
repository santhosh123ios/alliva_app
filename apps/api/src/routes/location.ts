import type { Request } from 'express';
import {
  addressSchema,
  addressUpdateSchema,
  checkoutValidateSchema,
  deliveryQuoteSchema,
  guestLocationSchema,
  type PaymentMethodCode,
} from '@alliva/validation';
import { badRequest, checkoutError, notFound } from '../common/errors';
import { RequestUser, validate } from '../common/http';
import { createRoutes } from '../common/routes';
import type { Container } from '../container';
import { nearestAddress } from '../domain/cart-merge';
import { haversineKm, insideBahrain, parsePoint } from '../domain/geo';
import { presentAddress, type CheckoutRequest } from '../modules/commerce.service';

/** Area centres used to name a pin when the geocoder is unreachable. */
const AREAS = [
  { en: 'Manama', ar: 'المنامة', latitude: 26.2285, longitude: 50.586 },
  { en: 'Seef', ar: 'السيف', latitude: 26.2361, longitude: 50.5452 },
  { en: 'Juffair', ar: 'الجفير', latitude: 26.2125, longitude: 50.6032 },
  { en: 'Adliya', ar: 'العدلية', latitude: 26.2128, longitude: 50.5893 },
  { en: 'Muharraq', ar: 'المحرق', latitude: 26.2572, longitude: 50.6119 },
  { en: 'Amwaj Islands', ar: 'جزر أمواج', latitude: 26.2887, longitude: 50.6609 },
  { en: 'Riffa', ar: 'الرفاع', latitude: 26.13, longitude: 50.555 },
  { en: 'Isa Town', ar: 'مدينة عيسى', latitude: 26.1736, longitude: 50.5478 },
  { en: 'Hamad Town', ar: 'مدينة حمد', latitude: 26.1153, longitude: 50.5069 },
  { en: 'Sitra', ar: 'سترة', latitude: 26.1547, longitude: 50.6206 },
  { en: 'Budaiya', ar: 'البديع', latitude: 26.2187, longitude: 50.4519 },
  { en: 'Saar', ar: 'سار', latitude: 26.1969, longitude: 50.4889 },
  { en: 'Zallaq', ar: 'الزلاق', latitude: 26.0469, longitude: 50.4836 },
];

const DEFAULT_ADDRESS_MATCH_KM = 0.5;

export function locationRoutes({ prisma, jwt, crypto, commerce, geocoder }: Container) {
  const routes = createRoutes({ jwt, prisma }, 'Location and checkout');

  async function guestFor(request: Request) {
    const token = request.cookies?.alliva_guest as string | undefined;
    return token ? prisma.guest.findUnique({ where: { tokenHash: crypto.hash(token) } }) : null;
  }

  async function viewerFor(request: Request, user?: RequestUser) {
    const guest = await guestFor(request);
    return { customerId: user?.customerId ?? null, guestId: guest && !guest.mergedIntoCustomerId ? guest.id : null };
  }

  async function customerId(user?: RequestUser) {
    if (user?.customerId) return user.customerId;
    if (!user) throw checkoutError('AUTH_REQUIRED', 'Sign in to continue');
    const customer = await prisma.customer.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!customer) throw checkoutError('AUTH_REQUIRED', 'A customer account is required');
    return customer.id;
  }

  async function addressMatchKm() {
    const row = await prisma.platformSetting.findUnique({ where: { key: 'addressMatchRadiusKm' } });
    const value = Number(row?.value);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_ADDRESS_MATCH_KM;
  }

  routes.put('/guests/location', { public: true, throttle: 30 }, async (request) => {
    const body = validate<{ latitude: string | number; longitude: string | number; label?: string | null; source?: string | null }>(guestLocationSchema, request.body);
    const point = parsePoint(body.latitude, body.longitude);
    if (!point) throw badRequest('Choose a valid location');
    const guest = await guestFor(request);
    // Signed-in customers keep their location on the device; only guest sessions store it.
    if (!guest || guest.mergedIntoCustomerId) return { saved: false, latitude: point.latitude.toFixed(6), longitude: point.longitude.toFixed(6), label: body.label ?? null };
    const saved = await commerce.setGuestLocation(guest.id, body);
    return { saved: true, ...saved };
  });

  routes.get('/guests/location', { public: true }, async (request) => {
    const guest = await guestFor(request);
    if (!guest?.latitude || !guest.longitude) return { location: null };
    return {
      location: {
        latitude: Number(guest.latitude).toFixed(6),
        longitude: Number(guest.longitude).toFixed(6),
        label: guest.locationLabel,
        source: guest.locationSource,
        updatedAt: guest.locationUpdatedAt?.toISOString() ?? null,
      },
    };
  });

  routes.get('/geo/reverse', { public: true, throttle: 40 }, async (request) => {
    const query = request.query as { lat?: string; lng?: string; locale?: string };
    const point = parsePoint(query.lat, query.lng);
    if (!point) throw badRequest('Choose a valid location');
    const locale = query.locale === 'ar' ? 'ar' : 'en';
    const inside = insideBahrain(point);
    const found = inside ? await geocoder.reverse(point, locale) : null;
    const closest = [...AREAS].sort((a, b) => haversineKm(point, a) - haversineKm(point, b))[0]!;
    const fallbackArea = haversineKm(point, closest) <= 4 ? closest[locale] : null;
    return {
      latitude: point.latitude.toFixed(6),
      longitude: point.longitude.toFixed(6),
      insideServiceCountry: inside,
      resolved: Boolean(found),
      label: found?.label || fallbackArea || null,
      road: found?.road ?? null,
      block: found?.block ?? null,
      area: found?.area ?? fallbackArea,
      city: found?.city ?? (fallbackArea ? closest[locale] : null),
    };
  });

  routes.get('/storefront/nearby', { public: true }, async (request) => {
    const query = request.query as { lat?: string; lng?: string };
    const viewer = await viewerFor(request, request.user);
    return commerce.nearby({ lat: query.lat, lng: query.lng, exclusiveSlug: request.cookies?.alliva_storefront, ...viewer });
  });

  routes.post('/delivery/quote', { public: true, throttle: 60 }, async (request) => {
    const body = validate<{ addressId?: string | null; latitude?: string | number | null; longitude?: string | number | null; merchantId?: string | null; branchId?: string | null }>(deliveryQuoteSchema, request.body);
    return commerce.deliveryQuote(await viewerFor(request, request.user), body);
  });

  routes.post('/cart/merge', async (request) => {
    const guest = await guestFor(request);
    const id = await customerId(request.user);
    if (guest) await commerce.mergeGuestCart(guest.id, id);
    return commerce.cartFor({ customerId: id });
  });

  routes.get('/customers/me/addresses', async (request) => {
    const id = await customerId(request.user);
    const rows = await prisma.address.findMany({ where: { customerId: id, deletedAt: null }, orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] });
    return rows.map(presentAddress);
  });

  routes.get('/customers/me/addresses/nearest', async (request) => {
    const id = await customerId(request.user);
    const query = request.query as { lat?: string; lng?: string };
    const point = parsePoint(query.lat, query.lng);
    if (!point) throw badRequest('Choose a valid location');
    const maxKm = await addressMatchKm();
    const rows = await prisma.address.findMany({ where: { customerId: id, deletedAt: null } });
    const usable = rows
      .map((row) => ({ row, latitude: Number(row.latitude), longitude: Number(row.longitude) }))
      .filter((row) => parsePoint(row.latitude, row.longitude));
    const match = nearestAddress(usable, (row) => haversineKm(point, row), maxKm);
    const closest = usable.length ? Math.min(...usable.map((row) => haversineKm(point, row))) : null;
    return {
      maxDistanceKm: maxKm.toFixed(3),
      address: match ? presentAddress(match.address.row) : null,
      distanceKm: match ? match.distanceKm.toFixed(3) : null,
      closestDistanceKm: closest === null ? null : closest.toFixed(3),
      savedCount: usable.length,
    };
  });

  routes.post('/customers/me/addresses', async (request) => {
    const id = await customerId(request.user);
    const body = validate<AddressBody & { forCheckout?: boolean }>(addressSchema, request.body);
    const { forCheckout, ...fields } = body;
    if (forCheckout) {
      const quote = await commerce.deliveryQuote({ customerId: id }, { latitude: fields.latitude, longitude: fields.longitude }).catch(() => null);
      if (quote && !quote.available) {
        if (quote.reason === 'OUT_OF_RANGE') throw checkoutError('ADDRESS_OUT_OF_RANGE', 'This location is outside the store’s delivery range');
        if (quote.reason === 'CONFIG_MISSING') throw checkoutError('DELIVERY_CONFIG_MISSING', 'This store has not finished setting up delivery');
        throw checkoutError('DELIVERY_DISABLED', 'This store does not deliver to this location');
      }
    }
    const count = await prisma.address.count({ where: { customerId: id, deletedAt: null } });
    const isDefault = fields.isDefault ?? count === 0;
    const created = await prisma.$transaction(async (tx) => {
      if (isDefault) await tx.address.updateMany({ where: { customerId: id, isDefault: true }, data: { isDefault: false } });
      return tx.address.create({ data: { ...addressData(fields), customerId: id, isDefault } });
    });
    return presentAddress(created);
  });

  routes.patch('/customers/me/addresses/:id', async (request) => {
    const id = await customerId(request.user);
    const body = validate<Partial<AddressBody>>(addressUpdateSchema, request.body);
    const existing = await prisma.address.findFirst({ where: { id: request.params.id as string, customerId: id, deletedAt: null } });
    if (!existing) throw notFound('Address not found');
    if ((body.latitude === undefined) !== (body.longitude === undefined)) throw badRequest('Move the pin to update the location');
    const merged = { ...presentAddress(existing), ...stripUndefined(body) } as AddressBody;
    const updated = await prisma.$transaction(async (tx) => {
      if (body.isDefault) await tx.address.updateMany({ where: { customerId: id, isDefault: true, NOT: { id: existing.id } }, data: { isDefault: false } });
      return tx.address.update({ where: { id: existing.id }, data: { ...addressData(merged), isDefault: body.isDefault ?? existing.isDefault } });
    });
    return presentAddress(updated);
  });

  routes.delete('/customers/me/addresses/:id', async (request) => {
    const id = await customerId(request.user);
    const existing = await prisma.address.findFirst({ where: { id: request.params.id as string, customerId: id, deletedAt: null } });
    if (!existing) throw notFound('Address not found');
    await prisma.address.update({ where: { id: existing.id }, data: { deletedAt: new Date(), isDefault: false } });
    await prisma.cart.updateMany({ where: { customerId: id, addressId: existing.id }, data: { addressId: null } });
    return { ok: true };
  });

  routes.post('/checkout/validate', { throttle: 60 }, async (request) => {
    const id = await customerId(request.user);
    const body = validate<Omit<CheckoutRequest, 'paymentMethod'> & { paymentMethod?: PaymentMethodCode }>(checkoutValidateSchema, request.body);
    // Remember the choice on the cart so the cart screen shows the same address and order type.
    await commerce.setContext({ customerId: id }, body).catch(() => undefined);
    const { internal: _internal, ...view } = await commerce.validateCheckout(id, body as CheckoutRequest);
    return view;
  });

  return routes;
}

type AddressBody = {
  label: string;
  line1?: string;
  line2?: string | null;
  building?: string | null;
  flat?: string | null;
  road?: string | null;
  block?: string | null;
  area?: string | null;
  city: string;
  landmark?: string | null;
  latitude: string;
  longitude: string;
  contactName?: string | null;
  contactPhone?: string | null;
  instructions?: string | null;
  isDefault?: boolean;
};

/** Bahrain addresses read "Bldg 123, Flat 4, Road 2803, Block 428"; build that line when the customer filled the parts. */
function addressData(body: AddressBody) {
  const parts = [
    body.building ? `Bldg ${body.building}` : null,
    body.flat ? `Flat ${body.flat}` : null,
    body.road ? `Road ${body.road}` : null,
    body.block ? `Block ${body.block}` : null,
  ].filter(Boolean);
  const line1 = parts.length ? parts.join(', ') : (body.line1?.trim() ?? '');
  const empty = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);
  return {
    label: body.label,
    line1,
    line2: empty(body.line2 ?? body.area),
    city: body.city,
    latitude: body.latitude,
    longitude: body.longitude,
    building: empty(body.building),
    flat: empty(body.flat),
    road: empty(body.road),
    block: empty(body.block),
    area: empty(body.area),
    landmark: empty(body.landmark),
    contactName: empty(body.contactName),
    contactPhone: empty(body.contactPhone),
    instructions: empty(body.instructions),
  };
}

function stripUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}
