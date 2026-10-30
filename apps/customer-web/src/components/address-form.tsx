import { api } from '@/components/providers';
import { LocationMap, LocationSearch } from '@/components/location-map';
import { LocationNotice, usePlaceName } from '@/components/location-picker';
import { errorCode, errorMessage } from '@/lib/checkout-errors';
import { DEFAULT_POINT, LocationError, readDevicePosition, useLocationStore, type LatLng, type LocationStatus } from '@/lib/location';
import { Button, cn, Input, Label, Spinner, Textarea } from '@alliva/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Briefcase, Crosshair, Home, MapPin, Navigation } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';

type Saved = Awaited<ReturnType<typeof api.addAddress>>;

const labels = [
  ['Home', Home],
  ['Work', Briefcase],
  ['Other', MapPin],
] as const;

/**
 * Add a delivery address from an exact map pin. The pin starts at the customer's current position;
 * they drag it to the building entrance. Coordinates are required, typed text alone is never enough.
 */
export function AddressForm({
  forCheckout = false,
  onSaved,
  onCancel,
}: {
  /** Ask the API to refuse a pin the cart's store cannot deliver to. */
  forCheckout?: boolean;
  onSaved: (address: Saved) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations('customer.address');
  const e = useTranslations('customer.checkoutErrors');
  const locale = useLocale() as 'en' | 'ar';
  const remembered = useLocationStore((state) => state.point);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const [pin, setPin] = useState<LatLng | null>(remembered);
  const moved = useRef(false);
  const [gps, setGps] = useState<LocationStatus>('idle');
  const [label, setLabel] = useState<string>('Home');
  const [customLabel, setCustomLabel] = useState('');
  const [fields, setFields] = useState({ building: '', flat: '', road: '', block: '', area: '', city: '', landmark: '', instructions: '', contactName: '', contactPhone: '' });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const place = usePlaceName(pin, locale);
  const askedGps = useRef(false);

  // Start from a fresh GPS reading so the pin opens where the customer is standing.
  useEffect(() => {
    if (askedGps.current) return;
    askedGps.current = true;
    setGps('locating');
    readDevicePosition()
      .then((point) => {
        setGps('ready');
        setPin((current) => (moved.current && current ? current : point));
      })
      .catch((error) => {
        setGps(error instanceof LocationError ? error.status : 'error');
        setPin((current) => current ?? DEFAULT_POINT);
      });
  }, []);

  // Fill blank fields from the pinned place; never overwrite what the customer typed.
  useEffect(() => {
    const found = place.place;
    if (!found) return;
    setFields((current) => ({
      ...current,
      road: touched.road ? current.road : (found.road?.replace(/^road\s*/i, '') ?? current.road),
      block: touched.block ? current.block : (found.block ?? current.block),
      area: touched.area ? current.area : (found.area ?? current.area),
      city: touched.city ? current.city : (found.city ?? current.city),
    }));
  }, [place.place, touched]);

  useEffect(() => {
    const user = me.data;
    if (!user) return;
    setFields((current) => ({
      ...current,
      contactName: current.contactName || [user.firstName, user.lastName].filter(Boolean).join(' '),
      contactPhone: current.contactPhone || user.phone || '',
    }));
  }, [me.data]);

  const set = (key: keyof typeof fields) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.target.value;
    setTouched((current) => ({ ...current, [key]: true }));
    setFields((current) => ({ ...current, [key]: value }));
  };

  const save = useMutation({
    mutationFn: () =>
      api.addAddress({
        label: label === 'Other' ? customLabel.trim() || 'Other' : label,
        building: fields.building.trim() || null,
        flat: fields.flat.trim() || null,
        road: fields.road.trim() || null,
        block: fields.block.trim() || null,
        area: fields.area.trim() || null,
        city: fields.city.trim() || fields.area.trim() || 'Bahrain',
        landmark: fields.landmark.trim() || null,
        instructions: fields.instructions.trim() || null,
        contactName: fields.contactName.trim() || null,
        contactPhone: fields.contactPhone.replace(/\s+/g, '') || null,
        latitude: pin!.lat.toFixed(6),
        longitude: pin!.lng.toFixed(6),
        forCheckout,
      }),
    onSuccess: onSaved,
    onError: (error) => {
      const code = errorCode(error);
      setFormError(code ? e(errorMessage(error)) : e('addressSaveFailed'));
    },
  });

  const missingStreet = !fields.building.trim() && !fields.road.trim();
  const phoneInvalid = Boolean(fields.contactPhone.trim()) && !/^\+?\d{8,15}$/.test(fields.contactPhone.replace(/\s+/g, ''));
  const canSave = Boolean(pin) && !place.outside && !missingStreet && !phoneInvalid && !save.isPending;

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setFormError(null);
        setTouched((current) => ({ ...current, building: true, road: true }));
        if (canSave) save.mutate();
      }}
    >
      <div>
        <p className="text-sm font-semibold">{t('pinTitle')}</p>
        <p className="text-xs text-[#6f6f6a]">{t('pinBody')}</p>
      </div>
      {gps === 'denied' || gps === 'unavailable' || gps === 'timeout' || gps === 'unsupported' ? <LocationNotice status={gps} /> : null}
      <div className="relative overflow-hidden rounded-2xl border border-[#e6e6e0]">
        {pin ? (
          <LocationMap
            point={pin}
            onMark={(point) => {
              setPin(point);
              moved.current = true;
            }}
            className="z-0 h-64 w-full sm:h-72"
            zoomPosition="bottomright"
          />
        ) : (
          <div className="grid h-64 place-items-center bg-[#f7f7f5] sm:h-72">
            <span className="inline-flex items-center gap-2 text-sm text-[#6f6f6a]">
              <Spinner className="size-4" />
              {t('locating')}
            </span>
          </div>
        )}
        <LocationSearch
          locale={locale}
          className="absolute inset-x-2 top-2 z-[500]"
          onPick={(point) => {
            setPin(point);
            moved.current = true;
          }}
          labels={{ search: t('search'), placeholder: t('searchPlaceholder'), noResults: t('noResults'), failed: t('searchFailed') }}
        />
        <button
          type="button"
          aria-label={t('recenter')}
          onClick={() => {
            setGps('locating');
            readDevicePosition()
              .then((point) => {
                setGps('ready');
                setPin(point);
              })
              .catch((error) => setGps(error instanceof LocationError ? error.status : 'error'));
          }}
          className="absolute start-2 bottom-2 z-[500] grid size-10 place-items-center rounded-full bg-white shadow-md"
        >
          {gps === 'locating' ? <Spinner className="size-4" /> : <Navigation className="size-4" />}
        </button>
      </div>
      <div className="flex items-start gap-2 rounded-2xl bg-[#f7f7f5] px-3 py-2.5 text-sm">
        <Crosshair className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">{place.loading ? t('finding') : place.label || t('pinned')}</p>
          {pin ? <p className="text-xs text-[#8d8d88]" dir="ltr">{pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}</p> : null}
        </div>
      </div>
      {place.outside ? <p role="alert" className="text-sm font-medium text-[#B42318]">{t('outside')}</p> : null}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t('label')}</legend>
        <div className="flex gap-2">
          {labels.map(([value, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={label === value}
              onClick={() => setLabel(value)}
              className={cn('inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold', label === value ? 'border-transparent bg-primary text-[#111]' : 'border-[#e6e6e0] bg-white')}
            >
              <Icon className="size-4" />
              {t(`labels.${value.toLowerCase() as 'home' | 'work' | 'other'}`)}
            </button>
          ))}
        </div>
        {label === 'Other' ? <Input className="mt-2" value={customLabel} maxLength={40} placeholder={t('customLabel')} onChange={(event) => setCustomLabel(event.target.value)} /> : null}
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <Field id="address-building" label={t('building')}>
          <Input id="address-building" value={fields.building} onChange={set('building')} maxLength={40} aria-invalid={touched.building && missingStreet} />
        </Field>
        <Field id="address-flat" label={t('flat')}>
          <Input id="address-flat" value={fields.flat} onChange={set('flat')} maxLength={40} />
        </Field>
        <Field id="address-road" label={t('road')}>
          <Input id="address-road" value={fields.road} onChange={set('road')} maxLength={80} aria-invalid={touched.road && missingStreet} />
        </Field>
        <Field id="address-block" label={t('block')}>
          <Input id="address-block" value={fields.block} onChange={set('block')} maxLength={20} inputMode="numeric" />
        </Field>
        <Field id="address-area" label={t('area')}>
          <Input id="address-area" value={fields.area} onChange={set('area')} maxLength={80} />
        </Field>
        <Field id="address-city" label={t('city')}>
          <Input id="address-city" value={fields.city} onChange={set('city')} maxLength={80} />
        </Field>
      </div>
      {touched.building && missingStreet ? <p className="text-sm text-[#B42318]">{t('streetRequired')}</p> : null}
      <Field id="address-landmark" label={t('landmark')}>
        <Input id="address-landmark" value={fields.landmark} onChange={set('landmark')} maxLength={120} />
      </Field>
      <Field id="address-instructions" label={t('instructions')}>
        <Textarea id="address-instructions" value={fields.instructions} onChange={set('instructions')} maxLength={280} rows={2} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="address-contact" label={t('contactName')}>
          <Input id="address-contact" value={fields.contactName} onChange={set('contactName')} maxLength={80} autoComplete="name" />
        </Field>
        <Field id="address-phone" label={t('contactPhone')}>
          <Input id="address-phone" value={fields.contactPhone} onChange={set('contactPhone')} inputMode="tel" autoComplete="tel" dir="ltr" placeholder="+973" aria-invalid={phoneInvalid} />
        </Field>
      </div>
      {phoneInvalid ? <p className="text-sm text-[#B42318]">{t('phoneInvalid')}</p> : null}

      {formError ? <p role="alert" className="rounded-2xl bg-[#fdecea] px-4 py-3 text-sm font-semibold text-[#B42318]">{formError}</p> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button type="button" variant="ghost" className="h-12 rounded-full" onClick={onCancel}>
            {t('cancel')}
          </Button>
        ) : null}
        <Button type="submit" variant="yellow" className="h-12 rounded-full px-6 font-bold" loading={save.isPending} disabled={!canSave}>
          {forCheckout ? t('saveAndUse') : t('save')}
        </Button>
      </div>
    </form>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
