'use client';

import { api } from '@/components/providers';
import { Link } from '@/i18n/navigation';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { Button, Card, EmptyState, ErrorState, Input, ListSkeleton, Skeleton } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

export default function CartPage() {
  const locale = useLocale() as 'en' | 'ar';
  const t = useTranslations();
  const client = useQueryClient();
  const cart = useQuery({ queryKey: ['cart'], queryFn: () => api.cart() });
  const [code, setCode] = useState('');
  const refresh = () => client.invalidateQueries({ queryKey: ['cart'] });
  const promo = useMutation({ mutationFn: () => api.applyPromo(code), onSuccess: refresh });
  if (cart.isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]" aria-busy>
        <ListSkeleton rows={3} />
        <Card className="space-y-3 p-5">
          {Array.from({ length: 6 }, (_, index) => <div key={index} className="flex justify-between"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-16" /></div>)}
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </Card>
      </div>
    );
  }
  if (cart.error) return <ErrorState title={t('common.error')} body={(cart.error as Error).message} />;
  if (!cart.data?.items.length) return <EmptyState title={t('nav.cart')} body={t('common.empty')} />;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
      <div className="space-y-3">
        {cart.data.items.map((item) => (
          <Card key={item.id} className="flex items-center justify-between p-4">
            <div>
              <p className="font-semibold">{pickLocalized(item.name, locale)}</p>
              <p className="text-sm text-muted-foreground">{formatMoney(item.lineTotal, locale)}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => api.updateItem(item.id, Math.max(1, item.quantity - 1)).then(refresh)}>-</Button>
              <span className="flex h-11 items-center">{item.quantity}</span>
              <Button variant="outline" onClick={() => api.updateItem(item.id, item.quantity + 1).then(refresh)}>+</Button>
            </div>
          </Card>
        ))}
      </div>
      <Card className="space-y-3 p-5">
        <Price label="Subtotal" value={cart.data.pricing.subtotal} locale={locale} />
        <Price label="Discount" value={cart.data.pricing.discount} locale={locale} />
        <Price label="Delivery" value={cart.data.pricing.deliveryFee} locale={locale} />
        <Price label="Free delivery saved" value={cart.data.pricing.deliveryFeeSaved} locale={locale} />
        <Price label="Tax" value={cart.data.pricing.tax} locale={locale} />
        <Price label="Total" value={cart.data.pricing.total} locale={locale} />
        <div className="flex gap-2">
          <Input value={code} onChange={(event) => setCode(event.target.value)} placeholder="WELCOME10" />
          <Button variant="outline" loading={promo.isPending} onClick={() => promo.mutate()}>Apply</Button>
        </div>
        <Button asChild variant="yellow" className="w-full">
          <Link href="/checkout">{t('customer.checkout')}</Link>
        </Button>
      </Card>
    </div>
  );
}

function Price({ label, value, locale }: { label: string; value: string; locale: 'en' | 'ar' }) {
  return (
    <div className="flex justify-between text-sm">
      <span>{label}</span>
      <span>{formatMoney(value, locale)}</span>
    </div>
  );
}
