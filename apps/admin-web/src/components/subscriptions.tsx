'use client';

import { PlanDialog } from '@/components/plan-wizard';
import { formFromPlan, toEntitlements } from '@/components/plan-form';
import { api } from '@/components/providers';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import type { LocalizedText, SubscriptionBoard, SubscriptionPlanView } from '@alliva/types';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, EmptyState, Input, Skeleton } from '@alliva/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, MoreHorizontal, ShoppingBag, ShoppingCart, Store, Tag, Upload, UtensilsCrossed } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

type Plan = SubscriptionBoard['plans'][number];
type SubscriptionRow = SubscriptionBoard['subscriptions'][number];
type StatusFilter = 'ALL' | 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
type RenewalFilter = 'ALL' | '7' | '30';
export function Subscriptions({ board }: { board: SubscriptionBoard }) {
  const t = useTranslations('plans');
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const [tab, setTab] = useState<'plans' | 'merchants'>('plans');
  const [planQuery, setPlanQuery] = useState('');
  const [planStatus, setPlanStatus] = useState<StatusFilter>('ALL');
  const [merchantQuery, setMerchantQuery] = useState('');
  const [merchantPlan, setMerchantPlan] = useState('ALL');
  const [merchantStatus, setMerchantStatus] = useState('ALL');
  const [renewal, setRenewal] = useState<RenewalFilter>('ALL');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Plan | null>(null);
  const [archivePlan, setArchivePlan] = useState<Plan | null>(null);
  const [assignRow, setAssignRow] = useState<SubscriptionRow | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const plans = useMemo(() => {
    const query = planQuery.trim().toLowerCase();
    return [...board.plans]
      .sort((a, b) => a.displayOrder - b.displayOrder || a.name.en.localeCompare(b.name.en))
      .filter((plan) => (planStatus === 'ALL' ? true : plan.status === planStatus))
      .filter((plan) => !query || `${plan.code} ${plan.name.en} ${plan.name.ar}`.toLowerCase().includes(query));
  }, [board.plans, planQuery, planStatus]);
  const rows = useMemo(() => {
    const query = merchantQuery.trim().toLowerCase();
    const horizon = renewal === 'ALL' ? null : Date.now() + Number(renewal) * 86_400_000;
    return board.subscriptions.filter((row) => {
      if (merchantPlan !== 'ALL' && row.planId !== merchantPlan) return false;
      if (merchantStatus !== 'ALL' && row.status !== merchantStatus) return false;
      if (horizon && !(row.status === 'ACTIVE' && new Date(row.currentPeriodEnd).getTime() <= horizon)) return false;
      return !query || `${pickLocalized(row.merchantName, locale)} ${pickLocalized(row.planName, locale)}`.toLowerCase().includes(query);
    });
  }, [board.subscriptions, locale, merchantPlan, merchantQuery, merchantStatus, renewal]);

  function refresh() {
    return client.invalidateQueries({ queryKey: ['admin', 'subscriptions'] });
  }

  async function run(action: () => Promise<unknown>) {
    setError('');
    setNotice('');
    try {
      await action();
      await refresh();
      setNotice(t('saved'));
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-6rem)] flex-col md:h-[calc(100dvh-7rem)]">
      <div className="shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex h-11 items-center rounded-xl border bg-card p-1" role="tablist">
          <TabButton active={tab === 'plans'} count={board.plans.length} onClick={() => setTab('plans')}>{t('plans')}</TabButton>
          <TabButton active={tab === 'merchants'} count={board.subscriptions.length} onClick={() => setTab('merchants')}>{t('merchantSubscriptions')}</TabButton>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tab === 'plans' ? (
            <>
              <Input value={planQuery} onChange={(event) => setPlanQuery(event.target.value)} placeholder={t('searchPlans')} aria-label={t('searchPlans')} className="h-11 w-52" />
              <select aria-label={t('status')} className="h-11 rounded-xl border bg-card px-3 text-sm font-semibold" value={planStatus} onChange={(event) => setPlanStatus(event.target.value as StatusFilter)}>
                <option value="ALL">{t('allStatuses')}</option>
                <option value="DRAFT">{t('draft')}</option>
                <option value="ACTIVE">{t('published')}</option>
                <option value="ARCHIVED">{t('archived')}</option>
              </select>
            </>
          ) : null}
          <Button variant="outline" className="h-11 rounded-xl bg-card px-4" onClick={() => exportCsv(board, locale)}>
            <Upload className="size-4" /> {t('export')}
          </Button>
          <Button variant="yellow" className="h-11 rounded-xl px-4" onClick={() => { setError(''); setCreating(true); }}>
            <span className="text-lg leading-none">+</span> {t('createPlan')}
          </Button>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-[#D9342B]" role="alert">{error}</p> : null}
      {notice ? <p className="mt-3 text-sm font-semibold text-[#168A52]">{notice}</p> : null}
      {tab === 'merchants' ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <Input value={merchantQuery} onChange={(event) => setMerchantQuery(event.target.value)} placeholder={t('searchMerchants')} aria-label={t('searchMerchants')} className="max-w-xs" />
          <Filter value={merchantPlan} onChange={setMerchantPlan} label={t('plans')} options={[['ALL', t('allPlans')], ...board.plans.map((plan) => [plan.id, pickLocalized(plan.name, locale)] as [string, string])]} />
          <Filter value={merchantStatus} onChange={setMerchantStatus} label={t('status')} options={[['ALL', t('allStatuses')], ...['ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED'].map((status) => [status, status] as [string, string])]} />
          <Filter value={renewal} onChange={(value) => setRenewal(value as RenewalFilter)} label={t('renews')} options={[['ALL', t('allStatuses')], ['7', t('next7')], ['30', t('next30')]]} />
        </div>
      ) : null}
      </div>

      {tab === 'plans' ? (
        <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
          {plans.length ? (
            <div className="grid gap-4 pb-2 sm:grid-cols-2 xl:grid-cols-3">
              {plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  locale={locale}
                  menuOpen={menuId === plan.id}
                  onMenu={() => setMenuId(menuId === plan.id ? null : plan.id)}
                  onView={() => { setMenuId(null); setViewing(plan); }}
                  onEdit={() => { setMenuId(null); setEditing(plan); }}
                  onDuplicate={() => run(() => api.duplicatePlan(plan.id))}
                  onStatus={(status) => run(() => api.updatePlan(plan.id, { ...planPayload(plan, { status }), entitlements: toEntitlements(formFromPlan(plan), plan.entitlements) }))}
                  onArchive={() => { setMenuId(null); setArchivePlan(plan); }}
                  onMove={(direction) => {
                    const ids = board.plans.slice().sort((a, b) => a.displayOrder - b.displayOrder).map((item) => item.id);
                    const at = ids.indexOf(plan.id);
                    const next = at + direction;
                    if (next < 0 || next >= ids.length) return;
                    const swap = ids[at]!;
                    ids[at] = ids[next]!;
                    ids[next] = swap;
                    return run(() => api.reorderPlans(ids));
                  }}
                />
              ))}
            </div>
          ) : <div className="mt-4"><EmptyState title={board.plans.length ? t('noMatch') : t('noPlans')} body={t('subtitle')} /></div>}
        </div>
      ) : (
        <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
          {rows.length ? (
            <div className="overflow-x-auto rounded-3xl border bg-card">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="text-xs tracking-[0.12em] text-muted-foreground">
                    <th className="px-5 py-3 text-start font-semibold">{t('merchant')}</th>
                    <th className="px-3 py-3 text-start font-semibold">{t('plans')}</th>
                    <th className="px-3 py-3 text-start font-semibold">{t('starts')}</th>
                    <th className="px-3 py-3 text-start font-semibold">{t('renews')}</th>
                    <th className="px-3 py-3 text-start font-semibold">{t('status')}</th>
                    <th className="px-3 py-3 text-start font-semibold">{t('usage')}</th>
                    <th className="px-5 py-3 text-start font-semibold">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t align-top">
                      <td className="px-5 py-3 font-semibold">{pickLocalized(row.merchantName, locale)}</td>
                      <td className="px-3 py-3">
                        {pickLocalized(row.planName, locale)}
                        {row.pendingPlanName && row.pendingEffectiveAt ? <p className="mt-1 text-xs text-muted-foreground">{t('scheduled', { plan: pickLocalized(row.pendingPlanName, locale), date: formatDate(row.pendingEffectiveAt, locale) })}</p> : null}
                      </td>
                      <td className="px-3 py-3">{formatDate(row.currentPeriodStart, locale)}</td>
                      <td className="px-3 py-3">{formatDate(row.currentPeriodEnd, locale)}</td>
                      <td className="px-3 py-3"><StatusPill status={row.status} label={row.status === 'ACTIVE' ? t('active') : row.status} /></td>
                      <td className="px-3 py-3">{row.usage.map((item) => <p key={item.key} className="text-xs">{usageLabel(item, t)}</p>)}</td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" className="h-9 rounded-xl px-3" onClick={() => setAssignRow(row)}>{t('changePlan')}</Button>
                          <Button variant="outline" className="h-9 rounded-xl px-3" onClick={() => setHistoryId(row.merchantId)}>{t('history')}</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="mt-4"><EmptyState title={t('noMatch')} body={t('noSubscriptions')} /></div>}
        </div>
      )}

      <PlanDialog
        open={creating || Boolean(editing)}
        plan={editing}
        order={board.plans.length}
        onOpenChange={(open) => { if (!open) { setCreating(false); setEditing(null); } }}
        onSaved={async () => { await refresh(); setNotice(t('saved')); }}
      />
      <Dialog open={Boolean(viewing)} onOpenChange={(open) => { if (!open) setViewing(null); }}>
        <DialogContent>
          <DialogTitle>{viewing ? pickLocalized(viewing.name, locale) : ''}</DialogTitle>
          <DialogDescription>{viewing ? pickLocalized(viewing.description, locale) : ''}</DialogDescription>
          {viewing ? <p className="mt-4 text-sm">{formatMoney(viewing.priceMonthly, locale)} {t('perMonth')} · {statusLabel(viewing.status, t)} · {t('merchants', { count: viewing.merchantCount })}</p> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(archivePlan)} onOpenChange={(open) => { if (!open) setArchivePlan(null); }}>
        <DialogContent>
          <DialogTitle>{t('archiveTitle')}</DialogTitle>
          <DialogDescription>{t('archiveBody')}</DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setArchivePlan(null)}>{t('cancel')}</Button>
            <Button variant="yellow" onClick={() => archivePlan && run(() => api.updatePlan(archivePlan.id, { ...planPayload(archivePlan, { status: 'ARCHIVED' }), entitlements: toEntitlements(formFromPlan(archivePlan), archivePlan.entitlements) })).then(() => setArchivePlan(null))}>{t('archive')}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <AssignDialog row={assignRow} plans={board.plans.filter((plan) => plan.status === 'ACTIVE')} onOpenChange={(open) => { if (!open) setAssignRow(null); }} onSaved={refresh} />
      <HistoryDialog merchantId={historyId} onOpenChange={(open) => { if (!open) setHistoryId(null); }} />
    </div>
  );
}

function PlanCard({ plan, locale, menuOpen, onMenu, onView, onEdit, onDuplicate, onStatus, onArchive, onMove }: {
  plan: Plan;
  locale: 'en' | 'ar';
  menuOpen: boolean;
  onMenu: () => void;
  onView: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onStatus: (status: 'DRAFT' | 'ACTIVE') => void;
  onArchive: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const t = useTranslations('plans');
  const rows = featureRows(plan, t);
  return (
    <article className={`relative rounded-3xl bg-card p-5 ${plan.recommended ? 'border-2 border-primary' : 'border'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-2xl">{pickLocalized(plan.name, locale)}</h3>
          <p className="text-xs text-muted-foreground">{plan.code} · {t('displayOrder')} {plan.displayOrder}</p>
        </div>
        <StatusPill status={plan.status} label={statusLabel(plan.status, t)} />
      </div>
      <p className="mt-3 text-lg font-semibold">{formatMoney(plan.priceMonthly, locale)} <span className="text-sm font-medium text-muted-foreground">{t('perMonth')}</span></p>
      <p className="mt-1 text-sm text-muted-foreground">{t('merchants', { count: plan.merchantCount })}</p>
      <div className="mt-4 space-y-3 border-t pt-4">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3 text-sm">
            <row.icon className="size-4 text-muted-foreground" />
            <span>{row.label}</span>
            <span className="ms-auto font-semibold">{row.value}</span>
          </div>
        ))}
      </div>
      <div className="mt-5 flex gap-2">
        <Button variant={plan.recommended ? 'yellow' : 'outline'} className="h-11 flex-1 rounded-xl" onClick={onEdit}>{t('editPlan')}</Button>
        <Button variant="outline" className="h-11 rounded-xl px-3" aria-expanded={menuOpen} aria-label={t('actions')} onClick={onMenu}><MoreHorizontal className="size-4" /></Button>
      </div>
      {menuOpen ? (
        <div className="absolute bottom-16 end-5 z-10 grid min-w-40 rounded-xl border bg-card p-1 text-sm font-semibold shadow-lg">
          <button type="button" className="rounded-lg px-3 py-2 text-start hover:bg-muted" onClick={onView}>{t('view')}</button>
          <button type="button" className="rounded-lg px-3 py-2 text-start hover:bg-muted" onClick={onDuplicate}>{t('duplicate')}</button>
          <button type="button" className="rounded-lg px-3 py-2 text-start hover:bg-muted" onClick={() => onMove(-1)}>{t('moveUp')}</button>
          <button type="button" className="rounded-lg px-3 py-2 text-start hover:bg-muted" onClick={() => onMove(1)}>{t('moveDown')}</button>
          {plan.status === 'ACTIVE' ? <button type="button" className="rounded-lg px-3 py-2 text-start hover:bg-muted" onClick={() => onStatus('DRAFT')}>{t('unpublish')}</button> : null}
          {plan.status !== 'ACTIVE' ? <button type="button" className="rounded-lg px-3 py-2 text-start hover:bg-muted" onClick={() => onStatus('ACTIVE')}>{t('publish')}</button> : null}
          {plan.status !== 'ARCHIVED' ? <button type="button" className="rounded-lg px-3 py-2 text-start hover:bg-muted" onClick={onArchive}>{t('archive')}</button> : null}
        </div>
      ) : null}
    </article>
  );
}

function AssignDialog({ row, plans, onOpenChange, onSaved }: { row: SubscriptionRow | null; plans: Plan[]; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void> }) {
  const t = useTranslations('plans');
  const [planId, setPlanId] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const selected = planId || plans[0]?.id || '';
  async function save() {
    if (!row || !selected) return;
    setPending(true);
    setError('');
    try {
      await api.assignPlan(row.merchantId, { planId: selected, billingInterval: 'MONTHLY' });
      await onSaved();
      onOpenChange(false);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog open={Boolean(row)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t('changeTitle')}</DialogTitle>
        <DialogDescription>{t('changeBody')}</DialogDescription>
        <div className="mt-4 grid gap-3">
          <SelectField label={t('plans')} value={selected} onChange={setPlanId} options={plans.map((plan) => [plan.id, plan.name.en])} />
          {error ? <p className="text-sm text-[#D9342B]">{error}</p> : null}
          <Button variant="yellow" disabled={pending || !selected} onClick={() => void save()}>{t('confirm')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ merchantId, onOpenChange }: { merchantId: string | null; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('plans');
  const locale = useLocale() as 'en' | 'ar';
  const history = useQuery({
    queryKey: ['admin', 'subscription-history', merchantId],
    queryFn: () => api.subscriptionHistory(merchantId!),
    enabled: Boolean(merchantId),
  });
  const rows = (history.data ?? []) as { id: string; fromPlan: LocalizedText | null; toPlan: LocalizedText; effectiveAt: string; appliedAt: string | null }[];
  return (
    <Dialog open={Boolean(merchantId)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t('history')}</DialogTitle>
        <DialogDescription>{t('subtitle')}</DialogDescription>
        {history.isLoading ? (
          <ul className="mt-4 space-y-3" aria-busy>
            {Array.from({ length: 3 }, (_, index) => (
              <li key={index} className="space-y-2 rounded-xl border px-3 py-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </li>
            ))}
          </ul>
        ) : null}
        {history.error ? <p className="mt-4 text-sm text-[#D9342B]">{(history.error as Error).message}</p> : null}
        {rows.length ? (
          <ul className="mt-4 space-y-3 text-sm">
            {rows.map((row) => (
              <li key={row.id} className="rounded-xl border px-3 py-2">
                <p className="font-semibold">{row.fromPlan ? pickLocalized(row.fromPlan, locale) : '—'} → {pickLocalized(row.toPlan, locale)}</p>
                <p className="text-muted-foreground">{formatDate(row.effectiveAt, locale)}{row.appliedAt ? '' : ` · ${t('renews')}`}</p>
              </li>
            ))}
          </ul>
        ) : history.data ? <p className="mt-4 text-sm text-muted-foreground">{t('noSubscriptions')}</p> : null}
      </DialogContent>
    </Dialog>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return (
    <label className="grid gap-1 text-sm font-semibold">
      {label}
      <select className="h-12 rounded-xl border bg-card px-3 text-sm" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
      </select>
    </label>
  );
}

function Filter({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: [string, string][] }) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
      {label}
      <select className="h-12 rounded-xl border bg-card px-3 text-sm font-semibold text-foreground" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
      </select>
    </label>
  );
}

function TabButton({ active, count, onClick, children }: { active: boolean; count: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${active ? 'bg-primary text-[#111111]' : 'text-muted-foreground hover:text-foreground'}`}
    >
      {children}
      <span className={`rounded-full px-2 py-0.5 text-xs ${active ? 'bg-[#111111]/10' : 'bg-[#F1F1EE]'}`}>{count}</span>
    </button>
  );
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const tone = status === 'ACTIVE' ? 'bg-[#E7F6EE] text-[#168A52]' : status === 'ARCHIVED' || status === 'EXPIRED' || status === 'CANCELLED' ? 'bg-muted text-muted-foreground' : 'bg-[#FFF4CC] text-[#8A6A00]';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{label}</span>;
}

function featureRows(plan: SubscriptionPlanView, t: ReturnType<typeof useTranslations<'plans'>>) {
  const value = (key: string) => plan.entitlements.find((row) => row.key === key)?.value;
  const visibility = String(value('visibility') ?? '');
  const visibilityLabel = visibility === 'CURRENT_STORE_ONLY' || visibility === 'EXCLUSIVE_STOREFRONT' ? t('currentStore') : visibility === 'EXCLUDE_SAME_BUSINESS_TYPE' ? t('excludeType') : t('allStores');
  return [
    { icon: Store, label: t('storefront'), value: visibilityLabel },
    { icon: ShoppingBag, label: t('products'), value: limitText(value('productLimit'), t) },
    { icon: ShoppingCart, label: t('orders'), value: limitText(value('monthlyOrderLimit'), t) },
    { icon: Tag, label: t('highlightedOffers'), value: value('offerHighlighting') ? t('on') : t('off') },
    { icon: CreditCard, label: t('onlinePayments'), value: value('paymentIntegration') ? t('on') : t('off') },
    { icon: UtensilsCrossed, label: t('tableOrdering'), value: value('tableOrdering') ? limitText(value('tableCountLimit'), t) : t('off') },
  ];
}

function limitText(value: unknown, t: ReturnType<typeof useTranslations<'plans'>>) {
  if (value === null || value === undefined || value === '') return t('unlimited');
  return String(value);
}

function usageLabel(item: { key: string; used: number; limit: number | null }, t: ReturnType<typeof useTranslations<'plans'>>) {
  const name = item.key.replace('Limit', '').replace('monthlyOrder', 'orders');
  return `${name} ${item.used} / ${item.limit ?? t('unlimited')}`;
}

function statusLabel(status: string, t: ReturnType<typeof useTranslations<'plans'>>) {
  if (status === 'ACTIVE') return t('published');
  if (status === 'DRAFT') return t('draft');
  if (status === 'ARCHIVED') return t('archived');
  return status;
}

function planPayload(plan: Plan, extra: { status?: string } = {}) {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description,
    priceMonthly: plan.priceMonthly,
    priceAnnual: plan.priceAnnual,
    status: extra.status ?? plan.status,
    displayOrder: plan.displayOrder,
    recommended: plan.recommended,
    entitlements: plan.entitlements,
  };
}

function formatDate(iso: string, locale: 'en' | 'ar') {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-BH' : 'en-GB', { timeZone: 'Asia/Bahrain', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

function exportCsv(board: SubscriptionBoard, locale: 'en' | 'ar') {
  const header = ['merchant', 'plan', 'billing', 'amount', 'renews', 'status'];
  const lines = board.subscriptions.map((row) => [pickLocalized(row.merchantName, locale), pickLocalized(row.planName, locale), row.billingInterval, row.amount, row.currentPeriodEnd, row.status].map(csv).join(','));
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'alliva-subscriptions.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function csv(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
