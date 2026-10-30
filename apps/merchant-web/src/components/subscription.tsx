import { api } from '@/components/providers';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { Dialog, DialogContent, DialogDescription, DialogTitle, EmptyState, ErrorState, Skeleton } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, CreditCard, FileText, Info, Megaphone, QrCode, Store, Truck, UtensilsCrossed } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

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
    autoRenew?: boolean;
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
  const client = useQueryClient();
  const seeded = useRef(false);
  const [details, setDetails] = useState<Plan | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [billing, setBilling] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY');
  const [autoRenew, setAutoRenew] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [method, setMethod] = useState<'CARD' | 'BENEFIT' | 'BANK'>('CARD');
  const [card, setCard] = useState({ name: '', number: '', expiry: '', cvv: '' });
  const [cardError, setCardError] = useState('');
  const profileQuery = useQuery({ queryKey: ['merchant', 'profile'], queryFn: () => api.profile() });
  const usageQuery = useQuery({ queryKey: ['merchant', 'subscription'], queryFn: () => api.subscription() });
  const plansQuery = useQuery({ queryKey: ['public', 'plans'], queryFn: () => api.publicPlans() });
  const invoicesQuery = useQuery({ queryKey: ['merchant', 'invoices'], queryFn: () => api.invoices() });
  const quoteQuery = useQuery({
    queryKey: ['merchant', 'subscription-quote', selectedId, billing],
    queryFn: () => api.quoteSubscription({ planId: selectedId!, billingInterval: billing }),
    enabled: Boolean(selectedId),
  });
  useEffect(() => {
    const current = (profileQuery.data as MerchantProfile | undefined)?.subscription;
    if (!current || seeded.current) return;
    seeded.current = true;
    setSelectedId(current.plan.id);
    setBilling(current.billingInterval);
    setAutoRenew(Boolean(current.autoRenew));
  }, [profileQuery.data]);
  useEffect(() => {
    if (!selectedId) return;
    const plan = ((plansQuery.data ?? []) as Plan[]).find((item) => item.id === selectedId);
    const next = planIntervals(plan);
    if (!next.includes(billing)) setBilling(next[0] ?? 'MONTHLY');
  }, [selectedId, billing, plansQuery.data]);
  const renew = useMutation({
    mutationFn: (paymentMethod?: 'CARD' | 'BENEFIT' | 'BANK') => {
      if (!selectedId) throw new Error(t('choosePlanFirst'));
      return api.renewSubscription({ planId: selectedId, billingInterval: billing, autoRenew, paymentMethod });
    },
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: ['merchant'] });
      setPayOpen(false);
      toast.success(result.scheduled ? t('scheduled') : result.renewed ? t('paid') : t('autoRenewSaved'));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const saveAuto = useMutation({
    mutationFn: (next: boolean) => api.setSubscriptionAutoRenew(next),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['merchant', 'profile'] });
    },
    onError: (error: Error, next) => {
      setAutoRenew(!next);
      toast.error(error.message);
    },
  });

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
  const choices = plans.filter((plan) => plan.status === 'ACTIVE');
  const selected = choices.find((plan) => plan.id === selectedId) ?? null;
  const allowed = planIntervals(selected);
  const activeBilling = allowed.includes(billing) ? billing : allowed[0] ?? 'MONTHLY';
  const expired = Boolean(subscription && (subscription.status !== 'ACTIVE' || new Date(subscription.currentPeriodEnd).getTime() <= Date.now()));
  const samePlan = Boolean(subscription && selected && selected.id === subscription.plan.id && activeBilling === subscription.billingInterval);
  const payable = quoteQuery.data?.payable ?? (selected ? (activeBilling === 'ANNUAL' ? selected.priceAnnual : selected.priceMonthly) : '0');
  const choosePlan = (plan: Plan) => {
    const next = planIntervals(plan);
    setSelectedId(plan.id);
    if (!next.includes(billing)) setBilling(next[0] ?? 'MONTHLY');
  };
  const startPayment = () => {
    if (!selected) {
      toast.error(t('choosePlanFirst'));
      return;
    }
    if (expired) {
      setCardError('');
      setPayOpen(true);
      return;
    }
    if (!samePlan) {
      renew.mutate(undefined);
      return;
    }
    saveAuto.mutate(autoRenew);
  };

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

      {expired && subscription ? (
        <div className="rounded-2xl border border-[#F5D0D0] bg-[#FFF6F6] px-4 py-3 text-sm text-[#7A1F1A]">
          <p className="font-semibold">{t('renewTitle')}</p>
          <p className="mt-1">{t('renewBody', { date: formatDate(subscription.currentPeriodEnd, locale) })}</p>
        </div>
      ) : null}

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
        <section ref={compareRef} className="rounded-2xl border border-[#EEEEEC] bg-white p-5 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[#161616]">{t('selectPlan')}</h2>
              <p className="mt-1 text-sm text-[#8A8A86]">{t('selectPlanHint')}</p>
            </div>
            <div className="flex rounded-full bg-[#F1F1EE] p-1">
              {(['MONTHLY', 'ANNUAL'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={!allowed.includes(option)}
                  className={`h-8 rounded-full px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${activeBilling === option ? 'bg-primary text-[#111111]' : 'text-[#6b6b66]'}`}
                  onClick={() => setBilling(option)}
                >
                  {option === 'MONTHLY' ? t('monthly') : t('yearly')}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {choices.map((plan) => {
              const picked = plan.id === selected?.id;
              const price = activeBilling === 'ANNUAL' ? plan.priceAnnual : plan.priceMonthly;
              return (
                <article key={plan.id} className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${picked ? 'border-[#111111] bg-[#FFFDF5]' : 'border-[#EEEEEC]'}`}>
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-start" onClick={() => choosePlan(plan)} aria-pressed={picked}>
                    <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#F7F7F5]">
                      <Store className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[#161616]">{pickLocalized(plan.name, locale)}</span>
                        {subscription?.plan.id === plan.id ? <span className="rounded-full bg-[#F1F1EE] px-2 py-0.5 text-[10px] font-bold text-[#696965]">{t('current')}</span> : null}
                        {picked ? <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-[#161616]">{t('selected')}</span> : null}
                      </span>
                      <span className="mt-0.5 block text-sm text-[#3A3A36]">
                        {formatMoney(price, locale)} <span className="text-[#8A8A86]">{activeBilling === 'ANNUAL' ? t('perYear') : t('perMonth')}</span>
                      </span>
                    </span>
                  </button>
                  <button type="button" className="h-9 rounded-xl border border-[#E6E6E2] bg-white px-3 text-sm font-semibold" onClick={() => setDetails(plan)}>
                    {t('viewDetails')}
                  </button>
                </article>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#F3F3F1] pt-4">
            <label className="flex max-w-xl items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-[#111111]"
                checked={autoRenew}
                onChange={(event) => {
                  const next = event.target.checked;
                  setAutoRenew(next);
                  if (subscription) saveAuto.mutate(next);
                }}
              />
              <span>
                <span className="block font-semibold text-[#161616]">{t('autoRenew')}</span>
                <span className="mt-0.5 block text-xs text-[#8A8A86]">{t('autoRenewHint')}</span>
              </span>
            </label>
            <button
              type="button"
              className="h-11 rounded-xl bg-[#111111] px-4 text-sm font-semibold text-white disabled:opacity-60"
              disabled={renew.isPending || saveAuto.isPending}
              onClick={startPayment}
            >
              {expired ? t('payNow', { amount: formatMoney(payable, locale) }) : samePlan ? t('saveAutoRenew') : t('scheduleChange')}
            </button>
          </div>
        </section>

        <section ref={billingRef} className="rounded-2xl border border-[#EEEEEC] bg-white p-5 lg:col-span-2">
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
              onClick={startPayment}
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

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="w-[min(100%-2rem,28rem)]">
          <DialogTitle>{t('payTitle')}</DialogTitle>
          <DialogDescription>{t('payBody')}</DialogDescription>
          {selected ? (
            <p className="mt-3 text-sm font-semibold text-[#161616]">
              {pickLocalized(selected.name, locale)} · {formatMoney(payable, locale)}
            </p>
          ) : null}
          <div className="mt-4 grid grid-cols-3 gap-2">
            {(['CARD', 'BENEFIT', 'BANK'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={method === option}
                className={`h-10 rounded-xl border text-xs font-semibold ${method === option ? 'border-[#111111] bg-[#FFF6CC]' : 'border-[#E6E6E2] bg-white'}`}
                onClick={() => setMethod(option)}
              >
                {t(option === 'CARD' ? 'card' : option === 'BENEFIT' ? 'benefit' : 'bank')}
              </button>
            ))}
          </div>
          {method === 'CARD' ? (
            <div className="mt-4 grid gap-2">
              <input className="h-10 rounded-xl border border-[#E6E6E2] px-3 text-sm" placeholder={t('cardName')} value={card.name} onChange={(event) => setCard({ ...card, name: event.target.value })} />
              <input className="h-10 rounded-xl border border-[#E6E6E2] px-3 text-sm" inputMode="numeric" placeholder={t('cardNumber')} value={card.number} onChange={(event) => setCard({ ...card, number: event.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <input className="h-10 rounded-xl border border-[#E6E6E2] px-3 text-sm" placeholder={t('expiry')} value={card.expiry} onChange={(event) => setCard({ ...card, expiry: event.target.value })} />
                <input className="h-10 rounded-xl border border-[#E6E6E2] px-3 text-sm" inputMode="numeric" placeholder={t('cvv')} value={card.cvv} onChange={(event) => setCard({ ...card, cvv: event.target.value })} />
              </div>
            </div>
          ) : null}
          {cardError ? <p className="mt-2 text-sm text-[#B42318]">{cardError}</p> : null}
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 size-4 accent-[#111111]" checked={autoRenew} onChange={(event) => setAutoRenew(event.target.checked)} />
            <span>
              <span className="font-semibold">{t('autoRenew')}</span>
              <span className="mt-0.5 block text-xs text-[#8A8A86]">{t('autoRenewHint')}</span>
            </span>
          </label>
          <button
            type="button"
            className="mt-5 h-11 w-full rounded-xl bg-[#111111] text-sm font-semibold text-white disabled:opacity-60"
            disabled={renew.isPending}
            onClick={() => {
              if (method === 'CARD' && (card.name.trim().length < 2 || card.number.replace(/\D/g, '').length < 12 || card.expiry.replace(/\D/g, '').length < 4 || card.cvv.replace(/\D/g, '').length < 3)) {
                setCardError(t('cardInvalid'));
                return;
              }
              setCardError('');
              renew.mutate(method);
            }}
          >
            {t('confirmPay')}
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
  const ended = status !== 'ACTIVE' || new Date(renewsAt).getTime() <= Date.now();
  const dateLabel = formatDate(renewsAt, locale);
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
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${ended ? 'bg-[#FDECEC] text-[#B42318]' : 'bg-[#E7F8EE] text-[#16924A]'}`}>
            <span className={`size-1.5 rounded-full ${ended ? 'bg-[#D92D20]' : 'bg-[#22A85A]'}`} />
            {statusLabel(ended && status === 'ACTIVE' ? 'EXPIRED' : status, t)}
          </span>
        </p>
        <p className="mt-2 text-sm text-[#696965]">{pickLocalized(plan.description, locale)}</p>
      </div>
      <div className="flex flex-col justify-center gap-3 p-5 sm:p-6">
        <div className="flex items-start gap-2 text-sm">
          <Calendar className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold text-[#161616]">{ended ? t('expiredOn', { date: dateLabel }) : t('nextRenewal', { date: dateLabel })}</p>
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

function planIntervals(plan: Plan | null | undefined) {
  const value = plan?.entitlements.find((row) => row.key === 'billingIntervals')?.value;
  const choices = Array.isArray(value) ? value.filter((item): item is 'MONTHLY' | 'ANNUAL' => item === 'MONTHLY' || item === 'ANNUAL') : [];
  return choices.length ? choices : (['MONTHLY'] as ('MONTHLY' | 'ANNUAL')[]);
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
