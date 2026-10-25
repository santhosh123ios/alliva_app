import { Button } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Plus, Repeat } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { QrCode } from '../qr';
import { useConsole } from '../context';
import { formatDate, formatMoney } from '../format';
import { pick, useLang, useT } from '../i18n';
import {
  AreaField, CopyButton, DateRange, FilterSelect, FormActions, Kpi, ListView, Modal, Page, QueryBoundary, SearchBox, Section, SelectField, StatusPill, TextField, Toolbar, useAction, useData, useFilters, useList, usePlans, useStaffOptions, type Column,
} from '../kit';
import type { LeadRow, MemberDetail, StoreRow } from '../types';

const MERCHANT_STATUSES = ['PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REJECTED'];

export function StoresScreen({ params }: { params: Record<string, string> }) {
  const { role } = useConsole();
  const t = useT();
  const lang = useLang();
  const filters = useFilters({ q: '', merchantStatus: '', staffId: '', from: '', to: '' });
  const query = useList<StoreRow>('stores', '/stores', filters.params);
  const staff = useStaffOptions(role !== 'STAFF');
  const [creating, setCreating] = useState(Boolean(params.leadId));
  const [reassigning, setReassigning] = useState<StoreRow | null>(null);

  const columns: Column<StoreRow>[] = [
    { key: 'name', header: t('colStore'), cell: (row) => <div><p className="font-semibold">{row.name}</p><p className="text-xs text-muted-foreground">{row.city}{row.businessType ? ` · ${row.businessType}` : ''}</p></div> },
    { key: 'status', header: t('colStatus'), cell: (row) => <StatusPill value={row.merchantStatus} /> },
    { key: 'plan', header: t('colPlan'), cell: (row) => row.planName ?? '—' },
    ...(role !== 'STAFF' ? [{ key: 'staff', header: t('colStaffMember'), cell: (row: StoreRow) => row.staffName }] : []),
    { key: 'code', header: t('colReferralCode'), cell: (row) => <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{row.referralCode}</code> },
    { key: 'registered', header: t('colRegistered'), cell: (row) => formatDate(row.registeredAt, lang) },
    { key: 'first', header: t('colFirstPayment'), cell: (row) => (row.firstPayment ? <div><p>{formatMoney(row.firstPayment, lang)}</p><p className="text-xs text-muted-foreground">{formatDate(row.firstPaymentAt, lang)}</p></div> : <span className="text-muted-foreground">{t('awaitingPayment')}</span>) },
    { key: 'commission', header: t('colCommission'), cell: (row) => (row.commissionEarned == null ? '—' : formatMoney(row.commissionEarned, lang)) },
    ...(role === 'ADMIN' ? [{ key: 'actions', header: '', cell: (row: StoreRow) => <Button size="sm" variant="ghost" onClick={() => setReassigning(row)}><Repeat className="size-4" />{t('reassign')}</Button> }] : []),
  ];

  return (
    <Page
      title={t(role === 'STAFF' ? 'storesTitleStaff' : 'storesTitle')}
      subtitle={t('storesSubtitle')}
      actions={role === 'STAFF' ? <Button variant="yellow" onClick={() => setCreating(true)}><Plus className="size-4" />{t('registerStore')}</Button> : undefined}
    >
      <Toolbar>
        <SearchBox value={filters.values.q} onChange={(q) => filters.set({ q })} />
        <FilterSelect label={t('colStatus')} value={filters.values.merchantStatus} onChange={(merchantStatus) => filters.set({ merchantStatus })} options={MERCHANT_STATUSES.map((value) => ({ value, label: t(`status.${value}` as 'status.ACTIVE') }))} />
        {role !== 'STAFF' ? <FilterSelect label={t('colStaffMember')} value={filters.values.staffId} onChange={(staffId) => filters.set({ staffId })} options={(staff.data?.items ?? []).map((row) => ({ value: row.id, label: row.fullName }))} /> : null}
        <DateRange from={filters.values.from} to={filters.values.to} onChange={filters.set} />
      </Toolbar>
      <ListView query={query} columns={columns} rowKey={(row) => row.id} onPage={filters.setPage} emptyTitle={t('noStores')} emptyBody={t(role === 'STAFF' ? 'noStoresStaff' : 'noStoresBody')} />
      {creating ? <StoreForm leadId={params.leadId} onClose={() => setCreating(false)} /> : null}
      {reassigning ? <ReassignStore row={reassigning} onClose={() => setReassigning(null)} /> : null}
    </Page>
  );
}

function ReassignStore({ row, onClose }: { row: StoreRow; onClose: () => void }) {
  const { api } = useConsole();
  const t = useT();
  const act = useAction();
  const staff = useStaffOptions();
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Modal open onClose={onClose} title={t('reassignStore')} description={t('reassignStoreHint', { name: row.name })}>
      <form onSubmit={async (event) => { event.preventDefault(); const result = await act(() => api.mk.post(`/stores/${row.id}/reassign`, { staffUserId: target, reason: reason.trim() }), 'saved'); if (result.ok) onClose(); }}>
        <div className="space-y-4">
          <SelectField label={t('colStaffMember')} value={target} onChange={setTarget} required placeholder={t('chooseStaff')} options={(staff.data?.items ?? []).filter((member) => member.id !== row.staffId && member.status === 'ACTIVE').map((member) => ({ value: member.id, label: member.fullName }))} />
          <AreaField label={t('reasonRequired')} value={reason} onChange={setReason} required maxLength={300} />
        </div>
        <FormActions onCancel={onClose} submitLabel={t('reassign')} disabled={!target || reason.trim().length < 5} />
      </form>
    </Modal>
  );
}

function StoreForm({ leadId, onClose }: { leadId?: string; onClose: () => void }) {
  const { api } = useConsole();
  const t = useT();
  const lang = useLang();
  const act = useAction();
  const plans = usePlans();
  const lead = useData<LeadRow>('lead', `/leads/${leadId}`, undefined, Boolean(leadId));
  const categories = useQuery({ queryKey: ['mk', 'categories'], queryFn: () => api.businessCategories(), staleTime: 60_000 });
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({ businessName: '', businessNameAr: '', phone: '', email: '', city: '', businessType: 'RESTAURANT', categoryId: '', planId: '', billingInterval: 'MONTHLY', promoCode: '' });
  const [prefilled, setPrefilled] = useState(false);
  if (lead.data && !prefilled) {
    setPrefilled(true);
    setForm((current) => ({ ...current, businessName: lead.data.businessName, phone: lead.data.phone, email: lead.data.email ?? '', city: lead.data.city ?? '', planId: lead.data.interestedPlanId ?? '' }));
  }
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const quote = useQuery({
    queryKey: ['mk', 'quote', form.planId, form.billingInterval, form.promoCode],
    queryFn: () => api.quoteSubscription({ planId: form.planId, billingInterval: form.billingInterval as 'MONTHLY' | 'ANNUAL', promoCode: form.promoCode.trim() || undefined }),
    enabled: Boolean(form.planId),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    const result = await act(
      () => api.mk.post('/stores', { businessName: form.businessName.trim(), businessNameAr: form.businessNameAr.trim() || undefined, phone: form.phone.trim(), email: form.email.trim(), city: form.city.trim(), businessType: form.businessType, categoryId: form.categoryId, planId: form.planId || undefined, billingInterval: form.planId ? form.billingInterval : undefined, promoCode: form.promoCode.trim() || null, leadId: leadId ?? null }),
      'created',
    );
    setPending(false);
    if (result.ok) onClose();
  }

  const q = quote.data;
  return (
    <Modal open onClose={onClose} title={t('registerStore')} description={t('registerStoreHint')} wide>
      <form onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t('colStore')} value={form.businessName} onChange={set('businessName')} required />
          <TextField label={t('fBusinessNameAr')} value={form.businessNameAr} onChange={set('businessNameAr')} dir="rtl" />
          <TextField label={t('fPhone')} type="tel" value={form.phone} onChange={set('phone')} required dir="ltr" inputMode="tel" />
          <TextField label={t('fEmail')} type="email" value={form.email} onChange={set('email')} required dir="ltr" />
          <TextField label={t('fCity')} value={form.city} onChange={set('city')} required />
          <SelectField label={t('fBusinessType')} value={form.businessType} onChange={set('businessType')} options={['RESTAURANT', 'CAFE', 'BAKERY', 'GROCERY', 'PHARMACY', 'OTHER'].map((value) => ({ value, label: t(`biz.${value}` as 'biz.OTHER') }))} />
          <SelectField label={t('fCategory')} value={form.categoryId} onChange={set('categoryId')} required placeholder={t('chooseCategory')} options={(categories.data ?? []).map((category) => ({ value: category.id, label: pick(category.name, lang) }))} />
          <SelectField label={t('colPlan')} value={form.planId} onChange={set('planId')} placeholder={t('none')} options={(plans.data ?? []).map((plan) => ({ value: plan.id, label: pick(plan.name, lang) }))} />
          {form.planId ? <SelectField label={t('fBilling')} value={form.billingInterval} onChange={set('billingInterval')} options={[{ value: 'MONTHLY', label: t('monthly') }, { value: 'ANNUAL', label: t('annual') }]} /> : null}
          {form.planId ? <TextField label={t('fPromoCode')} value={form.promoCode} onChange={(value) => set('promoCode')(value.toUpperCase())} hint={t('promoNotReferral')} dir="ltr" /> : null}
        </div>
        {q ? (
          <div className="mt-4 rounded-xl bg-muted p-3 text-sm">
            <p>{t('quotePrice')}: <strong>{formatMoney(q.gross, lang)}</strong></p>
            {q.promo ? <p className={q.promo.valid ? 'text-[#168a52]' : 'text-[#d9342b]'}>{q.promo.valid ? `${t('quoteDiscount')}: −${formatMoney(q.discount, lang)}` : q.promo.reason}</p> : null}
            <p>{t('quotePayable')}: <strong>{formatMoney(q.payable, lang)}</strong></p>
          </div>
        ) : null}
        <FormActions onCancel={onClose} submitLabel={t('registerStore')} pending={pending} disabled={!form.categoryId || Boolean(q?.promo && !q.promo.valid)} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------- referral code

export function ReferralScreen() {
  const { me, registerUrl } = useConsole();
  const t = useT();
  const lang = useLang();
  const detail = useData<MemberDetail>('me-detail', `/staff/${me?.id ?? ''}`, undefined, Boolean(me));
  const stores = useList<StoreRow>('stores', '/stores', { pageSize: 5 });
  const code = me?.referralCode;
  const link = code ? `${registerUrl}${registerUrl.includes('?') ? '&' : '?'}ref=${encodeURIComponent(code)}` : '';
  const whatsapp = code ? `https://wa.me/?text=${encodeURIComponent(`${t('shareMessage', { code })} ${link}`)}` : '';
  return (
    <Page title={t('referralTitle')} subtitle={t('referralSubtitle')}>
      {code ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title={t('yourCode')} subtitle={t('yourCodeHint')}>
            <p className="rounded-2xl bg-secondary px-5 py-6 text-center text-3xl font-semibold tracking-widest text-primary" dir="ltr">{code}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <CopyButton text={code} label={t('copyCode')} />
              <CopyButton text={link} label={t('copyLink')} />
              <Button asChild variant="outline" size="sm"><a href={whatsapp} target="_blank" rel="noreferrer noopener"><MessageCircle className="size-4" />{t('shareWhatsapp')}</a></Button>
            </div>
            <div className="mt-4 flex items-center gap-4">
              <QrCode value={link} label={t('qrLabel')} />
              <p className="min-w-0 flex-1 break-all rounded-xl bg-muted p-3 text-xs" dir="ltr">{link}</p>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{t('referralRules')}</p>
          </Section>
          <Section title={t('referralStats')}>
            <QueryBoundary query={detail}>
              {(data) => (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Kpi label={t('colStores')} value={data.stats?.referredStores ?? 0} />
                    <Kpi label={t('colLeads')} value={data.stats?.leads ?? 0} />
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-semibold">{t('codeHistory')}</p>
                    <ul className="space-y-2">
                      {data.referralCodes.map((entry) => (
                        <li key={entry.code} className="flex items-center justify-between rounded-xl bg-muted px-3 py-2 text-sm">
                          <code className="font-semibold">{entry.code}</code>
                          <span className="flex items-center gap-2 text-xs text-muted-foreground">{formatDate(entry.createdAt, lang)}<StatusPill value={entry.active ? 'ACTIVE' : 'EXPIRED'} /></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </QueryBoundary>
          </Section>
          <Section title={t('latestReferrals')} className="lg:col-span-2">
            {stores.data?.items.length ? (
              <ul className="divide-y text-sm">
                {stores.data.items.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-2"><span className="font-medium">{row.name}</span><span className="flex items-center gap-2"><StatusPill value={row.merchantStatus} />{formatDate(row.registeredAt, lang)}</span></li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">{t('noReferralsYet')}</p>}
          </Section>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('noReferralCode')}</p>
      )}
    </Page>
  );
}

