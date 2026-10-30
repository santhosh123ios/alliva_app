import { api } from '@/components/providers';
import { Link } from '@/i18n/navigation';
import type { CashDepositView, RiderCollections } from '@alliva/types';
import { cn, Dialog, DialogContent, DialogDescription, DialogTitle, EmptyState, ErrorState, Skeleton, toast } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, Banknote, Check, CreditCard, Hourglass, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'use-intl';
import { dateTimeLabel, money, riderKeys, useRiderLocale } from './shared';

type Tab = 'transactions' | 'deposits';

export default function RiderCollection() {
  const t = useTranslations('rider.collection');
  const locale = useRiderLocale();
  const data = useQuery({ queryKey: riderKeys.collections, queryFn: () => api.rider.collections(), refetchInterval: 60_000 });
  const [tab, setTab] = useState<Tab>('transactions');
  const [depositing, setDepositing] = useState(false);

  if (data.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 rounded-3xl" />
        <Skeleton className="h-10 rounded-xl" />
        {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-16 rounded-2xl" />)}
      </div>
    );
  }
  if (data.error || !data.data) return <ErrorState title={t('loadFailed')} body={(data.error as Error | null)?.message ?? ''} />;
  const view = data.data;
  const hasCash = Number(view.cashInHand) > 0;

  return (
    <div className="space-y-4">
      <section className="rounded-3xl bg-[#111111] p-5 text-white">
        <p className="text-sm text-white/70">{t('inHand')}</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">{money(view.cashInHand, locale)}</p>
        <p className="mt-1 text-xs text-white/60">{t('inHandHint', { count: view.inHand.length })}</p>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-2xl bg-white/10 px-3 py-2.5">
            <p className="text-xs text-white/60">{t('collectedToday')}</p>
            <p className="font-semibold tabular-nums">{money(view.collectedToday, locale)}</p>
          </div>
          <div className="rounded-2xl bg-white/10 px-3 py-2.5">
            <p className="text-xs text-white/60">{t('awaitingStore')}</p>
            <p className="font-semibold tabular-nums">{money(view.pendingDeposit, locale)}</p>
          </div>
        </div>
        <button
          type="button"
          disabled={!hasCash}
          onClick={() => setDepositing(true)}
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#FFC400] text-sm font-semibold text-[#111111] disabled:opacity-40"
        >
          <ArrowDownToLine className="size-4" />{t('depositCta')}
        </button>
      </section>

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#ECECE8] p-1" role="tablist">
        {(['transactions', 'deposits'] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={cn('h-10 rounded-lg text-sm font-semibold', tab === value ? 'bg-white shadow-sm' : 'text-[#696965]')}>
            {t(`tabs.${value}`)}
          </button>
        ))}
      </div>

      {tab === 'transactions' ? <Transactions view={view} /> : <Deposits deposits={view.deposits} />}

      <DepositDialog view={view} open={depositing} onOpenChange={setDepositing} />
    </div>
  );
}

function Transactions({ view }: { view: RiderCollections }) {
  const t = useTranslations('rider.collection');
  const tr = useTranslations('rider');
  const locale = useRiderLocale();
  if (!view.transactions.length) return <div className="rounded-3xl bg-white"><EmptyState title={t('noTransactions')} body={t('noTransactionsBody')} /></div>;
  return (
    <ul className="divide-y divide-[#F0F0EC] overflow-hidden rounded-3xl bg-white">
      {view.transactions.map((row) => {
        const cash = row.method === 'CASH';
        return (
          <li key={row.orderId}>
            <Link href={`/rider/orders/${row.orderId}`} className="flex items-center gap-3 px-4 py-3">
              <span className={cn('grid size-10 shrink-0 place-items-center rounded-2xl', cash ? 'bg-[#FFF4D6] text-[#8A5A00]' : 'bg-[#E7F0FF] text-[#2F6FED]')}>
                {cash ? <Banknote className="size-5" /> : <CreditCard className="size-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold"><bdi dir="ltr">#{row.orderNumber}</bdi></span>
                <span className="block text-xs text-[#696965]">{tr(`payment.${row.method ?? 'UNKNOWN'}`)} · {dateTimeLabel(row.deliveredAt, locale)}</span>
              </span>
              <span className="text-end">
                <span className="block text-sm font-semibold tabular-nums">{money(cash ? row.collected ?? row.total : row.total, locale)}</span>
                {row.cashStatus ? <span className={cn('block text-[11px] font-medium', statusTone(row.cashStatus))}>{t(`cashStatus.${row.cashStatus}`)}</span> : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function statusTone(status: string) {
  if (status === 'CONFIRMED') return 'text-[#168A52]';
  if (status === 'DEPOSIT_PENDING') return 'text-[#2F6FED]';
  if (status === 'DISPUTED') return 'text-[#B42318]';
  return 'text-[#8A5A00]';
}

function Deposits({ deposits }: { deposits: CashDepositView[] }) {
  const t = useTranslations('rider.collection');
  const locale = useRiderLocale();
  if (!deposits.length) return <div className="rounded-3xl bg-white"><EmptyState title={t('noDeposits')} body={t('noDepositsBody')} /></div>;
  return (
    <ul className="space-y-2">
      {deposits.map((deposit) => (
        <li key={deposit.id} className="rounded-2xl bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <span className={cn('grid size-10 shrink-0 place-items-center rounded-2xl', deposit.status === 'CONFIRMED' ? 'bg-[#E3F5EA] text-[#168A52]' : deposit.status === 'REJECTED' ? 'bg-[#FDECEA] text-[#B42318]' : 'bg-[#E7F0FF] text-[#2F6FED]')}>
              {deposit.status === 'CONFIRMED' ? <Check className="size-5" /> : deposit.status === 'REJECTED' ? <X className="size-5" /> : <Hourglass className="size-5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{t(`depositStatus.${deposit.status}`)}</span>
              <span className="block text-xs text-[#696965]">{t('depositMeta', { count: deposit.orders, time: dateTimeLabel(deposit.createdAt, locale) })}</span>
            </span>
            <span className="text-sm font-semibold tabular-nums">{money(deposit.amount, locale)}</span>
          </div>
          {deposit.note ? <p className="mt-2 text-xs text-[#5C5C58]">{deposit.note}</p> : null}
          {deposit.reviewNote ? <p className="mt-2 rounded-lg bg-[#F7F7F5] px-2.5 py-1.5 text-xs text-[#5C5C58]">{t('storeSaid', { note: deposit.reviewNote })}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function DepositDialog({ view, open, onOpenChange }: { view: RiderCollections; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('rider.collection');
  const locale = useRiderLocale();
  const client = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setPicked(new Set(view.inHand.map((row) => row.id)));
      setError('');
    }
  }, [open, view.inHand]);
  const total = useMemo(() => view.inHand.filter((row) => picked.has(row.id)).reduce((sum, row) => sum + Number(row.amount), 0), [picked, view.inHand]);
  const save = useMutation({
    mutationFn: () => api.rider.deposit({ collectionIds: [...picked], ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: () => {
      setNote('');
      onOpenChange(false);
      toast.success(t('depositSent'));
      void client.invalidateQueries({ queryKey: riderKeys.collections });
    },
    onError: (reason: Error) => setError(reason.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col max-sm:bottom-0 max-sm:top-auto max-sm:w-full max-sm:translate-y-0 max-sm:rounded-b-none">
        <DialogTitle>{t('depositTitle')}</DialogTitle>
        <DialogDescription>{t('depositBody')}</DialogDescription>
        <ul className="mt-4 min-h-0 flex-1 divide-y divide-[#F0F0EC] overflow-y-auto rounded-2xl border border-[#ECECE8]">
          {view.inHand.map((row) => (
            <li key={row.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="size-5 accent-[#111111]"
                  checked={picked.has(row.id)}
                  onChange={(event) => setPicked((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(row.id);
                    else next.delete(row.id);
                    return next;
                  })}
                />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-medium"><bdi dir="ltr">#{row.orderNumber}</bdi></span>
                  <span className="block text-xs text-[#696965]">{dateTimeLabel(row.collectedAt, locale)}</span>
                </span>
                <span className="text-sm font-semibold tabular-nums">{money(row.amount, locale)}</span>
              </label>
            </li>
          ))}
        </ul>
        <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder={t('depositNote')} className="mt-3 h-11 w-full rounded-xl border border-[#E2E2DC] px-3 text-sm outline-none focus:border-[#111111]" />
        {error ? <p className="mt-2 rounded-xl bg-[#FDECEA] px-3 py-2 text-sm text-[#B42318]" role="alert">{error}</p> : null}
        <button type="button" disabled={!picked.size || save.isPending} onClick={() => save.mutate()} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#111111] text-sm font-semibold text-white disabled:opacity-40">
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowDownToLine className="size-4" />}
          {t('depositSubmit', { amount: money(total, locale) })}
        </button>
      </DialogContent>
    </Dialog>
  );
}
