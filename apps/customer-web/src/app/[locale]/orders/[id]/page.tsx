'use client';

import { api } from '@/components/providers';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { Badge, Button, Card, ErrorState, Skeleton, SkeletonText } from '@alliva/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { use, useEffect } from 'react';
import { io } from 'socket.io-client';

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const order = useQuery({ queryKey: ['order', id], queryFn: () => api.order(id) });
  useEffect(() => {
    let active = true;
    let socket: ReturnType<typeof io> | undefined;
    void api.socketToken().then(({ token }) => {
      if (!active) return;
      socket = io(process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000', { auth: { token } });
      socket.emit('join', { orderId: id });
      socket.on('order.updated', () => void client.invalidateQueries({ queryKey: ['order', id] }));
    }).catch(() => undefined);
    return () => {
      active = false;
      socket?.close();
    };
  }, [client, id]);
  if (order.isLoading) {
    return (
      <div className="space-y-4" aria-busy>
        <div className="flex items-center justify-between"><Skeleton className="h-8 w-40" /><Skeleton className="h-6 w-20 rounded-full" /></div>
        <Card className="space-y-3 p-5"><SkeletonText lines={4} /></Card>
        <Card className="space-y-3 p-5"><SkeletonText lines={3} /></Card>
      </div>
    );
  }
  if (!order.data) return <ErrorState title="Order" body={(order.error as Error)?.message ?? 'Missing'} />;
  const data = order.data;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{data.number}</h1>
        <Badge>{data.status}</Badge>
      </div>
      <Card className="space-y-2 p-5">
        <p>{pickLocalized(data.merchantName, locale)}</p>
        <p>Merchant {data.merchantPhone}</p>
        <p>Driver {data.driverName ?? 'Not assigned'} {data.driverPhone ?? ''}</p>
        <p>Arrival {data.estimatedArrival ?? 'Calculating'}</p>
        {data.items.map((item, index) => (
          <p key={index}>{pickLocalized(item.name, locale)} × {item.quantity} · {formatMoney(item.lineTotal, locale)}</p>
        ))}
        <p className="font-semibold">Total {formatMoney(data.pricing.total, locale)}</p>
      </Card>
      <ol className="space-y-2">
        {data.events.map((event, index) => (
          <li key={index} className="rounded-xl bg-card p-3 text-sm">{event.status} · {event.note}</li>
        ))}
      </ol>
      {data.status === 'PENDING' ? (
        <Button variant="destructive" onClick={() => api.cancel(data.id, 'Changed my mind').then(() => client.invalidateQueries({ queryKey: ['order', id] }))}>
          Cancel order
        </Button>
      ) : null}
      <Button variant="outline" onClick={() => api.reorder(data.id)}>Reorder</Button>
    </div>
  );
}
