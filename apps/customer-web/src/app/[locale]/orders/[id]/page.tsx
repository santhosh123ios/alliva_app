'use client';

import { api } from '@/components/providers';
import { Link, useRouter } from '@/i18n/navigation';
import { ActiveDeliveryCard, HistoryRow, isScheduledOrder, orderStatusLabel, supportHref } from '@/components/order-board';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { ErrorState, Skeleton, SkeletonText } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { use, useEffect } from 'react';
import { toast } from 'sonner';
import { io } from 'socket.io-client';

const PAST = new Set(['DELIVERED', 'CANCELLED', 'REFUNDED']);

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations();
  const locale = useLocale() as 'en' | 'ar';
  const router = useRouter();
  const client = useQueryClient();
  const order = useQuery({ queryKey: ['order', id], queryFn: () => api.order(id) });
  const reorder = useMutation({
    mutationFn: () => api.reorder(id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['cart'] });
      router.push('/cart');
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancel(id, 'Changed my mind'),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['order', id] }),
    onError: (error: Error) => toast.error(error.message),
  });

  useEffect(() => {
    let active = true;
    let socket: ReturnType<typeof io> | undefined;
    void api.socketToken().then(({ token }) => {
      if (!active) return;
      socket = io(process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000', { auth: { token } });
      socket.emit('join', { orderId: id });
      socket.on('order.updated', () => {
        void client.invalidateQueries({ queryKey: ['order', id] });
        void client.invalidateQueries({ queryKey: ['orders'] });
      });
    }).catch(() => undefined);
    return () => {
      active = false;
      socket?.close();
    };
  }, [client, id]);

  if (order.isLoading) {
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-80 rounded-[28px]" />
        <div className="rounded-[28px] border border-[#ecece6] bg-white p-5"><SkeletonText lines={4} /></div>
      </div>
    );
  }
  if (!order.data) return <ErrorState title={t('nav.orders')} body={(order.error as Error)?.message ?? t('common.error')} />;

  const data = order.data;
  const open = !PAST.has(data.status) && !isScheduledOrder(data);

  return (
    <div className="space-y-4">
      <Link href="/orders" className="inline-flex items-center gap-1 text-sm font-semibold">
        <ChevronLeft className="size-4 rtl:rotate-180" />
        {t('nav.orders')}
      </Link>
      {open ? (
        <ActiveDeliveryCard order={data} focus />
      ) : (
        <HistoryRow order={data} embedded reordering={reorder.isPending} onReorder={() => reorder.mutate()} />
      )}
      <section className="rounded-[28px] border border-[#ecece6] bg-white p-4 lg:p-5">
        <h2 className="text-lg">{t('customer.yourOrder')}</h2>
        <ul className="mt-3 divide-y divide-[#f3f3ee]">
          {data.items.map((item, index) => (
            <li key={index} className="flex items-center justify-between gap-3 py-3 text-sm">
              <span className="min-w-0">
                <span className="block font-semibold">{pickLocalized(item.name, locale)}</span>
                <span className="text-[#6f6f6a]">× {item.quantity}</span>
              </span>
              <span className="shrink-0 font-semibold">{formatMoney(item.lineTotal, locale)}</span>
            </li>
          ))}
        </ul>
        <p className="flex items-center justify-between border-t border-[#f3f3ee] pt-3 font-bold">
          <span>{t('customer.total')}</span>
          <span>{formatMoney(data.pricing.total, locale)}</span>
        </p>
      </section>
      {data.events.length ? (
        <ol className="space-y-2">
          {data.events.map((event, index) => (
            <li key={index} className="rounded-2xl border border-[#ecece6] bg-white px-4 py-3 text-sm">
              <p className="font-semibold">{orderStatusLabel(event.status, t)}</p>
              <p className="text-xs text-[#6f6f6a]">
                {new Intl.DateTimeFormat(locale === 'ar' ? 'ar-BH' : 'en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(event.createdAt))}
                {event.note ? ` · ${event.note}` : ''}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {data.status === 'PENDING' ? (
          <button type="button" disabled={cancel.isPending} onClick={() => cancel.mutate()} className="inline-flex h-11 items-center rounded-full border border-[#f0c8c5] px-5 text-sm font-semibold text-[#d9342b] disabled:opacity-60">
            {t('common.cancel')}
          </button>
        ) : null}
        {data.status === 'DELIVERED' ? null : open ? (
          <button type="button" disabled={reorder.isPending} onClick={() => reorder.mutate()} className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-bold text-[#111] disabled:opacity-60">
            {t('customer.orders.reorder')}
          </button>
        ) : null}
        <a href={supportHref(data.number)} className="inline-flex h-11 items-center rounded-full bg-[#f2f2ee] px-5 text-sm font-semibold">
          {t('customer.orders.getHelp')}
        </a>
      </div>
    </div>
  );
}
