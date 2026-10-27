import { api } from '@/components/providers';
import { parsePaymentMethods, type PaymentMethodConfig } from '@alliva/validation';
import { Button } from '@alliva/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, CreditCard, Link2, Settings, Shield } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';

type SettingRow = { key: string; value: unknown };
type Tab = 'general' | 'payments' | 'notifications' | 'security' | 'integrations';

export type SettingsData = {
  values?: SettingRow[];
  gateways?: { id: string; provider: string; enabled: boolean; publicConfig?: unknown }[];
  templates?: { id: string; key: string; channel: string; subject?: unknown }[];
};

type Draft = {
  currency: string;
  timezone: string;
  taxPercent: string;
  supportPhone: string;
  maintenance: boolean;
  termsEn: string;
  termsAr: string;
  privacyEn: string;
  privacyAr: string;
  paymentMethods: PaymentMethodConfig[];
};

const tabs: { id: Tab; icon: typeof Settings }[] = [
  { id: 'general', icon: Settings },
  { id: 'payments', icon: CreditCard },
  { id: 'notifications', icon: Bell },
  { id: 'security', icon: Shield },
  { id: 'integrations', icon: Link2 },
];

const generalKeys = ['currency', 'timezone', 'taxPercent', 'supportPhone', 'termsEn', 'termsAr', 'privacyEn', 'privacyAr'] as const;
const paymentKeys = ['paymentMethods'] as const;
const securityKeys = ['maintenance'] as const;

export function PlatformSettings({ data }: { data: SettingsData }) {
  const t = useTranslations('settingsPage');
  const client = useQueryClient();
  const values = data.values ?? [];
  const initial = useMemo(() => draftFrom(values), [values]);
  const [tab, setTab] = useState<Tab>('general');
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(initial);
    setBaseline(initial);
  }, [initial]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage('');
    setError('');
  }

  function changed(keys: readonly (keyof Draft)[]) {
    return keys.some((key) => draft[key] !== baseline[key]);
  }

  function discard(keys: readonly (keyof Draft)[]) {
    setDraft((current) => applyKeys(current, keys, baseline));
    setMessage('');
    setError('');
  }

  async function save(valuesToStore: Record<string, unknown>, keys: readonly (keyof Draft)[], snapshot = draft) {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api.updateSettings(valuesToStore);
      setBaseline((current) => applyKeys(current, keys, snapshot));
      await client.invalidateQueries({ queryKey: ['admin', 'settings'] });
      setMessage(t('saved'));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function saveGeneral() {
    const tax = Number(draft.taxPercent);
    if (!draft.currency.trim() || !draft.timezone.trim() || !Number.isFinite(tax) || tax < 0 || tax > 100) {
      setError(t('invalidGeneral'));
      return;
    }
    return save({
      currency: draft.currency.trim(),
      timezone: draft.timezone.trim(),
      taxRate: (tax / 100).toFixed(3),
      supportPhone: draft.supportPhone.trim(),
      terms: { en: draft.termsEn, ar: draft.termsAr },
      privacy: { en: draft.privacyEn, ar: draft.privacyAr },
    }, generalKeys);
  }

  function saveSecurity() {
    return save({ maintenanceMode: draft.maintenance }, securityKeys);
  }

  function savePayments() {
    const methods = draft.paymentMethods.map((row) => ({
      code: row.code,
      enabled: row.enabled,
      name: { en: row.name.en.trim(), ar: row.name.ar.trim() },
    }));
    if (methods.some((row) => !row.name.en || !row.name.ar)) {
      setError(t('invalidPayments'));
      return;
    }
    if (!methods.some((row) => row.enabled)) {
      setError(t('enableOne'));
      return;
    }
    const snapshot = { ...draft, paymentMethods: methods };
    setDraft(snapshot);
    return save({ paymentMethods: methods }, paymentKeys, snapshot);
  }

  function updateMethod(code: PaymentMethodConfig['code'], patch: { enabled?: boolean; en?: string; ar?: string }) {
    setDraft((current) => ({
      ...current,
      paymentMethods: current.paymentMethods.map((row) =>
        row.code === code
          ? { ...row, enabled: patch.enabled ?? row.enabled, name: { en: patch.en ?? row.name.en, ar: patch.ar ?? row.name.ar } }
          : row,
      ),
    }));
    setMessage('');
    setError('');
  }

  const activeKeys = tab === 'general' ? generalKeys : tab === 'payments' ? paymentKeys : tab === 'security' ? securityKeys : null;
  const dirty = activeKeys ? changed(activeKeys) : false;

  return (
    <div>
      <h1 className="text-[28px] font-bold tracking-tight">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      <div className="mt-5 grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <nav className="rounded-2xl border bg-white p-2" aria-label={t('title')}>
          {tabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => { setTab(item.id); setMessage(''); setError(''); }}
                className={`relative flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-start text-sm font-medium ${active ? 'bg-[#FFF6D4] text-[#111111]' : 'text-[#3A3A36] hover:bg-[#F7F7F5]'}`}
                aria-current={active ? 'page' : undefined}
              >
                {active ? <span className="absolute inset-y-1.5 start-0 w-1 rounded-full bg-primary" /> : null}
                <Icon className="size-4 shrink-0" />
                {t(item.id)}
              </button>
            );
          })}
        </nav>
        <section className="rounded-2xl border bg-white p-5 md:p-6">
          <h2 className="text-xl font-bold tracking-tight">{t(tab)}</h2>
          <div className="mt-4 space-y-4">
            {tab === 'general' ? <GeneralForm draft={draft} update={update} /> : null}
            {tab === 'payments' ? <PaymentsForm methods={draft.paymentMethods} onChange={updateMethod} /> : null}
            {tab === 'notifications' ? <Notifications templates={data.templates ?? []} /> : null}
            {tab === 'security' ? <SecurityForm draft={draft} update={update} /> : null}
            {tab === 'integrations' ? <Integrations gateways={data.gateways ?? []} /> : null}
          </div>
          {message ? <p className="mt-4 text-sm text-[#168A52]">{message}</p> : null}
          {error ? <p className="mt-4 text-sm text-[#D9342B]">{error}</p> : null}
          {activeKeys ? (
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" className="h-10 rounded-lg border-[#E6E6E2] bg-white px-4 font-semibold" disabled={!dirty || saving} onClick={() => discard(activeKeys)}>{t('discard')}</Button>
              <Button
                type="button"
                variant="yellow"
                className="h-10 rounded-lg px-4"
                loading={saving}
                disabled={!dirty}
                onClick={() => {
                  if (tab === 'general') void saveGeneral();
                  if (tab === 'payments') void savePayments();
                  if (tab === 'security') void saveSecurity();
                }}
              >
                {t('save')}
              </Button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function GeneralForm({ draft, update }: { draft: Draft; update: <K extends keyof Draft>(key: K, value: Draft[K]) => void }) {
  const t = useTranslations('settingsPage');
  return (
    <>
      <Panel title={t('platform')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('currency')} value={draft.currency} onChange={(value) => update('currency', value)} />
          <Field label={t('timezone')} value={draft.timezone} onChange={(value) => update('timezone', value)} />
          <Affix label={t('tax')} value={draft.taxPercent} suffix="%" onChange={(value) => update('taxPercent', value)} />
          <Field label={t('supportPhone')} value={draft.supportPhone} onChange={(value) => update('supportPhone', value)} />
        </div>
      </Panel>
      <Panel title={t('legal')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Area label={t('termsEn')} value={draft.termsEn} onChange={(value) => update('termsEn', value)} />
          <Area label={t('termsAr')} value={draft.termsAr} onChange={(value) => update('termsAr', value)} />
          <Area label={t('privacyEn')} value={draft.privacyEn} onChange={(value) => update('privacyEn', value)} />
          <Area label={t('privacyAr')} value={draft.privacyAr} onChange={(value) => update('privacyAr', value)} />
        </div>
      </Panel>
    </>
  );
}

function PaymentsForm({ methods, onChange }: { methods: PaymentMethodConfig[]; onChange: (code: PaymentMethodConfig['code'], patch: { enabled?: boolean; en?: string; ar?: string }) => void }) {
  const t = useTranslations('settingsPage');
  return (
    <>
      <p className="text-sm text-muted-foreground">{t('paymentsHint')}</p>
      <ul className="space-y-3">
        {methods.map((method) => (
          <li key={method.code} className="rounded-xl border border-[#ECECE8] p-4">
            <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">{method.code}</p>
            <Toggle checked={method.enabled} onChange={(enabled) => onChange(method.code, { enabled })} label={method.enabled ? t('enabled') : t('disabled')} />
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Field label={t('methodEn')} value={method.name.en} onChange={(en) => onChange(method.code, { en })} />
              <Field label={t('methodAr')} value={method.name.ar} dir="rtl" onChange={(ar) => onChange(method.code, { ar })} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function SecurityForm({ draft, update }: { draft: Draft; update: <K extends keyof Draft>(key: K, value: Draft[K]) => void }) {
  const t = useTranslations('settingsPage');
  return (
    <Panel title={t('access')}>
      <Toggle checked={draft.maintenance} onChange={(value) => update('maintenance', value)} label={t('maintenance')} />
      <p className="mt-2 ps-14 text-xs text-muted-foreground">{t('maintenanceHint')}</p>
    </Panel>
  );
}

function Notifications({ templates }: { templates: NonNullable<SettingsData['templates']> }) {
  const t = useTranslations('settingsPage');
  return (
    <Panel title={t('templates')}>
      {templates.length ? (
        <ul className="divide-y">
          {templates.map((template) => (
            <li key={template.id} className="flex items-center justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0">
              <span>
                <span className="block font-semibold">{textOf(template.subject) || template.key}</span>
                <span className="text-xs text-muted-foreground">{template.key}</span>
              </span>
              <span className="rounded-full bg-[#F3F3F0] px-2.5 py-1 text-xs font-semibold">{template.channel}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">{t('noTemplates')}</p>}
    </Panel>
  );
}

function Integrations({ gateways }: { gateways: NonNullable<SettingsData['gateways']> }) {
  const t = useTranslations('settingsPage');
  return (
    <Panel title={t('gateways')}>
      {gateways.length ? (
        <ul className="divide-y">
          {gateways.map((gateway) => (
            <li key={gateway.id} className="flex items-center justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0">
              <span>
                <span className="block font-semibold">{gateway.provider}</span>
                {feeLabel(gateway.publicConfig) ? <span className="text-xs text-muted-foreground">{t('fee', { rate: feeLabel(gateway.publicConfig) ?? '' })}</span> : null}
              </span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${gateway.enabled ? 'bg-[#E8F6EE] text-[#168A52]' : 'bg-[#F3F3F0] text-muted-foreground'}`}>
                {gateway.enabled ? t('enabled') : t('disabled')}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">{t('noGateways')}</p>}
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[#ECECE8] p-4 md:p-5">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({ label, value, onChange, dir }: { label?: string; value: string; onChange: (value: string) => void; dir?: 'ltr' | 'rtl' }) {
  return (
    <label className="block">
      {label ? <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span> : null}
      <input dir={dir} value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-lg border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-primary" />
    </label>
  );
}

function Affix({ label, value, onChange, prefix, suffix }: { label: string; value: string; onChange: (value: string) => void; prefix?: string; suffix?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      <span className="flex h-10 overflow-hidden rounded-lg border bg-white focus-within:ring-2 focus-within:ring-primary">
        {prefix ? <span className="grid place-items-center border-e bg-[#F4F4F1] px-3 text-xs font-semibold text-muted-foreground">{prefix}</span> : null}
        <input value={value} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" />
        {suffix ? <span className="grid place-items-center border-s bg-[#F4F4F1] px-3 text-xs font-semibold text-muted-foreground">{suffix}</span> : null}
      </span>
    </label>
  );
}

function Area({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} className="min-h-24 w-full rounded-lg border bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-primary" />
    </label>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center gap-3 rounded-lg py-1.5 text-start text-sm">
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-[#34C759]' : 'bg-[#E4E4E0]'}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-all ${checked ? 'end-0.5' : 'start-0.5'}`} />
      </span>
      <span>{label}</span>
    </button>
  );
}

function applyKeys(source: Draft, keys: readonly (keyof Draft)[], from: Draft): Draft {
  const next = { ...source };
  for (const key of keys) Object.assign(next, { [key]: from[key] });
  return next;
}

function draftFrom(values: SettingRow[]): Draft {
  const read = (key: string) => values.find((row) => row.key === key)?.value;
  const terms = localized(read('terms'));
  const privacy = localized(read('privacy'));
  return {
    currency: text(read('currency'), 'BHD'),
    timezone: text(read('timezone'), 'Asia/Bahrain'),
    taxPercent: taxField(read('taxRate')),
    supportPhone: text(read('supportPhone'), ''),
    maintenance: flag(read('maintenanceMode'), false),
    termsEn: terms.en,
    termsAr: terms.ar,
    privacyEn: privacy.en,
    privacyAr: privacy.ar,
    paymentMethods: parsePaymentMethods(read('paymentMethods')),
  };
}

function localized(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const row = value as { en?: unknown; ar?: unknown };
    return { en: typeof row.en === 'string' ? row.en : '', ar: typeof row.ar === 'string' ? row.ar : '' };
  }
  return { en: '', ar: '' };
}

function text(value: unknown, fallback: string) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function flag(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function taxField(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '10';
  const percent = number <= 1 ? number * 100 : number;
  return String(Math.round(percent * 1000) / 1000);
}

function textOf(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'en' in value && typeof (value as { en: unknown }).en === 'string') return (value as { en: string }).en;
  return '';
}

function feeLabel(config: unknown) {
  if (!config || typeof config !== 'object') return null;
  const rate = Number((config as { feeRate?: unknown }).feeRate);
  if (!Number.isFinite(rate)) return null;
  return `${(rate * 100).toFixed(rate * 100 % 1 === 0 ? 0 : 1)}%`;
}
