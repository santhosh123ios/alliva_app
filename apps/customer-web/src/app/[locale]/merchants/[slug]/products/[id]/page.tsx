'use client';

import { api } from '@/components/providers';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { Button, Card, ErrorState, Input, Skeleton, SkeletonText } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { use, useState } from 'react';
import { toast } from 'sonner';

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const locale = useLocale() as 'en' | 'ar';
  const t = useTranslations();
  const client = useQueryClient();
  const product = useQuery({ queryKey: ['product', id], queryFn: () => api.product(id) });
  const [variantId, setVariantId] = useState<string | null>(null);
  const [addons, setAddons] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const add = useMutation({
    mutationFn: () => api.addItem({ productId: id, variantId, addonIds: addons, quantity, notes }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['cart'] });
      toast.success(t('customer.add'));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  if (product.isLoading) {
    return (
      <Card className="space-y-4 p-6" aria-busy>
        <Skeleton className="h-9 w-2/3" />
        <SkeletonText lines={2} />
        <Skeleton className="h-7 w-28" />
        <div className="flex gap-2"><Skeleton className="h-12 w-24" /><Skeleton className="h-12 w-24" /><Skeleton className="h-12 w-24" /></div>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-40" />
      </Card>
    );
  }
  if (!product.data) return <ErrorState title="Product" body={(product.error as Error)?.message ?? 'Missing'} />;
  const data = product.data;
  return (
    <Card className="space-y-4 p-6">
      <h1 className="text-3xl font-semibold">{pickLocalized(data.name, locale)}</h1>
      <p>{pickLocalized(data.description, locale)}</p>
      <p className="text-xl font-semibold">{formatMoney(data.price, locale)}</p>
      {data.variants.length ? (
        <div className="flex flex-wrap gap-2">
          {data.variants.map((variant) => (
            <Button key={variant.id} type="button" variant={variantId === variant.id ? 'default' : 'outline'} onClick={() => setVariantId(variant.id)}>
              {pickLocalized(variant.name, locale)} · {formatMoney(variant.price, locale)}
            </Button>
          ))}
        </div>
      ) : null}
      {data.addonGroups.map((group) => (
        <div key={group.id}>
          <p className="font-semibold">{pickLocalized(group.name, locale)}</p>
          {group.addons.map((addon) => (
            <label key={addon.id} className="mt-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={addons.includes(addon.id)}
                onChange={(event) =>
                  setAddons((current) => (event.target.checked ? [...current, addon.id] : current.filter((item) => item !== addon.id)))
                }
              />
              {pickLocalized(addon.name, locale)} · {formatMoney(addon.price, locale)}
            </label>
          ))}
        </div>
      ))}
      <Input type="number" min={1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
      <Input placeholder="Special instructions" value={notes} onChange={(event) => setNotes(event.target.value)} />
      <Button variant="yellow" disabled={!data.available} loading={add.isPending} onClick={() => add.mutate()}>
        {t('customer.add')}
      </Button>
    </Card>
  );
}
