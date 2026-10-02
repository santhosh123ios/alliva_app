'use client';

import { api } from '@/components/providers';
import { categoryIcon, formatDistanceKm, HeroBanner, MerchantTile, ProductTile } from '@/components/storefront';
import { useRouter } from '@/i18n/navigation';
import { areas, usePlace } from '@/lib/place';
import { cn, EmptyState, ErrorState, Skeleton } from '@alliva/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export default function HomePage() {
  const t = useTranslations();
  const locale = useLocale() as 'en' | 'ar';
  const router = useRouter();
  const client = useQueryClient();
  const areaId = usePlace((state) => state.area);
  const query = usePlace((state) => state.query);
  const area = areas.find((item) => item.id === areaId) ?? areas[0]!;
  const [debounced, setDebounced] = useState(query);
  const [category, setCategory] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [showMerchants, setShowMerchants] = useState(false);
  const [showProducts, setShowProducts] = useState(false);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const customer = useQuery({
    queryKey: ['customer'],
    queryFn: () => api.customer(),
    enabled: me.data?.kind === 'CUSTOMER',
    retry: false,
  });
  const home = useQuery({
    queryKey: ['home', area.id, debounced],
    queryFn: () => api.home(`?lat=${encodeURIComponent(area.lat)}&lng=${encodeURIComponent(area.lng)}${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const favouriteIds = new Set(
    ((customer.data as { favourites?: { merchantId: string }[] } | undefined)?.favourites ?? []).map((row) => row.merchantId),
  );
  const add = useMutation({
    mutationFn: async (productId: string) => {
      await api.guest().catch(() => undefined);
      return api.addItem({ productId, quantity: 1 });
    },
    onSuccess: async () => {
      toast.success(t('customer.added'));
      await client.invalidateQueries({ queryKey: ['cart'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const save = useMutation({
    mutationFn: async (merchantId: string) => {
      const saved = favouriteIds.has(merchantId);
      return saved ? api.unfavourite(merchantId) : api.favourite(merchantId);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['customer'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const categories = home.data?.categories ?? [];
  const visibleCategories = categories.slice(0, 5);
  const overflowCategories = categories.slice(5);
  const merchants = (home.data?.merchants ?? []).filter((merchant) => {
    if (category && !merchant.categorySlugs.includes(category)) return false;
    return true;
  });
  const merchantIds = new Set(merchants.map((merchant) => merchant.id));
  const products = (home.data?.topProducts ?? []).filter((product) => product.available && merchantIds.has(product.merchantId));

  const toggleSave = (merchantId: string) => {
    if (me.data?.kind !== 'CUSTOMER') {
      router.push('/login');
      return;
    }
    save.mutate(merchantId);
  };

  return (
    <div className="space-y-5 md:space-y-8">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {visibleCategories.map((item) => {
          const Icon = categoryIcon(item.slug);
          const selected = category === item.slug;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setCategory(selected ? null : item.slug)}
              className={cn(
                'inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold',
                selected ? 'border-transparent bg-primary text-[#111]' : 'border-[#e6e6e0] bg-white',
              )}
            >
              <Icon className="size-4" />
              {item.name[locale] || item.name.en}
            </button>
          );
        })}
        {overflowCategories.length ? (
          <div className="relative">
            <button
              type="button"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((value) => !value)}
              className="inline-flex h-11 items-center rounded-full border border-[#e6e6e0] bg-white px-4 text-sm font-semibold"
            >
              {t('customer.more')}
            </button>
            {moreOpen ? (
              <ul className="absolute start-0 z-20 mt-2 w-48 rounded-2xl border bg-white py-1 shadow-lg">
                {overflowCategories.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="w-full px-4 py-2 text-start text-sm font-medium hover:bg-[#f7f7f5]"
                      onClick={() => {
                        setCategory(item.slug);
                        setMoreOpen(false);
                      }}
                    >
                      {item.name[locale] || item.name.en}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <HeroBanner title={t('customer.heroTitle')} subtitle={t('customer.heroSubtitle')} action={t('customer.exploreNearby')} />

      {home.data?.exclusiveMerchant ? <p className="rounded-2xl bg-[#111] px-4 py-3 text-sm font-medium text-white">{t('customer.exclusive')}</p> : null}
      {home.isLoading ? <HomeSkeleton /> : null}
      {home.error ? <ErrorState title={t('common.error')} body={(home.error as Error).message} /> : null}

      {home.data ? (
        <>
          <section id="popular">
            <SectionHeader
              title={t('customer.popular')}
              action={merchants.length > 4 ? (showMerchants ? t('customer.showLess') : t('customer.seeAll')) : null}
              expanded={showMerchants}
              onAction={() => setShowMerchants((value) => !value)}
            />
            {merchants.length ? (
              <div className={cn('flex snap-x gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible xl:grid-cols-4', showMerchants && 'grid grid-cols-1 snap-none md:grid-cols-2')}>
                {(showMerchants ? merchants : merchants.slice(0, 4)).map((merchant) => (
                  <div key={merchant.slug} className={cn(!showMerchants && 'w-[52%] max-w-[180px] shrink-0 snap-start md:w-auto md:max-w-none')}>
                  <MerchantTile
                    merchant={merchant}
                    locale={locale}
                    saved={favouriteIds.has(merchant.id)}
                    saveLabel={favouriteIds.has(merchant.id) ? t('customer.saved') : t('customer.saveStore')}
                    closedLabel={t('customer.closed')}
                    minuteLabel={t('customer.minuteRange', {
                      from: Math.max(10, merchant.deliveryMinutes - 5),
                      to: merchant.deliveryMinutes + 5,
                    })}
                    distanceLabel={(() => {
                      const km = formatDistanceKm(merchant.latitude, merchant.longitude, area);
                      return km ? t('customer.distanceKm', { km }) : null;
                    })()}
                    onToggleSave={() => toggleSave(merchant.id)}
                  />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title={t('common.empty')} body={t('customer.noMatches')} />
            )}
          </section>

          <section>
            <SectionHeader
              title={t('customer.topPicks')}
              action={products.length > 4 ? (showProducts ? t('customer.showLess') : t('customer.seeAll')) : null}
              expanded={showProducts}
              onAction={() => setShowProducts((value) => !value)}
            />
            {products.length ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-4">
                {(showProducts ? products : products.slice(0, 4)).map((product) => {
                  const merchant = (home.data?.merchants ?? []).find((item) => item.id === product.merchantId);
                  return (
                  <ProductTile
                    key={product.id}
                    product={product}
                    locale={locale}
                    addLabel={t('customer.addShort')}
                    minuteLabel={
                      merchant
                        ? t('customer.minuteRange', {
                            from: Math.max(10, merchant.deliveryMinutes - 5),
                            to: merchant.deliveryMinutes + 5,
                          })
                        : null
                    }
                    pending={add.isPending && add.variables === product.id}
                    onAdd={() => add.mutate(product.id)}
                  />
                  );
                })}
              </div>
            ) : (
              <EmptyState title={t('common.empty')} body={t('customer.noMatches')} />
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function SectionHeader({
  title,
  action,
  expanded,
  onAction,
}: {
  title: string;
  action: string | null;
  expanded: boolean;
  onAction: () => void;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      {action ? (
        <button type="button" onClick={onAction} className="inline-flex items-center gap-1 text-sm font-semibold">
          {action}
          <ChevronRight className={cn('size-4 rtl:rotate-180', expanded && 'rotate-90 rtl:rotate-90')} />
        </button>
      ) : null}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-8" aria-busy>
      <section>
        <Skeleton className="mb-4 h-7 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-64 rounded-2xl" />)}
        </div>
      </section>
      <section>
        <Skeleton className="mb-4 h-7 w-40" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-72 rounded-2xl" />)}
        </div>
      </section>
    </div>
  );
}
