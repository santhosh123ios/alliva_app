import { api } from '@/components/providers';
import { formatMoney } from '@alliva/design-tokens';
import type { OrderStatus, RiderOrder } from '@alliva/types';
import { cn } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useLocale } from 'use-intl';

export type Point = { latitude: number; longitude: number };

export const riderKeys = {
  me: ['rider', 'me'] as const,
  orders: ['rider', 'orders'] as const,
  order: (id: string) => ['rider', 'order', id] as const,
  collections: ['rider', 'collections'] as const,
};

export function useRiderLocale(): 'en' | 'ar' {
  return useLocale() === 'ar' ? 'ar' : 'en';
}

export function money(value: string | number | null | undefined, locale: 'en' | 'ar') {
  return formatMoney(value ?? 0, locale);
}

export function useRiderProfile() {
  return useQuery({ queryKey: riderKeys.me, queryFn: () => api.rider.me(), staleTime: 30_000 });
}

const LocationContext = createContext<{ point: Point | null; denied: boolean }>({ point: null, denied: false });

export function useRiderPoint() {
  return useContext(LocationContext);
}

/** Watches the phone's position while on shift and tells the store where the rider is, at most once a minute. */
export function RiderLocationProvider({ onShift, children }: { onShift: boolean; children: React.ReactNode }) {
  const [point, setPoint] = useState<Point | null>(null);
  const [denied, setDenied] = useState(false);
  const lastPing = useRef(0);
  useEffect(() => {
    if (!onShift || typeof navigator === 'undefined' || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (position) => {
        const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        setPoint(next);
        setDenied(false);
        if (Date.now() - lastPing.current > 60_000) {
          lastPing.current = Date.now();
          void api.rider.ping(next).catch(() => undefined);
        }
      },
      (error) => { if (error.code === error.PERMISSION_DENIED) setDenied(true); },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [onShift]);
  return <LocationContext.Provider value={{ point, denied }}>{children}</LocationContext.Provider>;
}

export function useRiderOrders() {
  const { point } = useRiderPoint();
  // Round the position so small GPS drift does not refetch the list.
  const from = point ? { latitude: Math.round(point.latitude * 500) / 500, longitude: Math.round(point.longitude * 500) / 500 } : null;
  return useQuery({
    queryKey: [...riderKeys.orders, from?.latitude ?? null, from?.longitude ?? null],
    queryFn: () => api.rider.orders(from),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export type RiderStage = 'assigned' | 'pickedUp' | 'onTheWay' | 'delivered' | 'cancelled';

export function riderStage(order: Pick<RiderOrder, 'status' | 'pickupVerifiedAt'>): RiderStage {
  if (order.status === 'DELIVERED' || order.status === 'REFUNDED') return 'delivered';
  if (order.status === 'CANCELLED') return 'cancelled';
  if (order.status === 'OUT_FOR_DELIVERY') return 'onTheWay';
  if (order.pickupVerifiedAt) return 'pickedUp';
  return 'assigned';
}

const stageTone: Record<RiderStage, string> = {
  assigned: 'bg-[#FFF4D6] text-[#8A5A00]',
  pickedUp: 'bg-[#E7F0FF] text-[#2F6FED]',
  onTheWay: 'bg-[#EDE7FF] text-[#6B3FD6]',
  delivered: 'bg-[#E3F5EA] text-[#168A52]',
  cancelled: 'bg-[#FDECEA] text-[#B42318]',
};

export function StagePill({ stage, label, className }: { stage: RiderStage; label: string; className?: string }) {
  return <span className={cn('inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold', stageTone[stage], className)}>{label}</span>;
}

type AddressPart = 'flat' | 'building' | 'road' | 'block';

export function addressLines(address: RiderOrder['address'], label: (part: AddressPart, value: string) => string) {
  const parts: AddressPart[] = ['flat', 'building', 'road', 'block'];
  const first = parts.filter((part) => address[part]).map((part) => label(part, address[part]!)).join(', ');
  const second = [address.area, address.city].filter(Boolean).join(', ');
  return { title: address.line1 || first || second || '—', detail: [first, address.line2, second].filter((part) => part && part !== address.line1).join(' · ') };
}

export function directionsLinks(point: { latitude: number | null; longitude: number | null }) {
  if (point.latitude === null || point.longitude === null) return null;
  const at = `${point.latitude},${point.longitude}`;
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${at}&travelmode=driving`,
    apple: `https://maps.apple.com/?daddr=${at}&dirflg=d`,
    waze: `https://waze.com/ul?ll=${at}&navigate=yes`,
  };
}

export function telHref(phone: string | null | undefined) {
  return phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : undefined;
}

export function timeLabel(iso: string | null | undefined, locale: 'en' | 'ar') {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-BH' : 'en-BH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Bahrain' }).format(new Date(iso));
}

export function dateTimeLabel(iso: string | null | undefined, locale: 'en' | 'ar') {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-BH' : 'en-BH', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Bahrain' }).format(new Date(iso));
}

export function minutesSince(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

export const ACTIVE_STATUSES: OrderStatus[] = ['ASSIGNED_TO_DRIVER', 'OUT_FOR_DELIVERY'];
