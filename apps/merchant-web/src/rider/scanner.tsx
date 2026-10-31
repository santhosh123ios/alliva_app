import { api } from '@/components/providers';
import type { RiderOrder } from '@alliva/types';
import { cn, Dialog, DialogContent, DialogDescription, DialogTitle, toast } from '@alliva/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera as CameraIcon, CameraOff, Check, Hand, Keyboard, Loader2, QrCode } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { riderKeys, useRiderOrders } from './shared';

type Mode = 'scan' | 'code';

/**
 * Proves the rider has the order in hand: scan the ticket QR, type the pickup code when the camera
 * cannot be used, or mark an order picked up by hand from the list below.
 * Without `orderId` it stays open so the rider can collect every order on the route in one go;
 * with it, it narrows to that order and closes once it is collected.
 */
export function PickupVerifier({ open, onOpenChange, orderId, onVerified }: { open: boolean; onOpenChange: (open: boolean) => void; orderId?: string; onVerified?: (order: RiderOrder) => void }) {
  const t = useTranslations('rider.verify');
  const client = useQueryClient();
  const [mode, setMode] = useState<Mode>('scan');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [last, setLast] = useState<string | null>(null);
  const verify = useMutation({
    mutationFn: (body: { qr?: string; code?: string; orderId?: string; manual?: boolean }) =>
      api.rider.verifyPickup({ ...body, ...((body.code || body.manual) && orderId ? { orderId } : {}) }),
    onSuccess: (order) => {
      setError('');
      setCode('');
      setLast(order.id);
      void client.invalidateQueries({ queryKey: ['rider'] });
      client.setQueryData(riderKeys.order(order.id), order);
      if (orderId) onVerified?.(order);
      else toast.success(t('picked', { number: order.number }));
    },
    onError: (reason: Error) => setError(reason.message),
  });

  useEffect(() => {
    if (!open) {
      setError('');
      setMode('scan');
      setLast(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[100dvh] w-full max-w-none flex-col gap-0 overflow-y-auto rounded-none p-0 max-sm:inset-0 max-sm:h-dvh max-sm:translate-x-0 max-sm:translate-y-0 sm:w-[min(100%-2rem,28rem)] sm:rounded-3xl">
        <div className="px-5 pb-3 pt-5">
          <DialogTitle className="text-xl">{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </div>
        <div className="mx-5 grid grid-cols-2 gap-1 rounded-xl bg-[#F2F2EF] p-1" role="tablist">
          {(['scan', 'code'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => { setMode(value); setError(''); }}
              className={cn('flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold', mode === value ? 'bg-white shadow-sm' : 'text-[#696965]')}
            >
              {value === 'scan' ? <QrCode className="size-4" /> : <Keyboard className="size-4" />}
              {t(value === 'scan' ? 'scanTab' : 'codeTab')}
            </button>
          ))}
        </div>
        <div className="flex-1 px-5 py-4">
          {mode === 'scan' ? (
            <Camera
              compact
              active={open && mode === 'scan' && !verify.isPending}
              onResult={(text) => { if (!verify.isPending) verify.mutate({ qr: text }); }}
              onUnavailable={() => setMode('code')}
              onError={setError}
            />
          ) : (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (code.trim().length >= 4) verify.mutate({ code });
              }}
            >
              <label htmlFor="pickup-code" className="text-sm font-medium">{t('codeLabel')}</label>
              <input
                id="pickup-code"
                value={code}
                onChange={(event) => { setCode(event.target.value.toUpperCase()); setError(''); }}
                autoFocus
                autoComplete="off"
                autoCapitalize="characters"
                inputMode="text"
                maxLength={8}
                placeholder="AB3K7Q"
                dir="ltr"
                className="h-16 w-full rounded-2xl border-2 border-[#E2E2DC] bg-white text-center font-mono text-3xl font-bold tracking-[0.4em] outline-none focus:border-[#111111]"
              />
              <p className="text-xs text-[#696965]">{t('codeHint')}</p>
              <button
                type="submit"
                disabled={verify.isPending || code.trim().length < 4}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#111111] text-sm font-semibold text-white disabled:opacity-40"
              >
                {verify.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {t('submit')}
              </button>
            </form>
          )}
          {verify.isPending && mode === 'scan' ? <p className="mt-3 flex items-center justify-center gap-2 text-sm text-[#696965]"><Loader2 className="size-4 animate-spin" />{t('checking')}</p> : null}
          {error ? <p className="mt-3 rounded-xl bg-[#FDECEA] px-3 py-2.5 text-sm font-medium text-[#B42318]" role="alert">{error}</p> : null}
          <PickupList
            orderId={orderId}
            highlight={last}
            busy={verify.isPending ? verify.variables?.orderId ?? null : null}
            onMark={(id) => { setError(''); verify.mutate({ orderId: id, manual: true }); }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The rider's orders in route order with their ticket codes, so they can match tickets at the counter and tick each one off. */
function PickupList({ orderId, highlight, busy, onMark }: { orderId?: string; highlight: string | null; busy: string | null; onMark: (id: string) => void }) {
  const t = useTranslations('rider.verify');
  const orders = useRiderOrders();
  const rows = (orders.data?.active ?? []).filter((order) => (orderId ? order.id === orderId : order.status === 'ASSIGNED_TO_DRIVER'));
  if (!rows.length) return null;
  const left = rows.filter((order) => !order.pickupVerifiedAt).length;
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-end justify-between">
        <h2 className="text-sm font-semibold">{t('listTitle')}</h2>
        <span className="text-xs text-[#696965]">{left ? t('listLeft', { count: left }) : t('listDone')}</span>
      </div>
      <ol className="space-y-2">
        {rows.map((order) => {
          const picked = Boolean(order.pickupVerifiedAt);
          return (
            <li
              key={order.id}
              className={cn('flex items-center gap-3 rounded-2xl border p-3 transition-colors', picked ? 'border-[#BFE5CF] bg-[#F1FAF4]' : 'border-[#ECECE8] bg-white', highlight === order.id && 'ring-2 ring-[#168A52]')}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#111111] text-sm font-bold text-[#FFC400]">{order.stop}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold"><bdi dir="ltr">#{order.number}</bdi></p>
                <p className="truncate text-xs text-[#5C5C58]">{order.customer.name}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#696965]">
                  {order.pickupCode ? <span className="rounded-md bg-[#F2F2EF] px-1.5 py-0.5 font-mono text-[13px] font-bold tracking-widest text-[#111111]" dir="ltr">{order.pickupCode}</span> : <span>{t('noCode')}</span>}
                  <span>{t('itemCount', { count: order.items.reduce((total, item) => total + item.quantity, 0) })}</span>
                </p>
              </div>
              {picked ? (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#E3F5EA] px-2.5 py-1.5 text-xs font-semibold text-[#168A52]"><Check className="size-3.5" />{t('pickedLabel')}</span>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => onMark(order.id)}
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-[#111111] px-3 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {busy === order.id ? <Loader2 className="size-3.5 animate-spin" /> : <Hand className="size-3.5" />}
                  {t('markPicked')}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

type CameraState = 'starting' | 'running' | 'insecure' | 'denied' | 'failed';

/**
 * Live QR scanning with the phone camera. Browsers only open a live camera on https (iPhone Safari is strict about it)
 * and after the rider allows it, so a photo of the QR is always offered too: the native camera works on any link.
 */
function Camera({ active, onResult, onUnavailable, onError, compact }: { active: boolean; onResult: (text: string) => void; onUnavailable: () => void; onError: (message: string) => void; compact?: boolean }) {
  const t = useTranslations('rider.verify');
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef(onResult);
  const [state, setState] = useState<CameraState>('starting');
  const [reading, setReading] = useState(false);
  resultRef.current = onResult;

  useEffect(() => {
    const video = videoRef.current;
    if (!active || !video) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState('insecure');
      return;
    }
    let disposed = false;
    let scanner: { start: () => Promise<void>; stop: () => void; destroy: () => void } | null = null;
    let last = '';
    setState('starting');
    void import('qr-scanner').then(async ({ default: QrScanner }) => {
      if (disposed) return;
      try {
        const instance = new QrScanner(
          video,
          (result) => {
            // The same QR fires many times a second; act once until it changes.
            if (result.data && result.data !== last) {
              last = result.data;
              resultRef.current(result.data);
              setTimeout(() => { last = ''; }, 2500);
            }
          },
          { preferredCamera: 'environment', highlightScanRegion: false, returnDetailedScanResult: true, maxScansPerSecond: 5 },
        );
        scanner = instance;
        await instance.start();
        if (disposed) instance.destroy();
        else setState('running');
      } catch (error) {
        // qr-scanner rejects with a string or a DOMException; NotAllowedError means the rider (or Safari settings) said no.
        const name = error instanceof DOMException ? error.name : String(error);
        if (!disposed) setState(/NotAllowed|denied|permission/i.test(name) ? 'denied' : 'failed');
      }
    });
    return () => {
      disposed = true;
      scanner?.stop();
      scanner?.destroy();
    };
  }, [active]);

  const readPhoto = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      const { default: QrScanner } = await import('qr-scanner');
      const result = await QrScanner.scanImage(file, { returnDetailedScanResult: true, alsoTryWithoutScanRegion: true });
      onResult(result.data);
    } catch {
      onError(t('photoNoQr'));
    } finally {
      setReading(false);
      if (photoRef.current) photoRef.current.value = '';
    }
  };

  const blocked = state === 'insecure' || state === 'denied' || state === 'failed';
  const message = state === 'insecure' ? t('cameraInsecure') : state === 'denied' ? t('cameraDenied') : t('cameraFailed');

  return (
    <div>
      <div className={cn('relative mx-auto aspect-square w-full overflow-hidden rounded-3xl bg-[#111111]', compact ? 'max-w-[15rem]' : 'max-w-sm')}>
        <video ref={videoRef} className="size-full object-cover" muted playsInline autoPlay />
        {state === 'running' ? (
          <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-[#FFC400] shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        ) : null}
        {state === 'starting' ? <div className="absolute inset-0 grid place-items-center text-sm text-white/80"><Loader2 className="size-6 animate-spin" /></div> : null}
        {blocked ? (
          <div className="absolute inset-0 grid place-items-center p-5 text-center text-white">
            <div>
              <CameraOff className="mx-auto size-7 opacity-80" />
              <p className="mt-2 text-sm font-semibold">{message}</p>
              <button type="button" onClick={onUnavailable} className="mt-3 h-9 rounded-xl bg-white/15 px-3 text-xs font-semibold text-white">{t('useCode')}</button>
            </div>
          </div>
        ) : null}
      </div>
      <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => void readPhoto(event.target.files?.[0])} />
      <button
        type="button"
        disabled={reading}
        onClick={() => photoRef.current?.click()}
        className={cn('mx-auto mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold disabled:opacity-60', compact ? 'max-w-[15rem]' : 'max-w-sm', blocked ? 'bg-[#FFC400] text-[#111111]' : 'border border-[#E2E2DC] bg-white text-[#111111]')}
      >
        {reading ? <Loader2 className="size-4 animate-spin" /> : <CameraIcon className="size-4" />}
        {t('takePhoto')}
      </button>
      {state === 'running' ? <p className="mt-2 text-center text-sm text-[#696965]">{t('scanHint')}</p> : null}
    </div>
  );
}
