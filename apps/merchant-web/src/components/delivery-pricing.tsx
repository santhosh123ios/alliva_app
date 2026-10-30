import { api } from '@/components/providers';
import { pickLocalized } from '@alliva/design-tokens';
import { Button } from '@alliva/ui';
import { deliverySettingSchema } from '@alliva/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Info, Route } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';

type Setting = {
  id: string;
  branchId: string | null;
  serviceAreaId: string | null;
  deliveryEnabled: boolean;
  freeRadiusKm: string;
  maxRadiusKm: string;
  includedKm: string;
  baseCharge: string;
  chargePerStep: string;
  billingStepKm: string;
  minCharge: string | null;
  maxCharge: string | null;
  freeAboveOrder: string | null;
  taxRate: string;
  promoFreeFrom: string | null;
  promoFreeUntil: string | null;
  version: number;
  updatedAt: string;
};
type Settings = {
  storeDeliveryEnabled: boolean;
  branches: { id: string; name: { en?: string; ar?: string }; city: string; active: boolean }[];
  settings: Setting[];
};
type PreviewQuote = { distanceKm: string; available: boolean; reason: string | null; billingUnits: number; charge: string; tax: string; total: string; free: boolean; freeReason: string | null };

type Draft = {
  deliveryEnabled: boolean;
  freeRadiusKm: string;
  maxRadiusKm: string;
  baseCharge: string;
  chargePerStep: string;
  billingStepKm: string;
  minCharge: string;
  maxCharge: string;
  freeAboveOrder: string;
  taxPercent: string;
  promoFreeFrom: string;
  promoFreeUntil: string;
};

const STORE = 'store';
const SAMPLE_KM = [1, 3, 5, 8, 12];
const errorFields = ['freeRadiusKm', 'maxRadiusKm', 'baseCharge', 'chargePerStep', 'billingStepKm', 'minCharge', 'maxCharge', 'freeAboveOrder', 'taxRate', 'promoFreeUntil'] as const;

/** Detailed delivery pricing for the store and each branch, saved as DeliverySetting rows and previewed with the checkout engine. */
export function DeliveryPricingCard() {
  const t = useTranslations('merchantDelivery');
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ['merchant-delivery-settings'], queryFn: () => api.deliverySettings<Settings>() });
  const [scope, setScope] = useState(STORE);
  const [override, setOverride] = useState(false);
  const [form, setForm] = useState<Draft>(() => toDraft(null));
  const [notice, setNotice] = useState('');
  const [orderAmount, setOrderAmount] = useState('');
  const [tryKm, setTryKm] = useState('');

  const data = settings.data;
  const storeRow = data?.settings.find((row) => !row.branchId && !row.serviceAreaId) ?? null;
  const row = scope === STORE ? storeRow : data?.settings.find((item) => item.branchId === scope && !item.serviceAreaId) ?? null;
  const editing = scope === STORE || override;

  // Reload the form whenever the saved row for the chosen scope changes.
  useEffect(() => {
    setOverride(Boolean(row));
    setForm(toDraft(row ?? storeRow));
  }, [scope, row?.id, row?.version, storeRow?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setNotice(''), [scope]);

  const payload = useMemo(() => toPayload(form), [form]);
  const checked = deliverySettingSchema.safeParse(payload);
  const errors = checked.success ? {} : Object.fromEntries(checked.error.issues.map((issue) => [String(issue.path[0]), true]));

  const distances = useMemo(() => {
    const custom = Number(tryKm);
    return Number.isFinite(custom) && custom > 0 && custom <= 200 ? [...SAMPLE_KM, custom].sort((a, b) => a - b) : SAMPLE_KM;
  }, [tryKm]);
  const previewBody = checked.success && editing ? { ...payload, distancesKm: distances, orderAmount: /^\d+(\.\d{1,3})?$/.test(orderAmount) ? orderAmount : null } : null;
  const debounced = useDebounced(previewBody, 350);
  const preview = useQuery({
    queryKey: ['merchant-delivery-preview', debounced],
    queryFn: () => api.previewDeliverySetting<{ quotes: PreviewQuote[] }>(debounced!),
    enabled: Boolean(debounced),
    placeholderData: (previous) => previous,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (scope !== STORE && !override) {
        if (row) await api.deactivateDeliverySetting(row.id);
        return;
      }
      if (row) await api.updateDeliverySetting(row.id, { ...payload, version: row.version });
      else await api.createDeliverySetting({ ...payload, branchId: scope === STORE ? null : scope });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['merchant-delivery-settings'] });
      setNotice(t('saved'));
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setForm((current) => ({ ...current, [key]: value }));
  const fieldError = (key: (typeof errorFields)[number]) => (errors[key] ? t(`errors.${key}`) : undefined);

  if (settings.isLoading) return <section className="h-40 animate-pulse rounded-[20px] border border-[#ECECEA] bg-white" />;
  if (!data) return null;

  return (
    <section className="rounded-[20px] border border-[#ECECEA] bg-white p-5 shadow-[0_8px_30px_rgba(17,17,17,0.04)]">
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#FFF3C4]">
          <Route className="size-5" />
        </span>
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-[#161616]">{t('title')}</h3>
          <p className="text-sm text-[#9A9A96]">{t('hint')}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label={t('scope')}>
        {[{ id: STORE, label: t('storeDefault') }, ...data.branches.map((branch) => ({ id: branch.id, label: pickLocalized(branch.name, locale) || branch.city }))].map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={scope === item.id}
            className={`h-9 rounded-full border px-4 text-sm font-semibold ${scope === item.id ? 'border-[#161616] bg-[#161616] text-white' : 'border-[#E8E8E4] bg-[#F7F7F5] text-[#161616]'}`}
            onClick={() => setScope(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {!data.storeDeliveryEnabled ? <Note>{t('storeDeliveryOff')}</Note> : null}
      {scope === STORE && !storeRow ? <Note>{t('usingBasic')}</Note> : null}

      {scope !== STORE ? (
        <Toggle label={t('branchOverride')} hint={override ? t('branchOverrideOn') : t('branchOverrideOff')} on={override} onChange={setOverride} />
      ) : null}

      {editing ? (
        <>
          <Toggle label={t('deliveryEnabled')} hint={t('deliveryEnabledHint')} on={form.deliveryEnabled} onChange={(value) => set('deliveryEnabled', value)} />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label={t('freeRadius')} suffix={t('km')} value={form.freeRadiusKm} error={fieldError('freeRadiusKm')} onChange={(value) => set('freeRadiusKm', value)} />
            <Field label={t('maxRadius')} hint={t('maxRadiusHint')} suffix={t('km')} value={form.maxRadiusKm} error={fieldError('maxRadiusKm')} onChange={(value) => set('maxRadiusKm', value)} />
            <Field label={t('baseCharge')} suffix={t('bhd')} value={form.baseCharge} error={fieldError('baseCharge')} onChange={(value) => set('baseCharge', value)} />
            <Field label={t('chargePerStep')} suffix={t('bhd')} value={form.chargePerStep} error={fieldError('chargePerStep')} onChange={(value) => set('chargePerStep', value)} />
            <label className="block text-sm font-semibold text-[#161616]">
              {t('billingStep')}
              <select value={form.billingStepKm} onChange={(event) => set('billingStepKm', event.target.value)} className="mt-1.5 h-12 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm outline-none">
                <option value="1">{t('stepOne')}</option>
                <option value="0.5">{t('stepHalf')}</option>
                {form.billingStepKm !== '1' && form.billingStepKm !== '0.5' ? <option value={form.billingStepKm}>{form.billingStepKm} {t('km')}</option> : null}
              </select>
              {fieldError('billingStepKm') ? <FieldError>{fieldError('billingStepKm')}</FieldError> : null}
            </label>
            <Field label={t('taxPercent')} suffix="%" value={form.taxPercent} error={fieldError('taxRate')} onChange={(value) => set('taxPercent', value)} />
            <Field label={t('minCharge')} hint={t('optional')} suffix={t('bhd')} value={form.minCharge} error={fieldError('minCharge')} onChange={(value) => set('minCharge', value)} />
            <Field label={t('maxCharge')} hint={t('optional')} suffix={t('bhd')} value={form.maxCharge} error={fieldError('maxCharge')} onChange={(value) => set('maxCharge', value)} />
            <Field label={t('freeAboveOrder')} hint={t('optional')} suffix={t('bhd')} value={form.freeAboveOrder} error={fieldError('freeAboveOrder')} onChange={(value) => set('freeAboveOrder', value)} />
          </div>
          <p className="mt-5 text-sm font-semibold text-[#161616]">{t('promo')}</p>
          <p className="text-xs text-[#9A9A96]">{t('promoHint')}</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <DateField label={t('promoFrom')} value={form.promoFreeFrom} onChange={(value) => set('promoFreeFrom', value)} />
            <DateField label={t('promoUntil')} value={form.promoFreeUntil} error={fieldError('promoFreeUntil')} onChange={(value) => set('promoFreeUntil', value)} />
          </div>

          <div className="mt-5 rounded-xl border border-[#F1F1EE] bg-[#FAFAF8] p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-[#161616]"><Calculator className="size-4" /> {t('preview')}</p>
              <div className="flex gap-2">
                <MiniField label={t('previewOrder')} suffix={t('bhd')} value={orderAmount} onChange={setOrderAmount} />
                <MiniField label={t('previewDistance')} suffix={t('km')} value={tryKm} onChange={setTryKm} />
              </div>
            </div>
            {!checked.success ? (
              <p className="mt-3 text-sm text-[#8A8A86]">{t('previewFix')}</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-start text-xs text-[#8A8A86]">
                    <th className="py-1 text-start font-medium">{t('distance')}</th>
                    <th className="py-1 text-end font-medium">{t('charge')}</th>
                    <th className="py-1 text-end font-medium">{t('tax')}</th>
                    <th className="py-1 text-end font-medium">{t('customerPays')}</th>
                  </tr>
                </thead>
                <tbody className={preview.isFetching ? 'opacity-60' : ''}>
                  {(preview.data?.quotes ?? []).map((quote) => (
                    <tr key={quote.distanceKm} className="border-t border-[#EFEFEC]">
                      <td className="py-2 font-medium"><bdi>{Number(quote.distanceKm)} {t('km')}</bdi></td>
                      {quote.available ? (
                        <>
                          <td className="py-2 text-end"><bdi>{quote.charge}</bdi></td>
                          <td className="py-2 text-end"><bdi>{quote.tax}</bdi></td>
                          <td className="py-2 text-end font-semibold">
                            {quote.free ? <span className="text-[#067647]">{t(`free.${quote.freeReason ?? 'WITHIN_FREE_RADIUS'}`)}</span> : <bdi>{t('bhd')} {quote.total}</bdi>}
                          </td>
                        </>
                      ) : (
                        <td colSpan={3} className="py-2 text-end text-[#B42318]">{t(`unavailable.${quote.reason ?? 'CONFIG_MISSING'}`)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <Note>{t('followsStore')}</Note>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 text-xs text-[#8A8A86]">
          <Info className="size-3.5" /> {row ? t('version', { version: row.version, date: new Date(row.updatedAt).toLocaleString(locale === 'ar' ? 'ar-BH' : 'en-BH') }) : t('notSaved')}
        </p>
        <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" loading={save.isPending} disabled={(editing && !checked.success) || (!editing && !row)} onClick={() => { setNotice(''); save.mutate(); }}>
          {t('save')}
        </Button>
      </div>
      {notice ? <p className="mt-3 text-sm font-medium text-[#161616]" role="status">{notice}</p> : null}
    </section>
  );
}

function toDraft(row: Setting | null): Draft {
  if (!row) {
    return { deliveryEnabled: true, freeRadiusKm: '0', maxRadiusKm: '10', baseCharge: '0.500', chargePerStep: '0', billingStepKm: '1', minCharge: '', maxCharge: '', freeAboveOrder: '', taxPercent: '0', promoFreeFrom: '', promoFreeUntil: '' };
  }
  return {
    deliveryEnabled: row.deliveryEnabled,
    freeRadiusKm: trim(row.freeRadiusKm),
    maxRadiusKm: trim(row.maxRadiusKm),
    baseCharge: row.baseCharge,
    chargePerStep: row.chargePerStep,
    billingStepKm: Number(row.billingStepKm) > 0 ? trim(row.billingStepKm) : '1',
    minCharge: row.minCharge ?? '',
    maxCharge: row.maxCharge ?? '',
    freeAboveOrder: row.freeAboveOrder ?? '',
    taxPercent: String(Number((Number(row.taxRate) * 100).toFixed(3))),
    promoFreeFrom: row.promoFreeFrom ? toLocalInput(new Date(row.promoFreeFrom)) : '',
    promoFreeUntil: row.promoFreeUntil ? toLocalInput(new Date(row.promoFreeUntil)) : '',
  };
}

/** The API body for a draft. Tax goes from a percentage to a fraction; empty optional fields become null. */
function toPayload(form: Draft) {
  const percent = form.taxPercent.trim();
  const optional = (value: string) => (value.trim() ? value.trim() : null);
  return {
    deliveryEnabled: form.deliveryEnabled,
    freeRadiusKm: form.freeRadiusKm.trim(),
    maxRadiusKm: form.maxRadiusKm.trim(),
    baseCharge: form.baseCharge.trim(),
    chargePerStep: form.chargePerStep.trim(),
    billingStepKm: form.billingStepKm,
    minCharge: optional(form.minCharge),
    maxCharge: optional(form.maxCharge),
    freeAboveOrder: optional(form.freeAboveOrder),
    taxRate: /^\d+(\.\d{1,3})?$/.test(percent) ? String(Number((Number(percent) / 100).toFixed(5))) : percent || 'invalid',
    promoFreeFrom: form.promoFreeFrom ? new Date(form.promoFreeFrom).toISOString() : null,
    promoFreeUntil: form.promoFreeUntil ? new Date(form.promoFreeUntil).toISOString() : null,
  };
}

function trim(value: string) {
  return String(Number(value));
}

function toLocalInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function useDebounced<T>(value: T, ms: number) {
  const [current, setCurrent] = useState(value);
  const key = JSON.stringify(value);
  useEffect(() => {
    const timer = setTimeout(() => setCurrent(value), ms);
    return () => clearTimeout(timer);
  }, [key, ms]); // eslint-disable-line react-hooks/exhaustive-deps
  return current;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 flex items-start gap-2 rounded-xl bg-[#F7F7F5] px-4 py-3 text-sm text-[#5F5F5B]"><Info className="mt-0.5 size-4 shrink-0" /> {children}</p>;
}

function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[#F1F1EE] px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-[#161616]">{label}</p>
        <p className="text-xs text-[#9A9A96]">{hint}</p>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? 'bg-[#161616]' : 'bg-[#E4E4E0]'}`} onClick={() => onChange(!on)}>
        <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow ${on ? 'start-5' : 'start-0.5'}`} />
      </button>
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <span className="mt-1 block text-xs font-medium text-[#B42318]">{children}</span>;
}

function Field({ label, hint, suffix, value, error, onChange }: { label: string; hint?: string; suffix: string; value: string; error?: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-semibold text-[#161616]">
      {label} {hint ? <span className="font-normal text-[#9A9A96]">({hint})</span> : null}
      <span className={`mt-1.5 flex h-12 overflow-hidden rounded-xl border bg-[#F7F7F5] ${error ? 'border-[#F04438]' : 'border-[#E8E8E4]'}`}>
        <input className="w-full bg-transparent px-3 text-sm font-medium outline-none" inputMode="decimal" dir="ltr" value={value} aria-invalid={Boolean(error)} onChange={(event) => onChange(event.target.value)} />
        <span className="grid shrink-0 place-items-center border-s border-[#E8E8E4] bg-white px-3 text-xs font-medium text-[#8A8A86]">{suffix}</span>
      </span>
      {error ? <FieldError>{error}</FieldError> : null}
    </label>
  );
}

function MiniField({ label, suffix, value, onChange }: { label: string; suffix: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-xs font-medium text-[#8A8A86]">
      {label}
      <span className="mt-1 flex h-9 w-28 overflow-hidden rounded-lg border border-[#E8E8E4] bg-white">
        <input className="w-full bg-transparent px-2 text-sm text-[#161616] outline-none" inputMode="decimal" dir="ltr" value={value} onChange={(event) => onChange(event.target.value)} />
        <span className="grid shrink-0 place-items-center px-2 text-xs">{suffix}</span>
      </span>
    </label>
  );
}

function DateField({ label, value, error, onChange }: { label: string; value: string; error?: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-semibold text-[#161616]">
      {label}
      <input type="datetime-local" dir="ltr" value={value} onChange={(event) => onChange(event.target.value)} className={`mt-1.5 h-12 w-full rounded-xl border bg-[#F7F7F5] px-3 text-sm outline-none ${error ? 'border-[#F04438]' : 'border-[#E8E8E4]'}`} />
      {error ? <FieldError>{error}</FieldError> : null}
    </label>
  );
}
