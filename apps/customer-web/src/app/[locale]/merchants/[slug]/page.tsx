'use client';

import { api } from '@/components/providers';
import { Link } from '@/i18n/navigation';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { Badge, Card, DetailSkeleton, ErrorState } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { use } from 'react';

export default function MerchantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const locale = useLocale() as 'en' | 'ar';
  const merchant = useQuery({ queryKey: ['merchant', slug], queryFn: () => api.merchant(slug) });
  if (merchant.isLoading) return <DetailSkeleton />;
  if (merchant.error || !merchant.data) return <ErrorState title="Merchant" body={(merchant.error as Error)?.message ?? 'Missing'} />;
  const data = merchant.data;
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold">{pickLocalized(data.name, locale)}</h1>
            <p className="mt-2 text-muted-foreground">{pickLocalized(data.description, locale)}</p>
            <p className="mt-2 text-sm">
              {data.rating} · {data.deliveryMinutes} min · {data.address}
            </p>
          </div>
          <Badge tone={data.isOpen ? 'ok' : 'muted'}>{data.isOpen ? 'Open' : 'Closed'}</Badge>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {data.fulfillment.map((type) => (
            <Badge key={type}>{type}</Badge>
          ))}
        </div>
        <button
          className="mt-4 text-sm font-semibold underline"
          onClick={() => navigator.clipboard.writeText(window.location.href)}
        >
          Share merchant
        </button>
      </Card>
      {data.categories.map((category) => (
        <section key={category.id}>
          <h2 className="mb-3 text-xl font-semibold">{pickLocalized(category.name, locale)}</h2>
          <div className="grid gap-3">
            {category.products.map((product) => (
              <Link key={product.id} href={`/merchants/${slug}/products/${product.id}`}>
                <Card className="lift flex items-center justify-between p-4">
                  <div>
                    <p className="font-semibold">{pickLocalized(product.name, locale)}</p>
                    <p className="text-sm text-muted-foreground">{pickLocalized(product.description, locale)}</p>
                  </div>
                  <p className="font-semibold">{formatMoney(product.price, locale)}</p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
      <section>
        <h2 className="mb-3 text-xl font-semibold">Reviews</h2>
        <div className="grid gap-3">
          {data.reviews.map((review) => (
            <Card key={review.id} className="p-4">
              <p className="font-semibold">{review.author} · {review.rating}/5</p>
              <p className="text-sm">{review.comment}</p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
