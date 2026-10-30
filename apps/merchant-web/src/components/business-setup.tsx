import { LocationMap } from '@/components/location-map';
import { api } from '@/components/providers';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@alliva/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, LocateFixed, MapPin, Search, ShoppingBag, Store, Truck, UtensilsCrossed } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';
import { useEffect, useRef, useState } from 'react';

type Hour = { dayOfWeek: number; opensAt: string; closesAt: string; closed: boolean };
type Point = { lat: number; lng: number };
type SearchResult = { lat: string; lon: string; display_name: string };
type SetupGap = 'ORDER_TYPES' | 'LOCATION' | 'HOURS' | 'DELIVERY';
const dayOrder = [1, 2, 3, 4, 5, 6, 0];

/** The parts of the merchant profile the popup starts from. */
export type SetupProfile = {
  businessSetupSaved?: boolean;
  setupMissing?: SetupGap[];
  detailedDeliveryPricing?: boolean;
  deliveryEnabled?: boolean;
  takeawayEnabled?: boolean;
  dineInEnabled?: boolean;
  freeDeliveryEnabled?: boolean;
  freeDeliveryKm?: string;
  baseDeliveryKm?: string;
  baseDeliveryFee?: string;
  beyondFreeDeliveryFee?: string;
  beyondDeliveryFeeMode?: string;
  maxDeliveryKm?: string;
  minimumOrder?: string;
  branches?: { latitude: string | number; longitude: string | number; active?: boolean }[];
  hours?: Hour[];
};

export function BusinessSetupDialog({ profile }: { profile?: SetupProfile }) {
  const t = useTranslations('merchantBusiness');
  const locale = useLocale();
  const client = useQueryClient();
  // A store that already went through setup starts from what it saved, so it only fills the gaps.
  const saved = profile?.businessSetupSaved ? profile : undefined;
  const missing = saved?.setupMissing ?? [];
  const [point, setPoint] = useState<Point | null>(() => savedPoint(saved));
  const [delivery, setDelivery] = useState(Boolean(saved?.deliveryEnabled));
  const [takeaway, setTakeaway] = useState(Boolean(saved?.takeawayEnabled));
  const [dineIn, setDineIn] = useState(Boolean(saved?.dineInEnabled));
  const [freeDeliveryEnabled, setFreeDeliveryEnabled] = useState(Boolean(saved?.freeDeliveryEnabled));
  const [deliveryForm, setDeliveryForm] = useState({
    freeDeliveryKm: amount(saved?.freeDeliveryKm, '0'),
    baseDeliveryKm: amount(saved?.baseDeliveryKm, ''),
    baseDeliveryFee: amount(saved?.baseDeliveryFee, ''),
    beyondFreeDeliveryFee: amount(saved?.beyondFreeDeliveryFee, ''),
    beyondDeliveryFeeMode: (saved?.beyondDeliveryFeeMode === 'FIXED' ? 'FIXED' : 'PER_KM') as 'PER_KM' | 'FIXED',
    maxDeliveryKm: amount(saved?.maxDeliveryKm, ''),
    minimumOrder: amount(saved?.minimumOrder, '0', true),
  });
  const [hours, setHours] = useState<Hour[]>(() =>
    dayOrder.map((dayOfWeek) => {
      const known = saved?.hours?.length === 7 ? saved.hours.find((hour) => hour.dayOfWeek === dayOfWeek) : undefined;
      return known ? { dayOfWeek, opensAt: known.opensAt, closesAt: known.closesAt, closed: known.closed } : { dayOfWeek, opensAt: '08:00', closesAt: '23:00', closed: false };
    }),
  );
  const [error, setError] = useState('');
  const [draftVersion, setDraftVersion] = useState(0);
  const [hasAutoSaved, setHasAutoSaved] = useState(false);
  const [locationQuery, setLocationQuery] = useState('');
  const [locationResults, setLocationResults] = useState<SearchResult[]>([]);
  const [searchingLocation, setSearchingLocation] = useState(false);
  const autoSaveTimer = useRef<number | undefined>(undefined);
  const days = t.raw('days') as string[];
  const nonNegative = (value: string) => value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
  const positive = (value: string) => nonNegative(value) && Number(value) > 0;
  const deliveryReady = !delivery || Boolean(profile?.detailedDeliveryPricing) || (
    positive(deliveryForm.maxDeliveryKm)
    && nonNegative(deliveryForm.minimumOrder)
    && nonNegative(deliveryForm.beyondFreeDeliveryFee)
    && (freeDeliveryEnabled
      ? positive(deliveryForm.freeDeliveryKm)
      : positive(deliveryForm.baseDeliveryKm) && positive(deliveryForm.baseDeliveryFee))
  );
  const locationReady = point !== null;
  const orderTypesReady = delivery || takeaway || dineIn;
  const hoursReady = hours.some((hour) => !hour.closed)
    && hours.every((hour) => hour.closed || (hour.opensAt !== hour.closesAt && Boolean(hour.opensAt) && Boolean(hour.closesAt)));
  const complete = [deliveryReady, locationReady, orderTypesReady, hoursReady].filter(Boolean).length;

  const autoSave = useMutation({
    mutationFn: async (payload: { profile: Record<string, string | number | boolean>; hours: Hour[] }) => {
      await Promise.all([api.updateProfile(payload.profile), api.setHours(payload.hours)]);
    },
    onSuccess: () => {
      setHasAutoSaved(true);
      setError('');
    },
    onError: () => setError(t('setupAutoSaveFailed')),
  });

  useEffect(() => {
    if (!draftVersion) return;
    window.clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = window.setTimeout(() => {
      const profile: Record<string, string | number | boolean> = {
        delivery,
        takeaway,
        dineIn,
        freeDeliveryEnabled,
      };
      Object.entries(deliveryForm).forEach(([key, value]) => {
        if (key === 'beyondDeliveryFeeMode') profile[key] = value;
        else if (value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0) profile[key] = value;
      });
      if (point) {
        profile.latitude = point.lat;
        profile.longitude = point.lng;
      }
      autoSave.mutate({ profile, hours });
    }, 700);
    return () => window.clearTimeout(autoSaveTimer.current);
  }, [draftVersion]);

  function changed() {
    setHasAutoSaved(false);
    setDraftVersion((version) => version + 1);
  }

  function choosePoint(next: Point) {
    setPoint(next);
    setLocationResults([]);
    setError('');
    changed();
  }

  function changeDelivery(key: keyof typeof deliveryForm, value: string) {
    setDeliveryForm((current) => ({ ...current, [key]: value }));
    changed();
  }

  function changeHour(dayOfWeek: number, update: Partial<Hour>) {
    setHours((current) => current.map((item) => item.dayOfWeek === dayOfWeek ? { ...item, ...update } : item));
    changed();
  }

  async function searchLocation(event: React.FormEvent) {
    event.preventDefault();
    const query = locationQuery.trim();
    if (!query) return;
    setSearchingLocation(true);
    setError('');
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=bh&accept-language=${locale}&q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error();
      const results = await response.json() as SearchResult[];
      setLocationResults(results);
      if (!results.length) setError(t('setupLocationNoResults'));
    } catch {
      setError(t('setupLocationSearchFailed'));
    } finally {
      setSearchingLocation(false);
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) return setError(t('locationDenied'));
    navigator.geolocation.getCurrentPosition(
      (position) => choosePoint({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => setError(t('locationDenied')),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  const save = useMutation({
    mutationFn: () => api.completeBusinessSetup({
      delivery,
      takeaway,
      dineIn,
      freeDeliveryEnabled,
      ...deliveryForm,
      latitude: point?.lat,
      longitude: point?.lng,
      hours,
    }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['merchant', 'business'] });
      await client.invalidateQueries({ queryKey: ['merchant', 'dashboard'] });
    },
    onError: (reason: Error) => setError(reason.message),
  });

  function submit() {
    if (!deliveryReady) return setError(t('setupDeliveryRequired'));
    if (!locationReady) return setError(t('setupLocationRequired'));
    if (!orderTypesReady) return setError(t('setupOrderRequired'));
    if (!hoursReady) return setError(t('setupHoursRequired'));
    window.clearTimeout(autoSaveTimer.current);
    setError('');
    save.mutate();
  }

  return (
    <Dialog open>
      <DialogContent
        hideClose
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        className="flex max-h-[min(92dvh,56rem)] w-[min(100%-1rem,52rem)] flex-col overflow-hidden p-0"
      >
        <div className="border-b border-[#ECECEA] bg-[#FFF9E4] px-5 py-5 sm:px-7">
          <div className="flex items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary shadow-[0_8px_24px_rgba(255,196,0,0.3)]">
              <Store className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="font-display text-xl tracking-[-0.02em] sm:text-2xl">{t('setupTitle')}</DialogTitle>
              <DialogDescription>{t('setupDescription')}</DialogDescription>
            </div>
          </div>
          {missing.length ? (
            <div role="status" className="mt-4 rounded-xl bg-white/80 px-3 py-2.5 text-sm text-[#5C4700]">
              <p className="font-semibold">{t('setupMissingTitle')}</p>
              <p className="mt-0.5">{t('setupMissingBody', { items: missing.map((gap) => t(gapLabel[gap])).join(', ') })}</p>
            </div>
          ) : null}
          <div className="mt-4 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/10">
              <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${complete * 25}%` }} />
            </div>
            <span className="shrink-0 text-xs font-semibold text-[#5C5C58]">{t('setupProgress', { complete })}</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          <SetupSection icon={Truck} title={t('deliverySettings')} ready={deliveryReady}>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-[#F7F7F5] px-3 py-2.5">
              <div>
                <p className="text-sm font-semibold">{t('freeDelivery')}</p>
                <p className="text-xs text-[#8A8A86]">{t('freeDeliveryHint')}</p>
              </div>
              <Switch checked={freeDeliveryEnabled} onClick={() => { setFreeDeliveryEnabled((value) => !value); changed(); }} label={t('freeDelivery')} />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {freeDeliveryEnabled ? (
                <NumberField label={t('freeDeliveryKm')} suffix={t('km')} value={deliveryForm.freeDeliveryKm} onChange={(value) => changeDelivery('freeDeliveryKm', value)} />
              ) : (
                <>
                  <NumberField label={t('baseDeliveryKm')} suffix={t('km')} value={deliveryForm.baseDeliveryKm} onChange={(value) => changeDelivery('baseDeliveryKm', value)} />
                  <NumberField label={t('baseDeliveryFee')} suffix={t('bhd')} value={deliveryForm.baseDeliveryFee} onChange={(value) => changeDelivery('baseDeliveryFee', value)} />
                </>
              )}
              <label className="block text-sm font-semibold">
                {t('beyondPricingMode')}
                <select value={deliveryForm.beyondDeliveryFeeMode} onChange={(event) => { setDeliveryForm((current) => ({ ...current, beyondDeliveryFeeMode: event.target.value === 'FIXED' ? 'FIXED' : 'PER_KM' })); changed(); }} className="mt-1.5 h-11 w-full rounded-xl border border-[#E4E4E0] bg-[#F7F7F5] px-3 text-sm outline-none">
                  <option value="PER_KM">{t('perKm')}</option>
                  <option value="FIXED">{t('fixedPrice')}</option>
                </select>
              </label>
              <NumberField label={deliveryForm.beyondDeliveryFeeMode === 'FIXED' ? t('beyondFeeFixed') : t('beyondFeePerKm')} suffix={deliveryForm.beyondDeliveryFeeMode === 'FIXED' ? t('bhd') : t('bhdPerKm')} value={deliveryForm.beyondFreeDeliveryFee} onChange={(value) => changeDelivery('beyondFreeDeliveryFee', value)} />
              <NumberField label={t('maxArea')} suffix={t('km')} value={deliveryForm.maxDeliveryKm} onChange={(value) => changeDelivery('maxDeliveryKm', value)} />
              <NumberField label={t('minimumDelivery')} suffix={t('bhd')} value={deliveryForm.minimumOrder} onChange={(value) => changeDelivery('minimumOrder', value)} />
            </div>
          </SetupSection>

          <SetupSection icon={MapPin} title={t('location')} ready={locationReady} hint={t('setupLocationHint')}>
            <div className="relative">
              <form className="flex gap-2" onSubmit={(event) => void searchLocation(event)}>
                <label className="relative min-w-0 flex-1">
                  <span className="sr-only">{t('setupLocationSearch')}</span>
                  <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[#8A8A86]" />
                  <input value={locationQuery} onChange={(event) => setLocationQuery(event.target.value)} placeholder={t('setupLocationPlaceholder')} className="h-11 w-full rounded-xl border border-[#E4E4E0] bg-[#F7F7F5] ps-9 pe-3 text-sm outline-none focus:border-[#111111]" />
                </label>
                <Button type="submit" variant="outline" className="h-11 min-w-0 rounded-xl px-3" loading={searchingLocation}>{t('setupLocationSearch')}</Button>
                <button type="button" onClick={useCurrentLocation} className="grid size-11 shrink-0 place-items-center rounded-xl border border-[#E4E4E0] bg-white" aria-label={t('useLocation')} title={t('useLocation')}>
                  <LocateFixed className="size-4" />
                </button>
              </form>
              {locationResults.length ? (
                <ul className="absolute inset-x-0 top-12 z-20 max-h-52 overflow-y-auto rounded-xl border border-[#E4E4E0] bg-white p-1.5 shadow-xl">
                  {locationResults.map((result) => (
                    <li key={`${result.lat}-${result.lon}`}>
                      <button type="button" className="w-full rounded-lg px-3 py-2 text-start text-sm hover:bg-[#F7F7F5]" onClick={() => {
                        setLocationQuery(result.display_name);
                        choosePoint({ lat: Number(result.lat), lng: Number(result.lon) });
                      }}>
                        <span className="line-clamp-2">{result.display_name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="mt-3 overflow-hidden rounded-2xl border border-[#E8E8E4]">
              <LocationMap point={point} onMark={choosePoint} className="z-0 h-56 w-full" />
            </div>
            {point ? <p className="mt-2 text-xs font-medium text-[#5C5C58]">{point.lat.toFixed(6)}, {point.lng.toFixed(6)}</p> : null}
          </SetupSection>

          <SetupSection icon={ShoppingBag} title={t('orderTypesTitle')} ready={orderTypesReady} hint={t('orderTypesHint')}>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <OrderType icon={Truck} label={t('deliveryType')} selected={delivery} onClick={() => { setDelivery((value) => !value); changed(); }} />
              <OrderType icon={ShoppingBag} label={t('pickup')} selected={takeaway} onClick={() => { setTakeaway((value) => !value); changed(); }} />
              <OrderType icon={UtensilsCrossed} label={t('dineIn')} selected={dineIn} onClick={() => { setDineIn((value) => !value); changed(); }} />
            </div>
          </SetupSection>

          <SetupSection icon={Clock} title={t('hours')} ready={hoursReady} hint={t('setupHoursHint')}>
            <div className="mt-3 divide-y divide-[#EEEEEC]">
              {hours.map((hour, index) => (
                <div key={hour.dayOfWeek} className="grid items-center gap-2 py-2.5 sm:grid-cols-[minmax(5rem,1fr)_auto] sm:gap-3">
                  <span className="text-sm font-semibold">{days[index]}</span>
                  <div className="flex items-center justify-between gap-1.5 sm:gap-2">
                    <label className="inline-flex items-center gap-1.5 text-xs text-[#696965]">
                      <input type="checkbox" checked={hour.closed} onChange={(event) => changeHour(hour.dayOfWeek, { closed: event.target.checked })} className="size-4 accent-[#FFC400]" />
                      {t('setupClosed')}
                    </label>
                    <input type="time" disabled={hour.closed} value={hour.opensAt} onChange={(event) => changeHour(hour.dayOfWeek, { opensAt: event.target.value })} className="h-9 w-[6.6rem] rounded-lg border border-[#E4E4E0] bg-white px-2 text-xs disabled:opacity-40" />
                    <span className="text-xs text-[#8A8A86]">–</span>
                    <input type="time" disabled={hour.closed} value={hour.closesAt} onChange={(event) => changeHour(hour.dayOfWeek, { closesAt: event.target.value })} className="h-9 w-[6.6rem] rounded-lg border border-[#E4E4E0] bg-white px-2 text-xs disabled:opacity-40" />
                  </div>
                </div>
              ))}
            </div>
          </SetupSection>
        </div>

        <div className="border-t border-[#ECECEA] bg-white px-4 py-4 sm:px-6">
          {autoSave.isPending ? <p className="mb-2 text-center text-xs font-medium text-[#696965]">{t('saving')}</p> : hasAutoSaved ? <p className="mb-2 text-center text-xs font-medium text-[#168A52]"><Check className="me-1 inline size-3.5" />{t('saved')}</p> : null}
          {error ? <p className="mb-3 text-sm font-medium text-[#B42318]" role="alert">{error}</p> : null}
          <Button type="button" variant="yellow" className="h-12 w-full rounded-xl" loading={save.isPending} disabled={autoSave.isPending} onClick={submit}>
            <Check className="size-4" /> {t('setupComplete')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const gapLabel = { ORDER_TYPES: 'orderTypesTitle', LOCATION: 'location', HOURS: 'hours', DELIVERY: 'deliverySettings' } as const;

function savedPoint(profile?: SetupProfile): Point | null {
  const branch = profile?.branches?.find((row) => row.active !== false) ?? profile?.branches?.[0];
  const lat = Number(branch?.latitude);
  const lng = Number(branch?.longitude);
  return branch && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0) ? { lat, lng } : null;
}

/** Saved zeros mean "not set" for required distances and fees, so show them blank; keep zero where zero is valid. */
function amount(value: string | undefined, fallback: string, zeroIsValid = false) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number === 0 && !zeroIsValid) return fallback;
  return String(number);
}

function SetupSection({ icon: Icon, title, hint, ready, children }: { icon: typeof Truck; title: string; hint?: string; ready: boolean; children: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border bg-white p-4 transition-colors ${ready ? 'border-[#D6EBDD]' : 'border-[#ECECEA]'}`}>
      <div className="flex items-center gap-3">
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${ready ? 'bg-[#E7F8EE] text-[#168A52]' : 'bg-[#FFF3C4]'}`}>
          {ready ? <Check className="size-4" strokeWidth={3} /> : <Icon className="size-4" />}
        </span>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {hint ? <p className="text-xs text-[#8A8A86]">{hint}</p> : null}
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function NumberField({ label, suffix, value, onChange }: { label: string; suffix: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-xs font-semibold">
      {label}
      <span className="mt-1.5 flex h-11 overflow-hidden rounded-xl border border-[#E4E4E0] bg-[#F7F7F5]">
        <input type="number" min="0" step="0.001" value={value} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" />
        <span className="grid shrink-0 place-items-center border-s border-[#E4E4E0] bg-white px-2 text-[10px] text-[#8A8A86]">{suffix}</span>
      </span>
    </label>
  );
}

function Switch({ checked, onClick, label }: { checked: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onClick} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-[#161616]' : 'bg-[#DCDCD7]'}`}>
      <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-[inset-inline-start] ${checked ? 'start-5' : 'start-0.5'}`} />
    </button>
  );
}

function OrderType({ icon: Icon, label, selected, onClick }: { icon: typeof Truck; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={`flex h-12 items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${selected ? 'border-[#E6B800] bg-[#FFF8D4]' : 'border-[#E4E4E0] bg-white'}`}>
      <Icon className="size-4" />
      <span className="min-w-0 flex-1 text-start">{label}</span>
      <span className={`grid size-5 place-items-center rounded-full ${selected ? 'bg-primary' : 'border border-[#D6D6D0]'}`}>{selected ? <Check className="size-3" strokeWidth={3} /> : null}</span>
    </button>
  );
}
