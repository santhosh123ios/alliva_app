import { api } from '@/components/providers';
import { LocationMap, LocationSearch } from '@/components/location-map';
import { chooseLocation, detectLocation, DEFAULT_POINT, LocationError, useLocationStore, type LatLng, type LocationSource, type LocationStatus } from '@/lib/location';
import { areas } from '@/lib/place';
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Spinner } from '@alliva/ui';
import { Crosshair, LocateFixed, MapPin, MapPinOff, Navigation } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';

type Step = 'intro' | 'map';

/**
 * First-run location prompt and the "Change location" sheet.
 * Explains why we ask, tries the device location, and always offers search and a map pin instead.
 */
export function LocationPicker({ open, onOpenChange, intro = false }: { open: boolean; onOpenChange: (open: boolean) => void; intro?: boolean }) {
  const t = useTranslations('customer.locationFlow');
  const locale = useLocale() as 'en' | 'ar';
  const saved = useLocationStore((state) => state.point);
  const status = useLocationStore((state) => state.status);
  const markPrompted = useLocationStore((state) => state.markPrompted);
  const [step, setStep] = useState<Step>(intro ? 'intro' : 'map');
  const [draft, setDraft] = useState<LatLng | null>(saved);
  const [source, setSource] = useState<LocationSource>('PIN');
  const [failure, setFailure] = useState<LocationStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const place = usePlaceName(draft, locale);

  useEffect(() => {
    if (!open) return;
    setStep(intro ? 'intro' : 'map');
    setDraft(useLocationStore.getState().point);
    setFailure(null);
  }, [open, intro]);

  const locating = status === 'locating';

  const useDevice = async () => {
    setFailure(null);
    try {
      const point = await detectLocation(locale);
      setDraft(point);
      onOpenChange(false);
    } catch (error) {
      setFailure(error instanceof LocationError ? error.status : 'error');
      setDraft((current) => current ?? DEFAULT_POINT);
      setStep('map');
    }
  };

  const confirm = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await chooseLocation(draft, source, locale, place.label);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const close = (next: boolean) => {
    if (!next) markPrompted();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92dvh] w-[min(100%-1.5rem,40rem)] overflow-y-auto p-5 sm:p-6">
        {step === 'intro' ? (
          <div className="text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-full bg-primary text-[#111]">
              <MapPin className="size-7" />
            </span>
            <DialogTitle className="mt-4 text-xl font-bold">{t('introTitle')}</DialogTitle>
            <DialogDescription className="mx-auto mt-2 max-w-sm text-[15px] text-[#6f6f6a]">{t('introBody')}</DialogDescription>
            <div className="mt-6 grid gap-2">
              <Button type="button" variant="yellow" className="h-12 rounded-full text-base font-bold" loading={locating} onClick={() => void useDevice()}>
                <LocateFixed className="size-4" />
                {t('allow')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-12 rounded-full"
                disabled={locating}
                onClick={() => {
                  setDraft((current) => current ?? DEFAULT_POINT);
                  setStep('map');
                }}
              >
                {t('chooseManually')}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <DialogTitle className="pe-8 text-xl font-bold">{t('changeTitle')}</DialogTitle>
            <DialogDescription className="text-sm text-[#6f6f6a]">{t('changeBody')}</DialogDescription>

            {failure ? <LocationNotice status={failure} /> : null}

            <button
              type="button"
              onClick={() => void useDevice()}
              disabled={locating}
              className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-[#e6e6e0] bg-white px-4 py-3 text-start hover:border-[#111] disabled:opacity-60"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#111] text-primary">
                {locating ? <Spinner className="size-4" /> : <Navigation className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{locating ? t('locating') : t('useCurrent')}</span>
                <span className="block text-xs text-[#6f6f6a]">{t('useCurrentHint')}</span>
              </span>
            </button>

            <div className="relative mt-3 overflow-hidden rounded-2xl border border-[#e6e6e0]">
              <LocationMap
                point={draft ?? DEFAULT_POINT}
                onMark={(point) => {
                  setDraft(point);
                  setSource('PIN');
                }}
                className="z-0 h-64 w-full sm:h-72"
                zoomPosition="bottomright"
              />
              <LocationSearch
                locale={locale}
                className="absolute inset-x-2 top-2 z-[500]"
                onPick={(point) => {
                  setDraft(point);
                  setSource('SEARCH');
                }}
                labels={{ search: t('search'), placeholder: t('searchPlaceholder'), noResults: t('noResults'), failed: t('searchFailed') }}
              />
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-[#6f6f6a]">
              <Crosshair className="size-3.5" />
              {t('pinHint')}
            </p>

            <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
              {areas.map((area) => (
                <button
                  key={area.id}
                  type="button"
                  onClick={() => {
                    setDraft({ lat: Number(area.lat), lng: Number(area.lng) });
                    setSource('AREA');
                  }}
                  className="h-9 shrink-0 rounded-full border border-[#e6e6e0] bg-white px-3.5 text-sm font-semibold hover:border-[#111]"
                >
                  {locale === 'ar' ? area.ar : area.en}
                </button>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-3 rounded-2xl bg-[#f7f7f5] px-4 py-3">
              <MapPin className="size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-[#6f6f6a]">{t('selected')}</p>
                <p className={cn('truncate text-sm font-semibold', place.loading && 'text-[#8d8d88]')}>
                  {place.loading ? t('findingAddress') : place.label || t('pinnedLocation')}
                </p>
              </div>
            </div>
            {place.outside ? <p className="mt-2 text-sm font-medium text-[#B42318]">{t('outsideBahrain')}</p> : null}

            <Button
              type="button"
              variant="yellow"
              className="mt-4 h-12 w-full rounded-full text-base font-bold"
              loading={saving}
              disabled={!draft || place.outside || place.loading}
              onClick={() => void confirm()}
            >
              {t('confirm')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Name the pinned spot, waiting until the pin stops moving and cancelling stale lookups. */
export function usePlaceName(point: LatLng | null, locale: 'en' | 'ar') {
  const [state, setState] = useState<{ label: string | null; outside: boolean; loading: boolean; place: Awaited<ReturnType<typeof api.reverseGeocode>> | null }>({ label: null, outside: false, loading: false, place: null });
  const latest = useRef(0);
  useEffect(() => {
    if (!point) {
      setState({ label: null, outside: false, loading: false, place: null });
      return;
    }
    const request = ++latest.current;
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true }));
    const timer = window.setTimeout(() => {
      api
        .reverseGeocode(point.lat.toFixed(6), point.lng.toFixed(6), locale, { signal: controller.signal })
        .then((place) => {
          if (request === latest.current) setState({ label: place.label, outside: !place.insideServiceCountry, loading: false, place });
        })
        .catch(() => {
          if (request === latest.current && !controller.signal.aborted) setState({ label: null, outside: false, loading: false, place: null });
        });
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [point?.lat, point?.lng, locale]);
  return state;
}

export function LocationNotice({ status }: { status: LocationStatus }) {
  const t = useTranslations('customer.locationFlow');
  const key = status === 'denied' ? 'denied' : status === 'unavailable' ? 'gpsOff' : status === 'unsupported' ? 'unsupported' : 'failed';
  return (
    <div role="alert" className="mt-4 flex gap-3 rounded-2xl bg-[#fff6d0] px-4 py-3 text-sm text-[#5c4700]">
      <MapPinOff className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-semibold">{t(`${key}Title`)}</p>
        <p className="mt-0.5">{t(`${key}Body`)}</p>
      </div>
    </div>
  );
}
