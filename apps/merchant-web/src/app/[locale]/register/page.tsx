'use client';

import { api } from '@/components/providers';
import { Link, useRouter } from '@/i18n/navigation';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import type { SubscriptionPlanView } from '@alliva/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Building2, Check, Hash, Info, Lock, Mail, Package, Phone, ShoppingCart, Star, Store, Ticket, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

export default function RegisterPage() {
  const t = useTranslations('register');
  const locale = useLocale() as 'en' | 'ar';
  const router = useRouter();
  const params = useSearchParams();
  const plans = useQuery({ queryKey: ['public-plans'], queryFn: () => api.publicPlans() });
  const categories = useQuery({ queryKey: ['business-categories'], queryFn: () => api.businessCategories() });
  const [step, setStep] = useState(0);
  const [interval, setInterval] = useState<'MONTHLY' | 'ANNUAL'>(params.get('interval') === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY');
  const [planId, setPlanId] = useState(params.get('plan') ?? '');
  const [form, setForm] = useState({
    email: '',
    password: '',
    businessName: '',
    categoryId: '',
    otherType: '',
    phone: '',
    crNumber: '',
    promoCode: '',
  });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const list = [...(plans.data ?? [])].sort((a, b) => a.displayOrder - b.displayOrder || Number(a.priceMonthly) - Number(b.priceMonthly));
  const register = useMutation({
    mutationFn: async () => {
      if (!planId) throw new Error(t('selectPlan'));
      const other = form.categoryId === 'other';
      if (!other && !form.categoryId) throw new Error(t('businessType'));
      if (other && form.otherType.trim().length < 2) throw new Error(t('otherType'));
      const category = (categories.data ?? []).find((item) => item.id === form.categoryId);
      const owner = form.email.split('@')[0] || form.businessName;
      const website = `www.${form.businessName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'store'}.bh`;
      await api.registerMerchant({
        businessName: form.businessName,
        website,
        businessType: other ? form.otherType.trim() : (category ? pickLocalized(category.name, locale) || category.slug : form.otherType.trim()),
        categoryId: other ? undefined : form.categoryId,
        city: 'Manama',
        phone: form.phone,
        email: form.email,
        firstName: owner,
        lastName: form.businessName,
        password: form.password,
        planId,
        billingInterval: interval,
        promoCode: form.promoCode.trim() || undefined,
        delivery: true,
        takeaway: true,
      });
      await api.login({ email: form.email, password: form.password });
    },
    onSuccess: () => router.push('/dashboard'),
    onError: (reason: Error) => setError(reason.message),
  });

  return (
    <div className="grid h-dvh overflow-hidden bg-white lg:grid-cols-2">
      <aside className="relative hidden flex-col overflow-hidden bg-primary px-10 py-8 text-[#111111] lg:flex">
        <img src="/route-map.png" alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-30" />
        <div className="relative z-10 max-w-md">
          <h1 className="font-display text-5xl leading-[0.95] tracking-tight lg:text-6xl">{t('headline')}</h1>
          <p className="mt-6 max-w-sm text-lg">{t('subhead')}</p>
        </div>
        <img src="/merchant-hero.png" alt="" className="relative z-10 mx-auto mt-auto h-auto max-h-72 w-auto max-w-sm object-contain" />
      </aside>
      <main className="flex h-dvh min-h-0 flex-col">
        <div className="shrink-0 px-6 pt-8 sm:px-12">
          <div className="mx-auto w-full max-w-[560px]">
            <img src="/logo-on-light.png" alt="Alliva" className="mb-6 h-12 w-auto" />
            <h2 className="font-display text-3xl tracking-tight">{step === 0 ? t('title') : t('choosePlan')}</h2>
            <p className="mt-2 text-sm text-[#6b6b66]">{step === 0 ? t('lead') : t('choosePlanHint')}</p>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-12">
          {step === 0 ? (
            <div className="mx-auto grid w-full max-w-[560px] gap-4 sm:grid-cols-2">
              <IconField icon={Mail} label={t('email')} value={form.email} error={fieldErrors.email} onChange={(email) => { setForm({ ...form, email }); setFieldErrors((current) => ({ ...current, email: '' })); }} type="email" />
              <IconField icon={Lock} label={t('password')} value={form.password} error={fieldErrors.password} onChange={(password) => { setForm({ ...form, password }); setFieldErrors((current) => ({ ...current, password: '' })); }} type="password" />
              <IconField icon={Store} label={t('businessName')} value={form.businessName} error={fieldErrors.businessName} onChange={(businessName) => { setForm({ ...form, businessName }); setFieldErrors((current) => ({ ...current, businessName: '' })); }} />
              <IconField icon={Phone} label={t('mobile')} value={form.phone} error={fieldErrors.phone} onChange={(phone) => { setForm({ ...form, phone }); setFieldErrors((current) => ({ ...current, phone: '' })); }} />
              <IconField icon={Hash} label={t('crNumber')} value={form.crNumber} onChange={(crNumber) => setForm({ ...form, crNumber })} />
              <IconField icon={Ticket} label={t('promo')} value={form.promoCode} onChange={(promoCode) => setForm({ ...form, promoCode })} placeholder={t('promoPlaceholder')} />
              <label className="block text-sm font-medium">
                {t('businessType')}
                <span className={`mt-2 flex h-12 items-center gap-2 rounded-full border px-4 ${fieldErrors.categoryId ? 'border-[#D9342B]' : ''}`}>
                  <Building2 className="h-4 w-4 shrink-0 text-[#8a8a86]" />
                  <select value={form.categoryId} onChange={(event) => { setForm({ ...form, categoryId: event.target.value }); setFieldErrors((current) => ({ ...current, categoryId: '', otherType: '' })); }} className="w-full bg-transparent text-sm outline-none">
                    <option value="">{t('businessType')}</option>
                    {(categories.data ?? []).map((category) => (
                      <option key={category.id} value={category.id}>{pickLocalized(category.name, locale) || category.slug}</option>
                    ))}
                    <option value="other">{t('other')}</option>
                  </select>
                </span>
                {fieldErrors.categoryId ? <span className="mt-1 block text-xs font-medium text-[#D9342B]">{fieldErrors.categoryId}</span> : null}
              </label>
              {form.categoryId === 'other' ? <IconField icon={Building2} label={t('otherType')} value={form.otherType} error={fieldErrors.otherType} onChange={(otherType) => { setForm({ ...form, otherType }); setFieldErrors((current) => ({ ...current, otherType: '' })); }} /> : null}
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[560px]">
              <div className="flex rounded-full bg-[#F1F1EE] p-1">
                <button type="button" className={`h-9 flex-1 rounded-full text-sm font-semibold ${interval === 'MONTHLY' ? 'bg-white' : 'text-[#8a8a86]'}`} onClick={() => setInterval('MONTHLY')}>{t('monthly')}</button>
                <button type="button" className={`h-9 flex-1 rounded-full text-sm font-semibold ${interval === 'ANNUAL' ? 'bg-white' : 'text-[#8a8a86]'}`} onClick={() => setInterval('ANNUAL')}>{t('yearly')}</button>
              </div>
              {fieldErrors.planId ? <p className="mt-3 text-sm font-medium text-[#D9342B]">{fieldErrors.planId}</p> : null}
              <div className="mt-4 grid gap-3">
                {list.map((plan) => (
                  <PlanChoice key={plan.id} plan={plan} locale={locale} selected={planId === plan.id} yearly={interval === 'ANNUAL'} onSelect={() => setPlanId(plan.id)} monthlyLabel={t('perMonth')} yearlyLabel={t('perYear')} more={t('viewFeatures')} less={t('hideDetails')} selectedLabel={t('selectedPlan')} />
                ))}
              </div>
              <p className="mt-4 flex items-center gap-2 rounded-2xl bg-[#f3f3f0] px-4 py-3 text-sm text-[#6b6b66]">
                <Info className="h-4 w-4 shrink-0" /> {t('planNote')}
              </p>
            </div>
          )}
        </div>
        <div className="shrink-0 border-t bg-white px-6 py-4 sm:px-12">
          <div className="mx-auto w-full max-w-[560px]">
            {error ? <p className="mb-3 text-sm text-[#D9342B]">{error}</p> : null}
            <div className="flex gap-3">
              <button type="button" className="h-12 rounded-full border px-5 text-sm font-semibold" onClick={() => (step === 0 ? router.back() : setStep(0))}>{t('back')}</button>
              {step === 0 ? (
                <button type="button" className="h-12 flex-1 rounded-full bg-[#111111] text-sm font-semibold text-white" onClick={() => { const next: Record<string, string> = {}; if (!form.email.includes('@')) next.email = t('emailInvalid'); if (form.password.length < 8) next.password = t('passwordShort'); if (form.businessName.trim().length < 2) next.businessName = t('required'); if (form.phone.trim().length < 8) next.phone = t('required'); if (!form.categoryId) next.categoryId = t('required'); if (form.categoryId === 'other' && form.otherType.trim().length < 2) next.otherType = t('required'); setFieldErrors(next); if (Object.keys(next).length) return; setError(''); setStep(1); }}>{t('continue')}</button>
              ) : (
                <button type="button" className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[#111111] text-sm font-semibold text-white" disabled={register.isPending} onClick={() => { if (!planId) { setFieldErrors({ planId: t('selectPlan') }); return; } setFieldErrors({}); setError(''); register.mutate(); }}>{t('submit')} <ArrowRight className="h-4 w-4 rtl:rotate-180" /></button>
              )}
            </div>
            <p className="mt-3 text-center text-sm text-[#6b6b66]">
              {t('haveAccount')} <Link href="/login" className="font-semibold text-[#111111] underline">{t('signIn')}</Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

function PlanChoice({ plan, locale, selected, yearly, onSelect, monthlyLabel, yearlyLabel, more, less, selectedLabel }: { plan: SubscriptionPlanView; locale: 'en' | 'ar'; selected: boolean; yearly: boolean; onSelect: () => void; monthlyLabel: string; yearlyLabel: string; more: string; less: string; selectedLabel: string }) {
  const plansT = useTranslations('plans');
  const [open, setOpen] = useState(false);
  const stats = planStats(plan, plansT);
  const details = planDetails(plan, plansT);
  return (
    <div className={`rounded-2xl border p-4 text-start ${selected ? 'border-[#111111] bg-[#FFF6CC]' : 'border-[#e6e6e1] bg-white'}`}>
      <button type="button" onClick={onSelect} className="w-full text-start">
        <span className="flex items-start justify-between gap-3">
          <span>
            {selected ? <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold"><Star className="h-3 w-3 fill-current" /> {selectedLabel}</span> : null}
            <span className="block font-semibold">{pickLocalized(plan.name, locale)}</span>
            <span className="mt-1 block text-2xl font-bold tracking-tight">{formatMoney(yearly ? plan.priceAnnual : plan.priceMonthly, locale)} <span className="text-sm font-medium text-[#6b6b66]">{yearly ? yearlyLabel : monthlyLabel}</span></span>
          </span>
          {selected ? <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary"><Check className="h-4 w-4" /></span> : <span className="mt-1 h-6 w-6 shrink-0 rounded-full border-2 border-[#d7d7d2]" />}
        </span>
        <span className="mt-2 block text-sm text-[#6b6b66]">{pickLocalized(plan.description, locale)}</span>
      </button>
      {stats.length ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t pt-3 text-xs text-[#3f3f3f]">
          {stats.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1.5"><item.icon className="h-3.5 w-3.5" /> {item.label}</span>
          ))}
        </div>
      ) : null}
      <button type="button" className="mt-3 text-sm font-semibold underline" onClick={() => setOpen((value) => !value)}>{open ? less : more} {!open ? <span aria-hidden>›</span> : null}</button>
      {open ? (
        <ul className="mt-2 space-y-1 text-sm text-[#3f3f3f]">
          {details.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

function planStats(plan: SubscriptionPlanView, t: ReturnType<typeof useTranslations<'plans'>>) {
  const value = (key: string) => plan.entitlements.find((row) => row.key === key)?.value;
  const text = (key: string) => value(key) == null || value(key) === '' ? t('unlimited') : String(value(key));
  const rows: { icon: typeof Package; label: string }[] = [];
  if (plan.entitlements.some((row) => row.key === 'productLimit')) rows.push({ icon: Package, label: `${text('productLimit')} ${t('products').toLowerCase()}` });
  if (plan.entitlements.some((row) => row.key === 'monthlyOrderLimit')) rows.push({ icon: ShoppingCart, label: `${text('monthlyOrderLimit')} ${t('orders').toLowerCase()}` });
  if (plan.entitlements.some((row) => row.key === 'staffLimit')) rows.push({ icon: Users, label: `${text('staffLimit')} ${t('staff').toLowerCase()}` });
  if (plan.entitlements.some((row) => row.key === 'branchLimit')) rows.push({ icon: Store, label: `${text('branchLimit')} ${t('branches').toLowerCase()}` });
  return rows;
}

function planDetails(plan: SubscriptionPlanView, t: ReturnType<typeof useTranslations<'plans'>>) {
  const value = (key: string) => plan.entitlements.find((row) => row.key === key)?.value;
  const lines: string[] = [];
  const visibility = String(value('visibility') ?? '');
  if (visibility) lines.push(visibility === 'CURRENT_STORE_ONLY' || visibility === 'EXCLUSIVE_STOREFRONT' ? t('currentStore') : visibility === 'EXCLUDE_SAME_BUSINESS_TYPE' ? t('excludeType') : t('allStores'));
  if (plan.entitlements.some((row) => row.key === 'productLimit')) lines.push(`${t('products')}: ${value('productLimit') == null || value('productLimit') === '' ? t('unlimited') : String(value('productLimit'))}`);
  if (plan.entitlements.some((row) => row.key === 'monthlyOrderLimit')) lines.push(`${t('orders')}: ${value('monthlyOrderLimit') == null || value('monthlyOrderLimit') === '' ? t('unlimited') : String(value('monthlyOrderLimit'))}`);
  if (plan.entitlements.some((row) => row.key === 'staffLimit')) lines.push(`${t('staff')}: ${value('staffLimit') == null || value('staffLimit') === '' ? t('unlimited') : String(value('staffLimit'))}`);
  if (plan.entitlements.some((row) => row.key === 'branchLimit')) lines.push(`${t('branches')}: ${value('branchLimit') == null || value('branchLimit') === '' ? t('unlimited') : String(value('branchLimit'))}`);
  const ordering = [value('deliveryOrdering') ? t('deliveryShort') : null, value('takeawayOrdering') ? t('takeawayShort') : null, value('tableOrdering') ? t('dineShort') : null].filter(Boolean);
  if (ordering.length) lines.push(ordering.join(', '));
  if (value('paymentIntegration')) lines.push(t('onlinePayments'));
  if (value('offerHighlighting')) lines.push(t('highlightedOffers'));
  const support = String(value('supportLevel') ?? '');
  if (support) lines.push(`${t('support')}: ${support === 'PRIORITY' ? t('priority') : t('standard')}`);
  return lines;
}

function IconField({ icon: Icon, label, value, onChange, placeholder, type = 'text', error }: { icon: typeof Mail; label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; error?: string }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <span className={`mt-2 flex h-12 items-center gap-2 rounded-full border px-4 ${error ? 'border-[#D9342B]' : ''}`}>
        <Icon className="h-4 w-4 shrink-0 text-[#8a8a86]" />
        <input type={type} className="w-full bg-transparent text-sm outline-none" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      </span>
      {error ? <span className="mt-1 block text-xs font-medium text-[#D9342B]">{error}</span> : null}
    </label>
  );
}
