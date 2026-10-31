import { CashDepositsCard } from '@/components/cash-deposits';
import { api } from '@/components/providers';
import { hasPermission } from '@/lib/roles';
import type { BillingBoard, CashDrawerView } from '@alliva/types';
import { cn, ErrorState, Skeleton, toast } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Loader2, Lock, Minus, Plus, Unlock, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { money, tillKey, useTillBoard, useTillLocale, useTillSettings } from './shared';

/** Bahraini notes and the coins counted as one lump. */
const NOTES = [20, 10, 5, 1, 0.5] as const;

export default function TillCash() {
  const t = useTranslations('till.cash');
  const board = useTillBoard();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });

  if (board.isLoading) return <div className="space-y-3"><Skeleton className="h-40 rounded-3xl" /><Skeleton className="h-40 rounded-3xl" /></div>;
  if (board.error && !board.data) return <ErrorState title={t('loadFailed')} body={(board.error as Error).message} />;
  const drawer = board.data!.drawer;
  const canSettle = Boolean(me.data && hasPermission(me.data, 'bill.settle'));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      {drawer ? <OpenDrawer drawer={drawer} canClose={canSettle} /> : <ClosedDrawer canOpen={canSettle} />}
      {me.data && hasPermission(me.data, 'cash.confirm') ? <div className="[&>section]:rounded-3xl [&>section]:border-0"><CashDepositsCard /></div> : null}
      <DrawerHistory />
    </div>
  );
}

function ClosedDrawer({ canOpen }: { canOpen: boolean }) {
  const t = useTranslations('till.cash');
  const locale = useTillLocale();
  const client = useQueryClient();
  const { branchId } = useTillSettings();
  const [float, setFloat] = useState('');
  const open = useMutation({
    mutationFn: () => api.openCashDrawer({ openingFloat: Number(float || 0).toFixed(3), ...(branchId ? { branchId } : {}) }),
    onSuccess: (drawer) => {
      client.setQueryData<BillingBoard>(tillKey(branchId), (board) => board && { ...board, drawer });
      toast.success(t('openedToast'));
      setFloat('');
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <section className="rounded-3xl bg-white p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#F0F0EC] text-[#696965]"><Lock className="size-6" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t('closedTitle')}</h2>
          <p className="text-xs text-[#696965]">{t('closedBody')}</p>
        </div>
      </div>
      {canOpen ? (
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-semibold" htmlFor="till-float">{t('float')}</label>
          <input id="till-float" inputMode="decimal" dir="ltr" value={float} onChange={(event) => setFloat(event.target.value.replace(/[^\d.]/g, ''))} placeholder="0.000" className="h-12 w-full rounded-xl border border-[#E2E2DC] px-4 text-lg font-semibold tabular-nums outline-none focus:border-[#111111]" />
          <p className="text-xs text-[#696965]">{t('floatHint')}</p>
          <button type="button" disabled={open.isPending} onClick={() => open.mutate()} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#111111] text-sm font-semibold text-white disabled:opacity-50">
            {open.isPending ? <Loader2 className="size-4 animate-spin" /> : <Unlock className="size-4" />}{t('open', { amount: money(float || 0, locale) })}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function OpenDrawer({ drawer, canClose }: { drawer: CashDrawerView; canClose: boolean }) {
  const t = useTranslations('till.cash');
  const locale = useTillLocale();
  const client = useQueryClient();
  const { branchId } = useTillSettings();
  const [counting, setCounting] = useState(false);
  const [notes, setNotes] = useState<Record<number, number>>({});
  const [coins, setCoins] = useState('');
  const [note, setNote] = useState('');
  const counted = NOTES.reduce((total, value) => total + value * (notes[value] ?? 0), 0) + Number(coins || 0);
  const difference = counted - Number(drawer.expected);
  const opened = new Date(drawer.openedAt).toLocaleTimeString(locale === 'ar' ? 'ar-BH' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bahrain' });

  const close = useMutation({
    mutationFn: () => api.closeCashDrawer(drawer.id, { countedAmount: counted.toFixed(3), ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: (closed) => {
      client.setQueryData<BillingBoard>(tillKey(branchId), (board) => board && { ...board, drawer: null });
      void client.invalidateQueries({ queryKey: ['merchant', 'billing', 'drawers'] });
      const diff = Number(closed.difference ?? 0);
      toast.success(diff === 0 ? t('closedBalanced') : t(diff > 0 ? 'closedOver' : 'closedShort', { amount: money(Math.abs(diff), locale) }));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="rounded-3xl bg-white p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#E3F5EA] text-[#168A52]"><Wallet className="size-6" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t('openTitle')}</h2>
          <p className="truncate text-xs text-[#696965]">{t('openedAt', { time: opened, name: drawer.openedBy ?? '—' })}</p>
        </div>
      </div>
      <dl className="mt-4 grid gap-2 sm:grid-cols-3 sm:text-center">
        <Figure label={t('floatShort')} value={money(drawer.openingFloat, locale)} />
        <Figure label={t('cashBills', { count: drawer.bills })} value={money(drawer.cashSales, locale)} />
        <Figure label={t('expected')} value={money(drawer.expected, locale)} strong />
      </dl>

      {canClose && !counting ? (
        <button type="button" onClick={() => setCounting(true)} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#111111] text-sm font-semibold text-white">
          <Lock className="size-4" />{t('countAndClose')}
        </button>
      ) : null}

      {counting ? (
        <div className="mt-4 space-y-3 border-t border-[#F0F0EC] pt-4">
          <p className="text-sm font-semibold">{t('countTitle')}</p>
          <ul className="space-y-2">
            {NOTES.map((value) => (
              <li key={value} className="flex items-center gap-3">
                <span className="w-20 text-sm font-semibold tabular-nums">{money(value, locale)}</span>
                <div className="flex items-center rounded-xl border border-[#E2E2DC]">
                  <button type="button" aria-label={t('less', { note: money(value, locale) })} onClick={() => setNotes((current) => ({ ...current, [value]: Math.max(0, (current[value] ?? 0) - 1) }))} className="grid size-10 place-items-center"><Minus className="size-4" /></button>
                  <input inputMode="numeric" dir="ltr" aria-label={t('noteCount', { note: money(value, locale) })} value={notes[value] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [value]: Number(event.target.value.replace(/\D/g, '').slice(0, 4) || 0) }))} placeholder="0" className="h-10 w-12 bg-transparent text-center font-semibold tabular-nums outline-none" />
                  <button type="button" aria-label={t('more', { note: money(value, locale) })} onClick={() => setNotes((current) => ({ ...current, [value]: (current[value] ?? 0) + 1 }))} className="grid size-10 place-items-center"><Plus className="size-4" /></button>
                </div>
                <span className="ms-auto text-sm tabular-nums text-[#696965]">{money(value * (notes[value] ?? 0), locale)}</span>
              </li>
            ))}
            <li className="flex items-center gap-3">
              <label htmlFor="till-coins" className="w-20 text-sm font-semibold">{t('coins')}</label>
              <input id="till-coins" inputMode="decimal" dir="ltr" value={coins} onChange={(event) => setCoins(event.target.value.replace(/[^\d.]/g, ''))} placeholder="0.000" className="h-10 w-[8.5rem] rounded-xl border border-[#E2E2DC] px-3 font-semibold tabular-nums outline-none focus:border-[#111111]" />
            </li>
          </ul>
          <div className={cn('flex items-center justify-between rounded-xl px-4 py-3', Math.abs(difference) < 0.0005 ? 'bg-[#E3F5EA] text-[#11663D]' : difference > 0 ? 'bg-[#EEF4FF] text-[#1E4FB8]' : 'bg-[#FDECEA] text-[#B42318]')}>
            <div>
              <p className="text-xs">{t('counted')}</p>
              <p className="text-xl font-bold tabular-nums">{money(counted, locale)}</p>
            </div>
            <p className="text-sm font-semibold">
              {Math.abs(difference) < 0.0005 ? t('balanced') : t(difference > 0 ? 'over' : 'short', { amount: money(Math.abs(difference), locale) })}
            </p>
          </div>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={300} placeholder={t('notePlaceholder')} className="w-full rounded-xl border border-[#E2E2DC] px-3 py-2 text-sm outline-none focus:border-[#111111]" />
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <button type="button" onClick={() => setCounting(false)} className="h-12 rounded-2xl border border-[#E2E2DC] px-4 text-sm font-semibold">{t('cancel')}</button>
            <button type="button" disabled={close.isPending} onClick={() => close.mutate()} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#111111] text-sm font-semibold text-white disabled:opacity-50">
              {close.isPending ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}{t('close')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 rounded-2xl px-4 py-3 sm:block sm:px-2', strong ? 'bg-[#111111] text-white' : 'bg-[#F7F7F5]')}>
      <dt className={cn('truncate text-xs', strong ? 'text-white/70' : 'text-[#696965]')}>{label}</dt>
      <dd className="whitespace-nowrap font-semibold tabular-nums sm:mt-0.5">{value}</dd>
    </div>
  );
}

function DrawerHistory() {
  const t = useTranslations('till.cash');
  const locale = useTillLocale();
  const { branchId } = useTillSettings();
  const history = useQuery({ queryKey: ['merchant', 'billing', 'drawers', branchId], queryFn: () => api.cashDrawers(branchId || undefined) });
  const rows = history.data?.drawers ?? [];
  return (
    <section className="overflow-hidden rounded-3xl bg-white">
      <header className="flex items-center gap-2 px-5 pb-2 pt-4">
        <History className="size-4 text-[#696965]" />
        <h2 className="font-semibold">{t('historyTitle')}</h2>
      </header>
      {history.isLoading ? <Skeleton className="mx-5 mb-5 h-16 rounded-2xl" /> : rows.length ? (
        <ul className="divide-y divide-[#F0F0EC]">
          {rows.map((row) => {
            const diff = Number(row.difference ?? 0);
            const when = new Date(row.closedAt!).toLocaleString(locale === 'ar' ? 'ar-BH' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bahrain' });
            return (
              <li key={row.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{when}{row.closedBy ? ` · ${row.closedBy}` : ''}</p>
                  <p className="truncate text-xs text-[#696965]">{t('historyLine', { expected: money(row.expected, locale), counted: money(row.countedAmount ?? 0, locale) })}</p>
                  {row.note ? <p className="truncate text-xs text-[#8A5A00]"><bdi>{row.note}</bdi></p> : null}
                </div>
                <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums', Math.abs(diff) < 0.0005 ? 'bg-[#E3F5EA] text-[#168A52]' : diff > 0 ? 'bg-[#EEF4FF] text-[#1E4FB8]' : 'bg-[#FDECEA] text-[#B42318]')}>
                  {Math.abs(diff) < 0.0005 ? t('balanced') : `${diff > 0 ? '+' : '−'}${money(Math.abs(diff), locale)}`}
                </span>
              </li>
            );
          })}
        </ul>
      ) : <p className="px-5 pb-5 pt-1 text-sm text-[#8A8A86]">{t('noHistory')}</p>}
    </section>
  );
}
