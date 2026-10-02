'use client';

import { CartButtonSpinner, flyFromButton } from '@/components/cart-motion';
import { api } from '@/components/providers';
import { categoryIcon, formatDistanceKm } from '@/components/storefront';
import { Link } from '@/i18n/navigation';
import { areas, usePlace } from '@/lib/place';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { cn, Dialog, DialogContent, DialogDescription, DialogTitle, EmptyState, ErrorState, Skeleton } from '@alliva/ui';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Bike, Check, ChevronDown, Clock, Cloud, Heart, MapPin, Plus, Search, SlidersHorizontal, Star } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

type Scope = 'all' | 'stores' | 'products';
type Shelf = 'all' | 'meals' | 'drinks' | 'desserts';
type SortKey = 'recent' | 'rating' | 'nearest';
type MenuName = 'filter' | 'sort' | null;
type StoreCardData = NonNullable<Awaited<ReturnType<typeof api.home>>>['merchants'][number];
type MenuProduct = NonNullable<Awaited<ReturnType<typeof api.merchant>>>['categories'][number]['products'][number];
type SavedProduct = { product: MenuProduct; shelf: Exclude<Shelf, 'all'>; savedAt: string; distance: number };

type Collection = { id: string; name: string; merchantIds: string[] };

const collectionsKey = 'alliva.favourite-collections';
const hiddenKey = 'alliva.hidden-favourite-products';
const logoTones = ['bg-[#1f8a4c] text-white', 'bg-[#5c3d2e] text-white', 'bg-[#f3b6c8] text-[#111]', 'bg-[#ffc400] text-[#111]', 'bg-[#111] text-white'];

export default function FavouritesPage() {
  const t = useTranslations();
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const areaId = usePlace((state) => state.area);
  const area = areas.find((item) => item.id === areaId) ?? areas[0]!;
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const customer = useQuery({
    queryKey: ['customer'],
    queryFn: () => api.customer(),
    enabled: me.data?.kind === 'CUSTOMER',
    retry: false,
  });
  const home = useQuery({
    queryKey: ['home', area.id],
    queryFn: () => api.home(`?lat=${encodeURIComponent(area.lat)}&lng=${encodeURIComponent(area.lng)}`),
    enabled: me.data?.kind === 'CUSTOMER',
  });
  const [scope, setScope] = useState<Scope>('all');
  const [shelf, setShelf] = useState<Shelf>('all');
  const [sort, setSort] = useState<SortKey>('recent');
  const [query, setQuery] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [freeOnly, setFreeOnly] = useState(false);
  const [menu, setMenu] = useState<MenuName>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionName, setCollectionName] = useState('');
  const [collections, setCollections] = useState<Collection[]>([]);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const filterLabelId = useId();

  useEffect(() => {
    setCollections(readList<Collection>(collectionsKey));
    setHiddenIds(readList<string>(hiddenKey));
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const favouriteRows = ((customer.data as { favourites?: { merchantId: string; createdAt?: string }[] } | undefined)?.favourites ?? []);
  const savedAt = useMemo(() => new Map(favouriteRows.map((row) => [row.merchantId, row.createdAt ?? ''])), [favouriteRows]);
  const savedMerchants = useMemo(
    () => (home.data?.merchants ?? []).filter((merchant) => savedAt.has(merchant.id)),
    [home.data?.merchants, savedAt],
  );
  const menus = useQueries({
    queries: savedMerchants.map((merchant) => ({
      queryKey: ['merchant', merchant.slug],
      queryFn: () => api.merchant(merchant.slug),
      staleTime: 60_000,
    })),
  });

  const removeStore = useMutation({
    mutationFn: (merchantId: string) => api.unfavourite(merchantId),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['customer'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
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

  const distanceOf = (merchant: StoreCardData) => {
    const km = formatDistanceKm(merchant.latitude, merchant.longitude, area);
    return km ? Number(km) : Number.POSITIVE_INFINITY;
  };

  const collection = collections.find((item) => item.id === collectionId) ?? null;
  const needle = query.trim().toLowerCase();
  const stores = savedMerchants
    .filter((merchant) => !collection || collection.merchantIds.includes(merchant.id))
    .filter((merchant) => !openOnly || merchant.isOpen)
    .filter((merchant) => !freeOnly || merchant.freeDelivery)
    .filter((merchant) => !needle || storeHaystack(merchant, locale).includes(needle))
    .sort((a, b) => compareStores(a, b, sort, savedAt, distanceOf));

  const hidden = new Set(hiddenIds);
  const products = topPerStore(
    dedupeProducts(
      menus.flatMap((result, index) => {
        const merchant = savedMerchants[index];
        const menuData = result.data;
        if (!merchant || !menuData) return [];
        if (collection && !collection.merchantIds.includes(merchant.id)) return [];
        if (openOnly && !merchant.isOpen) return [];
        if (freeOnly && !merchant.freeDelivery) return [];
        const storeMatches = !needle || storeHaystack(merchant, locale).includes(needle);
        return menuData.categories.flatMap((category) =>
          category.products
            .filter((product) => product.available && !hidden.has(product.id))
            .filter((product) => {
              if (storeMatches) return true;
              const name = `${pickLocalized(product.name, locale)} ${pickLocalized(product.merchantName, locale)}`.toLowerCase();
              return name.includes(needle);
            })
            .map((product) => ({
              product,
              shelf: productShelf(category.name, product.name),
              savedAt: savedAt.get(merchant.id) ?? '',
              distance: distanceOf(merchant),
            })),
        );
      }),
    ),
  ).sort((a, b) => compareProducts(a, b, sort));

  const shelved = shelf === 'all' ? products : products.filter((item) => item.shelf === shelf);
  const storeCount = stores.length;
  const productCount = products.length;
  const filtering = Boolean(needle) || openOnly || freeOnly || Boolean(collection);
  const menusLoading = menus.some((result) => result.isLoading);

  const hideProduct = (productId: string) => {
    const next = [...hiddenIds, productId];
    setHiddenIds(next);
    window.localStorage.setItem(hiddenKey, JSON.stringify(next));
  };

  const createCollection = (event: FormEvent) => {
    event.preventDefault();
    const name = collectionName.trim();
    if (!name) return;
    const next = [...collections, { id: crypto.randomUUID(), name, merchantIds: savedMerchants.map((merchant) => merchant.id) }];
    setCollections(next);
    window.localStorage.setItem(collectionsKey, JSON.stringify(next));
    setCollectionName('');
    setCollectionOpen(false);
    toast.success(t('customer.savedPage.collectionCreated'));
  };

  if (me.isLoading || (me.data?.kind === 'CUSTOMER' && (customer.isLoading || home.isLoading))) return <FavouritesSkeleton />;
  if (!me.data || me.data.kind !== 'CUSTOMER') {
    return (
      <div className="space-y-4">
        <PageIntro />
        <EmptyState
          title={t('customer.favourites')}
          body={t('customer.signInFavourites')}
          action={
            <Link href="/login" className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-[#111]">
              {t('auth.signIn')}
            </Link>
          }
        />
      </div>
    );
  }
  if (customer.error || home.error) {
    return <ErrorState title={t('common.error')} body={((customer.error ?? home.error) as Error).message} />;
  }

  const showStores = scope !== 'products';
  const showProducts = scope !== 'stores';

  return (
    <div>
      <div className="mb-5">
        <div className="lg:flex lg:items-center lg:justify-between lg:gap-6">
        <PageIntro />
        <div ref={menuRef} className="mt-4 flex flex-wrap items-center gap-2 lg:mt-0 lg:justify-end">
          <label className="relative order-1 min-w-0 flex-1 lg:w-48 lg:flex-none">
            <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-[#8d8d88]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('customer.savedPage.search')}
              aria-label={t('customer.savedPage.search')}
              className="h-11 w-full rounded-full border border-[#e6e6e0] bg-white ps-10 pe-4 text-sm outline-none placeholder:text-[#8d8d88] focus:border-[#111]"
            />
          </label>
          <div role="tablist" aria-label={t('customer.favourites')} className="order-3 flex w-full rounded-full bg-[#efefeb] p-1 lg:order-2 lg:w-auto">
            <ScopeTab selected={scope === 'all'} onClick={() => setScope('all')}>{t('customer.savedPage.allCount', { count: storeCount + productCount })}</ScopeTab>
            <ScopeTab selected={scope === 'stores'} onClick={() => setScope('stores')}>{t('customer.savedPage.storesCount', { count: storeCount })}</ScopeTab>
            <ScopeTab selected={scope === 'products'} onClick={() => setScope('products')}>{t('customer.savedPage.productsCount', { count: productCount })}</ScopeTab>
          </div>
          <div className="relative order-2 lg:order-3">
            <button
              type="button"
              aria-expanded={menu === 'filter'}
              aria-controls={filterLabelId}
              onClick={() => setMenu(menu === 'filter' ? null : 'filter')}
              className={cn(
                'inline-flex h-11 w-11 items-center justify-center gap-2 rounded-full border bg-white text-sm font-semibold lg:w-auto lg:px-4',
                openOnly || freeOnly ? 'border-primary bg-[#fff6d6]' : 'border-[#e6e6e0]',
              )}
            >
              <SlidersHorizontal className="size-4" />
              <span className="hidden lg:inline">{t('customer.savedPage.filter')}</span>
            </button>
            {menu === 'filter' ? (
              <div id={filterLabelId} className="absolute end-0 z-20 mt-2 w-52 overflow-hidden rounded-2xl border border-[#ecece6] bg-white py-1 shadow-lg">
                <FilterRow label={t('customer.savedPage.openNow')} checked={openOnly} onClick={() => setOpenOnly((value) => !value)} />
                <FilterRow label={t('customer.freeDelivery')} checked={freeOnly} onClick={() => setFreeOnly((value) => !value)} />
              </div>
            ) : null}
          </div>
          <SortMenu className="relative order-4 hidden lg:block" sort={sort} open={menu === 'sort'} onToggle={() => setMenu(menu === 'sort' ? null : 'sort')} onSort={(value) => { setSort(value); setMenu(null); }} />
        </div>
        </div>
        <p className="mt-2 hidden max-w-xl text-base text-[#6f6f6a] lg:block">{t('customer.savedPage.subtitle')}</p>
      </div>

      {collections.length ? (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          <ShelfChip selected={!collectionId} onClick={() => setCollectionId(null)}>{t('customer.orders.all')}</ShelfChip>
          {collections.map((item) => (
            <ShelfChip key={item.id} selected={collectionId === item.id} onClick={() => setCollectionId(item.id === collectionId ? null : item.id)}>
              {item.name}
            </ShelfChip>
          ))}
        </div>
      ) : null}

      {!savedMerchants.length && !filtering ? (
        <EmptyState title={t('customer.favourites')} body={t('customer.noFavourites')} />
      ) : (
        <>
          {showStores ? (
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-xl lg:text-2xl">{t('customer.savedPage.stores')}</h2>
                {scope === 'all' && stores.length ? (
                  <button type="button" onClick={() => setScope('stores')} className="inline-flex items-center gap-1 text-sm font-semibold text-[#111] lg:text-[#2563eb]">
                    <span className="lg:hidden">{t('customer.seeAll')}</span>
                    <span className="hidden lg:inline">{t('customer.savedPage.viewAllStores')}</span>
                    <ArrowRight className="size-4 rtl:rotate-180" />
                  </button>
                ) : null}
              </div>
              {stores.length ? (
                <div className={cn('flex snap-x gap-3 overflow-x-auto pb-2', scope === 'stores' && 'grid grid-cols-1 snap-none overflow-visible sm:grid-cols-2', 'lg:grid lg:snap-none lg:grid-cols-4 lg:overflow-visible')}>
                  {stores.map((merchant, index) => (
                    <div key={merchant.id} className={cn('h-full w-[78%] max-w-[300px] shrink-0 snap-start lg:w-auto lg:max-w-none', scope === 'stores' && 'w-auto max-w-none', scope === 'all' && index > 2 && 'lg:hidden')}>
                      <FavouriteStoreCard
                        merchant={merchant}
                        locale={locale}
                        category={merchant.categories.map((item) => pickLocalized(item, locale)).filter(Boolean).join(' · ')}
                        minuteLabel={t('customer.minuteRange', { from: Math.max(10, merchant.deliveryMinutes - 5), to: merchant.deliveryMinutes + 5 })}
                        distanceLabel={Number.isFinite(distanceOf(merchant)) ? t('customer.distanceKm', { km: distanceOf(merchant).toFixed(1) }) : null}
                        onUnsave={() => removeStore.mutate(merchant.id)}
                      />
                    </div>
                  ))}
                  <div className={cn('h-full w-[78%] max-w-[300px] shrink-0 snap-start lg:w-auto lg:max-w-none', scope === 'stores' && 'w-auto max-w-none')}>
                    <CollectionCard onCreate={() => setCollectionOpen(true)} />
                  </div>
                </div>
              ) : (
                <p className="rounded-2xl border border-dashed border-[#e6e6e0] bg-white px-4 py-8 text-center text-sm text-[#6f6f6a]">{t('customer.noMatches')}</p>
              )}
            </section>
          ) : null}

          {showProducts ? (
            <section className={cn(showStores && 'mt-8')}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-xl lg:text-2xl">{t('customer.savedPage.products')}</h2>
                <SortMenu className="relative lg:hidden" sort={sort} open={menu === 'sort'} onToggle={() => setMenu(menu === 'sort' ? null : 'sort')} onSort={(value) => { setSort(value); setMenu(null); }} />
              </div>
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                {(['all', 'meals', 'drinks', 'desserts'] as const).map((item) => (
                  <ShelfChip key={item} selected={shelf === item} onClick={() => setShelf(item)}>
                    {t(item === 'all' ? 'customer.orders.all' : `customer.savedPage.${item}`)}
                  </ShelfChip>
                ))}
              </div>
              {menusLoading && !shelved.length ? (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" aria-busy>
                  {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-64 rounded-2xl" />)}
                </div>
              ) : shelved.length ? (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
                  {shelved.map((item) => (
                    <FavouriteProductCard
                      key={item.product.id}
                      product={item.product}
                      locale={locale}
                      pending={add.isPending && add.variables === item.product.id}
                      onAdd={() => add.mutate(item.product.id)}
                      onUnsave={() => hideProduct(item.product.id)}
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-2xl border border-dashed border-[#e6e6e0] bg-white px-4 py-8 text-center text-sm text-[#6f6f6a]">
                  {filtering || shelf !== 'all' ? t('customer.noMatches') : t('customer.savedPage.noProducts')}
                </p>
              )}
            </section>
          ) : null}
        </>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full bg-white px-4 py-3 text-center text-sm text-[#6f6f6a]">
        <span className="inline-flex items-center gap-2">
          <Cloud className="size-4 text-[#168a52]" />
          {t('customer.savedPage.synced')}
        </span>
        <Link href="/profile" className="font-semibold text-[#2563eb]">{t('customer.savedPage.manageAccount')}</Link>
      </div>

      <Dialog open={collectionOpen} onOpenChange={(open) => { setCollectionOpen(open); if (!open) setCollectionName(''); }}>
        <DialogContent>
          <DialogTitle>{t('customer.savedPage.createCollection')}</DialogTitle>
          <DialogDescription>{t('customer.savedPage.collectionHint')}</DialogDescription>
          <form onSubmit={createCollection} className="mt-4 space-y-3">
            <label className="block text-sm font-semibold" htmlFor="collection-name">{t('customer.savedPage.collectionName')}</label>
            <input
              id="collection-name"
              value={collectionName}
              onChange={(event) => setCollectionName(event.target.value)}
              required
              className="h-12 w-full rounded-2xl border border-[#e6e6e0] px-3 text-sm outline-none focus:border-[#111]"
            />
            <button type="submit" className="h-11 w-full rounded-full bg-[#111] text-sm font-bold text-white">{t('customer.savedPage.newCollection')}</button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PageIntro() {
  const t = useTranslations();
  return (
    <div>
      <p className="mb-3 hidden text-sm text-[#8a8a84] lg:block">
        <Link href="/" className="hover:text-[#111]">{t('nav.home')}</Link>
        <span className="px-1.5">/</span>
        <span className="text-[#3f3f3c]">{t('customer.favourites')}</span>
      </p>
      <h1 className="text-2xl leading-none lg:text-5xl">{t('customer.favourites')}</h1>
      <p className="mt-1.5 max-w-md text-sm text-[#6f6f6a] lg:hidden">{t('customer.savedPage.subtitle')}</p>
    </div>
  );
}

function ScopeTab({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn('h-10 flex-1 rounded-full px-3 text-sm font-semibold whitespace-nowrap lg:flex-none lg:px-4', selected ? 'bg-primary text-[#111] shadow-sm' : 'text-[#3f3f3c]')}
    >
      {children}
    </button>
  );
}

function ShelfChip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn('h-9 shrink-0 rounded-full px-4 text-sm font-semibold', selected ? 'bg-primary text-[#111]' : 'border border-[#e6e6e0] bg-white text-[#111]')}
    >
      {children}
    </button>
  );
}

function FilterRow({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between px-4 py-2.5 text-start text-sm font-medium hover:bg-[#f7f7f5]">
      {label}
      {checked ? <Check className="size-4" /> : null}
    </button>
  );
}

function SortMenu({ sort, open, onToggle, onSort, className }: { sort: SortKey; open: boolean; onToggle: () => void; onSort: (value: SortKey) => void; className?: string }) {
  const t = useTranslations();
  const options: { id: SortKey; label: string }[] = [
    { id: 'recent', label: t('customer.savedPage.recentlyAdded') },
    { id: 'rating', label: t('customer.savedPage.highestRated') },
    { id: 'nearest', label: t('customer.savedPage.nearest') },
  ];
  const current = options.find((item) => item.id === sort) ?? options[0]!;
  return (
    <div className={className}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-[#e6e6e0] bg-white px-3.5 text-sm font-semibold lg:h-11 lg:px-4">
        {current.label}
        <ChevronDown className="size-4" />
      </button>
      {open ? (
        <div className="absolute end-0 z-20 mt-2 w-48 overflow-hidden rounded-2xl border border-[#ecece6] bg-white py-1 shadow-lg">
          {options.map((item) => (
            <button key={item.id} type="button" onClick={() => onSort(item.id)} className="flex w-full items-center justify-between px-4 py-2.5 text-start text-sm font-medium hover:bg-[#f7f7f5]">
              {item.label}
              {sort === item.id ? <Check className="size-4" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FavouriteStoreCard({
  merchant,
  locale,
  category,
  minuteLabel,
  distanceLabel,
  onUnsave,
}: {
  merchant: StoreCardData;
  locale: 'en' | 'ar';
  category: string;
  minuteLabel: string;
  distanceLabel: string | null;
  onUnsave: () => void;
}) {
  const t = useTranslations();
  const Icon = categoryIcon(merchant.categorySlugs[0] ?? '');
  const tone = logoTones[(merchant.slug.charCodeAt(0) + merchant.slug.length) % logoTones.length]!;
  const rating = Number(merchant.rating);
  const name = pickLocalized(merchant.name, locale);
  return (
    <article className="lift h-full overflow-hidden rounded-2xl border border-[#ecece6] bg-white shadow-[0_8px_24px_rgba(17,17,17,0.04)]">
      <div className="relative aspect-[16/10]">
        <Link href={`/merchants/${merchant.slug}`} aria-label={name} className="absolute inset-0">
          <img src={merchant.coverUrl || '/no-image-16x9.jpg'} alt="" className="size-full object-cover" />
        </Link>
        <span className="pointer-events-none absolute start-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold shadow-sm">
          <span className={cn('size-2 rounded-full', merchant.isOpen ? 'bg-[#1f8a4c]' : 'bg-[#e11d48]')} />
          {merchant.isOpen ? t('customer.open') : t('customer.closed')}
        </span>
        <button
          type="button"
          aria-pressed
          aria-label={t('customer.savedPage.remove')}
          onClick={onUnsave}
          className="absolute end-3 top-3 z-10 grid size-9 place-items-center rounded-full bg-primary shadow-sm"
        >
          <Heart className="size-4 fill-[#111] text-[#111]" />
        </button>
      </div>
      <div className="px-3.5 pt-3 pb-3.5">
        <div className="flex items-start gap-3">
          <div className={cn('-mt-7 grid size-12 shrink-0 place-items-center overflow-hidden rounded-full border-[3px] border-white shadow-md', tone)}>
            {merchant.logoUrl ? <img src={merchant.logoUrl} alt="" className="size-full object-cover" /> : <Icon className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <Link href={`/merchants/${merchant.slug}`} className="block truncate text-[15px] font-semibold">{name}</Link>
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm text-[#6f6f6a]">{category}</p>
              <Link href={`/merchants/${merchant.slug}`} className="hidden shrink-0 items-center gap-1 text-sm font-semibold lg:inline-flex">
                {t('customer.savedPage.viewStore')}
                <ArrowRight className="size-3.5 rtl:rotate-180" />
              </Link>
            </div>
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {rating > 0 ? (
            <span className="inline-flex items-center gap-1 font-semibold">
              <Star className="size-3.5 fill-[#FFC400] text-[#FFC400]" />
              {rating.toFixed(1)}
              {merchant.reviewCount > 0 ? <span className="font-medium text-[#6f6f6a]">({merchant.reviewCount})</span> : null}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1 text-[#6f6f6a]">
            <Clock className="size-3.5" />
            {minuteLabel}
          </span>
          {distanceLabel ? (
            <span className="inline-flex items-center gap-1 text-[#6f6f6a]">
              <MapPin className="size-3.5" />
              {distanceLabel}
            </span>
          ) : null}
        </div>
        {merchant.freeDelivery ? (
          <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-[#e7f6ee] px-2.5 py-1 text-[11px] font-semibold text-[#168a52]">
            <Bike className="size-3.5" />
            {t('customer.savedPage.freeWithin')}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function FavouriteProductCard({
  product,
  locale,
  pending,
  onAdd,
  onUnsave,
}: {
  product: MenuProduct;
  locale: 'en' | 'ar';
  pending: boolean;
  onAdd: () => void;
  onUnsave: () => void;
}) {
  const t = useTranslations();
  const rating = Number(product.rating);
  const name = pickLocalized(product.name, locale);
  return (
    <article className="lift overflow-hidden rounded-2xl border border-[#ecece6] bg-white shadow-[0_8px_24px_rgba(17,17,17,0.04)]">
      <div className="relative aspect-[4/3]">
        <Link href={`/merchants/${product.merchantSlug}/products/${product.id}`} aria-label={name} className="absolute inset-0">
          <img src={product.imageUrl || '/no-image-1x1.jpg'} alt="" className="size-full object-cover" />
        </Link>
        {product.customizable ? (
          <span className="pointer-events-none absolute start-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-[10px] font-semibold shadow-sm">
            <SlidersHorizontal className="size-3" />
            {t('customer.customizable')}
          </span>
        ) : null}
        <button
          type="button"
          aria-pressed
          aria-label={t('customer.savedPage.remove')}
          onClick={onUnsave}
          className="absolute end-2 top-2 z-10 grid size-8 place-items-center rounded-full bg-primary shadow-sm"
        >
          <Heart className="size-3.5 fill-[#111] text-[#111]" />
        </button>
      </div>
      <div className="p-3">
        <Link href={`/merchants/${product.merchantSlug}/products/${product.id}`} className="block truncate text-sm font-semibold">{name}</Link>
        <p className="truncate text-xs text-[#6f6f6a]">{pickLocalized(product.merchantName, locale)}</p>
        {rating > 0 ? (
          <p className="mt-1 inline-flex items-center gap-1 text-xs">
            <Star className="size-3.5 fill-[#FFC400] text-[#FFC400]" />
            <span className="font-semibold">{rating.toFixed(1)}</span>
            {product.reviewCount > 0 ? <span className="text-[#6f6f6a]">({product.reviewCount})</span> : null}
          </p>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-sm font-bold">{formatMoney(product.price, locale)}</p>
          <button
            type="button"
            disabled={!product.available || pending}
            aria-busy={pending}
            onClick={(event) => {
              flyFromButton(event.currentTarget, product.imageUrl || '/no-image-1x1.jpg');
              onAdd();
            }}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-primary px-3 text-sm font-bold text-[#111] disabled:opacity-50"
          >
            {pending ? <CartButtonSpinner /> : <Plus className="size-3.5" strokeWidth={2.6} />}
            {t('customer.addShort')}
          </button>
        </div>
      </div>
    </article>
  );
}

function CollectionCard({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations();
  return (
    <article className="flex h-full min-h-[280px] flex-col justify-between rounded-2xl bg-gradient-to-b from-[#fff7d6] to-[#ffe9a3] p-4">
      <div className="relative mx-auto mt-2 h-28 w-40" aria-hidden>
        <div className="absolute start-1 top-6 h-16 w-24 -rotate-12 rounded-2xl bg-[#ffe08a] shadow-sm" />
        <div className="absolute start-7 top-3 h-16 w-24 rotate-6 rounded-2xl bg-white shadow-md" />
        <div className="absolute end-1 top-7 grid size-14 place-items-center rounded-2xl bg-[#fffdf6] shadow-md">
          <Heart className="size-6 fill-[#111]" />
        </div>
        <span className="absolute end-0 top-1 size-1.5 rounded-full bg-[#111]/25" />
        <span className="absolute start-0 top-2 size-1 rounded-full bg-[#111]/20" />
      </div>
      <div>
        <h3 className="text-lg">{t('customer.savedPage.createCollection')}</h3>
        <p className="mt-1 text-sm text-[#5c5c57]">{t('customer.savedPage.collectionHint')}</p>
        <button type="button" onClick={onCreate} className="mt-4 h-11 w-full rounded-full bg-[#111] text-sm font-bold text-white">
          {t('customer.savedPage.newCollection')}
        </button>
      </div>
    </article>
  );
}

function FavouritesSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <Skeleton className="h-16 w-72 rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-64 rounded-2xl" />)}
      </div>
    </div>
  );
}

function storeHaystack(merchant: StoreCardData, locale: 'en' | 'ar') {
  return `${pickLocalized(merchant.name, locale)} ${merchant.categories.map((item) => pickLocalized(item, locale)).join(' ')}`.toLowerCase();
}

function compareStores(a: StoreCardData, b: StoreCardData, sort: SortKey, savedAt: Map<string, string>, distanceOf: (merchant: StoreCardData) => number) {
  if (sort === 'rating') return Number(b.rating) - Number(a.rating);
  if (sort === 'nearest') return distanceOf(a) - distanceOf(b);
  return (savedAt.get(b.id) ?? '').localeCompare(savedAt.get(a.id) ?? '');
}

function compareProducts(a: SavedProduct, b: SavedProduct, sort: SortKey) {
  if (sort === 'rating') return Number(b.product.rating) - Number(a.product.rating) || b.savedAt.localeCompare(a.savedAt);
  if (sort === 'nearest') return a.distance - b.distance || b.savedAt.localeCompare(a.savedAt);
  return b.savedAt.localeCompare(a.savedAt) || Number(b.product.rating) - Number(a.product.rating);
}

function productShelf(category: { en?: string; ar?: string }, product: { en?: string; ar?: string }): Exclude<Shelf, 'all'> {
  const text = `${category.en ?? ''} ${category.ar ?? ''} ${product.en ?? ''} ${product.ar ?? ''}`.toLowerCase();
  if (/drink|juice|coffee|tea|latte|beverage|smoothie|soda|مشروب|عصير|قهوة|شاي|لاتيه/.test(text)) return 'drinks';
  if (/dessert|sweet|cake|kunafa|baklava|pastry|bakery|مخبز|حلويات|كنافة|كيك|حلى/.test(text)) return 'desserts';
  return 'meals';
}

function dedupeProducts(items: SavedProduct[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.product.id)) return false;
    seen.add(item.product.id);
    return true;
  });
}

function topPerStore(items: SavedProduct[], limit = 4) {
  const grouped = new Map<string, SavedProduct[]>();
  for (const item of items) {
    const list = grouped.get(item.product.merchantId) ?? [];
    list.push(item);
    grouped.set(item.product.merchantId, list);
  }
  return [...grouped.values()].flatMap((list) => [...list].sort((a, b) => Number(b.product.rating) - Number(a.product.rating)).slice(0, limit));
}

function readList<T>(key: string): T[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(value) ? value as T[] : [];
  } catch {
    return [];
  }
}
