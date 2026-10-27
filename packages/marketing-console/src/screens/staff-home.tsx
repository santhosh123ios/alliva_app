import { Button } from '@alliva/ui';
import { CalendarClock, ChevronRight, ClipboardList, Clock, Coffee, CreditCard, Croissant, Dumbbell, Fish, Leaf, PenLine, Phone, Plus, Store, Ticket, Users, Utensils, Wallet, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { QrCode } from '../qr';
import { useConsole } from '../context';
import { TIME_ZONE, formatDate, formatMoney, formatNumber, fromLocalInput } from '../format';
import { useLang, useT, type MessageKey, type Translate } from '../i18n';
import { AreaField, CopyButton, SelectField, TextField, leadStatusChoices, useAction, useData, useList } from '../kit';
import { STAFF_LEAD_STATUSES, type ActivityRow, type AppointmentRow, type LeadRow, type StoreRow, type Wallet as WalletBalance } from '../types';
import { StoreForm } from './stores';

const CARD = 'rounded-2xl border border-[#E9E7DF] bg-white shadow-[0_1px_2px_rgba(23,23,18,0.04)]';
const ACTION_BUTTON = 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E9E7DF] bg-white px-3 text-xs font-semibold text-[#171712] transition hover:border-[#d9d6ca] hover:bg-[#faf9f5]';
const TONES = ['bg-[#fff6d4] text-[#8a6a00]', 'bg-[#e7f6ee] text-[#147d54]', 'bg-[#fff1e6] text-[#c46a1a]', 'bg-[#e8efff] text-[#2f62c9]'];

const PROGRESS: Record<string, { label: MessageKey; className: string }> = {
  NEW: { label: 'status.NEW', className: 'bg-[#f3f1ea] text-[#5c5a52]' },
  CONTACTED: { label: 'status.CONTACTED', className: 'bg-[#fff4cc] text-[#8a6a00]' },
  INTERESTED: { label: 'status.INTERESTED', className: 'bg-[#e8efff] text-[#2f62c9]' },
  NOT_INTERESTED: { label: 'status.NOT_INTERESTED', className: 'bg-[#fdecea] text-[#c13f35]' },
  PAYMENT_PENDING: { label: 'progressPaymentPending', className: 'bg-[#fff1e6] text-[#c46a1a]' },
  SUBSCRIBED: { label: 'progressSubscribed', className: 'bg-[#e7f6ee] text-[#147d54]' },
};

type PipelineRow = {
  key: string;
  name: string;
  place: string;
  phone: string | null;
  plan: string | null;
  progress: string;
  category: string | null;
  followUpAt: string | null;
  onView: () => void;
};

export function StaffHome() {
  const { me, navigate, registerUrl } = useConsole();
  const t = useT();
  const lang = useLang();
  const dash = useData<{ kpis: Record<string, string | number> }>('dashboard', '/dashboard');
  const wallet = useData<WalletBalance>('wallet', '/wallet');
  const followUpCount = useList<AppointmentRow>('staff-active-followups', '/appointments', { kind: 'FOLLOW_UP', status: 'SCHEDULED', pageSize: 1 });
  const today = useList<AppointmentRow>('staff-today', '/appointments', { bucket: 'today', pageSize: 8 });
  const upcoming = useList<AppointmentRow>('staff-upcoming', '/appointments', { bucket: 'upcoming', pageSize: 50 });
  const leads = useList<LeadRow>('staff-lead-options', '/leads', { pageSize: 100 });
  const stores = useList<StoreRow>('staff-recent-stores', '/stores', { pageSize: 5 });
  const activity = useList<ActivityRow>('staff-activity', '/activity', { pageSize: 6 });
  const [creating, setCreating] = useState(false);
  const [focus, setFocus] = useState<{ row: AppointmentRow; tick: number } | null>(null);

  const code = me?.referralCode ?? '';
  const link = code ? `${registerUrl}${registerUrl.includes('?') ? '&' : '?'}ref=${encodeURIComponent(code)}` : '';
  const promo = me?.connectedPromo ?? null;
  const promoValue = promo
    ? promo.discountType === 'PERCENTAGE'
      ? `${formatNumber(promo.discountValue, lang, Number(promo.discountValue) % 1 ? 1 : 0)}%`
      : formatMoney(promo.discountValue, lang)
    : '';
  const nextByLead = new Map<string, string>();
  const nextByStore = new Map<string, string>();
  for (const row of upcoming.data?.items ?? []) {
    if (row.leadId && !nextByLead.has(row.leadId)) nextByLead.set(row.leadId, row.scheduledAt);
    if (row.merchantId && !nextByStore.has(row.merchantId)) nextByStore.set(row.merchantId, row.scheduledAt);
  }

  const recent: PipelineRow[] = [
    ...(leads.data?.items ?? []).map((row) => ({
      at: row.updatedAt,
      row: {
        key: `lead-${row.id}`,
        name: row.businessName,
        place: [row.area, row.city].filter(Boolean).join(', '),
        phone: row.phone,
        plan: row.interestedPlanName,
        progress: row.status,
        category: row.category,
        followUpAt: row.nextFollowUpAt ?? nextByLead.get(row.id) ?? null,
        onView: () => navigate('leads', { lead: row.id }),
      },
    })),
    ...(stores.data?.items ?? []).map((row) => ({
      at: row.registeredAt,
      row: {
        key: `store-${row.id}`,
        name: row.name,
        place: row.city,
        phone: row.phone,
        plan: row.planName,
        progress: row.firstPayment || row.subscriptionStatus === 'ACTIVE' ? 'SUBSCRIBED' : row.planName || row.subscriptionStatus || row.merchantStatus === 'PENDING_APPROVAL' ? 'PAYMENT_PENDING' : row.merchantStatus,
        category: row.businessType,
        followUpAt: nextByStore.get(row.id) ?? null,
        onView: () => navigate('stores', { q: row.name }),
      },
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5)
    .map((item) => item.row);

  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const greeting = hour < 12 ? 'greetingMorning' : hour < 17 ? 'greetingAfternoon' : 'greetingEvening';
  const count = (value: string | number | undefined, loading: boolean) => (loading || value === undefined ? '—' : formatNumber(value, lang));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[1.75rem] leading-tight md:text-3xl">{t(greeting, { name: me?.firstName || me?.fullName || '' })}</h1>
          <p className="mt-1 text-sm text-[#74746c]">{t('staffDashSubtitle')}</p>
        </div>
        <Button variant="yellow" className="h-11 px-5" onClick={() => setCreating(true)}><Plus className="size-4" />{t('addNewStore')}</Button>
      </div>

      <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Store} label={t('kpiMyStores')} value={count(dash.data?.kpis.referredStores, dash.isLoading)} onClick={() => navigate('stores')} />
        <Stat icon={ClipboardList} label={t('kpiActiveFollowUps')} value={count(followUpCount.data?.total, followUpCount.isLoading)} onClick={() => navigate('appointments', { bucket: 'upcoming' })} />
        <Stat icon={CreditCard} label={t('kpiFirstPayments')} value={count(dash.data?.kpis.payingStores, dash.isLoading)} onClick={() => navigate('stores')} />
        <Stat
          icon={Wallet}
          label={t('kpiWalletBalance')}
          value={wallet.data ? formatMoney(wallet.data.available, lang) : '—'}
          note={t('walletCommissionNote')}
          onClick={() => navigate('wallet')}
        />
      </div>

      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.9fr)]">
        <div className="min-w-0 space-y-5">
          <section className={CARD}>
            <PanelHead icon={Users} title={t('referralCardTitle')} subtitle={t('referralCardHint')} action={<TextLink onClick={() => navigate('wallet')}>{t('viewAll')}</TextLink>} />
            {code ? (
              <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 pb-5 xl:gap-0 ${promo ? 'xl:grid-cols-[minmax(300px,1.55fr)_minmax(175px,1fr)_112px]' : 'xl:grid-cols-[minmax(300px,1fr)_112px]'}`}>
                <div className={`flex h-[78px] min-w-0 items-center justify-between gap-3 rounded-xl bg-gradient-to-r from-[#fffbed] to-[#fff3ba] px-5 ${promo ? 'col-span-2 xl:col-span-1' : ''}`}>
                  <p className="truncate text-[2rem] font-extrabold leading-none tracking-[0.04em]" dir="ltr">{code}</p>
                  <CopyButton text={code} label={t('copyCode')} variant="yellow" className="h-9 shrink-0 rounded-lg px-5" />
                </div>
                {promo ? (
                  <div className="flex min-w-0 items-center gap-3 px-1 xl:h-[78px] xl:border-x xl:border-[#E9E7DF] xl:px-5">
                    <Ticket className="size-5 shrink-0 text-[#6f706b]" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-[#74746c]">{t('connectedPromo')}</p>
                      <p className="truncate text-base font-bold" dir="ltr">{promo.code}</p>
                      <p className="text-xs text-[#74746c]">{t(promo.firstTimeMerchantOnly ? 'promoOffFirst' : 'promoOff', { value: promoValue })}</p>
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-col items-center justify-center text-center xl:ps-4">
                  <QrCode value={link} size={68} label={t('qrLabel')} framed={false} />
                  <p className="mt-1.5 text-[11px] text-[#74746c]">{t('scanToShare')}</p>
                </div>
              </div>
            ) : (
              <Empty>{t('noReferralCode')}</Empty>
            )}
          </section>

          <section className={CARD}>
            <PanelHead icon={CalendarClock} title={t('todaysFollowUps')} action={<TextLink onClick={() => navigate('appointments', { bucket: 'today' })}>{t('viewAll')}</TextLink>} />
            {today.data?.items.length ? (
              <ul className="divide-y divide-[#f0eee7] border-t border-[#f0eee7]">
                {today.data.items.map((row) => (
                  <FollowUpRow key={row.id} row={row} onAdd={() => setFocus((current) => ({ row, tick: (current?.tick ?? 0) + 1 }))} />
                ))}
              </ul>
            ) : (
              <Empty>{today.isLoading ? t('loading') : t('noFollowUpsToday')}</Empty>
            )}
          </section>

          <section className={`${CARD} min-w-0 overflow-hidden`}>
            <PanelHead icon={Store} title={t('recentStores')} action={<TextLink onClick={() => navigate('stores')}>{t('viewAll')}</TextLink>} />
            {recent.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead>
                    <tr className="border-y border-[#f0eee7] bg-[#faf9f5] text-start text-xs text-[#74746c]">
                      <th className="px-5 py-3 text-start font-semibold">{t('colStore')}</th>
                      <th className="px-3 py-3 text-start font-semibold">{t('contact')}</th>
                      <th className="hidden px-3 py-3 text-start font-semibold 2xl:table-cell">{t('colPlan')}</th>
                      <th className="px-3 py-3 text-start font-semibold">{t('colProgress')}</th>
                      <th className="px-3 py-3 text-start font-semibold">{t('colNextFollowUp')}</th>
                      <th className="px-5 py-3 text-end font-semibold">{t('colAction')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0eee7]">
                    {recent.map((row) => (
                      <tr key={row.key} className="transition hover:bg-[#fcfbf8]">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={row.name} category={row.category} />
                            <span className="min-w-0">
                              <span className="block truncate font-semibold">{row.name}</span>
                              {row.place ? <span className="block text-xs text-[#74746c]">{row.place}</span> : null}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-[#3f3f38]" dir="ltr">{row.phone || '—'}</td>
                        <td className="hidden px-3 py-3 text-[#3f3f38] 2xl:table-cell">{row.plan || '—'}</td>
                        <td className="px-3 py-3"><ProgressPill value={row.progress} /></td>
                        <td className="px-3 py-3 whitespace-nowrap text-[#3f3f38]">{row.followUpAt ? formatWhen(row.followUpAt, t, lang) : '—'}</td>
                        <td className="px-5 py-3 text-end">
                          <button type="button" className={ACTION_BUTTON} onClick={row.onView}>
                            {t('colView')}<ChevronRight className="size-3.5 rtl:rotate-180" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>{leads.isLoading || stores.isLoading ? t('loading') : t('noRecentStores')}</Empty>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-5">
          <QuickUpdate leads={leads.data?.items ?? []} focus={focus} />
          <section className={CARD}>
            <PanelHead icon={Clock} title={t('recentActivity')} action={<TextLink onClick={() => navigate('notifications')}>{t('viewAll')}</TextLink>} />
            {activity.data?.items.length ? (
              <ol className="relative px-5 pb-5">
                {activity.data.items.map((row, index, list) => (
                  <li key={row.id} className="relative flex gap-3 pb-4 last:pb-0">
                    {index < list.length - 1 ? <span className="absolute start-[4px] top-4 h-full w-px bg-[#ecebe4]" /> : null}
                    <span className={`relative mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-white ${activityDot(row.kind)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold leading-snug">{activityTitle(row, t)}</p>
                        <time className="shrink-0 pt-0.5 text-[11px] text-[#a09e93]">{formatAgo(row.at, t, lang)}</time>
                      </div>
                      {activityDetail(row, t) ? <p className="mt-0.5 text-xs leading-relaxed text-[#74746c]">{activityDetail(row, t)}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>{activity.isLoading ? t('loading') : t('noRecentActivity')}</Empty>
            )}
          </section>
        </div>
      </div>
      {creating ? <StoreForm onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function QuickUpdate({ leads, focus }: { leads: LeadRow[]; focus: { row: AppointmentRow; tick: number } | null }) {
  const { api } = useConsole();
  const t = useT();
  const act = useAction();
  const [leadId, setLeadId] = useState('');
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [pending, setPending] = useState(false);
  const [pinned, setPinned] = useState<{ id: string; label: string } | null>(null);
  const selected = leads.find((row) => row.id === leadId);

  useEffect(() => {
    const row = focus?.row;
    if (!row?.leadId) return;
    setLeadId(row.leadId);
    setPinned({ id: row.leadId, label: row.subject || row.title });
    if (row.progress && (STAFF_LEAD_STATUSES as readonly string[]).includes(row.progress)) setStatus(row.progress);
    document.getElementById('quick-update')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focus]);
  const options = leads.map((row) => ({ value: row.id, label: row.businessName }));
  if (pinned && !options.some((option) => option.value === pinned.id)) options.unshift({ value: pinned.id, label: pinned.label });

  async function save(event: FormEvent) {
    event.preventDefault();
    const lead = leads.find((row) => row.id === leadId);
    setPending(true);
    const result = await act(async () => {
      let changed = false;
      if (lead && status && status !== lead.status) {
        await api.mk.post(`/leads/${leadId}/status`, { status });
        changed = true;
      } else if (!lead && status && pinned?.id === leadId) {
        await api.mk.post(`/leads/${leadId}/status`, { status });
        changed = true;
      }
      const body = note.trim();
      if (body.length === 1) throw new Error(t('noteTooShort'));
      if (body.length >= 2) {
        await api.mk.post(`/leads/${leadId}/notes`, { body });
        changed = true;
      }
      if (date || time) {
        if (!date || !time) throw new Error(t('followUpNeedsBoth'));
        const scheduledAt = fromLocalInput(`${date}T${time}`);
        if (!scheduledAt) throw new Error(t('followUpNeedsBoth'));
        await api.mk.post('/appointments', { leadId, kind: 'FOLLOW_UP', title: t('followUpWith', { name: lead?.businessName ?? pinned?.label ?? '' }), scheduledAt });
        changed = true;
      }
      if (!changed) throw new Error(t('updateNeedsDetail'));
    }, 'saved');
    setPending(false);
    if (result.ok) {
      setNote('');
      setDate('');
      setTime('');
    }
  }

  return (
    <section id="quick-update" className={`${CARD} scroll-mt-24`}>
      <PanelHead icon={PenLine} title={t('quickUpdateTitle')} />
      <form className="space-y-3 px-5 pb-5" onSubmit={(event) => void save(event)}>
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label={t('fMerchant')}
            value={leadId}
            onChange={(id) => {
              setLeadId(id);
              const lead = leads.find((row) => row.id === id);
              if (lead) setStatus(lead.status);
            }}
            placeholder={t('selectMerchant')}
            required
            options={options}
          />
          <SelectField
            label={t('colStatus')}
            value={status}
            onChange={setStatus}
            placeholder={t('selectStatus')}
            required
            options={leadStatusChoices(t, 'STAFF', status || selected?.status).map((option) => {
              const known = PROGRESS[option.value];
              return known ? { ...option, label: t(known.label) } : option;
            })}
          />
        </div>
        <AreaField label={t('storyNote')} value={note} onChange={setNote} placeholder={t('storyNotePlaceholder')} maxLength={2000} rows={4} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t('nextFollowUpDate')} type="date" value={date} onChange={setDate} placeholder={t('selectDate')} />
          <TextField label={t('fTime')} type="time" value={time} onChange={setTime} placeholder={t('selectTime')} />
        </div>
        <Button type="submit" variant="yellow" className="h-11 w-full" loading={pending} disabled={!leadId || !status}>{t('saveUpdate')}</Button>
      </form>
    </section>
  );
}

function FollowUpRow({ row, onAdd }: { row: AppointmentRow; onAdd: () => void }) {
  const t = useT();
  const lang = useLang();
  const Icon = merchantIcon(row.category, row.subject || row.title);
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3.5">
      <Avatar name={row.subject || row.title} category={row.category} />
      <div className="min-w-[140px] flex-1">
        <p className="text-sm font-semibold">{row.subject || row.title}</p>
        <p className="mt-0.5 text-xs text-[#74746c]">{[row.place, formatWhen(row.scheduledAt, t, lang)].filter(Boolean).join(' · ')}</p>
      </div>
      {row.progress ? <ProgressPill value={row.progress} /> : null}
      <div className="flex gap-2">
        {row.phone ? (
          <a href={`tel:${row.phone}`} className={ACTION_BUTTON}>
            <Phone className="size-3.5" />{t('contact')}
          </a>
        ) : null}
        {row.leadId ? (
          <button type="button" className={ACTION_BUTTON} onClick={onAdd}>
            <PenLine className="size-3.5" />{t('addUpdate')}
          </button>
        ) : null}
      </div>
    </li>
  );
}

function Stat({ icon: Icon, label, value, note, onClick }: { icon: LucideIcon; label: string; value: string; note?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`${CARD} group flex h-full min-h-[104px] items-center gap-3.5 p-5 text-start transition hover:border-[#e2d9b4] hover:shadow-[0_4px_16px_rgba(23,23,18,0.06)]`}>
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#fff6d4] text-[#8a6a00]"><Icon className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-[#74746c]">{label}</span>
        <span className="mt-0.5 block whitespace-nowrap text-2xl font-bold leading-tight tracking-tight">{value}</span>
        {note ? <span className="mt-1 line-clamp-2 text-[11px] leading-snug text-[#8d8d86]">{note}</span> : null}
      </span>
      <ChevronRight className="-me-1 size-4 shrink-0 text-[#c2c0b6] transition group-hover:text-[#74746c] rtl:rotate-180" />
    </button>
  );
}

function PanelHead({ icon: Icon, title, subtitle, action }: { icon: LucideIcon; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-base font-semibold leading-6"><Icon className="size-5 shrink-0 text-[#e0a800]" />{title}</h2>
        {subtitle ? <p className="mt-1 text-xs text-[#74746c]">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="mx-5 mb-5 rounded-xl border border-dashed border-[#E9E7DF] bg-[#fcfbf8] px-4 py-6 text-center text-sm text-[#74746c]">{children}</p>;
}

function Avatar({ name, category }: { name: string; category: string | null | undefined }) {
  const Icon = merchantIcon(category, name);
  return <span className={`grid size-10 shrink-0 place-items-center rounded-full ${TONES[toneIndex(name) % TONES.length]}`}><Icon className="size-4" /></span>;
}

function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" className="shrink-0 pt-0.5 text-sm font-semibold text-[#886b00] hover:underline" onClick={onClick}>{children}</button>;
}

function activityTitle(row: ActivityRow, t: Translate) {
  const label = t(`activity.${row.kind}` as MessageKey);
  return label.startsWith('activity.') ? row.body : label;
}

function activityDetail(row: ActivityRow, t: Translate) {
  if (row.kind === 'STATUS' && row.toStatus) {
    const change = [row.fromStatus, row.toStatus].filter(Boolean).map((value) => statusLabel(value as string, t)).join(' → ');
    return [row.subject, change].filter(Boolean).join(' · ');
  }
  return [row.subject, row.body].filter(Boolean).join(' · ');
}

function statusLabel(value: string, t: Translate) {
  const known = PROGRESS[value];
  if (known) return t(known.label);
  const label = t(`status.${value}` as MessageKey);
  return label.startsWith('status.') ? value : label;
}

function ProgressPill({ value }: { value: string }) {
  const t = useT();
  const tone = PROGRESS[value]?.className ?? 'bg-[#f3f1ea] text-[#5c5a52]';
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}><Dot />{statusLabel(value, t)}</span>;
}

function Dot() {
  return <span className="size-1.5 rounded-full bg-current" />;
}

function merchantIcon(category: string | null | undefined, name: string): LucideIcon {
  const value = `${category ?? ''} ${name}`.toLowerCase();
  if (/cafe|coffee/.test(value)) return Coffee;
  if (/bakery|bread/.test(value)) return Croissant;
  if (/grocery|market|fruit|leaf/.test(value)) return Leaf;
  if (/fish|sea|ocean/.test(value)) return Fish;
  if (/fit|gym|sport/.test(value)) return Dumbbell;
  if (/restaurant|grill|kitchen/.test(value)) return Utensils;
  return Store;
}

function toneIndex(name: string) {
  return [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function activityDot(kind: string) {
  if (kind === 'COMMISSION_EARNED' || kind === 'SUBSCRIPTION_ACTIVATED') return 'bg-[#147d54]';
  if (kind === 'NOTE') return 'bg-[#2f62c9]';
  if (kind === 'STATUS' || kind === 'FOLLOW_UP' || kind === 'FOLLOW_UP_DONE') return 'bg-[#e0a100]';
  return 'bg-[#8d8d86]';
}

function bahrainDay(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function formatWhen(value: string, t: Translate, lang: string) {
  const date = new Date(value);
  const day = bahrainDay(date);
  const today = bahrainDay(new Date());
  const [year, month, dateNum] = today.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (dateNum ?? 1) + 1)).toISOString().slice(0, 10);
  const time = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(date);
  if (day === today) return t('todayAt', { time });
  if (day === tomorrow) return t('tomorrowAt', { time });
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-US', { timeZone: TIME_ZONE, month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(date) + `, ${time}`;
}

function formatAgo(value: string, t: Translate, lang: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return t('justNow');
  if (minutes < 60) return t('minutesAgo', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('hoursAgo', { count: hours });
  const days = Math.round(hours / 24);
  if (days < 14) return t('daysAgo', { count: days });
  return formatDate(value, lang);
}
