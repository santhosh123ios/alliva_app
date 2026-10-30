import { api } from '@/components/providers';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LatLng = { lat: number; lng: number };

export type LocationSource = 'GPS' | 'SEARCH' | 'PIN' | 'AREA' | 'ADDRESS';

/** What happened the last time we tried to read the device location. */
export type LocationStatus = 'idle' | 'locating' | 'ready' | 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'error';

/** Used to show stores before the customer picks a location. Never treated as their real location. */
export const DEFAULT_POINT: LatLng = { lat: 26.2285, lng: 50.586 };

type LocationState = {
  point: LatLng | null;
  label: string | null;
  source: LocationSource | null;
  /** The saved address the location came from, so the cart and checkout deliver there too. */
  addressId: string | null;
  /** The customer answered the first-run location prompt, either way. We never ask again on our own. */
  prompted: boolean;
  status: LocationStatus;
  /** Monotonic counter so screens can react to a new location even when the label is the same. */
  revision: number;
  setLocation: (point: LatLng, label: string | null, source: LocationSource, addressId?: string | null) => void;
  /** Forget the saved address (it was deleted or belongs to someone who signed out) but keep the point. */
  clearAddress: () => void;
  setLabel: (label: string | null) => void;
  setStatus: (status: LocationStatus) => void;
  markPrompted: () => void;
};

export const useLocationStore = create<LocationState>()(
  persist(
    (set) => ({
      point: null,
      label: null,
      source: null,
      addressId: null,
      prompted: false,
      status: 'idle',
      revision: 0,
      setLocation: (point, label, source, addressId = null) =>
        set((state) => ({ point, label, source, addressId, status: 'ready', prompted: true, revision: state.revision + 1 })),
      clearAddress: () => set((state) => (state.addressId ? { addressId: null, source: 'PIN' } : state)),
      setLabel: (label) => set({ label }),
      setStatus: (status) => set({ status }),
      markPrompted: () => set({ prompted: true }),
    }),
    {
      name: 'alliva-location',
      partialize: (state) => ({ point: state.point, label: state.label, source: state.source, addressId: state.addressId, prompted: state.prompted }),
    },
  ),
);

/** The point to search around: the customer's choice, or central Manama until they choose. */
export function useSearchPoint() {
  const point = useLocationStore((state) => state.point);
  return { point: point ?? DEFAULT_POINT, chosen: Boolean(point) };
}

/** Round to about 10 m so tiny GPS jitter does not refetch every list. */
export function pointKey(point: LatLng) {
  return `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
}

export function readDevicePosition(timeoutMs = 12_000): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new LocationError('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) reject(new LocationError('denied'));
        else if (error.code === error.POSITION_UNAVAILABLE) reject(new LocationError('unavailable'));
        else if (error.code === error.TIMEOUT) reject(new LocationError('timeout'));
        else reject(new LocationError('error'));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

export class LocationError extends Error {
  constructor(readonly status: Exclude<LocationStatus, 'idle' | 'locating' | 'ready'>) {
    super(status);
  }
}

/** Ask the device where it is, name the place, and remember it on the guest session. */
export async function detectLocation(locale: 'en' | 'ar') {
  const store = useLocationStore.getState();
  store.setStatus('locating');
  try {
    const point = await readDevicePosition();
    const label = await nameFor(point, locale);
    useLocationStore.getState().setLocation(point, label, 'GPS');
    void syncGuestLocation(point, label, 'GPS');
    return point;
  } catch (error) {
    const status = error instanceof LocationError ? error.status : 'error';
    useLocationStore.getState().setStatus(status);
    useLocationStore.getState().markPrompted();
    throw error;
  }
}

/** Use a point the customer chose on the map, from search, or from a quick area. */
export async function chooseLocation(point: LatLng, source: LocationSource, locale: 'en' | 'ar', knownLabel?: string | null) {
  const label = knownLabel ?? (await nameFor(point, locale));
  useLocationStore.getState().setLocation(point, label, source);
  void syncGuestLocation(point, label, source);
}

/** Deliver to one of the customer's saved addresses. Every screen that reads the location follows it. */
export function chooseAddress(address: { id: string; label: string; latitude: string; longitude: string }) {
  const point = { lat: Number(address.latitude), lng: Number(address.longitude) };
  useLocationStore.getState().setLocation(point, address.label, 'ADDRESS', address.id);
  void syncGuestLocation(point, address.label, 'ADDRESS');
}

export async function nameFor(point: LatLng, locale: 'en' | 'ar') {
  try {
    const place = await api.reverseGeocode(point.lat.toFixed(6), point.lng.toFixed(6), locale);
    return place.label;
  } catch {
    return null;
  }
}

async function syncGuestLocation(point: LatLng, label: string | null, source: LocationSource) {
  try {
    await ensureGuest();
    await api.setGuestLocation({ latitude: point.lat.toFixed(6), longitude: point.lng.toFixed(6), label, source: source === 'ADDRESS' ? 'PIN' : source });
  } catch {
    // The location still works on this device; the server copy only helps price a guest cart.
  }
}

let guestRequest: Promise<unknown> | null = null;

/** Create or restore the guest session once per page load, however many screens ask for it. */
export function ensureGuest() {
  guestRequest ??= api.guest().catch((error) => {
    guestRequest = null;
    throw error;
  });
  return guestRequest;
}

/** The search point shaped like the old fixed areas (`id`, `lat`, `lng` strings), for screens that only need distances. */
export function useAreaPoint() {
  const { point } = useSearchPoint();
  return { id: pointKey(point), lat: point.lat.toFixed(6), lng: point.lng.toFixed(6) };
}
