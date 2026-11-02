import { FeedbackSheet, OrderSentBadge } from '@/components/order-feedback';
import { api } from '@/components/providers';
import { ScanNotice, TableCallButton, tableNo, useTableLink, useTableService, VisitEnded } from '@/components/table-call';
import { Link, useRouter } from '@/i18n/navigation';
import { beginCartChange, cartQueryKey, cartQueryOptions, clearCartLines, failCartChange, optimisticLine, setLineQuantity, settleCartChange } from '@/lib/cart-cache';
import { ensureGuest } from '@/lib/location';
import { usePlace } from '@/lib/place';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { cn, Skeleton } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Loader2, Minus, NotebookPen, Plus, ReceiptText, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'use-intl';

type CartSnapshot = NonNullable<Awaited<ReturnType<typeof api.cart>>>;
type CartLine = CartSnapshot['items'][number];
type DinerBill = NonNullable<NonNullable<ReturnType<typeof useTableService>['data']>['bill']>;

const STATUS_TONE: Record<string, string> = {
  PENDING: 'bg-[#f0f0ec] text-[#4a4a46]',
  ACCEPTED: 'bg-[#fff4d6] text-[#8a5a00]',
  PREPARING: 'bg-[#fff4d6] text-[#8a5a00]',
  READY_FOR_PICKUP: 'bg-[#eef4ff] text-[#2f6fed]',
  DELIVERED: 'bg-[#e3f5ea] text-[#168a52]',
};

/**
 * The table's own cart: a diner reviews their dishes and sends them straight to the kitchen, with no sign-in
 * or payment step. They can come back and send more rounds; the whole table pays once at the till.
 */
export default function TableCartPage() {
  const { slug } = useParams() as { slug: string };
  const locale = useLocale() as 'en' | 'ar';
  const t = useTranslations();
  const client = useQueryClient();
  const setFulfillment = usePlace((state) => state.setFulfillment);
  const cart = useQuery(cartQueryOptions());
  const link = useTableLink();
  const router = useRouter();
  const table = useTableService();
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<{ id: string; number: string } | null>(null);
  const edit = useMutation({
    mutationFn: async ({ id, quantity }: { id: string; quantity: number }) => {
      await api.guest().catch(() => undefined);
      return quantity < 1 ? api.removeItem(id) : api.updateItem(id, quantity);
    },
    onMutate: ({ id, quantity }) => beginCartChange(client, (current) => setLineQuantity(current, id, quantity)),
    onSuccess: (cartView, _variables, changeId) => settleCartChange(client, changeId, cartView),
    onError: (error: Error, _variables, changeId) => {
      if (typeof changeId === 'number') failCartChange(client, changeId);
      toast.error(error.message);
    },
  });
  const place = useMutation({
    mutationFn: () => api.placeTableOrder(note.trim() || null),
    onSuccess: ({ order, service }) => {
      client.setQueryData(['table-service', table.tableId], service);
      client.setQueryData<CartSnapshot>(cartQueryKey, (current) => (current ? clearCartLines(current) : current));
      void client.invalidateQueries({ queryKey: cartQueryKey });
      setNote('');
      setSent({ id: order.id, number: order.number });
      window.scrollTo({ top: 0 });
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void client.invalidateQueries({ queryKey: cartQueryKey });
      void client.invalidateQueries({ queryKey: ['table-service'] });
    },
  });

  useEffect(() => {
    // Outside the shell, like the table page, so the guest session and dine-in mode start here.
    void ensureGuest().catch(() => undefined);
    setFulfillment('DINE_IN');
  }, [setFulfillment]);

  const service = table.data;
  const ended = Boolean(service?.visitEnded);
  const sameStore = cart.data?.merchant?.slug === slug;
  const lines = sameStore && !ended ? (cart.data?.items ?? []) : [];
  const pricing = cart.data?.pricing;
  const storeName = cart.data?.merchant ? pickLocalized(cart.data.merchant.name, locale) : '';
  const bill = service?.bill && !service.bill.settled ? service.bill : null;
  const busy = edit.isPending || lines.some((line) => optimisticLine(line.id));
  const money = (value: string | number) => formatMoney(value, locale);

  const empty = cart.isFetched && !cart.isFetching && !lines.length;
  useEffect(() => {
    // Nothing to send: the menu is where they add dishes. Not after a round was just sent, or once the table paid.
    if (empty && !sent && !ended && !place.isPending) router.replace(`/table/${slug}${link}`);
  }, [empty, sent, ended, place.isPending, router, slug, link]);

  return (
    <div className={cn('min-h-screen bg-[#f6f6f3]', lines.length && !sent ? 'pb-40' : 'pb-10')}>
      <header className="sticky top-0 z-30 border-b border-[#ececE6] bg-white">
        <div className="mx-auto flex h-14 max-w-[640px] items-center gap-3 px-4">
          <Link href={`/table/${slug}${link}`} aria-label={t('customer.back')} className="grid size-9 shrink-0 place-items-center rounded-full bg-[#f3f3ef]">
            <ArrowLeft className="size-[18px] rtl:rotate-180" strokeWidth={2.2} />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-[17px] leading-tight font-extrabold text-[#111]">{t('customer.tablePage.yourOrder')}</h1>
            {service ? (
              <p className="truncate text-[12px] text-[#6f6f6a]">
                {storeName ? t('customer.tablePage.storeTable', { store: storeName, table: tableNo(service.table.number) }) : t('customer.tablePage.diningAt', { table: tableNo(service.table.number) })}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[640px] space-y-3 px-4 pt-4">
        {ended ? (
          <VisitEnded title={t('customer.tablePage.visitEndedTitle')} body={t('customer.tablePage.visitEndedBody')} />
        ) : sent ? (
          <section className="rounded-[20px] bg-white p-5 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <OrderSentBadge />
            <h2 className="rise-in mt-4 text-[19px] font-extrabold text-[#111] [animation-delay:650ms]">{t('customer.tablePage.sentTitle')}</h2>
            <p className="rise-in mx-auto mt-1 max-w-[340px] text-[13.5px] leading-relaxed text-[#6f6f6a] [animation-delay:750ms]">{t('customer.tablePage.sentBody', { number: `⁦${sent.number}⁩` })}</p>
            <Link href={`/table/${slug}${link}`} className="rise-in mt-4 inline-flex h-11 w-full [animation-delay:850ms] items-center justify-center gap-2 rounded-full bg-primary text-sm font-bold text-[#111]">
              {t('customer.tablePage.orderMore')}<ArrowRight className="size-4 rtl:rotate-180" />
            </Link>
          </section>
        ) : cart.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-[20px]" />
            <Skeleton className="h-24 w-full rounded-[20px]" />
          </div>
        ) : lines.length ? (
          <>
            <section className="divide-y divide-[#f0f0ec] rounded-[20px] bg-white px-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              {lines.map((line) => (
                <Line key={line.id} line={line} locale={locale} onQty={(quantity) => edit.mutate({ id: line.id, quantity })} />
              ))}
            </section>

            <label className="block rounded-[20px] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <span className="flex items-center gap-2 text-[14px] font-bold text-[#111]">
                <NotebookPen className="size-4" />{t('customer.tablePage.kitchenNote')}
              </span>
              <textarea
                value={note}
                maxLength={250}
                rows={2}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t('customer.tablePage.kitchenNotePlaceholder')}
                className="mt-2 w-full resize-none rounded-xl bg-[#f6f6f3] px-3 py-2.5 text-[16px] outline-none placeholder:text-[#9a9a95] focus:ring-2 focus:ring-primary sm:text-sm"
              />
            </label>

            {pricing ? (
              <section className="rounded-[20px] bg-white px-4 py-3 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                <Row label={t('customer.tableCall.bill.subtotal')} value={money(pricing.subtotal)} />
                {Number(pricing.discount) > 0 ? <Row label={t('customer.tableCall.bill.discount')} value={`-${money(pricing.discount)}`} className="text-[#168a52]" /> : null}
                {Number(pricing.serviceFee) > 0 ? <Row label={pricing.serviceFeeLabel ? pickLocalized(pricing.serviceFeeLabel, locale) : t('customer.tableCall.bill.serviceFee')} value={money(pricing.serviceFee)} /> : null}
                {Number(pricing.tax) > 0 ? <Row label={pricing.taxLabel ? pickLocalized(pricing.taxLabel, locale) : t('customer.tableCall.bill.tax')} value={money(pricing.tax)} /> : null}
                <Row label={t('customer.tableCall.bill.total')} value={money(pricing.total)} className="mt-1 border-t border-[#ececE6] pt-2 text-[15px] font-extrabold text-[#111]" />
              </section>
            ) : null}
          </>
        ) : (
          // Empty: on the way back to the menu.
          <Skeleton className="h-24 w-full rounded-[20px]" />
        )}

        {bill ? <Ordered bill={bill} locale={locale} onBill={table.openBill} /> : null}
      </main>

      {lines.length && !sent && !ended ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#ececE6] bg-white px-4 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-[640px]">
            {table.missing && !service ? (
              <div className="mb-2.5"><ScanNotice body={t('customer.tablePage.scanToOrder')} /></div>
            ) : service?.cleaning ? (
              <div className="mb-2.5"><ScanNotice body={t('customer.tablePage.settingUp')} /></div>
            ) : (
              <p className="mb-2 text-center text-[12px] text-[#6f6f6a]">{t('customer.tablePage.payLater')}</p>
            )}
            <button
              type="button"
              disabled={place.isPending || busy || !service || service.cleaning}
              aria-busy={place.isPending}
              onClick={() => place.mutate()}
              className="inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-[#141416] text-[15px] font-bold text-white disabled:opacity-60"
            >
              {place.isPending ? <Loader2 className="size-5 animate-spin" /> : null}
              {t('customer.tablePage.placeOrder', { amount: money(pricing?.total ?? '0') })}
            </button>
          </div>
        </div>
      ) : null}
      {service && !ended ? <TableCallButton table={table} lift={lines.length && !sent ? 'orderBar' : 'none'} /> : null}
      {table.dialogs}
      <FeedbackSheet orderId={sent?.id ?? null} />
    </div>
  );
}

function Line({ line, locale, onQty }: { line: CartLine; locale: 'en' | 'ar'; onQty: (quantity: number) => void }) {
  const t = useTranslations();
  const name = pickLocalized(line.name, locale);
  const extras = [line.variantName, ...line.addons.map((addon) => addon.name)].filter((value): value is NonNullable<typeof value> => Boolean(value)).map((value) => pickLocalized(value, locale));
  const locked = Boolean(optimisticLine(line.id));
  return (
    <div className="flex gap-3 py-3.5">
      <img src={line.imageUrl || '/no-image-16x9.jpg'} alt="" className="size-16 shrink-0 rounded-xl bg-[#f3f3ef] object-cover" />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="line-clamp-2 text-[14px] leading-snug font-bold text-[#111]">{name}</p>
        {extras.length ? <p className="mt-0.5 line-clamp-2 text-[12px] text-[#6f6f6a]">{extras.join(' · ')}</p> : null}
        {line.notes ? <p className="mt-0.5 line-clamp-2 text-[12px] text-[#8a5a00] italic">“{line.notes}”</p> : null}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <p className="text-[13.5px] font-bold text-[#111] tabular-nums">{formatMoney(line.lineTotal, locale)}</p>
          <div role="group" aria-label={t('customer.tablePage.quantity')} className="flex h-8 items-center rounded-full bg-primary text-[#111]">
            <button
              type="button"
              disabled={locked}
              aria-label={line.quantity > 1 ? t('customer.decreaseQty') : t('customer.tablePage.removeLine', { name })}
              onClick={() => onQty(line.quantity - 1)}
              className="grid size-8 place-items-center rounded-full disabled:opacity-50"
            >
              {line.quantity > 1 ? <Minus className="size-4" strokeWidth={2.6} /> : <Trash2 className="size-[15px]" strokeWidth={2.2} />}
            </button>
            <span aria-live="polite" className="min-w-5 text-center text-[13px] font-bold tabular-nums">{line.quantity}</span>
            <button type="button" disabled={locked} aria-label={t('customer.increaseQty')} onClick={() => onQty(line.quantity + 1)} className="grid size-8 place-items-center rounded-full disabled:opacity-50">
              <Plus className="size-4" strokeWidth={2.6} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Rounds this table already sent, with where each one is, so a diner who reopens the page sees what is coming. */
function Ordered({ bill, locale, onBill }: { bill: DinerBill; locale: 'en' | 'ar'; onBill: () => void }) {
  const t = useTranslations('customer');
  return (
    <section className="rounded-[20px] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-extrabold text-[#111]">{t('tablePage.alreadyOrdered')}</h2>
          <p className="text-[12px] text-[#6f6f6a]">{t('tablePage.ordersSent', { count: bill.orders.length, amount: formatMoney(bill.total, locale) })}</p>
        </div>
        <button type="button" onClick={onBill} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[#e3e3de] px-3 text-[13px] font-bold text-[#111]">
          <ReceiptText className="size-4" />{t('tablePage.viewBill')}
        </button>
      </div>
      <ul className="mt-3 space-y-2.5">
        {bill.orders.map((order) => (
          <li key={order.number} className="rounded-2xl bg-[#f6f6f3] px-3 py-2.5">
            <p className="flex items-center justify-between gap-2 text-[12px] font-semibold text-[#6f6f6a]">
              <bdi>{order.number}</bdi>
              <span className={cn('rounded-full px-2 py-0.5', STATUS_TONE[order.status] ?? STATUS_TONE.PENDING)}>
                {t(`tableCall.bill.status.${order.status in STATUS_TONE ? order.status : 'PENDING'}`)}
              </span>
            </p>
            <p className="mt-1 text-[13px] text-[#111]">
              {order.items.map((item) => `${item.quantity}× ${pickLocalized(item.name, locale)}`).join(', ')}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between py-0.5 text-[#4a4a46]', className)}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
