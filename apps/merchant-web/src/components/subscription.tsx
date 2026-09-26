'use client';

import { api } from '@/components/providers';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { Dialog, DialogContent, DialogDescription, DialogTitle, EmptyState, ErrorState, Skeleton } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { Calendar, CreditCard, FileText, Info, Megaphone, QrCode, Store, Truck, UtensilsCrossed } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

type Localized = { en?: string; ar?: string };
type Entitlement = { key: string; value: unknown };
type Plan = {
  id: string;
  code: string;
  name: Localized;
  description: Localized;
  priceMonthly: string;
  priceAnnual: string;
  status: string;
  entitlements: Entitlement[];
};
type UsageRow = { key: string; value: unknown; usage: number | null };
type InvoiceRow = { id: string; number: string; amount: string; status: string; issuedAt: string };
type MerchantProfile = {
  subscription: {
    status: string;
    billingInterval: 'MONTHLY' | 'ANNUAL';
    currentPeriodEnd: string;
    plan: Plan;
  } | null;
};

const usageKeys = [
  { key: 'productLimit', label: 'products' },
  { key: 'monthlyOrderLimit', label: 'orders' },
  { key: 'staffLimit', label: 'staff' },
  { key: 'branchLimit', label: 'branches' },
] as const;

const featureKeys = [
  { key: 'visibility', label: 'qr', icon: QrCode },
  { key: 'tableOrdering', label: 'dineIn', icon: UtensilsCrossed },
  { key: 'paymentIntegration', label: 'payments', icon: CreditCard },
  { key: 'deliveryOrdering', label: 'delivery', icon: Truck },
  { key: 'offerHighlighting', label: 'offers', icon: Megaphone },
] as const;

export function SubscriptionPage() {
  const t = useTranslations('merchantSubscription');
  const locale = useLocale() as 'en' | 'ar';
  const billingRef = useRef<HTMLElement>(null);
  const compareRef = useRef<HTMLElement>(null);
  const [details, setDetails] = useState<Plan | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const profileQuery = useQuery({ queryKey: ['merchant', 'profile'], queryFn: () => api.profile() });
  const usageQuery = useQuery({ queryKey: ['merchant', 'subscription'], queryFn: () => api.subscription() });
  const plansQuery = useQuery({ queryKey: ['public', 'plans'], queryFn: () => api.publicPlans() });
  const invoicesQuery = useQuery({ queryKey: ['merchant', 'invoices'], queryFn: () => api.invoices() });

  if (profileQuery.isLoading || usageQuery.isLoading || plansQuery.isLoading || invoicesQuery.isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-44 w-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }
  const error = profileQuery.error ?? usageQuery.error ?? plansQuery.error ?? invoicesQuery.error;
  if (error) return <ErrorState title="Could not load" body={(error as Error).message} />;

  const profile = profileQuery.data as MerchantProfile;
  const subscription = profile.subscription;
  const usage = (usageQuery.data ?? []) as UsageRow[];
  const plans = (plansQuery.data ?? []) as Plan[];
  const invoices = (invoicesQuery.data ?? []) as InvoiceRow[];
  const alternatives = plans.filter((plan) => plan.status === 'ACTIVE' && plan.id !== subscription?.plan.id);

  const scrollTo = (node: HTMLElement | null) => node?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[32px] font-semibold leading-tight tracking-tight text-[#161616]">{t('title')}</h1>
          <p className="mt-1 text-sm text-[#8A8A86]">{t('subtitle')}</p>
        </div>
        <button
          type="button"
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#E6E6E2] bg-white px-3 text-sm font-semibold text-[#161616]"
          onClick={() => scrollTo(billingRef.current)}
        >
          <FileText className="size-4" />
          {t('viewInvoices')}
        </button>
      </div>

      {subscription ? (
        <CurrentPlan
          plan={subscription.plan}
          status={subscription.status}
          interval={subscription.billingInterval}
          renewsAt={subscription.currentPeriodEnd}
          locale={locale}
          onManage={() => scrollTo(compareRef.current)}
          onCompare={() => scrollTo(compareRef.current)}
        />
      ) : (
        <EmptyState title={t('noPlan')} body={t('noPlanBody')} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-[#EEEEEC] bg-white p-5">
          <h2 className="text-base font-semibold text-[#161616]">{t('usage')}</h2>
          <ul className="mt-4 space-y-4">
            {usageKeys.map((item) => {
              const row = usage.find((entry) => entry.key === item.key);
              return <UsageMeter key={item.key} label={t(item.label)} usage={row?.usage ?? 0} limit={limitOf(row?.value)} unlimitedLabel={t('unlimited')} />;
            })}
          </ul>
          <p className="mt-4 flex items-center gap-2 text-xs text-[#8A8A86]">
            <Info className="size-3.5" />
            {t('resets')}
          </p>
        </section>
        <section className="rounded-2xl border border-[#EEEEEC] bg-white p-5">
          <h2 className="text-base font-semibold text-[#161616]">{t('features')}</h2>
          <ul className="mt-2">
            {featureKeys.map((item) => (
              <li key={item.key} className="flex items-center gap-3 border-b border-[#F3F3F1] py-3 last:border-b-0">
                <item.icon className="size-4 text-[#161616]" />
                <span className="text-sm font-medium text-[#161616]">{t(item.label)}</span>
                <span className="ms-auto text-sm text-[#696965]">{featureText(item.key, entitlement(subscription?.plan.entitlements, item.key), t)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section ref={compareRef} className="rounded-2xl border border-[#EEEEEC] bg-white p-5">
          <h2 className="text-base font-semibold text-[#161616]">{t('compareTitle')}</h2>
          <p className="mt-1 text-sm text-[#8A8A86]">{t('compareHint')}</p>
          <div className="mt-4 grid gap-3">
            {alternatives.map((plan) => (
              <article key={plan.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#EEEEEC] p-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#F7F7F5]">
                  <Store className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[#161616]">{pickLocalized(plan.name, locale)}</p>
                  <p className="text-sm text-[#3A3A36]">
                    {formatMoney(plan.priceMonthly, locale)} <span className="text-[#8A8A86]">{t('perMonth')}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-[#8A8A86]">{pickLocalized(plan.description, locale)}</p>
                </div>
                <button
                  type="button"
                  className="h-9 rounded-xl border border-[#E6E6E2] bg-white px-3 text-sm font-semibold"
                  onClick={() => setDetails(plan)}
                >
                  {t('viewDetails')}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section ref={billingRef} className="rounded-2xl border border-[#EEEEEC] bg-white p-5">
          <h2 className="text-base font-semibold text-[#161616]">{t('billing')}</h2>
          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[28rem]">
              <div className="grid grid-cols-[1fr_1.2fr_0.8fr_0.8fr_0.6fr] gap-2 text-xs font-semibold text-[#8A8A86]">
                <span>{t('date')}</span>
                <span>{t('invoice')}</span>
                <span>{t('amount')}</span>
                <span>{t('status')}</span>
                <span>{t('action')}</span>
              </div>
              {invoices.length ? (
                <ul className="mt-2 divide-y divide-[#F3F3F1]">
                  {invoices.map((invoice) => (
                    <li key={invoice.id} className="grid grid-cols-[1fr_1.2fr_0.8fr_0.8fr_0.6fr] gap-2 py-3 text-sm">
                      <span>{formatDate(invoice.issuedAt, locale)}</span>
                      <span className="truncate font-medium">{invoice.number}</span>
                      <span>{formatMoney(invoice.amount, locale)}</span>
                      <span className="text-[#16924A]">{statusLabel(invoice.status, t)}</span>
                      <span />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-[#8A8A86]">
                  <span className="grid size-10 place-items-center rounded-full bg-[#F7F7F5] text-[#B0B0AC]">
                    <FileText className="size-4" />
                  </span>
                  {t('emptyInvoices')}
                </div>
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-[#F3F3F1] pt-4">
            <div>
              <h3 className="text-sm font-semibold text-[#161616]">{t('paymentMethod')}</h3>
              <p className="mt-0.5 text-xs text-[#8A8A86]">{t('paymentHint')}</p>
            </div>
            <button
              type="button"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-[#161616]"
              onClick={() => setPaymentOpen(true)}
            >
              <CreditCard className="size-4" />
              {t('addPayment')}
            </button>
          </div>
        </section>
      </div>

      <Dialog open={Boolean(details)} onOpenChange={(open) => { if (!open) setDetails(null); }}>
        <DialogContent className="w-[min(100%-2rem,28rem)]">
          <DialogTitle>{details ? pickLocalized(details.name, locale) : ''}</DialogTitle>
          <DialogDescription>{details ? pickLocalized(details.description, locale) : ''}</DialogDescription>
          {details ? (
            <div className="mt-4">
              <p className="text-sm font-semibold">
                {formatMoney(details.priceMonthly, locale)} <span className="font-normal text-[#8A8A86]">{t('perMonth')}</span>
              </p>
              <ul className="mt-3 divide-y divide-[#F3F3F1]">
                {featureKeys.map((item) => (
                  <li key={item.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span>{t(item.label)}</span>
                    <span className="text-[#696965]">{featureText(item.key, entitlement(details.entitlements, item.key), t)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="w-[min(100%-2rem,28rem)]">
          <DialogTitle>{t('paymentTitle')}</DialogTitle>
          <DialogDescription>{t('paymentBody')}</DialogDescription>
          <button type="button" className="mt-5 h-10 rounded-xl bg-[#111111] px-4 text-sm font-semibold text-white" onClick={() => setPaymentOpen(false)}>
            {t('close')}
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CurrentPlan({
  plan,
  status,
  interval,
  renewsAt,
  locale,
  onManage,
  onCompare,
}: {
  plan: Plan;
  status: string;
  interval: 'MONTHLY' | 'ANNUAL';
  renewsAt: string;
  locale: 'en' | 'ar';
  onManage: () => void;
  onCompare: () => void;
}) {
  const t = useTranslations('merchantSubscription');
  const price = interval === 'ANNUAL' ? plan.priceAnnual : plan.priceMonthly;
  return (
    <section className="grid overflow-hidden rounded-2xl border border-[#EEEEEC] bg-white lg:grid-cols-[1.45fr_1fr]">
      <div className="bg-[#FFF6CC] p-5 sm:p-6">
        <span className="grid size-14 place-items-center rounded-2xl bg-white/70">
          <Store className="size-7" />
        </span>
        <p className="mt-4 inline-flex rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold tracking-wide text-[#161616]">{t('currentPlan')}</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#161616]">{pickLocalized(plan.name, locale)}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-[#161616]">
            {formatMoney(price, locale)} <span className="font-normal text-[#696965]">{interval === 'ANNUAL' ? t('perYear') : t('perMonth')}</span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#E7F8EE] px-2 py-0.5 text-xs font-semibold text-[#16924A]">
            <span className="size-1.5 rounded-full bg-[#22A85A]" />
            {statusLabel(status, t)}
          </span>
        </p>
        <p className="mt-2 text-sm text-[#696965]">{pickLocalized(plan.description, locale)}</p>
      </div>
      <div className="flex flex-col justify-center gap-3 p-5 sm:p-6">
        <div className="flex items-start gap-2 text-sm">
          <Calendar className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold text-[#161616]">{t('nextRenewal', { date: formatDate(renewsAt, locale) })}</p>
            <p className="text-[#8A8A86]">{interval === 'ANNUAL' ? t('annualBilling') : t('monthlyBilling')}</p>
          </div>
        </div>
        <button type="button" className="h-11 rounded-xl bg-[#111111] text-sm font-semibold text-white" onClick={onManage}>
          {t('managePlan')}
        </button>
        <button type="button" className="h-11 rounded-xl border border-[#E6E6E2] bg-white text-sm font-semibold text-[#161616]" onClick={onCompare}>
          {t('comparePlans')}
        </button>
      </div>
    </section>
  );
}

function UsageMeter({ label, usage, limit, unlimitedLabel }: { label: string; usage: number; limit: number | null; unlimitedLabel: string }) {
  const width = limit ? Math.min(100, (usage / limit) * 100) : usage > 0 ? 100 : 0;
  return (
    <li className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 text-sm">
      <span className="font-medium text-[#161616]">{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-[#F1F1EE]">
        <span className="block h-full rounded-full bg-[#FFC400]" style={{ width: usage > 0 ? `max(${width}%, 8px)` : '0%' }} />
      </span>
      <span className="tabular-nums text-[#3A3A36]">{usage} / {limit ?? unlimitedLabel}</span>
    </li>
  );
}

function entitlement(rows: Entitlement[] | undefined, key: string) {
  return rows?.find((row) => row.key === key)?.value;
}

function limitOf(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? limit : null;
}

function featureText(key: string, value: unknown, t: (key: string) => string) {
  if (key === 'visibility') {
    if (value === 'CURRENT_STORE_ONLY' || value === 'EXCLUSIVE_STOREFRONT') return t('thisStore');
    if (value === 'ALL_STORES' || value === 'MARKETPLACE') return t('allStores');
    return t('similarStores');
  }
  if (key === 'deliveryOrdering') return value === true ? t('merchantTeam') : t('notIncluded');
  return value === true ? t('enabled') : t('notIncluded');
}

function statusLabel(status: string, t: (key: string) => string) {
  const key = status.toLowerCase().replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const known = ['active', 'pastDue', 'cancelled', 'expired', 'paid', 'pending'];
  return known.includes(key) ? t(key) : status;
}

function formatDate(value: string, locale: 'en' | 'ar') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-BH' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Bahrain',
  }).format(date);
}
