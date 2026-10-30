import { LocationMap } from '@/components/location-map';
import { api } from '@/components/providers';
import { RouteMap } from '@/components/route-map';
import { Link } from '@/i18n/navigation';
import { pickLocalized } from '@alliva/design-tokens';
import type { DeliveryIssueType, RiderOrder } from '@alliva/types';
import { cn, Dialog, DialogContent, DialogDescription, DialogTitle, ErrorState, Skeleton, toast } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, ExternalLink, Loader2, MapPinned, MessageSquareText, Phone, QrCode, Store, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useTranslations } from 'use-intl';
import { PickupVerifier } from './scanner';
import { addressLines, dateTimeLabel, directionsLinks, money, riderKeys, riderStage, StagePill, telHref, timeLabel, useRiderLocale, useRiderPoint, type RiderStage } from './shared';

const ISSUE_TYPES: DeliveryIssueType[] = ['CUSTOMER_UNREACHABLE', 'WRONG_ADDRESS', 'ITEM_MISSING', 'DAMAGED', 'PAYMENT_REFUSED', 'OTHER'];

export default function RiderOrderPage() {
  const { id = '' } = useParams();
  const t = useTranslations('rider');
  const order = useQuery({ queryKey: riderKeys.order(id), queryFn: () => api.rider.order(id), refetchInterval: 30_000 });
  if (order.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 rounded-3xl" />
        <Skeleton className="h-64 rounded-3xl" />
        <Skeleton className="h-40 rounded-3xl" />
      </div>
    );
  }
  if (order.error || !order.data) return <ErrorState title={t('order.loadFailed')} body={(order.error as Error | null)?.message ?? ''} />;
  return <OrderDetail order={order.data} />;
}

function OrderDetail({ order }: { order: RiderOrder }) {
  const t = useTranslations('rider');
  const locale = useRiderLocale();
  const client = useQueryClient();
  const { point } = useRiderPoint();
  const stage = riderStage(order);
  const [verifying, setVerifying] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [pinning, setPinning] = useState(false);
  const place = addressLines(order.address, (part, value) => t(`address.${part}`, { value }));
  const drop = order.address.latitude !== null && order.address.longitude !== null ? { lat: order.address.latitude, lng: order.address.longitude } : null;
  const storePoint = useMemo(() => ({ lat: order.store.latitude, lng: order.store.longitude }), [order.store.latitude, order.store.longitude]);
  const routes = useMemo(() => (drop ? [{ id: order.id, color: '#6B3FD6', stops: [{ ...drop, label: String(order.stop ?? 1) }] }] : []), [drop?.lat, drop?.lng, order.id, order.stop]); // eslint-disable-line react-hooks/exhaustive-deps
  const me = useMemo(() => (point ? { lat: point.latitude, lng: point.longitude } : null), [point?.latitude, point?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps
  const toCustomer = directionsLinks(order.address);
  const toStore = directionsLinks(order.store);
  const done = stage === 'delivered' || stage === 'cancelled';

  const refresh = (next: RiderOrder) => {
    client.setQueryData(riderKeys.order(next.id), next);
    void client.invalidateQueries({ queryKey: riderKeys.orders });
    void client.invalidateQueries({ queryKey: riderKeys.collections });
    void client.invalidateQueries({ queryKey: riderKeys.me });
  };
  const start = useMutation({
    mutationFn: () => api.rider.setStatus(order.id, { status: 'OUT_FOR_DELIVERY' }),
    onSuccess: (result) => { refresh(result.order); toast.success(t('order.started')); },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className={cn('space-y-3', !done && 'pb-24 md:pb-24')}>
      <div className="flex items-center gap-2">
        <Link href="/rider" className="grid size-10 place-items-center rounded-xl bg-white" aria-label={t('order.back')}>
          <ArrowLeft className="size-5 rtl:rotate-180" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{t('order.title', { number: order.number })}</h1>
          <p className="text-xs text-[#696965]">{order.scheduledFor ? t('order.scheduled', { time: dateTimeLabel(order.scheduledFor, locale) }) : t('order.placed', { time: timeLabel(order.createdAt, locale) })}</p>
        </div>
        <StagePill stage={stage} label={t(`stage.${stage}`)} />
      </div>

      <Progress order={order} stage={stage} />

      <section className="rounded-3xl bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#8A8A86]">{t('order.customer')}</p>
        <div className="mt-2 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{order.customer.name}</p>
            {order.customer.phone ? <p className="text-sm text-[#5C5C58]" dir="ltr">{order.customer.phone}</p> : <p className="text-sm text-[#8A8A86]">{t('order.noPhone')}</p>}
          </div>
          {order.customer.phone ? (
            <>
              <a href={`https://wa.me/${order.customer.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="grid size-11 place-items-center rounded-2xl bg-[#F2F2EF]" aria-label={t('order.message')}>
                <MessageSquareText className="size-5" />
              </a>
              <a href={telHref(order.customer.phone)} className="flex h-11 items-center gap-2 rounded-2xl bg-[#168A52] px-4 text-sm font-semibold text-white">
                <Phone className="size-4" />{t('order.call')}
              </a>
            </>
          ) : null}
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl bg-white">
        <RouteMap store={storePoint} routes={routes} me={me} className="z-0 h-52 w-full md:h-64" />
        <div className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8A8A86]">{t('order.dropoff')}</p>
          <p className="mt-1 text-base font-semibold">{place.title}</p>
          {place.detail ? <p className="text-sm text-[#5C5C58]">{place.detail}</p> : null}
          {order.address.landmark ? <p className="mt-1 text-sm text-[#5C5C58]">{t('order.landmark', { value: order.address.landmark })}</p> : null}
          {order.address.instructions ? <p className="mt-2 rounded-xl bg-[#FFF8E1] px-3 py-2 text-sm text-[#6B5A2A]">{order.address.instructions}</p> : null}
          {order.address.pinCorrectedAt ? <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[#2F6FED]"><MapPinned className="size-3.5" />{t('order.pinCorrected')}</p> : null}
          {!drop ? <p className="mt-2 text-sm font-medium text-[#B42318]">{t('order.noPin')}</p> : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {toCustomer ? (
              <a href={toCustomer.google} target="_blank" rel="noreferrer" className="col-span-2 flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#111111] text-sm font-semibold text-white">
                <Truck className="size-4" />{t('order.directions')}
              </a>
            ) : null}
            {toCustomer ? (
              <>
                <a href={toCustomer.apple} target="_blank" rel="noreferrer" className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-[#E2E2DC] text-sm font-medium">{t('order.appleMaps')}<ExternalLink className="size-3.5" /></a>
                <a href={toCustomer.waze} target="_blank" rel="noreferrer" className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-[#E2E2DC] text-sm font-medium">Waze<ExternalLink className="size-3.5" /></a>
              </>
            ) : null}
            {!done ? (
              <button type="button" onClick={() => setPinning(true)} className="col-span-2 flex h-10 items-center justify-center gap-2 rounded-xl border border-dashed border-[#C9C9C2] text-sm font-medium text-[#5C5C58]">
                <MapPinned className="size-4" />{t('order.fixPin')}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {!order.pickupVerifiedAt && !done ? (
        <section className="rounded-3xl bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8A8A86]">{t('order.pickupFrom')}</p>
          <div className="mt-2 flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-[#FFF4D6]"><Store className="size-5 text-[#8A5A00]" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{pickLocalized(order.store.branch, locale) || pickLocalized(order.store.name, locale)}</p>
              <p className="truncate text-sm text-[#5C5C58]">{[order.store.line1, order.store.city].filter(Boolean).join(', ')}</p>
            </div>
            {order.store.phone ? <a href={telHref(order.store.phone)} className="grid size-10 place-items-center rounded-xl bg-[#F2F2EF]" aria-label={t('order.callStore')}><Phone className="size-4" /></a> : null}
            {toStore ? <a href={toStore.google} target="_blank" rel="noreferrer" className="grid size-10 place-items-center rounded-xl bg-[#F2F2EF]" aria-label={t('order.directionsStore')}><Truck className="size-4" /></a> : null}
          </div>
        </section>
      ) : null}

      <section className="rounded-3xl bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#8A8A86]">{t('order.items', { count: order.items.reduce((total, item) => total + item.quantity, 0) })}</p>
        <ul className="mt-2 divide-y divide-[#F0F0EC]">
          {order.items.map((item, index) => (
            <li key={index} className="flex items-start gap-3 py-2.5 text-sm">
              <span className="grid h-6 min-w-6 place-items-center rounded-md bg-[#F2F2EF] px-1 text-xs font-bold">{item.quantity}×</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{pickLocalized(item.name, locale)}</span>
                {item.addons.length ? <span className="block text-xs text-[#696965]">{item.addons.map((addon) => pickLocalized(addon.name, locale)).join(', ')}</span> : null}
                {item.notes ? <span className="block text-xs italic text-[#8A5A00]">{item.notes}</span> : null}
              </span>
            </li>
          ))}
        </ul>
        {order.notes ? <p className="mt-2 rounded-xl bg-[#F7F7F5] px-3 py-2 text-sm">{t('order.note', { note: order.notes })}</p> : null}
      </section>

      <section className="rounded-3xl bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#8A8A86]">{t('order.payment')}</p>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-sm text-[#5C5C58]">{t(`payment.${order.paymentMethod ?? 'UNKNOWN'}`)}</span>
          <span className="text-sm">{t('order.total', { amount: money(order.total, locale) })}</span>
        </div>
        {order.cashDue ? (
          <div className={cn('mt-3 flex items-center justify-between rounded-2xl px-4 py-3', order.cashCollected ? 'bg-[#E3F5EA]' : 'bg-[#FFF4D6]')}>
            <span className="text-sm font-semibold">{order.cashCollected ? t('order.cashCollected') : t('order.cashToCollect')}</span>
            <span className="text-lg font-bold tabular-nums">{money(order.cashCollected ?? order.cashDue, locale)}</span>
          </div>
        ) : (
          <p className="mt-3 flex items-center gap-2 rounded-2xl bg-[#E3F5EA] px-4 py-3 text-sm font-semibold text-[#168A52]"><Check className="size-4" />{t('order.prepaid')}</p>
        )}
      </section>

      <section className="rounded-3xl bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8A8A86]">{t('order.issues')}</p>
          {!done ? (
            <button type="button" onClick={() => setReporting(true)} className="flex h-9 items-center gap-1.5 rounded-xl bg-[#FDECEA] px-3 text-sm font-semibold text-[#B42318]">
              <AlertTriangle className="size-4" />{t('order.reportIssue')}
            </button>
          ) : null}
        </div>
        {order.issues.length ? (
          <ul className="mt-2 space-y-2">
            {order.issues.map((issue) => (
              <li key={issue.id} className="rounded-xl bg-[#F7F7F5] px-3 py-2 text-sm">
                <span className="font-semibold">{t(`issue.types.${issue.type}`)}</span>
                <span className="text-xs text-[#696965]"> · {timeLabel(issue.createdAt, locale)}</span>
                {issue.note ? <span className="block text-[#5C5C58]">{issue.note}</span> : null}
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-[#8A8A86]">{t('order.noIssues')}</p>}
      </section>

      {!done ? (
        <div className="fixed inset-x-0 bottom-[calc(max(0.7rem,env(safe-area-inset-bottom))+5.4rem)] z-30 border-t border-[#E6E6E1] bg-white/95 px-4 py-3 backdrop-blur md:bottom-0">
          <div className="mx-auto max-w-3xl">
            {stage === 'assigned' ? (
              <ActionButton onClick={() => setVerifying(true)} icon={<QrCode className="size-5" />}>{t('order.verifyPickup')}</ActionButton>
            ) : stage === 'pickedUp' ? (
              <ActionButton onClick={() => start.mutate()} loading={start.isPending} icon={<Truck className="size-5" />}>{t('order.startDelivery')}</ActionButton>
            ) : (
              <ActionButton onClick={() => setDelivering(true)} tone="success" icon={<Check className="size-5" />}>{order.cashDue ? t('order.collectAndDeliver', { amount: money(order.cashDue, locale) }) : t('order.markDelivered')}</ActionButton>
            )}
          </div>
        </div>
      ) : null}

      <PickupVerifier open={verifying} onOpenChange={setVerifying} orderId={order.id} onVerified={(next) => { setVerifying(false); refresh(next); toast.success(t('order.verified')); }} />
      <DeliverDialog order={order} open={delivering} onOpenChange={setDelivering} onDone={(next) => { setDelivering(false); refresh(next); toast.success(t('order.delivered')); }} />
      <IssueDialog order={order} open={reporting} onOpenChange={setReporting} onDone={(next) => { setReporting(false); refresh(next); toast.success(t('issue.sent')); }} />
      <PinDialog order={order} open={pinning} onOpenChange={setPinning} onDone={(next) => { setPinning(false); refresh(next); toast.success(t('pin.saved')); }} />
    </div>
  );
}

function ActionButton({ children, onClick, icon, loading, tone = 'dark' }: { children: React.ReactNode; onClick: () => void; icon: React.ReactNode; loading?: boolean; tone?: 'dark' | 'success' }) {
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className={cn('flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-semibold disabled:opacity-60', tone === 'success' ? 'bg-[#168A52] text-white' : 'bg-[#FFC400] text-[#111111]')}
    >
      {loading ? <Loader2 className="size-5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

function Progress({ order, stage }: { order: RiderOrder; stage: RiderStage }) {
  const t = useTranslations('rider');
  const locale = useRiderLocale();
  const at = (status: string) => [...order.events].reverse().find((event) => event.status === status)?.createdAt ?? null;
  const steps: { key: RiderStage; done: boolean; time: string | null }[] = [
    { key: 'assigned', done: true, time: order.assignedAt },
    { key: 'pickedUp', done: Boolean(order.pickupVerifiedAt), time: order.pickupVerifiedAt },
    { key: 'onTheWay', done: stage === 'onTheWay' || stage === 'delivered', time: at('OUT_FOR_DELIVERY') },
    { key: 'delivered', done: stage === 'delivered', time: at('DELIVERED') },
  ];
  return (
    <ol className="grid grid-cols-4 gap-1 rounded-3xl bg-white p-3">
      {steps.map((step, index) => (
        <li key={step.key} className="flex flex-col items-center text-center">
          <div className="flex w-full items-center">
            <span className={cn('h-0.5 flex-1', index === 0 ? 'opacity-0' : step.done ? 'bg-[#168A52]' : 'bg-[#E2E2DC]')} />
            <span className={cn('grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold', step.done ? 'bg-[#168A52] text-white' : 'bg-[#F0F0EC] text-[#8A8A86]')}>
              {step.done ? <Check className="size-4" /> : index + 1}
            </span>
            <span className={cn('h-0.5 flex-1', index === steps.length - 1 ? 'opacity-0' : steps[index + 1]!.done ? 'bg-[#168A52]' : 'bg-[#E2E2DC]')} />
          </div>
          <span className="mt-1.5 text-[11px] font-semibold leading-tight">{t(`stage.${step.key}`)}</span>
          <span className="text-[10px] text-[#8A8A86]">{step.done ? timeLabel(step.time, locale) : ''}</span>
        </li>
      ))}
    </ol>
  );
}

function DeliverDialog({ order, open, onOpenChange, onDone }: { order: RiderOrder; open: boolean; onOpenChange: (open: boolean) => void; onDone: (order: RiderOrder) => void }) {
  const t = useTranslations('rider.deliver');
  const locale = useRiderLocale();
  const [amount, setAmount] = useState(order.cashDue ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const differs = Boolean(order.cashDue) && amount !== '' && Number(amount) !== Number(order.cashDue);
  const save = useMutation({
    mutationFn: () => api.rider.setStatus(order.id, { status: 'DELIVERED', ...(order.cashDue ? { collectedAmount: Number(amount).toFixed(3) } : {}), ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: (result) => { setError(''); onDone(result.order); },
    onError: (reason: Error) => setError(reason.message),
  });
  const invalid = Boolean(order.cashDue) && (!/^\d+(\.\d{1,3})?$/.test(amount) || (differs && !note.trim()));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-sm:bottom-0 max-sm:top-auto max-sm:w-full max-sm:translate-y-0 max-sm:rounded-b-none">
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{order.cashDue ? t('cashBody', { amount: money(order.cashDue, locale) }) : t('paidBody')}</DialogDescription>
        <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); if (!invalid) save.mutate(); }}>
          {order.cashDue ? (
            <div>
              <label htmlFor="collected" className="text-sm font-medium">{t('amountLabel')}</label>
              <div className="relative mt-1.5">
                <input
                  id="collected"
                  inputMode="decimal"
                  dir="ltr"
                  value={amount}
                  onChange={(event) => { setAmount(event.target.value.replace(/[^\d.]/g, '')); setError(''); }}
                  className="h-14 w-full rounded-2xl border-2 border-[#E2E2DC] bg-white pe-16 ps-4 text-2xl font-bold tabular-nums outline-none focus:border-[#111111]"
                />
                <span className="absolute end-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[#8A8A86]">BHD</span>
              </div>
              {differs ? <p className="mt-1.5 text-xs font-medium text-[#B54708]">{t('differs')}</p> : null}
            </div>
          ) : null}
          <div>
            <label htmlFor="deliver-note" className="text-sm font-medium">{differs ? t('noteRequired') : t('noteLabel')}</label>
            <textarea id="deliver-note" value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={300} className="mt-1.5 w-full rounded-xl border border-[#E2E2DC] px-3 py-2 text-sm outline-none focus:border-[#111111]" />
          </div>
          {error ? <p className="rounded-xl bg-[#FDECEA] px-3 py-2 text-sm text-[#B42318]" role="alert">{error}</p> : null}
          <button type="submit" disabled={invalid || save.isPending} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#168A52] text-sm font-semibold text-white disabled:opacity-40">
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {t('confirm')}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IssueDialog({ order, open, onOpenChange, onDone }: { order: RiderOrder; open: boolean; onOpenChange: (open: boolean) => void; onDone: (order: RiderOrder) => void }) {
  const t = useTranslations('rider.issue');
  const [type, setType] = useState<DeliveryIssueType>('CUSTOMER_UNREACHABLE');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => api.rider.reportIssue(order.id, { type, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: (next) => { setNote(''); setError(''); onDone(next); },
    onError: (reason: Error) => setError(reason.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-sm:bottom-0 max-sm:top-auto max-sm:w-full max-sm:translate-y-0 max-sm:rounded-b-none">
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('body')}</DialogDescription>
        <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="sr-only">{t('typeLabel')}</legend>
            {ISSUE_TYPES.map((value) => (
              <label key={value} className={cn('flex min-h-11 cursor-pointer items-center rounded-xl border px-3 py-2 text-sm font-medium', type === value ? 'border-[#111111] bg-[#111111] text-white' : 'border-[#E2E2DC]')}>
                <input type="radio" name="issue-type" value={value} checked={type === value} onChange={() => setType(value)} className="sr-only" />
                {t(`types.${value}`)}
              </label>
            ))}
          </fieldset>
          <div>
            <label htmlFor="issue-note" className="text-sm font-medium">{type === 'OTHER' ? t('noteRequired') : t('noteLabel')}</label>
            <textarea id="issue-note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={500} className="mt-1.5 w-full rounded-xl border border-[#E2E2DC] px-3 py-2 text-sm outline-none focus:border-[#111111]" />
          </div>
          {error ? <p className="rounded-xl bg-[#FDECEA] px-3 py-2 text-sm text-[#B42318]" role="alert">{error}</p> : null}
          <button type="submit" disabled={save.isPending || (type === 'OTHER' && !note.trim())} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#B42318] text-sm font-semibold text-white disabled:opacity-40">
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
            {t('submit')}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PinDialog({ order, open, onOpenChange, onDone }: { order: RiderOrder; open: boolean; onOpenChange: (open: boolean) => void; onDone: (order: RiderOrder) => void }) {
  const t = useTranslations('rider.pin');
  const { point: here } = useRiderPoint();
  const initial = order.address.latitude !== null && order.address.longitude !== null ? { lat: order.address.latitude, lng: order.address.longitude } : null;
  const [point, setPoint] = useState(initial);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => api.rider.correctDropoff(order.id, { latitude: point!.lat, longitude: point!.lng, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: (next) => { setError(''); onDone(next); },
    onError: (reason: Error) => setError(reason.message),
  });
  const moved = Boolean(point && (!initial || point.lat !== initial.lat || point.lng !== initial.lng));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[100dvh] flex-col p-0 max-sm:inset-0 max-sm:h-dvh max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:w-[min(100%-2rem,40rem)]">
        <div className="px-5 pt-5">
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </div>
        <div className="relative mt-3 min-h-0 flex-1">
          {open ? <LocationMap point={point} onMark={setPoint} className="z-0 h-full min-h-72 w-full" zoomPosition="bottomright" /> : null}
          {here ? (
            <button type="button" onClick={() => setPoint({ lat: here.latitude, lng: here.longitude })} className="absolute start-3 top-3 z-[500] flex h-10 items-center gap-2 rounded-xl bg-white px-3 text-sm font-semibold shadow-md">
              <MapPinned className="size-4" />{t('useMine')}
            </button>
          ) : null}
        </div>
        <form className="space-y-2 px-5 py-4" onSubmit={(event) => { event.preventDefault(); if (point) save.mutate(); }}>
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder={t('notePlaceholder')} className="h-11 w-full rounded-xl border border-[#E2E2DC] px-3 text-sm outline-none focus:border-[#111111]" />
          {error ? <p className="rounded-xl bg-[#FDECEA] px-3 py-2 text-sm text-[#B42318]" role="alert">{error}</p> : null}
          <button type="submit" disabled={!moved || save.isPending} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#111111] text-sm font-semibold text-white disabled:opacity-40">
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <MapPinned className="size-4" />}
            {t('save')}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
