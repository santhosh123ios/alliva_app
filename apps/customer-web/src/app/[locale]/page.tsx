'use client';

import { api } from '@/components/providers';
import { areas, usePlace } from '@/lib/place';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { Badge, Card, CardGridSkeleton, EmptyState, ErrorState, Mascot, Skeleton } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export default function HomePage() {
  const t = useTranslations();
  const locale = useLocale() as 'en' | 'ar';
  const areaId = usePlace((state) => state.area);
  const setArea = usePlace((state) => state.setArea);
  const area = areas.find((item) => item.id === areaId) ?? areas[0]!;
  const home = useQuery({
    queryKey: ['home', area.id],
    queryFn: () => api.home(`?lat=${area.lat}&lng=${area.lng}`),
  });

  return (
    <div className="space-y-8">
      <section className="grid items-center gap-6 rounded-3xl bg-primary p-6 text-[#111111] md:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="text-sm font-semibold">{t('customer.guest')}</p>
          <h1 className="font-display mt-2 text-4xl md:text-5xl">{t('customer.headline')}</h1>
          <label className="mt-5 block text-sm font-medium">
            {t('customer.location')}
            <select
              className="mt-1 h-12 w-full rounded-xl border border-[#111111] bg-white px-3 text-[#111111]"
              value={area.id}
              onChange={(event) => setArea(event.target.value)}
            >
              {areas.map((item) => (
                <option key={item.id} value={item.id}>
                  {locale === 'ar' ? item.ar : item.en}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Mascot className="mx-auto h-48" />
      </section>
      {home.isLoading ? <HomeSkeleton /> : null}
      {home.error ? <ErrorState title={t('common.error')} body={(home.error as Error).message} /> : null}
      {home.data?.exclusiveMerchant ? (
        <Card className="p-4">{t('customer.exclusive')}</Card>
      ) : null}
      {home.data ? (
        <>
          <div className="flex gap-2 overflow-x-auto">
            {home.data.categories.map((category) => (
              <Badge key={category.id}>{pickLocalized(category.name, locale)}</Badge>
            ))}
          </div>
          <Section title={t('customer.nearby')}>
            <MerchantGrid merchants={home.data.merchants} locale={locale} />
          </Section>
          <Section title={t('customer.offers')}>
            {home.data.offers.length ? (
              <div className="grid gap-3 md:grid-cols-3">
                {home.data.offers.map((offer) => (
                  <Link key={offer.id} href={`/merchants/${offer.merchantSlug}`}>
                    <Card className="lift p-4">
                      <p className="font-semibold">{pickLocalized(offer.title, locale)}</p>
                      <p className="text-sm text-muted-foreground">{pickLocalized(offer.merchantName, locale)}</p>
                    </Card>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState title={t('common.empty')} body={t('customer.offers')} />
            )}
          </Section>
          <Section title={t('customer.freeDelivery')}>
            <MerchantGrid merchants={home.data.freeDelivery} locale={locale} />
          </Section>
          <Section title={t('customer.top')}>
            <ProductRow products={home.data.topProducts} locale={locale} />
          </Section>
        </>
      ) : null}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-8" aria-busy>
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-7 w-24 shrink-0 rounded-full" />)}
      </div>
      <section>
        <Skeleton className="mb-3 h-7 w-40" />
        <CardGridSkeleton count={6} />
      </section>
      <section>
        <Skeleton className="mb-3 h-7 w-32" />
        <CardGridSkeleton count={3} columns="md:grid-cols-3" />
      </section>
      <section>
        <Skeleton className="mb-3 h-7 w-44" />
        <CardGridSkeleton count={4} columns="sm:grid-cols-2 lg:grid-cols-4" />
      </section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function MerchantGrid({
  merchants,
  locale,
}: {
  merchants: { slug: string; name: { en: string; ar: string }; rating: string; deliveryMinutes: number; isOpen: boolean; minimumOrder: string }[];
  locale: 'en' | 'ar';
}) {
  if (!merchants.length) return <EmptyState title="No merchants" body="Try another area." />;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {merchants.map((merchant) => (
        <Link key={merchant.slug} href={`/merchants/${merchant.slug}`}>
          <Card className="lift p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold">{pickLocalized(merchant.name, locale)}</h3>
              <Badge tone={merchant.isOpen ? 'ok' : 'muted'}>{merchant.isOpen ? 'Open' : 'Closed'}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {merchant.rating} · {merchant.deliveryMinutes} min · {formatMoney(merchant.minimumOrder, locale)} min
            </p>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function ProductRow({
  products,
  locale,
}: {
  products: { id: string; merchantSlug: string; name: { en: string; ar: string }; price: string }[];
  locale: 'en' | 'ar';
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {products.map((product) => (
        <Link key={product.id} href={`/merchants/${product.merchantSlug}/products/${product.id}`}>
          <Card className="lift p-4">
            <p className="font-semibold">{pickLocalized(product.name, locale)}</p>
            <p className="mt-2">{formatMoney(product.price, locale)}</p>
          </Card>
        </Link>
      ))}
    </div>
  );
}
