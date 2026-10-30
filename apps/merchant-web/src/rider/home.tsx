import { api } from '@/components/providers';
import { useRouter } from '@/i18n/navigation';
import { Link } from '@/i18n/navigation';
import type { RiderOrder } from '@alliva/types';
import { cn, EmptyState, ErrorState, Skeleton } from '@alliva/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Clock, MapPin, Navigation, PackageCheck, QrCode, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { PickupVerifier } from './scanner';
import { addressLines, minutesSince, money, riderKeys, riderStage, StagePill, timeLabel, useRiderLocale, useRiderOrders, useRiderPoint, useRiderProfile } from './shared';

export default function RiderHome() {
  const t = useTranslations('rider');
  const locale = useRiderLocale();
  const router = useRouter();
  const profile = useRiderProfile();
  const orders = useRiderOrders();
  const { denied } = useRiderPoint();
  const [scanning, setScanning] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const active = orders.data?.active ?? [];
  const delivered = orders.data?.delivered ?? [];
  const cashDue = active.reduce((total, order) => total + (order.cashDue ? Number(order.cashDue) : 0), 0);

  return (
    <div className="space-y-4">
      {profile.data && !profile.data.onShift ? <ShiftBanner /> : null}
      {denied && profile.data?.onShift ? <p className="rounded-2xl bg-[#FFF4D6] px-4 py-3 text-sm text-[#8A5A00]">{t('home.locationDenied')}</p> : null}

      <section className="grid grid-cols-3 gap-2">
        <Stat label={t('home.toDeliver')} value={orders.data ? String(active.length) : '–'} />
        <Stat label={t('home.deliveredToday')} value={orders.data ? String(delivered.length) : '–'} />
        <Stat label={t('home.cashToCollect')} value={orders.data ? money(cashDue, locale) : '–'} small />
      </section>

      <button
        type="button"
        onClick={() => setScanning(true)}
        className="flex w-full items-center gap-4 rounded-3xl bg-[#111111] p-4 text-start text-white shadow-[0_10px_30px_rgba(17,17,17,0.18)] active:scale-[0.99]"
      >
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[#FFC400] text-[#111111]"><QrCode className="size-7" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold">{t('home.scanTitle')}</span>
          <span className="block text-sm text-white/70">{t('home.scanBody')}</span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-white/60 rtl:rotate-180" />
      </button>

      <section>
        <div className="mb-2 flex items-end justify-between">
          <h1 className="text-lg font-semibold">{t('home.routeTitle')}</h1>
          {active.length > 1 ? <span className="text-xs text-[#696965]">{t('home.routeHint')}</span> : null}
        </div>
        {orders.isLoading ? (
          <div className="space-y-3">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-36 rounded-3xl" />)}</div>
        ) : orders.error ? (
          <ErrorState title={t('home.loadFailed')} body={(orders.error as Error).message} />
        ) : active.length ? (
          <ol className="space-y-3">
            {active.map((order) => <li key={order.id}><OrderCard order={order} /></li>)}
          </ol>
        ) : (
          <div className="rounded-3xl border border-dashed border-[#DADAD4] bg-white">
            <EmptyState title={t('home.emptyTitle')} body={profile.data?.onShift ? t('home.emptyOnShift') : t('home.emptyOffShift')} />
          </div>
        )}
      </section>

      {delivered.length ? (
        <section>
          <button type="button" onClick={() => setShowDone((value) => !value)} className="flex w-full items-center justify-between py-2 text-sm font-semibold text-[#5C5C58]">
            {t('home.doneToday', { count: delivered.length })}
            <ChevronRight className={cn('size-4 transition-transform', showDone ? 'rotate-90' : 'rtl:rotate-180')} />
          </button>
          {showDone ? (
            <ul className="space-y-2">
              {delivered.map((order) => (
                <li key={order.id}>
                  <Link href={`/rider/orders/${order.id}`} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3">
                    <PackageCheck className="size-5 shrink-0 text-[#168A52]" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold"><bdi dir="ltr">#{order.number}</bdi></span>
                      <span className="block truncate text-xs text-[#696965]">{order.customer.name}</span>
                    </span>
                    <span className="text-xs text-[#696965]">{timeLabel(order.events.at(-1)?.createdAt, locale)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <PickupVerifier
        open={scanning}
        onOpenChange={setScanning}
        onVerified={(order) => {
          setScanning(false);
          router.push(`/rider/orders/${order.id}`);
        }}
      />
    </div>
  );
}

function ShiftBanner() {
  const t = useTranslations('rider');
  const client = useQueryClient();
  const start = useMutation({
    mutationFn: () => api.rider.setShift({ onShift: true }),
    onSuccess: (profile) => client.setQueryData(riderKeys.me, profile),
  });
  return (
    <div className="flex items-center gap-3 rounded-3xl border border-[#F0D27A] bg-[#FFF8E1] p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t('home.offShiftTitle')}</p>
        <p className="text-xs text-[#6B5A2A]">{t('home.offShiftBody')}</p>
      </div>
      <button type="button" disabled={start.isPending} onClick={() => start.mutate()} className="h-10 shrink-0 rounded-xl bg-[#111111] px-4 text-sm font-semibold text-white disabled:opacity-50">
        {t('shift.start')}
      </button>
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-2xl bg-white px-3 py-3">
      <p className={cn('font-semibold tabular-nums', small ? 'text-sm leading-6' : 'text-xl')}>{value}</p>
      <p className="mt-0.5 text-[11px] leading-tight text-[#696965]">{label}</p>
    </div>
  );
}

function OrderCard({ order }: { order: RiderOrder }) {
  const t = useTranslations('rider');
  const locale = useRiderLocale();
  const stage = riderStage(order);
  const place = addressLines(order.address, (part, value) => t(`address.${part}`, { value }));
  const waited = minutesSince(order.assignedAt ?? order.createdAt);
  const km = order.fromHereKm ?? order.distanceKm;
  return (
    <Link href={`/rider/orders/${order.id}`} className="block rounded-3xl border border-[#ECECE8] bg-white p-4 shadow-[0_4px_16px_rgba(17,17,17,0.04)] active:bg-[#FAFAF8]">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#111111] text-sm font-bold text-[#FFC400]" aria-label={t('home.stop', { number: order.stop ?? 0 })}>{order.stop}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-base font-semibold">{order.customer.name}</p>
            <StagePill stage={stage} label={t(`stage.${stage}`)} />
          </div>
          <p className="text-xs text-[#696965]"><bdi dir="ltr">#{order.number}</bdi></p>
        </div>
      </div>
      <div className="mt-3 flex items-start gap-2 text-sm">
        <MapPin className="mt-0.5 size-4 shrink-0 text-[#8A8A86]" />
        <p className="min-w-0">
          <span className="block truncate font-medium">{place.title}</span>
          {place.detail ? <span className="block truncate text-xs text-[#696965]">{place.detail}</span> : null}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[#F0F0EC] pt-3 text-xs text-[#5C5C58]">
        {km !== null ? <span className="flex items-center gap-1"><Navigation className="size-3.5" />{t('home.km', { km: km.toFixed(1) })}</span> : null}
        <span className={cn('flex items-center gap-1', waited > 30 && 'font-semibold text-[#B42318]')}><Clock className="size-3.5" />{t('home.minutesAgo', { minutes: waited })}</span>
        <span className="flex items-center gap-1">
          <Wallet className="size-3.5" />
          {order.cashDue ? <strong className="font-semibold text-[#111111]">{t('home.collect', { amount: money(order.cashDue, locale) })}</strong> : t('home.paid')}
        </span>
        <span className="ms-auto">{t('home.items', { count: order.items.reduce((total, item) => total + item.quantity, 0) })}</span>
      </div>
    </Link>
  );
}
