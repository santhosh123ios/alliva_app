import { Button } from '@alliva/ui';
import { Pencil, Plus, Power } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useConsole } from '../context';
import { formatDate, formatMoney, formatNumber, toDateInput } from '../format';
import { pick, useLang, useT, type MessageKey } from '../i18n';
import {
  CheckField, ConfirmDialog, DataTable, Drawer, FilterSelect, FormActions, ListView, Modal, Page, QueryBoundary, SearchBox, Section, SelectField, StatusPill, TextField, Toolbar, useAction, useData, useFilters, useList, usePlans, type Column, type Paged,
} from '../kit';
import type { PromoRow, PromoUsageRow } from '../types';

type Performance = { id: string; code: string; campaign: string | null; source: string | null; reserved: number; applied: number; voided: number; discount: string };
type Assignable = { id: string; name: string; kind: 'HEAD' | 'STAFF'; headUserId: string | null; status: string };

export function PromosScreen() {
  const { api } = useConsole();
  const t = useT();
  const lang = useLang();
  const act = useAction();
  const filters = useFilters({ q: '', status: '', source: '' });
  const query = useList<PromoRow>('promos', '/promos', filters.params);
  const performance = useData<Performance[]>('promo-performance', '/promos/performance');
  const [editing, setEditing] = useState<PromoRow | 'new' | null>(null);
  const [usage, setUsage] = useState<PromoRow | null>(null);
  const [toggling, setToggling] = useState<PromoRow | null>(null);

  const columns: Column<PromoRow>[] = [
    { key: 'code', header: t('colPromo'), cell: (row) => <div><code className="font-semibold">{row.code}</code><p className="text-xs text-muted-foreground">{row.campaignName}</p></div> },
    { key: 'discount', header: t('colDiscount'), cell: (row) => (row.discountType === 'PERCENTAGE' ? `${Number(row.discountValue)}%${row.maxDiscount ? ` (≤ ${formatMoney(row.maxDiscount, lang)})` : ''}` : formatMoney(row.discountValue, lang)) },
    { key: 'valid', header: t('colValidity'), cell: (row) => <span className="text-xs">{formatDate(row.startsAt, lang)} – {formatDate(row.endsAt, lang)}</span> },
    { key: 'uses', header: t('colUses'), cell: (row) => `${formatNumber(row.uses, lang)}${row.usageLimit ? ` / ${formatNumber(row.usageLimit, lang)}` : ''}` },
    { key: 'given', header: t('colDiscountGiven'), cell: (row) => formatMoney(row.discountGiven, lang) },
    { key: 'assignee', header: t('colAssignedTo'), cell: (row) => row.assignedUser?.name ?? row.assignedHead?.name ?? '—' },
    { key: 'status', header: t('colStatus'), cell: (row) => <StatusPill value={row.status} /> },
    {
      key: 'actions',
      header: '',
      cell: (row) => (
        <div className="flex justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
          <Button size="sm" variant="outline" onClick={() => setEditing(row)}><Pencil className="size-4" />{t('edit')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setToggling(row)}><Power className="size-4" />{t(row.active ? 'deactivate' : 'activate')}</Button>
        </div>
      ),
    },
  ];

  return (
    <Page title={t('promosTitle')} subtitle={t('promosSubtitle')} actions={<Button variant="yellow" onClick={() => setEditing('new')}><Plus className="size-4" />{t('createPromo')}</Button>}>
      <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">{t('promoVsReferral')}</p>
      {performance.data?.length ? (
        <Section title={t('promoPerformance')} subtitle={t('promoPerformanceHint')}>
          <DataTable
            rows={performance.data}
            rowKey={(row) => row.id}
            columns={[
              { key: 'c', header: t('colPromo'), cell: (row: Performance) => <code className="font-semibold">{row.code}</code> },
              { key: 'camp', header: t('fCampaign'), cell: (row: Performance) => row.campaign ?? '—' },
              { key: 'src', header: t('fSource'), cell: (row: Performance) => row.source ?? '—' },
              { key: 'ap', header: t('promoApplied'), cell: (row: Performance) => formatNumber(row.applied, lang) },
              { key: 're', header: t('promoReserved'), cell: (row: Performance) => formatNumber(row.reserved, lang) },
              { key: 'vo', header: t('promoVoided'), cell: (row: Performance) => formatNumber(row.voided, lang) },
              { key: 'di', header: t('colDiscountGiven'), cell: (row: Performance) => formatMoney(row.discount, lang) },
            ]}
          />
        </Section>
      ) : null}
      <Toolbar>
        <SearchBox value={filters.values.q} onChange={(q) => filters.set({ q })} />
        <FilterSelect label={t('colStatus')} value={filters.values.status} onChange={(status) => filters.set({ status })} options={['ACTIVE', 'INACTIVE', 'EXPIRED'].map((value) => ({ value, label: t(`status.${value}` as MessageKey) }))} />
      </Toolbar>
      <ListView query={query} columns={columns} rowKey={(row) => row.id} onPage={filters.setPage} onRowClick={setUsage} emptyTitle={t('noPromos')} emptyBody={t('noPromosBody')} />
      {editing ? <PromoForm promo={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {usage ? <UsageDrawer promo={usage} onClose={() => setUsage(null)} /> : null}
      <ConfirmDialog
        open={Boolean(toggling)}
        onClose={() => setToggling(null)}
        title={t(toggling?.active ? 'deactivate' : 'activate')}
        body={t(toggling?.active ? 'deactivatePromoBody' : 'activatePromoBody', { code: toggling?.code ?? '' })}
        confirmLabel={t(toggling?.active ? 'deactivate' : 'activate')}
        destructive={toggling?.active}
        onConfirm={async () => (await act(() => api.mk.post(`/promos/${toggling?.id}/active`, { active: !toggling?.active }), 'saved')).ok}
      />
    </Page>
  );
}

function PromoForm({ promo, onClose }: { promo: PromoRow | null; onClose: () => void }) {
  const { api } = useConsole();
  const t = useT();
  const lang = useLang();
  const act = useAction();
  const plans = usePlans();
  const assignable = useData<Assignable[]>('promo-assignable', '/promos/assignable');
  const [pending, setPending] = useState(false);
  const today = toDateInput(new Date().toISOString());
  const [form, setForm] = useState({
    code: promo?.code ?? '',
    campaignName: promo?.campaignName ?? '',
    descriptionEn: promo?.description.en ?? '',
    descriptionAr: promo?.description.ar ?? '',
    discountType: promo?.discountType ?? 'PERCENTAGE',
    discountValue: promo?.discountValue ?? '',
    maxDiscount: promo?.maxDiscount ?? '',
    minimumAmount: promo?.minimumAmount ?? '',
    planIds: promo?.planIds ?? ([] as string[]),
    startsAt: promo ? toDateInput(promo.startsAt) : today,
    endsAt: promo ? toDateInput(promo.endsAt) : '',
    usageLimit: promo?.usageLimit ? String(promo.usageLimit) : '',
    perMerchantLimit: promo?.perMerchantLimit ? String(promo.perMerchantLimit) : '',
    firstTimeMerchantOnly: promo?.firstTimeMerchantOnly ?? false,
    campaignSource: promo?.campaignSource ?? '',
    assignedUserId: promo?.assignedUser?.id ?? '',
    active: promo?.active ?? true,
  });
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const text = (key: 'code' | 'campaignName' | 'descriptionEn' | 'descriptionAr' | 'discountValue' | 'maxDiscount' | 'minimumAmount' | 'startsAt' | 'endsAt' | 'usageLimit' | 'perMerchantLimit' | 'campaignSource' | 'assignedUserId' | 'discountType') => set(key) as (value: string) => void;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    const body = {
      code: form.code.trim().toUpperCase(),
      campaignName: form.campaignName.trim(),
      descriptionEn: form.descriptionEn.trim(),
      descriptionAr: form.descriptionAr.trim(),
      discountType: form.discountType,
      discountValue: form.discountValue.trim(),
      maxDiscount: form.discountType === 'PERCENTAGE' && form.maxDiscount.trim() ? form.maxDiscount.trim() : null,
      minimumAmount: form.minimumAmount.trim() || null,
      planIds: form.planIds.length ? form.planIds : null,
      startsAt: form.startsAt,
      endsAt: form.endsAt,
      usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
      perMerchantLimit: form.perMerchantLimit ? Number(form.perMerchantLimit) : null,
      firstTimeMerchantOnly: form.firstTimeMerchantOnly,
      campaignSource: form.campaignSource.trim() || null,
      assignedUserId: form.assignedUserId || null,
      assignedHeadUserId: null,
      active: form.active,
    };
    const result = await act(() => (promo ? api.mk.patch(`/promos/${promo.id}`, body) : api.mk.post('/promos', body)), promo ? 'saved' : 'created');
    setPending(false);
    if (result.ok) onClose();
  }

  const togglePlan = (id: string) => set('planIds')(form.planIds.includes(id) ? form.planIds.filter((value) => value !== id) : [...form.planIds, id]);
  return (
    <Modal open onClose={onClose} title={promo ? t('editPromo') : t('createPromo')} description={t('promoFormHint')} wide>
      <form onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t('fPromoCode')} value={form.code} onChange={(value) => set('code')(value.toUpperCase())} required dir="ltr" maxLength={32} />
          <TextField label={t('fCampaign')} value={form.campaignName} onChange={text('campaignName')} required />
          <TextField label={t('fDescriptionEn')} value={form.descriptionEn} onChange={text('descriptionEn')} />
          <TextField label={t('fDescriptionAr')} value={form.descriptionAr} onChange={text('descriptionAr')} dir="rtl" />
          <SelectField label={t('fDiscountType')} value={form.discountType} onChange={text('discountType')} options={[{ value: 'PERCENTAGE', label: t('discountPercentage') }, { value: 'FIXED', label: t('discountFixed') }]} />
          <TextField label={t('fDiscountValue')} value={form.discountValue} onChange={text('discountValue')} inputMode="decimal" required dir="ltr" hint={form.discountType === 'PERCENTAGE' ? t('fDiscountPercentHint') : 'BHD'} />
          {form.discountType === 'PERCENTAGE' ? <TextField label={t('fMaxDiscount')} value={form.maxDiscount} onChange={text('maxDiscount')} inputMode="decimal" dir="ltr" hint="BHD" /> : null}
          <TextField label={t('fMinimumAmount')} value={form.minimumAmount} onChange={text('minimumAmount')} inputMode="decimal" dir="ltr" hint="BHD" />
          <TextField label={t('fStartsAt')} type="date" value={form.startsAt} onChange={text('startsAt')} required />
          <TextField label={t('fEndsAt')} type="date" value={form.endsAt} onChange={text('endsAt')} required />
          <TextField label={t('fUsageLimit')} value={form.usageLimit} onChange={text('usageLimit')} inputMode="numeric" dir="ltr" hint={t('fUnlimitedHint')} />
          <TextField label={t('fPerMerchantLimit')} value={form.perMerchantLimit} onChange={text('perMerchantLimit')} inputMode="numeric" dir="ltr" hint={t('fUnlimitedHint')} />
          <TextField label={t('fSource')} value={form.campaignSource} onChange={text('campaignSource')} placeholder="Instagram, field visit…" />
          <SelectField label={t('fAssignedTo')} value={form.assignedUserId} onChange={text('assignedUserId')} placeholder={t('unassigned')} options={(assignable.data ?? []).filter((row) => row.status === 'ACTIVE').map((row) => ({ value: row.id, label: `${row.name} · ${t(row.kind === 'HEAD' ? 'roleHead' : 'roleStaff')}` }))} hint={t('fAssignedHint')} />
        </div>
        <fieldset className="mt-4">
          <legend className="mb-2 text-sm font-medium">{t('fPlans')}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {(plans.data ?? []).map((plan) => <CheckField key={plan.id} label={pick(plan.name, lang)} checked={form.planIds.includes(plan.id)} onChange={() => togglePlan(plan.id)} />)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t('fPlansHint')}</p>
        </fieldset>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          <CheckField label={t('fFirstTimeOnly')} checked={form.firstTimeMerchantOnly} onChange={set('firstTimeMerchantOnly')} />
          <CheckField label={t('fActive')} checked={form.active} onChange={set('active')} />
        </div>
        <FormActions onCancel={onClose} submitLabel={promo ? t('save') : t('create')} pending={pending} />
      </form>
    </Modal>
  );
}

function UsageDrawer({ promo, onClose }: { promo: PromoRow; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const query = useData<Paged<PromoUsageRow>>('promo-usage', `/promos/${promo.id}/usage`, { pageSize: 50 });
  return (
    <Drawer open onClose={onClose} title={promo.code} subtitle={promo.campaignName}>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-muted p-3"><p className="text-xs text-muted-foreground">{t('colUses')}</p><p className="text-lg font-semibold">{formatNumber(promo.uses, lang)}</p></div>
        <div className="rounded-xl bg-muted p-3"><p className="text-xs text-muted-foreground">{t('colDiscountGiven')}</p><p className="text-lg font-semibold">{formatMoney(promo.discountGiven, lang)}</p></div>
      </div>
      <Section title={t('promoUsage')}>
        <QueryBoundary query={query}>
          {(data) => (
            <DataTable
              rows={data.items}
              rowKey={(row) => row.id}
              emptyTitle={t('noPromoUsage')}
              emptyBody={t('noPromoUsageBody')}
              columns={[
                { key: 'm', header: t('colStore'), cell: (row: PromoUsageRow) => row.merchantName },
                { key: 's', header: t('colStatus'), cell: (row: PromoUsageRow) => <StatusPill value={row.status} /> },
                { key: 'd', header: t('colDiscount'), cell: (row: PromoUsageRow) => formatMoney(row.discountAmount, lang) },
                { key: 'a', header: t('colDate'), cell: (row: PromoUsageRow) => formatDate(row.appliedAt ?? row.createdAt, lang) },
              ]}
            />
          )}
        </QueryBoundary>
      </Section>
    </Drawer>
  );
}

