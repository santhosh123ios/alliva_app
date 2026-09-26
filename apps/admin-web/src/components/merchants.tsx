'use client';

import { api } from '@/components/providers';
import { pickLocalized } from '@alliva/design-tokens';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Label, Sheet, SheetContent } from '@alliva/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Cake,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coffee,
  Flower2,
  Laptop,
  LayoutGrid,
  Leaf,
  List,
  MoreHorizontal,
  Plus,
  Salad,
  Search,
  ShoppingCart,
  Store,
  Upload,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';

export type MerchantRow = {
  id: string;
  slug: string;
  name: { en: string; ar: string };
  status: string;
  phone?: string;
  email?: string;
  websiteUrl?: string | null;
  city?: string;
  plan?: string | null;
  planName?: { en: string; ar: string } | null;
  categories?: { en: string; ar: string }[];
  businessType?: string;
  logoUrl?: string | null;
  createdAt?: string;
};

type Tab = 'all' | 'pending' | 'suspended';
type Layout = 'list' | 'grid';
type Action = 'approve' | 'suspend';

const pageSizes = [6, 12, 24];

const marks: { test: RegExp; icon: LucideIcon; bg: string; fg: string }[] = [
  { test: /kitchen|restaurant|grill/i, icon: UtensilsCrossed, bg: 'bg-[#111111]', fg: 'text-primary' },
  { test: /groc|market/i, icon: Leaf, bg: 'bg-[#E8F6EE]', fg: 'text-[#1B8A4A]' },
  { test: /caf[eé]|coffee/i, icon: Coffee, bg: 'bg-[#F6E7D8]', fg: 'text-[#8B5E34]' },
  { test: /conven|mart|retail/i, icon: ShoppingCart, bg: 'bg-[#FFF1D6]', fg: 'text-[#E07A12]' },
  { test: /flower|bloom/i, icon: Flower2, bg: 'bg-[#FDE8F2]', fg: 'text-[#D23B84]' },
  { test: /electron|tech|computer/i, icon: Laptop, bg: 'bg-[#E7F0FF]', fg: 'text-[#2F6BFF]' },
  { test: /sweet|dessert/i, icon: Cake, bg: 'bg-[#FDE8F2]', fg: 'text-[#D23B84]' },
  { test: /healthy|bowl|salad/i, icon: Salad, bg: 'bg-[#E8F6EE]', fg: 'text-[#1B8A4A]' },
];

export function Merchants({ rows }: { rows: MerchantRow[] }) {
  const t = useTranslations('directory');
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [plan, setPlan] = useState('all');
  const [layout, setLayout] = useState<Layout>('list');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [selected, setSelected] = useState<string[]>([]);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ id: string; action: Action } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const directory = useMemo(() => {
    const order = [...rows].sort((a, b) => (a.createdAt ?? a.slug).localeCompare(b.createdAt ?? b.slug));
    const codes = new Map(order.map((row, index) => [row.id, `MER-${String(index + 1).padStart(2, '0')}`]));
    return rows.map((row) => ({ ...row, code: codes.get(row.id) ?? row.slug.toUpperCase() }));
  }, [rows]);

  const counts = {
    all: directory.length,
    active: directory.filter((row) => row.status === 'ACTIVE').length,
    pending: directory.filter((row) => row.status === 'PENDING_APPROVAL').length,
    suspended: directory.filter((row) => row.status === 'SUSPENDED').length,
  };
  const types = [...new Set(directory.map((row) => row.businessType).filter(Boolean))] as string[];
  const plans = [...new Set(directory.map((row) => planLabel(row, locale, t('noPlan'))))];

  const filtered = directory.filter((row) => {
    if (tab === 'pending' && row.status !== 'PENDING_APPROVAL') return false;
    if (tab === 'suspended' && row.status !== 'SUSPENDED') return false;
    if (type !== 'all' && row.businessType !== type) return false;
    if (plan !== 'all' && planLabel(row, locale, t('noPlan')) !== plan) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [pickLocalized(row.name, locale), row.code, row.slug, row.phone ?? '', row.email ?? ''].join(' ').toLowerCase().includes(needle);
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const from = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, filtered.length);
  const allSelected = pageRows.length > 0 && pageRows.every((row) => selected.includes(row.id));
  const openRow = directory.find((row) => row.id === openId) ?? null;

  useEffect(() => {
    setPage(1);
  }, [tab, query, type, plan, pageSize]);

  useEffect(() => {
    if (!menuId) return;
    const close = () => setMenuId(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuId]);

  function toggleAll() {
    const ids = pageRows.map((row) => row.id);
    setSelected((current) => (allSelected ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]));
  }

  function toggleOne(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function exportCsv() {
    const source = selected.length ? directory.filter((row) => selected.includes(row.id)) : filtered;
    const header = ['code', 'name', 'type', 'location', 'plan', 'status', 'phone', 'joined'];
    const lines = source.map((row) =>
      [row.code, pickLocalized(row.name, locale), row.businessType ?? '', row.city ?? '', planLabel(row, locale, t('noPlan')), row.status, row.phone ?? '', row.createdAt ?? ''].map(csv).join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'alliva-merchants.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function runConfirm() {
    if (!confirm) return;
    setPending(true);
    setError('');
    try {
      if (confirm.action === 'approve') await api.approveMerchant(confirm.id);
      else await api.suspendMerchant(confirm.id);
      await client.invalidateQueries({ queryKey: ['admin'] });
      setConfirm(null);
      setMenuId(null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-tight md:text-5xl">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-11 rounded-xl bg-card px-4" onClick={exportCsv}>
            <Upload className="size-4" /> {t('export')}
          </Button>
          <Button variant="yellow" className="h-11 rounded-xl px-4" onClick={() => { setError(''); setCreateOpen(true); }}>
            <Plus className="size-4" /> {t('addMerchant')}
          </Button>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-y-6 md:grid-cols-4">
        <Stat label={t('total')} value={counts.all} />
        <Stat label={t('active')} value={counts.active} divided />
        <Stat label={t('pendingApproval')} value={counts.pending} divided />
        <Stat label={t('suspended')} value={counts.suspended} divided />
      </div>

      {counts.pending > 0 ? (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl bg-[#FFF6D4] px-4 py-3">
          <Clock className="size-4" />
          <p className="text-sm font-semibold">{t('waiting', { count: counts.pending })}</p>
          <button type="button" className="ms-auto text-sm font-semibold" onClick={() => setTab('pending')}>
            {t('reviewApplications')} →
          </button>
        </div>
      ) : null}
      {error && !confirm && !createOpen ? <p className="mt-3 text-sm text-[#D9342B]">{error}</p> : null}

      <div className="mt-6 flex gap-6 border-b">
        <TabButton active={tab === 'all'} count={counts.all} onClick={() => setTab('all')}>{t('allMerchants')}</TabButton>
        <TabButton active={tab === 'pending'} count={counts.pending} onClick={() => setTab('pending')}>{t('pendingApproval')}</TabButton>
        <TabButton active={tab === 'suspended'} count={counts.suspended} onClick={() => setTab('suspended')}>{t('suspended')}</TabButton>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('search')}
            className="h-11 w-full rounded-xl border bg-card ps-9 pe-3 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <select value={type} onChange={(event) => setType(event.target.value)} className="h-11 rounded-xl border bg-card px-3 text-sm font-medium" aria-label={t('allTypes')}>
          <option value="all">{t('allTypes')}</option>
          {types.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={plan} onChange={(event) => setPlan(event.target.value)} className="h-11 rounded-xl border bg-card px-3 text-sm font-medium" aria-label={t('allPlans')}>
          <option value="all">{t('allPlans')}</option>
          {plans.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <div className="ms-auto flex items-center gap-2">
          <IconToggle active={layout === 'list'} label={t('listView')} onClick={() => setLayout('list')} icon={List} />
          <IconToggle active={layout === 'grid'} label={t('gridView')} onClick={() => setLayout('grid')} icon={LayoutGrid} />
        </div>
      </div>

      {layout === 'list' ? (
        <div className="mt-4 overflow-hidden rounded-2xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b text-start text-muted-foreground">
                  <th className="w-12 px-4 py-3">
                    <input type="checkbox" className="size-4 accent-[#111111]" checked={allSelected} onChange={toggleAll} aria-label={t('selectAll')} />
                  </th>
                  <th className="px-3 py-3 text-start font-medium">{t('business')}</th>
                  <th className="px-3 py-3 text-start font-medium">{t('businessType')}</th>
                  <th className="px-3 py-3 text-start font-medium">{t('location')}</th>
                  <th className="px-3 py-3 text-start font-medium">{t('plan')}</th>
                  <th className="px-3 py-3 text-start font-medium">{t('status')}</th>
                  <th className="px-3 py-3 text-start font-medium">{t('joined')}</th>
                  <th className="px-4 py-3 text-end font-medium">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length ? pageRows.map((row, index) => (
                  <MerchantLine
                    key={row.id}
                    row={row}
                    index={index}
                    locale={locale}
                    selected={selected.includes(row.id)}
                    menuOpen={menuId === row.id}
                    onToggle={() => toggleOne(row.id)}
                    onOpen={() => setOpenId(row.id)}
                    onMenu={(event) => { event.stopPropagation(); setMenuId((current) => (current === row.id ? null : row.id)); }}
                    onAction={(action) => { setMenuId(null); setError(''); setConfirm({ id: row.id, action }); }}
                  />
                )) : (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">{t('empty')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {pageRows.length ? pageRows.map((row, index) => (
            <article key={row.id} className="rounded-2xl border bg-card p-4">
              <div className="flex items-start gap-3">
                <Mark type={row.businessType ?? ''} logoUrl={row.logoUrl} index={index} />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{pickLocalized(row.name, locale)}</p>
                  <p className="text-xs text-muted-foreground">{row.code}</p>
                </div>
                <StatusBadge status={row.status} className="ms-auto" />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <Meta label={t('businessType')} value={row.businessType || '—'} />
                <Meta label={t('location')} value={row.city || '—'} />
                <Meta label={t('plan')} value={planLabel(row, locale, t('noPlan'))} />
                <Meta label={t('joined')} value={joinedLabel(row.createdAt, locale)} />
              </dl>
              <Button variant={row.status === 'PENDING_APPROVAL' ? 'yellow' : 'outline'} className="mt-4 h-10 w-full rounded-xl" onClick={() => setOpenId(row.id)}>
                {row.status === 'PENDING_APPROVAL' ? t('review') : `${t('view')} →`}
              </Button>
            </article>
          )) : <p className="text-sm text-muted-foreground">{t('empty')}</p>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <p>{t('showing', { from, to, total: filtered.length })}</p>
        <div className="ms-auto flex items-center gap-2">
          <select
            value={pageSize}
            onChange={(event) => setPageSize(Number(event.target.value))}
            className="h-9 rounded-lg border bg-card px-2 text-sm font-medium text-foreground"
            aria-label={t('perPage', { count: pageSize })}
          >
            {pageSizes.map((size) => <option key={size} value={size}>{t('perPage', { count: size })}</option>)}
          </select>
          <Pager page={safePage} pageCount={pageCount} onPage={setPage} previousLabel={t('previous')} nextLabel={t('next')} pageLabel={(value) => t('page', { page: value })} />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t('footnote')}</p>

      <Sheet open={Boolean(openRow)} onOpenChange={(open) => { if (!open) setOpenId(null); }}>
        <SheetContent className="start-auto end-0 w-[min(100%,26rem)] p-6">
          {openRow ? (
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground">{t('profile')}</p>
              <div className="mt-4 flex items-center gap-3">
                <Mark type={openRow.businessType ?? ''} logoUrl={openRow.logoUrl} index={0} />
                <div>
                  <h2 className="font-display text-2xl">{pickLocalized(openRow.name, locale)}</h2>
                  <p className="text-sm text-muted-foreground">{openRow.code}</p>
                </div>
              </div>
              <div className="mt-4"><StatusBadge status={openRow.status} /></div>
              <dl className="mt-6 space-y-3 text-sm">
                <ProfileRow label={t('businessType')} value={openRow.businessType || '—'} />
                <ProfileRow label={t('location')} value={openRow.city || '—'} />
                <ProfileRow label={t('plan')} value={planLabel(openRow, locale, t('noPlan'))} />
                <ProfileRow label={t('phone')} value={openRow.phone || '—'} />
                <ProfileRow label={t('email')} value={openRow.email || '—'} />
                <ProfileRow label={t('website')} value={openRow.websiteUrl || '—'} />
                <ProfileRow label={t('joined')} value={joinedLabel(openRow.createdAt, locale)} />
                <ProfileRow label={t('category')} value={(openRow.categories ?? []).map((item) => pickLocalized(item, locale)).filter(Boolean).join(', ') || '—'} />
              </dl>
              <div className="mt-6 flex gap-2">
                {openRow.status !== 'ACTIVE' ? (
                  <Button variant="yellow" className="h-11 rounded-xl" onClick={() => { setError(''); setConfirm({ id: openRow.id, action: 'approve' }); }}>{t('approve')}</Button>
                ) : null}
                {openRow.status !== 'SUSPENDED' ? (
                  <Button variant="outline" className="h-11 rounded-xl" onClick={() => { setError(''); setConfirm({ id: openRow.id, action: 'suspend' }); }}>{t('suspend')}</Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog open={Boolean(confirm)} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <DialogContent>
          <DialogTitle>{confirm?.action === 'suspend' ? t('suspendTitle') : t('approveTitle')}</DialogTitle>
          <DialogDescription>{confirm?.action === 'suspend' ? t('suspendBody') : t('approveBody')}</DialogDescription>
          {error ? <p className="mt-3 text-sm text-[#D9342B]">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>{t('cancel')}</Button>
            <Button variant={confirm?.action === 'suspend' ? 'destructive' : 'yellow'} disabled={pending} onClick={runConfirm}>
              {confirm?.action === 'suspend' ? t('suspend') : t('approve')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CreateMerchantDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function MerchantLine({
  row, index, locale, selected, menuOpen, onToggle, onOpen, onMenu, onAction,
}: {
  row: MerchantRow & { code: string };
  index: number;
  locale: 'en' | 'ar';
  selected: boolean;
  menuOpen: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onMenu: (event: MouseEvent) => void;
  onAction: (action: Action) => void;
}) {
  const t = useTranslations('directory');
  const name = pickLocalized(row.name, locale);
  const reviewing = row.status === 'PENDING_APPROVAL';
  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-3">
        <input type="checkbox" className="size-4 accent-[#111111]" checked={selected} onChange={onToggle} aria-label={t('selectMerchant', { name })} />
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-3">
          <Mark type={row.businessType ?? ''} logoUrl={row.logoUrl} index={index} />
          <div>
            <p className="font-semibold">{name}</p>
            <p className="text-xs text-muted-foreground">{row.code}</p>
          </div>
        </div>
      </td>
      <td className="px-3 py-3">{row.businessType || '—'}</td>
      <td className="px-3 py-3">{row.city || '—'}</td>
      <td className="px-3 py-3">{planLabel(row, locale, t('noPlan'))}</td>
      <td className="px-3 py-3"><StatusBadge status={row.status} /></td>
      <td className="px-3 py-3 whitespace-nowrap">{joinedLabel(row.createdAt, locale)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onOpen}
            className={`h-9 rounded-xl px-3 text-sm font-semibold ${reviewing ? 'bg-primary text-[#111111]' : 'border bg-card'}`}
          >
            {reviewing ? t('review') : `${t('view')} →`}
          </button>
          <div className="relative">
            <button type="button" className="grid size-9 place-items-center rounded-xl border bg-card" aria-label={t('more', { name })} aria-expanded={menuOpen} onClick={onMenu}>
              <MoreHorizontal className="size-4" />
            </button>
            {menuOpen ? (
              <div className="absolute end-0 z-20 mt-1 w-36 rounded-xl border bg-card p-1 shadow-lg" onClick={(event) => event.stopPropagation()}>
                {row.status !== 'ACTIVE' ? <MenuItem onClick={() => onAction('approve')}>{t('approve')}</MenuItem> : null}
                {row.status !== 'SUSPENDED' ? <MenuItem onClick={() => onAction('suspend')}>{t('suspend')}</MenuItem> : null}
                <MenuItem onClick={onOpen}>{t('view')}</MenuItem>
              </div>
            ) : null}
          </div>
        </div>
      </td>
    </tr>
  );
}

function CreateMerchantDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('directory');
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const categories = useQuery({ queryKey: ['business-categories'], queryFn: () => api.businessCategories(), enabled: open });
  const plans = useQuery({ queryKey: ['admin', 'plans'], queryFn: () => api.plans(), enabled: open, retry: false });
  const [form, setForm] = useState(emptyMerchant);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    setError('');
    try {
      const amount = Number(form.minimumOrder);
      await api.createMerchant({
        name: { en: form.nameEn.trim(), ar: form.nameAr.trim() || form.nameEn.trim() },
        description: { en: form.descriptionEn.trim() || form.nameEn.trim(), ar: form.descriptionAr.trim() || form.nameAr.trim() || form.nameEn.trim() },
        businessType: form.businessType.trim(),
        categoryIds: [form.categoryId],
        phone: form.phone.trim(),
        email: form.email.trim(),
        minimumOrder: Number.isFinite(amount) ? amount.toFixed(3) : form.minimumOrder,
        preparationMinutes: Number(form.preparationMinutes),
        delivery: form.delivery,
        takeaway: form.takeaway,
        dineIn: form.dineIn,
        ...(form.planId ? { planId: form.planId, billingInterval: 'MONTHLY' } : {}),
      });
      await client.invalidateQueries({ queryKey: ['admin'] });
      setForm(emptyMerchant);
      onOpenChange(false);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[min(100%-2rem,40rem)] overflow-y-auto">
        <DialogTitle>{t('addMerchant')}</DialogTitle>
        <DialogDescription>{t('subtitle')}</DialogDescription>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={t('nameEn')} value={form.nameEn} onChange={(value) => setForm({ ...form, nameEn: value })} />
          <Field label={t('nameAr')} value={form.nameAr} onChange={(value) => setForm({ ...form, nameAr: value })} />
          <Field label={t('descriptionEn')} value={form.descriptionEn} onChange={(value) => setForm({ ...form, descriptionEn: value })} />
          <Field label={t('descriptionAr')} value={form.descriptionAr} onChange={(value) => setForm({ ...form, descriptionAr: value })} />
          <Field label={t('businessType')} value={form.businessType} onChange={(value) => setForm({ ...form, businessType: value })} />
          <div>
            <Label>{t('category')}</Label>
            <select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })} className="mt-2 h-12 w-full rounded-xl border bg-card px-3 text-sm">
              <option value="">{t('category')}</option>
              {(categories.data ?? []).map((category) => (
                <option key={category.id} value={category.id}>{pickLocalized(category.name, locale) || category.slug}</option>
              ))}
            </select>
          </div>
          <Field label={t('phone')} value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
          <Field label={t('email')} value={form.email} onChange={(value) => setForm({ ...form, email: value })} />
          <Field label={t('minimumOrder')} value={form.minimumOrder} onChange={(value) => setForm({ ...form, minimumOrder: value })} />
          <Field label={t('prep')} value={form.preparationMinutes} onChange={(value) => setForm({ ...form, preparationMinutes: value })} />
          <div>
            <Label>{t('plan')}</Label>
            <select value={form.planId} onChange={(event) => setForm({ ...form, planId: event.target.value })} className="mt-2 h-12 w-full rounded-xl border bg-card px-3 text-sm">
              <option value="">{t('noPlan')}</option>
              {(plans.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>{pickLocalized(item.name, locale)}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-end gap-4 pb-2 text-sm font-medium">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.delivery} onChange={(event) => setForm({ ...form, delivery: event.target.checked })} />{t('delivery')}</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.takeaway} onChange={(event) => setForm({ ...form, takeaway: event.target.checked })} />{t('takeaway')}</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.dineIn} onChange={(event) => setForm({ ...form, dineIn: event.target.checked })} />{t('dineIn')}</label>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-[#D9342B]">{error}</p> : null}
        <Button variant="yellow" className="mt-4 h-11 rounded-xl" disabled={pending || !form.categoryId} onClick={save}>{t('save')}</Button>
      </DialogContent>
    </Dialog>
  );
}

const emptyMerchant = {
  nameEn: '',
  nameAr: '',
  descriptionEn: '',
  descriptionAr: '',
  businessType: '',
  categoryId: '',
  phone: '',
  email: '',
  minimumOrder: '2.000',
  preparationMinutes: '20',
  delivery: true,
  takeaway: true,
  dineIn: false,
  planId: '',
};

function Stat({ label, value, divided = false }: { label: string; value: number; divided?: boolean }) {
  return (
    <div className={divided ? 'md:border-s md:ps-8' : ''}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-4xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function TabButton({ active, count, onClick, children }: { active: boolean; count: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`-mb-px inline-flex items-center gap-2 border-b-2 pb-3 text-sm font-semibold ${active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}>
      {children}
      <span className="rounded-full bg-[#F1F1EE] px-2 py-0.5 text-xs">{count}</span>
    </button>
  );
}

function IconToggle({ active, label, onClick, icon: Icon }: { active: boolean; label: string; onClick: () => void; icon: LucideIcon }) {
  return (
    <button type="button" aria-label={label} aria-pressed={active} onClick={onClick} className={`grid size-11 place-items-center rounded-xl ${active ? 'bg-primary text-[#111111]' : 'border bg-card'}`}>
      <Icon className="size-4" />
    </button>
  );
}

function Mark({ type, logoUrl, index }: { type: string; logoUrl?: string | null; index: number }) {
  if (logoUrl) return <img src={logoUrl} alt="" className="size-10 rounded-xl object-cover" />;
  const found = marks.find((mark) => mark.test.test(type));
  const fallback = [
    { icon: Store, bg: 'bg-[#111111]', fg: 'text-primary' },
    { icon: Store, bg: 'bg-[#E8F6EE]', fg: 'text-[#1B8A4A]' },
    { icon: Store, bg: 'bg-[#F6E7D8]', fg: 'text-[#8B5E34]' },
  ][index % 3]!;
  const mark = found ?? fallback;
  const Icon = mark.icon;
  return (
    <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${mark.bg} ${mark.fg}`}>
      <Icon className="size-4" />
    </span>
  );
}

function StatusBadge({ status, className = '' }: { status: string; className?: string }) {
  const t = useTranslations('directory');
  const style = status === 'ACTIVE'
    ? { dot: 'bg-[#1B8A4A]', chip: 'bg-[#E8F6EE] text-[#1B8A4A]', label: t('active') }
    : status === 'PENDING_APPROVAL'
      ? { dot: 'bg-[#E0A100]', chip: 'bg-[#FFF4D6] text-[#A16207]', label: t('pending') }
      : status === 'SUSPENDED'
        ? { dot: 'bg-[#8A8A84]', chip: 'bg-[#F1F1EE] text-[#5C5C57]', label: t('suspended') }
        : status === 'REJECTED'
          ? { dot: 'bg-[#D9342B]', chip: 'bg-[#FDECEC] text-[#D9342B]', label: t('rejected') }
          : { dot: 'bg-[#8A8A84]', chip: 'bg-[#F1F1EE] text-[#5C5C57]', label: t('draft') };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${style.chip} ${className}`}>
      <span className={`size-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

function Pager({ page, pageCount, onPage, previousLabel, nextLabel, pageLabel }: { page: number; pageCount: number; onPage: (page: number) => void; previousLabel: string; nextLabel: string; pageLabel: (page: number) => string }) {
  const items = pageItems(page, pageCount);
  return (
    <div className="flex items-center gap-1">
      <button type="button" className="grid size-9 place-items-center rounded-lg border bg-card disabled:opacity-40" aria-label={previousLabel} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft className="size-4 rtl:-scale-x-100" />
      </button>
      {items.map((item, index) => item === '…' ? (
        <span key={`gap-${index}`} className="px-1 text-muted-foreground">…</span>
      ) : (
        <button key={item} type="button" aria-label={pageLabel(item)} aria-current={item === page ? 'page' : undefined} onClick={() => onPage(item)} className={`grid size-9 place-items-center rounded-lg text-sm font-semibold ${item === page ? 'bg-primary text-[#111111]' : 'hover:bg-muted'}`}>
          {item}
        </button>
      ))}
      <button type="button" className="grid size-9 place-items-center rounded-lg border bg-card disabled:opacity-40" aria-label={nextLabel} disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
        <ChevronRight className="size-4 rtl:-scale-x-100" />
      </button>
    </div>
  );
}

function pageItems(page: number, total: number): (number | '…')[] {
  if (total <= 5) return Array.from({ length: total }, (_, index) => index + 1);
  const points = [...new Set([1, total, page - 1, page, page + 1].filter((value) => value >= 1 && value <= total))].sort((a, b) => a - b);
  const items: (number | '…')[] = [];
  points.forEach((value, index) => {
    if (index > 0 && value - points[index - 1]! > 1) items.push('…');
    items.push(value);
  });
  return items;
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b pb-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-semibold">{value}</dd>
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className="block w-full rounded-lg px-3 py-2 text-start text-sm font-semibold hover:bg-muted" onClick={onClick}>{children}</button>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input className="mt-2 h-12" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function planLabel(row: MerchantRow, locale: 'en' | 'ar', empty: string) {
  return row.planName ? pickLocalized(row.planName, locale) || empty : empty;
}

function joinedLabel(value: string | undefined, locale: 'en' | 'ar') {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-BH' : 'en-GB', {
    timeZone: 'Asia/Bahrain',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function csv(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
