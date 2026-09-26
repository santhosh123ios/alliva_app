'use client';

import { api } from '@/components/providers';
import { Link } from '@/i18n/navigation';
import { Badge, Button, Card, EmptyState, ErrorState, ListSkeleton } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { pickLocalized } from '@alliva/design-tokens';
import { useLocale } from 'next-intl';

export default function OrdersPage() {
  const locale = useLocale() as 'en' | 'ar';
  const orders = useQuery({ queryKey: ['orders'], queryFn: () => api.orders() });
  if (orders.isLoading) return <ListSkeleton rows={4} />;
  if (orders.error) {
    if ((orders.error as Error).message === 'Sign in required') {
      return (
        <Card className="space-y-3 p-6">
          <h1 className="text-xl font-semibold">Sign in to see your orders</h1>
          <Button asChild><Link href="/login">Sign in</Link></Button>
        </Card>
      );
    }
    return <ErrorState title="Orders" body={(orders.error as Error).message} />;
  }
  if (!orders.data?.length) return <EmptyState title="Orders" body="Your orders will show up here." />;
  return (
    <div className="space-y-3">
      {orders.data.map((order) => (
        <Link key={order.id} href={`/orders/${order.id}`}>
          <Card className="lift flex items-center justify-between p-4">
            <div>
              <p className="font-semibold">{order.number}</p>
              <p className="text-sm">{pickLocalized(order.merchantName, locale)}</p>
            </div>
            <Badge>{order.status}</Badge>
          </Card>
        </Link>
      ))}
    </div>
  );
}
