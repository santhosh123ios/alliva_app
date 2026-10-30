import { api } from '@/components/providers';
import type { RiderOrder } from '@alliva/types';
import { cn, Dialog, DialogContent, DialogDescription, DialogTitle } from '@alliva/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CameraOff, Keyboard, Loader2, QrCode } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { riderKeys } from './shared';

type Mode = 'scan' | 'code';

/**
 * Proves the rider has the order in hand: scan the ticket QR, or type the pickup code when the camera
 * cannot be used. `orderId` narrows a typed code to one order, since codes are short.
 */
export function PickupVerifier({ open, onOpenChange, orderId, onVerified }: { open: boolean; onOpenChange: (open: boolean) => void; orderId?: string; onVerified: (order: RiderOrder) => void }) {
  const t = useTranslations('rider.verify');
  const client = useQueryClient();
  const [mode, setMode] = useState<Mode>('scan');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const verify = useMutation({
    mutationFn: (body: { qr?: string; code?: string }) => api.rider.verifyPickup({ ...body, ...(body.code && orderId ? { orderId } : {}) }),
    onSuccess: (order) => {
      setError('');
      setCode('');
      void client.invalidateQueries({ queryKey: ['rider'] });
      client.setQueryData(riderKeys.order(order.id), order);
      onVerified(order);
    },
    onError: (reason: Error) => setError(reason.message),
  });

  useEffect(() => {
    if (!open) {
      setError('');
      setMode('scan');
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
              active={open && mode === 'scan' && !verify.isPending}
              onResult={(text) => { if (!verify.isPending) verify.mutate({ qr: text }); }}
              onUnavailable={() => setMode('code')}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Camera({ active, onResult, onUnavailable }: { active: boolean; onResult: (text: string) => void; onUnavailable: () => void }) {
  const t = useTranslations('rider.verify');
  const videoRef = useRef<HTMLVideoElement>(null);
  const resultRef = useRef(onResult);
  const [state, setState] = useState<'starting' | 'running' | 'failed'>('starting');
  resultRef.current = onResult;

  useEffect(() => {
    const video = videoRef.current;
    if (!active || !video) return;
    let disposed = false;
    let scanner: { start: () => Promise<void>; stop: () => void; destroy: () => void } | null = null;
    let last = '';
    setState('starting');
    void import('qr-scanner').then(async ({ default: QrScanner }) => {
      if (disposed) return;
      try {
        if (!(await QrScanner.hasCamera())) throw new Error('no camera');
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
      } catch {
        if (!disposed) setState('failed');
      }
    });
    return () => {
      disposed = true;
      scanner?.stop();
      scanner?.destroy();
    };
  }, [active]);

  return (
    <div>
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-3xl bg-[#111111]">
        <video ref={videoRef} className="size-full object-cover" muted playsInline />
        {state === 'running' ? (
          <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-[#FFC400] shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        ) : null}
        {state === 'starting' ? <div className="absolute inset-0 grid place-items-center text-sm text-white/80"><Loader2 className="size-6 animate-spin" /></div> : null}
        {state === 'failed' ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-white">
            <div>
              <CameraOff className="mx-auto size-8 opacity-80" />
              <p className="mt-3 text-sm font-semibold">{t('cameraFailed')}</p>
              <button type="button" onClick={onUnavailable} className="mt-4 h-10 rounded-xl bg-[#FFC400] px-4 text-sm font-semibold text-[#111111]">{t('useCode')}</button>
            </div>
          </div>
        ) : null}
      </div>
      <p className="mt-3 text-center text-sm text-[#696965]">{t('scanHint')}</p>
    </div>
  );
}
