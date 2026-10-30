import { api } from '@/components/providers';
import { InventorySettings } from '@/components/products';
import { pickLocalized } from '@alliva/design-tokens';
import type { StorePaymentMethod } from '@alliva/types';
import { Button, Skeleton } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CreditCard, Landmark, Smartphone, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';

export function SettingsPage() {
  const t = useTranslations('merchantProducts');
  const nav = useTranslations('nav');
  const profileQuery = useQuery({ queryKey: ['merchant', 'business'], queryFn: () => api.profile() });
  const method = readInventoryMethod(profileQuery.data);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-[-0.03em] text-[#161616]">{nav('settings')}</h1>
        <p className="mt-0.5 text-sm text-[#6F6F6B]">{t('settingsSubtitle')}</p>
      </div>
      <div className="grid items-start gap-4 min-[900px]:grid-cols-2">
        <div className="min-w-0 min-[900px]:col-start-1 min-[900px]:row-start-1">
          {profileQuery.isLoading ? <Skeleton className="h-56 rounded-xl" /> : <InventorySettings method={method} />}
        </div>
        <div className="min-w-0 min-[900px]:col-start-2 min-[900px]:row-span-2 min-[900px]:row-start-1">
          <ChargeSettings profile={profileQuery.data} />
        </div>
        <div className="min-w-0 min-[900px]:col-start-1 min-[900px]:row-start-2">
          <PaymentSettings profile={profileQuery.data} />
        </div>
      </div>
    </div>
  );
}

type ChargeMode = 'PERCENTAGE' | 'FIXED';
type ChargeDraft = { enabled: boolean; mode: ChargeMode; amount: string; labelEn: string; labelAr: string };

function ChargeSettings({ profile }: { profile: unknown }) {
  const t = useTranslations('merchantProducts');
  const client = useQueryClient();
  const stored = (profile as { orderCharges?: { serviceFee?: unknown; taxCharge?: unknown } } | undefined)?.orderCharges;
  const [serviceFee, setServiceFee] = useState<ChargeDraft>(() => chargeDraft(stored?.serviceFee, serviceFallback));
  const [tax, setTax] = useState<ChargeDraft>(() => chargeDraft(stored?.taxCharge, taxFallback));
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const signature = JSON.stringify(stored ?? null);
  useEffect(() => {
    const next = stored;
    setServiceFee(chargeDraft(next?.serviceFee, serviceFallback));
    setTax(chargeDraft(next?.taxCharge, taxFallback));
  }, [signature]);
  const save = useMutation({
    mutationFn: () => {
      if (!validCharge(serviceFee) || !validCharge(tax)) throw new Error(t('chargeInvalid'));
      return api.updateProfile({ orderCharges: { serviceFee: storedCharge(serviceFee), taxCharge: storedCharge(tax) } });
    },
    onSuccess: () => {
      setSaved(t('chargeSaved'));
      setError('');
      void client.invalidateQueries({ queryKey: ['merchant', 'business'] });
    },
    onError: (reason: Error) => { setSaved(''); setError(reason.message); },
  });
  if (!profile) return <Skeleton className="h-56 rounded-xl" />;
  return (
    <section className="rounded-xl border border-[#E2E1DC] bg-white p-4">
      <h2 className="font-bold text-[#161616]">{t('chargesTitle')}</h2>
      <p className="mt-1 text-sm text-[#777772]">{t('chargesHint')}</p>
      <div className="mt-4 grid gap-3">
        <ChargeCard title={t('serviceFee')} charge={serviceFee} onChange={setServiceFee} />
        <ChargeCard title={t('taxCharge')} charge={tax} onChange={setTax} />
      </div>
      {error ? <p className="mt-3 text-sm font-medium text-[#B42318]">{error}</p> : null}
      {saved ? <p className="mt-3 text-sm font-semibold text-[#157A3E]">{saved}</p> : null}
      <Button type="button" variant="yellow" className="mt-4 h-10 rounded-lg px-4" loading={save.isPending} onClick={() => { setError(''); save.mutate(); }}>{t('saveUpdate')}</Button>
    </section>
  );
}

function ChargeCard({ title, charge, onChange }: { title: string; charge: ChargeDraft; onChange: (charge: ChargeDraft) => void }) {
  const t = useTranslations('merchantProducts');
  const patch = (next: Partial<ChargeDraft>) => onChange({ ...charge, ...next });
  return (
    <div className="@container rounded-lg border border-[#E3E2DD] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-[#161616]">{title}</p>
        <button type="button" role="switch" aria-checked={charge.enabled} onClick={() => patch({ enabled: !charge.enabled })} className="inline-flex items-center gap-2 text-sm font-semibold text-[#161616]">
          <span>{charge.enabled ? t('chargeOn') : t('chargeOff')}</span>
          <span className={`relative h-6 w-11 rounded-full ${charge.enabled ? 'bg-[#25B55B]' : 'bg-[#D5D5D0]'}`}><span className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${charge.enabled ? 'end-0.5' : 'start-0.5'}`} /></span>
        </button>
      </div>
      <p className="mt-1 text-xs text-[#777772]">{t('chargeHint')}</p>
      <div className="mt-3 grid gap-3 @min-[24rem]:grid-cols-2">
        <ChargeField label={t('labelEn')} value={charge.labelEn} onChange={(labelEn) => patch({ labelEn })} />
        <ChargeField label={t('labelAr')} value={charge.labelAr} dir="rtl" onChange={(labelAr) => patch({ labelAr })} />
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[#777772]">{t('chargeType')}</span>
          <select value={charge.mode} onChange={(event) => patch({ mode: event.target.value === 'FIXED' ? 'FIXED' : 'PERCENTAGE' })} className="h-10 w-full rounded-lg border border-[#E3E2DD] bg-white px-3 text-sm outline-none">
            <option value="PERCENTAGE">{t('percentage')}</option>
            <option value="FIXED">{t('fixedPrice')}</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[#777772]">{t('amount')}</span>
          <span className="flex h-10 overflow-hidden rounded-lg border border-[#E3E2DD] bg-white">
            <input value={charge.amount} inputMode="decimal" onChange={(event) => patch({ amount: event.target.value })} className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" />
            <span className="grid place-items-center border-s border-[#E3E2DD] bg-[#F6F6F4] px-3 text-xs font-semibold text-[#555550]">{charge.mode === 'PERCENTAGE' ? '%' : 'BHD'}</span>
          </span>
        </label>
      </div>
    </div>
  );
}

function ChargeField({ label, value, onChange, dir }: { label: string; value: string; onChange: (value: string) => void; dir?: 'ltr' | 'rtl' }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-[#777772]">{label}</span>
      <input dir={dir} value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-lg border border-[#E3E2DD] bg-white px-3 text-sm outline-none" />
    </label>
  );
}

const serviceFallback: ChargeDraft = { enabled: false, mode: 'PERCENTAGE', amount: '0', labelEn: 'Service fee', labelAr: 'رسوم الخدمة' };
const taxFallback: ChargeDraft = { enabled: false, mode: 'PERCENTAGE', amount: '0', labelEn: 'Tax', labelAr: 'الضريبة' };

function chargeDraft(value: unknown, fallback: ChargeDraft): ChargeDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const row = value as { enabled?: unknown; mode?: unknown; amount?: unknown; label?: unknown };
  const mode: ChargeMode = row.mode === 'FIXED' ? 'FIXED' : 'PERCENTAGE';
  const label = row.label && typeof row.label === 'object' ? (row.label as { en?: unknown; ar?: unknown }) : {};
  const stored = typeof row.amount === 'string' || typeof row.amount === 'number' ? String(row.amount) : '0';
  const number = Number(stored);
  const amount = mode === 'PERCENTAGE'
    ? String(Math.round((Number.isFinite(number) ? (number <= 1 ? number * 100 : number) : 0) * 1000) / 1000)
    : (Number.isFinite(number) ? number.toFixed(3) : '0.000');
  return {
    enabled: typeof row.enabled === 'boolean' ? row.enabled : fallback.enabled,
    mode,
    amount,
    labelEn: typeof label.en === 'string' && label.en ? label.en : fallback.labelEn,
    labelAr: typeof label.ar === 'string' && label.ar ? label.ar : fallback.labelAr,
  };
}

function validCharge(charge: ChargeDraft) {
  const amount = Number(charge.amount);
  if (!charge.labelEn.trim() || !charge.labelAr.trim()) return false;
  if (!Number.isFinite(amount) || amount < 0) return false;
  return charge.mode === 'FIXED' || amount <= 100;
}

function storedCharge(charge: ChargeDraft) {
  const amount = Number(charge.amount);
  return {
    enabled: charge.enabled,
    mode: charge.mode,
    amount: charge.mode === 'PERCENTAGE' ? (amount / 100).toFixed(5) : amount.toFixed(3),
    label: { en: charge.labelEn.trim(), ar: charge.labelAr.trim() },
  };
}

const methodIcon = {
  CASH: Banknote,
  BANK_TRANSFER: Landmark,
  BENEFIT_PAY: Smartphone,
  TAP_PAY: CreditCard,
  PAYPAL: Wallet,
} as const;

function PaymentSettings({ profile }: { profile: unknown }) {
  const t = useTranslations('merchantProducts');
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const methods = useQuery({ queryKey: ['public-payment-methods'], queryFn: () => api.publicPaymentMethods() });
  const offered = methods.data ?? [];
  const [selected, setSelected] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const storedSelection = methods.isSuccess ? acceptedCodes(profile, methods.data ?? []).join('\n') : null;
  useEffect(() => {
    if (storedSelection == null) return;
    setSelected(storedSelection ? storedSelection.split('\n') : []);
    setReady(true);
  }, [storedSelection]);
  const save = useMutation({
    mutationFn: () => {
      if (!selected.length) throw new Error(t('paymentRequired'));
      return api.updateProfile({ paymentMethods: selected });
    },
    onSuccess: () => {
      setSaved(t('paymentSaved'));
      setError('');
      void client.invalidateQueries({ queryKey: ['merchant', 'business'] });
    },
    onError: (reason: Error) => { setSaved(''); setError(reason.message); },
  });
  function toggle(code: string) {
    setSaved('');
    setSelected((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  }
  return (
    <section className="rounded-xl border border-[#E2E1DC] bg-white p-4">
      <h2 className="font-bold text-[#161616]">{t('paymentOptions')}</h2>
      <p className="mt-1 text-sm text-[#777772]">{t('paymentOptionsHint')}</p>
      {methods.isLoading ? <Skeleton className="mt-4 h-28 rounded-xl" /> : null}
      {methods.isSuccess && !offered.length ? <p className="mt-4 text-sm text-[#777772]">{t('paymentEmpty')}</p> : null}
      <div className="mt-4 grid gap-2">
        {offered.map((method) => {
          const active = selected.includes(method.code);
          const Icon = methodIcon[method.code as keyof typeof methodIcon] ?? CreditCard;
          return (
            <button key={method.code} type="button" onClick={() => toggle(method.code)} className={`flex items-center gap-3 rounded-lg border p-3 text-start ${active ? 'border-[#F2C300] bg-[#FFFCEF]' : 'border-[#E3E2DD] bg-white'}`}>
              <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${active ? 'bg-[#FFC400] text-[#161616]' : 'bg-[#F6F6F4] text-[#555550]'}`}><Icon className="size-4" /></span>
              <span className="min-w-0 flex-1 font-semibold text-[#161616]">{pickLocalized(method.name, locale) || method.code}</span>
              <span className={`relative h-6 w-11 shrink-0 rounded-full ${active ? 'bg-[#25B55B]' : 'bg-[#D5D5D0]'}`}><span className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${active ? 'end-0.5' : 'start-0.5'}`} /></span>
            </button>
          );
        })}
      </div>
      {error ? <p className="mt-3 text-sm font-medium text-[#B42318]">{error}</p> : null}
      {saved ? <p className="mt-3 text-sm font-semibold text-[#157A3E]">{saved}</p> : null}
      <Button type="button" variant="yellow" className="mt-4 h-10 rounded-lg px-4" disabled={!ready || !offered.length} loading={save.isPending} onClick={() => { setError(''); save.mutate(); }}>{t('saveUpdate')}</Button>
    </section>
  );
}

function acceptedCodes(profile: unknown, offered: StorePaymentMethod[]) {
  const stored = (profile as { acceptedPaymentMethods?: unknown } | undefined)?.acceptedPaymentMethods;
  if (!Array.isArray(stored)) return offered.map((method) => method.code);
  const chosen = new Set(stored.filter((code): code is string => typeof code === 'string'));
  return offered.filter((method) => chosen.has(method.code)).map((method) => method.code);
}

function readInventoryMethod(data: unknown): 'daily' | 'stock' | null {
  const value = (data as { inventoryMethod?: string } | undefined)?.inventoryMethod;
  if (value === 'DAILY') return 'daily';
  if (value === 'STOCK') return 'stock';
  return null;
}
