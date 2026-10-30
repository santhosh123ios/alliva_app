import { api } from '@/components/providers';
import { useCartAdd } from '@/components/store-switch';
import { categoryIcon, HeroBanner, MerchantTile, ProductTile } from '@/components/storefront';
import { LocationPicker } from '@/components/location-picker';
import { pointKey, useLocationStore, useSearchPoint } from '@/lib/location';
import { formatMoney } from '@alliva/design-tokens';
import { useRouter } from '@/i18n/navigation';
import { usePlace } from '@/lib/place';
import { cn, EmptyState, ErrorState, Skeleton } from '@alliva/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export default function HomePage() {
  const t = useTranslations();
  const locale = useLocale() as 'en' | 'ar';
  const router = useRouter();
  const client = useQueryClient();
  const query = usePlace((state) => state.query);
  const { point, chosen } = useSearchPoint();
  const locating = useLocationStore((state) => state.status === 'locating');
  const [pickerOpen, setPickerOpen] = useState(false);
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
    queryKey: ['home', pointKey(point), debounced],
    queryFn: () => api.home(`?lat=${point.lat.toFixed(6)}&lng=${point.lng.toFixed(6)}${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`),
    // Keep the old list while typing a search, but show skeletons when the location itself changes.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === pointKey(point) ? keepPreviousData(previous) : undefined),
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const favouriteIds = new Set(
    ((customer.data as { favourites?: { merchantId: string }[] } | undefined)?.favourites ?? []).map((row) => row.merchantId),
  );
  const cartAdd = useCartAdd();
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
  const inCategory = (merchant: { categorySlugs: string[] }) => !category || merchant.categorySlugs.includes(category);
  const allMerchants = (home.data?.merchants ?? []).filter(inCategory);
  const merchants = (home.data?.openMerchants ?? home.data?.merchants ?? []).filter(inCategory);
  const closedMerchants = (home.data?.closedMerchants ?? []).filter(inCategory);
  const merchantIds = new Set(allMerchants.map((merchant) => merchant.id));
  const nothingNearby = Boolean(home.data?.located) && !debounced && !home.data?.merchants.length;
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
      {home.isLoading || (locating && !home.data) ? <HomeSkeleton /> : null}
      {home.error && !home.data ? (
        <div className="space-y-3">
          <ErrorState title={t('customer.locationFlow.storesFailedTitle')} body={t('customer.locationFlow.storesFailedBody')} />
          <div className="text-center">
            <button type="button" onClick={() => void home.refetch()} className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-bold text-[#111]">
              {t('customer.locationFlow.retry')}
            </button>
          </div>
        </div>
      ) : null}

      {nothingNearby ? (
        <EmptyState
          title={t('customer.locationFlow.noStoresTitle')}
          body={chosen ? t('customer.locationFlow.noStoresBody') : t('customer.locationFlow.noStoresChoose')}
          action={
            <button type="button" onClick={() => setPickerOpen(true)} className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-bold text-[#111]">
              {t('customer.locationFlow.change')}
            </button>
          }
        />
      ) : null}

      {home.data && !nothingNearby ? (
        <>
          <section id="popular">
            <SectionHeader
              title={t('customer.popular')}
              action={merchants.length > 4 ? (showMerchants ? t('customer.showLess') : t('customer.seeAll')) : null}
              expanded={showMerchants}
              onAction={() => setShowMerchants((value) => !value)}
            />
            {merchants.length ? (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3 pb-1 md:grid-cols-2 xl:grid-cols-4">
                {(showMerchants ? merchants : merchants.slice(0, 4)).map((merchant) => (
                  <div key={merchant.slug} className="min-w-0">
                  <MerchantTile
                    merchant={merchant}
                    locale={locale}
                    saved={favouriteIds.has(merchant.id)}
                    saveLabel={favouriteIds.has(merchant.id) ? t('customer.saved') : t('customer.saveStore')}
                    closedLabel={t('customer.closed')}
                    unavailableLabel={t('customer.temporarilyUnavailable')}
                    minuteLabel={t('customer.minuteRange', {
                      from: Math.max(10, merchant.deliveryMinutes - 5),
                      to: merchant.deliveryMinutes + 5,
                    })}
                    distanceLabel={merchant.distanceKm ? t('customer.distanceKm', { km: Number(merchant.distanceKm).toFixed(1) }) : null}
                    deliveryLabel={deliveryLabel(merchant)}
                    onToggleSave={() => toggleSave(merchant.id)}
                  />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title={closedMerchants.length ? t('customer.locationFlow.allClosedTitle') : t('common.empty')}
                body={closedMerchants.length ? t('customer.locationFlow.allClosedBody') : t('customer.noMatches')}
              />
            )}
          </section>

          {closedMerchants.length ? (
            <section aria-labelledby="closed-stores">
              <h2 id="closed-stores" className="mb-1 text-xl font-bold tracking-tight">{t('customer.locationFlow.closedTitle')}</h2>
              <p className="mb-4 text-sm text-[#6f6f6a]">{t('customer.locationFlow.closedBody')}</p>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3 opacity-80 md:grid-cols-2 xl:grid-cols-4">
                {closedMerchants.map((merchant) => (
                  <div key={merchant.slug} className="min-w-0">
                    <MerchantTile
                      merchant={merchant}
                      locale={locale}
                      saved={favouriteIds.has(merchant.id)}
                      saveLabel={favouriteIds.has(merchant.id) ? t('customer.saved') : t('customer.saveStore')}
                      closedLabel={t('customer.closed')}
                      unavailableLabel={t('customer.temporarilyUnavailable')}
                      minuteLabel={t('customer.minuteRange', { from: Math.max(10, merchant.deliveryMinutes - 5), to: merchant.deliveryMinutes + 5 })}
                      distanceLabel={merchant.distanceKm ? t('customer.distanceKm', { km: Number(merchant.distanceKm).toFixed(1) }) : null}
                      deliveryLabel={deliveryLabel(merchant)}
                      onToggleSave={() => toggleSave(merchant.id)}
                    />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

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
                  const merchant = allMerchants.find((item) => item.id === product.merchantId);
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
                    pending={cartAdd.pendingId === product.id}
                    onAdd={() => cartAdd.requestAdd(product.merchantId, product.merchantName, { productId: product.id, quantity: 1, preview: { name: product.name, description: product.description, imageUrl: product.imageUrl, unitPrice: product.price } })}
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
      {cartAdd.dialog}
      <LocationPicker open={pickerOpen} onOpenChange={setPickerOpen} />
    </div>
  );

  function deliveryLabel(merchant: { deliveryAvailable?: boolean; freeDelivery: boolean; deliveryFee: string; fulfillment: string[] }) {
    if (!merchant.fulfillment.includes('DELIVERY') || merchant.deliveryAvailable === false) return null;
    if (merchant.freeDelivery || Number(merchant.deliveryFee) === 0) return { text: t('customer.freeDeliveryBadge'), free: true };
    return { text: t('customer.locationFlow.deliveryFeeShort', { fee: formatMoney(merchant.deliveryFee, locale) }), free: false };
  }
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
