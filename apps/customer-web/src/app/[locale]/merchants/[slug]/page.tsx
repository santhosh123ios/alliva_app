'use client';

import { CartButtonSpinner, flyFromButton } from '@/components/cart-motion';
import { api } from '@/components/providers';
import { categoryIcon, formatDistanceKm } from '@/components/storefront';
import { Link, useRouter } from '@/i18n/navigation';
import { areas, usePlace, type FulfillmentMode } from '@/lib/place';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { cn, ErrorState } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Bike, ChevronRight, Clock, Headphones, Heart, MapPin, Minus, Plus, Search, Share2, ShieldCheck, ShoppingBag, ShoppingCart, Star, Trash2, Utensils } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { use, useState } from 'react';
import { toast } from 'sonner';

type StorePayload = NonNullable<Awaited<ReturnType<typeof api.merchant>>>;
type MenuProduct = StorePayload['categories'][number]['products'][number];
type CartSnapshot = NonNullable<Awaited<ReturnType<typeof api.cart>>>;

const fulfillmentOptions = [
  ['DELIVERY', Bike, 'delivery'],
  ['TAKEAWAY', ShoppingBag, 'pickup'],
  ['DINE_IN', Utensils, 'dineIn'],
] as const;

export default function MerchantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const locale = useLocale() as 'en' | 'ar';
  const t = useTranslations();
  const router = useRouter();
  const client = useQueryClient();
  const areaId = usePlace((state) => state.area);
  const fulfillment = usePlace((state) => state.fulfillment);
  const setFulfillment = usePlace((state) => state.setFulfillment);
  const area = areas.find((item) => item.id === areaId) ?? areas[0]!;
  const [tab, setTab] = useState('popular');
  const [search, setSearch] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const customer = useQuery({
    queryKey: ['customer'],
    queryFn: () => api.customer(),
    enabled: me.data?.kind === 'CUSTOMER',
    retry: false,
  });
  const merchant = useQuery({ queryKey: ['merchant', slug], queryFn: () => api.merchant(slug) });
  const cart = useQuery({ queryKey: ['cart'], queryFn: () => api.cart(), retry: false });
  const favouriteIds = new Set(
    ((customer.data as { favourites?: { merchantId: string }[] } | undefined)?.favourites ?? []).map((row) => row.merchantId),
  );
  const add = useMutation({
    mutationFn: async (productId: string) => {
      await api.guest().catch(() => undefined);
      return api.addItem({ productId, quantity: 1 });
    },
    onSuccess: (cartView) => {
      client.setQueryData(['cart'], cartView);
      toast.success(t('customer.added'));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const edit = useMutation({
    mutationFn: async ({ id, quantity }: { id: string; quantity: number }) => {
      await api.guest().catch(() => undefined);
      return quantity < 1 ? api.removeItem(id) : api.updateItem(id, quantity);
    },
    onSuccess: (cartView) => client.setQueryData(['cart'], cartView),
    onError: (error: Error) => toast.error(error.message),
  });
  const clear = useMutation({
    mutationFn: async (ids: string[]) => {
      await api.guest().catch(() => undefined);
      let latest: CartSnapshot | undefined;
      for (const id of ids) latest = await api.removeItem(id);
      return latest;
    },
    onSuccess: (cartView) => {
      if (cartView) client.setQueryData(['cart'], cartView);
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

  if (merchant.isLoading) return <StoreSkeleton />;
  if (merchant.error || !merchant.data) return <ErrorState title="Merchant" body={(merchant.error as Error)?.message ?? 'Missing'} />;

  const data = merchant.data;
  const name = pickLocalized(data.name, locale);
  const saved = favouriteIds.has(data.id);
  const kinds = (data.businessCategories ?? []).map((item) => pickLocalized(item, locale)).filter(Boolean);
  const rating = Number(data.rating);
  const distance = formatDistanceKm(Number(data.latitude), Number(data.longitude), area);
  const modes = fulfillmentOptions.filter(([id]) => data.fulfillment.includes(id));
  const catalog = data.categories.flatMap((category) => category.products.map((product) => ({ ...product, categoryId: category.id })));
  const needle = search.trim().toLowerCase();
  const inTab = tab === 'popular' ? catalog : catalog.filter((product) => product.categoryId === tab);
  const visible = (needle
    ? inTab.filter((product) => `${pickLocalized(product.name, locale)} ${pickLocalized(product.description, locale)}`.toLowerCase().includes(needle))
    : inTab
  ).slice();
  if (tab === 'popular') visible.sort((a, b) => Number(b.rating) - Number(a.rating) || b.reviewCount - a.reviewCount);
  const heading = tab === 'popular' ? t('customer.popularAt', { name }) : pickLocalized(data.categories.find((category) => category.id === tab)?.name ?? { en: '', ar: '' }, locale);
  const offer = data.offers?.[0];
  const count = cart.data?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const sameStore = !cart.data?.merchant || cart.data.merchant.id === data.id;
  const orderItems = sameStore ? cart.data?.items ?? [] : [];
  const Icon = categoryIcon(data.categorySlugs[0] ?? '');
  const images = new Map(catalog.map((product) => [product.id, product.imageUrl]));
  const modeLabel = t(`customer.${fulfillmentOptions.find(([id]) => id === fulfillment)?.[2] ?? 'delivery'}`);

  const toggleSave = () => {
    if (me.data?.kind !== 'CUSTOMER') {
      router.push('/login');
      return;
    }
    save.mutate(data.id);
  };

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: name, url });
      } catch {
        /* dismissed */
      }
      return;
    }
    await navigator.clipboard.writeText(url);
    toast.success(t('customer.linkCopied'));
  };

  const selectMode = (id: FulfillmentMode) => {
    setFulfillment(id);
    if (cart.data?.items.length && cart.data.merchant?.id === data.id) {
      void api
        .guest()
        .catch(() => undefined)
        .then(() => api.cartContext({ fulfillmentType: id }))
        .then((cartView) => client.setQueryData(['cart'], cartView))
        .catch((error: Error) => toast.error(error.message));
    }
  };

  const cover = data.coverUrl ? (
    <img src={data.coverUrl} alt="" className="size-full object-cover" />
  ) : (
    <img src="/no-image-16x9.jpg" alt="" className="size-full object-cover" />
  );

  return (
    <div className="bg-white pb-24 lg:pb-2">
      <div className="mx-auto max-w-[640px] lg:max-w-[1180px]">
        <div className="relative -mx-4 -mt-4 h-48 overflow-hidden rounded-b-[28px] sm:h-56 lg:mx-0 lg:mt-0 lg:h-64">
          {cover}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3 lg:p-4">
            <Link href="/" aria-label={t('customer.back')} className="grid size-11 place-items-center rounded-full bg-white shadow-sm">
              <ArrowLeft className="size-5 rtl:rotate-180" />
            </Link>
            <ShareSave saved={saved} onShare={() => void share()} onSave={toggleSave} shareLabel={t('customer.shareStore')} saveLabel={saved ? t('customer.saved') : t('customer.saveStore')} />
          </div>
        </div>

        <div className="relative z-10">
          <LogoBadge logoUrl={data.logoUrl} Icon={Icon} />
          <StoreTitle name={name} open={data.isOpen} openLabel={t('customer.open')} closedLabel={t('customer.closed')} />
          {kinds.length ? <p className="mt-1 text-[15px] text-[#8d8d88]">{kinds.join(' • ')}</p> : null}
          <MetaRow
            rating={rating}
            reviewCount={data.reviewCount}
            minutes={t('customer.minuteRange', { from: Math.max(10, data.deliveryMinutes - 5), to: data.deliveryMinutes + 5 })}
            distance={distance ? t('customer.distanceKm', { km: distance }) : null}
            infoOpen={infoOpen}
            moreInfo={t('customer.moreInfo')}
            onToggle={() => setInfoOpen((value) => !value)}
          />
        </div>

        <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-8">
          <div>
            {infoOpen ? (
              <StoreInfo
                description={pickLocalized(data.description, locale)}
                address={data.address}
                addressLabel={t('customer.storeAddress')}
                hours={data.hours}
                hoursLabel={t('customer.storeHours')}
                everyDay={t('customer.everyDay')}
                closedLabel={t('customer.closed')}
                reviewsLabel={t('customer.storeReviews')}
                reviews={data.reviews}
                locale={locale}
              />
            ) : null}

            {data.freeDelivery ? (
              <button type="button" onClick={() => setInfoOpen(true)} className="mt-4 flex w-full items-center gap-3 rounded-2xl bg-[#fff6d0] px-3 py-3 text-start">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white">
                  <Bike className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{t('customer.freeDeliveryBadge')}</span>
                  <span className="mt-0.5 block text-xs text-[#6f6f6a]">{t('customer.freeDeliveryNote')}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 rtl:rotate-180" />
              </button>
            ) : null}

            {modes.length ? (
              <div id="fulfillment" className="mt-4 flex gap-2 overflow-x-auto lg:grid lg:grid-cols-3">
                {modes.map(([id, ModeIcon, label]) => {
                  const selected = fulfillment === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => selectMode(id)}
                      className={cn(
                        'inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-semibold lg:w-full',
                        selected ? 'border-transparent bg-primary text-[#111]' : 'border-[#e6e6e0] bg-white',
                      )}
                    >
                      <ModeIcon className="size-4" />
                      {t(`customer.${label}`)}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <label className="relative mt-4 block">
              <span className="sr-only">{t('common.search')}</span>
              <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-[#8d8d88]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('customer.searchInStore', { name })}
                className="h-11 w-full rounded-full border border-[#e6e6e0] bg-white ps-10 pe-4 text-sm outline-none placeholder:text-[#8d8d88] focus:border-[#111]"
              />
            </label>

            <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
              <CategoryChip selected={tab === 'popular'} onClick={() => setTab('popular')}>{t('customer.storePopular')}</CategoryChip>
              {data.categories.filter((category) => category.products.length > 0).map((category) => (
                <CategoryChip key={category.id} selected={tab === category.id} onClick={() => setTab(category.id)}>
                  {pickLocalized(category.name, locale)}
                </CategoryChip>
              ))}
            </div>

            {offer ? (
              <div className="mt-4 flex overflow-hidden rounded-2xl bg-[#111] text-white">
                <div className="flex min-w-0 flex-1 flex-col justify-center p-4 lg:p-6">
                  <p className="text-2xl leading-tight font-bold text-primary lg:text-3xl">{pickLocalized(offer.title, locale)}</p>
                  <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-white/80">
                    <Clock className="size-3.5" />
                    {t('customer.limitedTime')}
                  </p>
                </div>
                <img src={data.coverUrl || '/no-image-1x1.jpg'} alt="" className="h-28 w-32 object-cover sm:h-32 sm:w-40 lg:h-40 lg:w-64" />
              </div>
            ) : null}

            <h2 className="mt-6 text-lg font-bold">{heading}</h2>
            {visible.length ? (
              <>
                <ul className="lg:hidden">
                  {visible.map((product) => (
                    <DishRow key={product.id} product={product} slug={slug} locale={locale} addLabel={t('customer.addShort')} pending={add.isPending && add.variables === product.id} onAdd={() => add.mutate(product.id)} />
                  ))}
                </ul>
                <ul className="mt-3 hidden gap-3 lg:grid lg:grid-cols-2">
                  {visible.map((product) => (
                    <DishCard key={product.id} product={product} slug={slug} locale={locale} addLabel={t('customer.addShort')} pending={add.isPending && add.variables === product.id} onAdd={() => add.mutate(product.id)} />
                  ))}
                </ul>
              </>
            ) : (
              <p className="py-8 text-sm text-[#6f6f6a]">{t('customer.noMatches')}</p>
            )}
          </div>

          <OrderPanel
            name={name}
            kinds={kinds.join(' · ')}
            logoUrl={data.logoUrl}
            Icon={Icon}
            items={orderItems}
            images={images}
            locale={locale}
            pricing={sameStore ? cart.data?.pricing : undefined}
            modeLabel={modeLabel}
            emptyLabel={sameStore ? t('customer.emptyOrder') : t('customer.otherCart')}
            otherStore={!sameStore && (cart.data?.items.length ?? 0) > 0}
            labels={{
              title: t('customer.yourOrder'),
              clear: t('customer.clearAll'),
              remove: t('customer.remove'),
              orderType: t('customer.orderType'),
              change: t('customer.change'),
              subtotal: t('customer.subtotal'),
              items: t('customer.cartItems', { count: orderItems.reduce((sum, item) => sum + item.quantity, 0) }),
              deliveryFee: t('customer.deliveryFee'),
              free: t('customer.free'),
              total: t('customer.total'),
              checkout: t('customer.goToCheckout'),
              secure: t('customer.securePayment'),
              safe: t('customer.paymentSafe'),
              support: t('customer.alwaysHere'),
              help: t('customer.hereToHelp'),
              viewCart: t('customer.viewCart'),
            }}
            pending={edit.isPending || clear.isPending}
            onQty={(id, quantity) => edit.mutate({ id, quantity })}
            onClear={() => clear.mutate(orderItems.map((item) => item.id))}
          />
        </div>
      </div>

      {count > 0 && cart.data ? (
        <div className="fixed inset-x-0 bottom-28 z-40 px-3 pb-2 lg:hidden">
          <div className="mx-auto flex max-w-[640px] items-center justify-between gap-3 rounded-full bg-[#111] py-2 ps-4 pe-2 text-white shadow-lg">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="relative">
                <ShoppingCart className="size-5" />
                <span className="absolute -top-2 -end-2 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-[#111]">{count}</span>
              </span>
              <span className="truncate text-sm font-semibold">
                {t('customer.cartItems', { count })} · {formatMoney(cart.data.pricing.total, locale)}
              </span>
            </div>
            <Link href="/cart" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-[#111]">
              {t('customer.viewCart')}
              <ArrowRight className="size-4 rtl:rotate-180" />
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ShareSave({ saved, onShare, onSave, shareLabel, saveLabel }: { saved: boolean; onShare: () => void; onSave: () => void; shareLabel: string; saveLabel: string }) {
  return (
    <div className="flex gap-2">
      <button type="button" aria-label={shareLabel} onClick={onShare} className="grid size-11 place-items-center rounded-full bg-white shadow-sm">
        <Share2 className="size-5" />
      </button>
      <button type="button" aria-pressed={saved} aria-label={saveLabel} onClick={onSave} className="grid size-11 place-items-center rounded-full bg-white shadow-sm">
        <Heart className={cn('size-5', saved && 'fill-[#111]')} />
      </button>
    </div>
  );
}

function LogoBadge({ logoUrl, Icon }: { logoUrl: string | null; Icon: ReturnType<typeof categoryIcon> }) {
  return (
    <div className="-mt-11 grid size-[4.75rem] shrink-0 place-items-center overflow-hidden rounded-full border-[5px] border-white bg-primary shadow-md">
      {logoUrl ? <img src={logoUrl} alt="" className="size-full object-cover" /> : <Icon className="size-8" />}
    </div>
  );
}

function StoreTitle({ name, open, openLabel, closedLabel }: { name: string; open: boolean; openLabel: string; closedLabel: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2.5">
      <h1 className="text-[1.7rem] leading-none font-extrabold tracking-[-0.03em] text-[#111]">{name}</h1>
      {open ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e7f8ee] px-2.5 py-1 text-sm font-semibold text-[#1c9a4b]">
          <span className="size-2 rounded-full bg-[#22a85a]" />
          {openLabel}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f2f2f0] px-2.5 py-1 text-sm font-semibold text-[#6f6f6a]">
          <span className="size-2 rounded-full bg-[#9a9a94]" />
          {closedLabel}
        </span>
      )}
    </div>
  );
}

function MetaRow({
  rating,
  reviewCount,
  minutes,
  distance,
  infoOpen,
  moreInfo,
  onToggle,
}: {
  rating: number;
  reviewCount: number;
  minutes: string;
  distance: string | null;
  infoOpen: boolean;
  moreInfo: string;
  onToggle: () => void;
}) {
  const facts = [
    rating > 0 ? (
      <span key="rating" className="inline-flex items-center gap-1 font-bold text-[#111]">
        <Star className="size-4 fill-[#FFC400] text-[#FFC400]" />
        {rating.toFixed(1)}
        {reviewCount > 0 ? <span className="font-semibold text-[#6f6f6a]">({reviewCount})</span> : null}
      </span>
    ) : null,
    <span key="time" className="inline-flex items-center gap-1.5 text-[#3f3f3c]">
      <Clock className="size-4 text-[#6f6f6a]" />
      {minutes}
    </span>,
    distance ? (
      <span key="distance" className="inline-flex items-center gap-1.5 text-[#3f3f3c]">
        <MapPin className="size-4 text-[#6f6f6a]" />
        {distance}
      </span>
    ) : null,
    <button key="more" type="button" aria-expanded={infoOpen} onClick={onToggle} className="inline-flex items-center gap-0.5 font-semibold text-[#111]">
      {moreInfo}
      <ChevronRight className={cn('size-4 rtl:rotate-180', infoOpen && 'rotate-90 rtl:rotate-90')} />
    </button>,
  ].filter((item) => item != null);
  return (
    <div className="mt-3 flex items-center overflow-x-auto text-[13px] whitespace-nowrap">
      {facts.map((item, index) => (
        <span key={index} className="inline-flex items-center">
          {index > 0 ? <span aria-hidden className="mx-2.5 h-3.5 w-px shrink-0 bg-[#e4e4e0]" /> : null}
          {item}
        </span>
      ))}
    </div>
  );
}

function CategoryChip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'inline-flex h-10 shrink-0 items-center rounded-full border px-4 text-sm font-semibold',
        selected ? 'border-transparent bg-primary text-[#111]' : 'border-[#e6e6e0] bg-white',
      )}
    >
      {children}
    </button>
  );
}

function DishRow({ product, slug, locale, addLabel, pending, onAdd }: DishProps) {
  return (
    <li className="flex gap-3 border-b border-[#f0f0ea] py-4">
      <div className="min-w-0 flex-1">
        <Link href={`/merchants/${slug}/products/${product.id}`} className="font-semibold leading-snug">{pickLocalized(product.name, locale)}</Link>
        <p className="mt-1 line-clamp-2 text-sm text-[#6f6f6a]">{pickLocalized(product.description, locale)}</p>
        <DishFacts product={product} locale={locale} />
      </div>
      <div className="relative w-28 shrink-0">
        <Link href={`/merchants/${slug}/products/${product.id}`} className="block overflow-hidden rounded-2xl">
          <img src={product.imageUrl || '/no-image-1x1.jpg'} alt="" className="aspect-square w-full object-cover" />
          <span aria-hidden className="absolute end-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-white shadow-sm">
            <Heart className="size-3.5" />
          </span>
        </Link>
        <AddButton label={addLabel} pending={pending} disabled={!product.available} imageSrc={product.imageUrl || '/no-image-1x1.jpg'} onClick={onAdd} className="absolute bottom-2 end-1.5" />
      </div>
    </li>
  );
}

function DishCard({ product, slug, locale, addLabel, pending, onAdd }: DishProps) {
  return (
    <li className="flex gap-3 rounded-2xl border border-[#ecece6] bg-white p-3">
      <Link href={`/merchants/${slug}/products/${product.id}`} className="relative size-24 shrink-0 overflow-hidden rounded-xl">
        <img src={product.imageUrl || '/no-image-1x1.jpg'} alt="" className="size-full object-cover" />
        <span aria-hidden className="absolute end-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-white shadow-sm">
          <Heart className="size-3.5" />
        </span>
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <Link href={`/merchants/${slug}/products/${product.id}`} className="font-semibold leading-snug">{pickLocalized(product.name, locale)}</Link>
        <p className="mt-1 line-clamp-2 text-sm text-[#6f6f6a]">{pickLocalized(product.description, locale)}</p>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <DishFacts product={product} locale={locale} />
          <AddButton label={addLabel} pending={pending} disabled={!product.available} imageSrc={product.imageUrl || '/no-image-1x1.jpg'} onClick={onAdd} />
        </div>
      </div>
    </li>
  );
}

function DishFacts({ product, locale }: { product: MenuProduct; locale: 'en' | 'ar' }) {
  const rating = Number(product.rating);
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {rating > 0 ? (
        <span className="inline-flex items-center gap-1">
          <Star className="size-3.5 fill-[#FFC400] text-[#FFC400]" />
          <span className="font-semibold">{rating.toFixed(1)}</span>
          {product.reviewCount > 0 ? <span className="text-[#6f6f6a]">({product.reviewCount})</span> : null}
        </span>
      ) : null}
      <span className="font-bold">{formatMoney(product.price, locale)}</span>
    </p>
  );
}

function AddButton({ label, pending, disabled, imageSrc, onClick, className }: { label: string; pending: boolean; disabled: boolean; imageSrc: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      disabled={disabled || pending}
      aria-busy={pending}
      onClick={(event) => {
        flyFromButton(event.currentTarget, imageSrc);
        onClick();
      }}
      className={cn('inline-flex h-9 shrink-0 items-center gap-0.5 rounded-full bg-primary px-3 text-sm font-bold text-[#111] shadow-sm disabled:opacity-50', className)}
    >
      {pending ? <CartButtonSpinner /> : <Plus className="size-3.5" />}
      {label}
    </button>
  );
}

type DishProps = {
  product: MenuProduct;
  slug: string;
  locale: 'en' | 'ar';
  addLabel: string;
  pending: boolean;
  onAdd: () => void;
};

function OrderPanel({
  name,
  kinds,
  logoUrl,
  Icon,
  items,
  images,
  locale,
  pricing,
  modeLabel,
  emptyLabel,
  otherStore,
  labels,
  pending,
  onQty,
  onClear,
}: {
  name: string;
  kinds: string;
  logoUrl: string | null;
  Icon: ReturnType<typeof categoryIcon>;
  items: CartSnapshot['items'];
  images: Map<string, string | null>;
  locale: 'en' | 'ar';
  pricing: CartSnapshot['pricing'] | undefined;
  modeLabel: string;
  emptyLabel: string;
  otherStore: boolean;
  labels: {
    title: string;
    clear: string;
    remove: string;
    orderType: string;
    change: string;
    subtotal: string;
    items: string;
    deliveryFee: string;
    free: string;
    total: string;
    checkout: string;
    secure: string;
    safe: string;
    support: string;
    help: string;
    viewCart: string;
  };
  pending: boolean;
  onQty: (id: string, quantity: number) => void;
  onClear: () => void;
}) {
  const deliveryFree = pricing ? Number(pricing.deliveryFee) === 0 : false;
  return (
    <aside className="sticky top-24 hidden rounded-3xl border border-[#eee] bg-white p-5 shadow-sm lg:block">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{labels.title}</h2>
        {items.length ? (
          <button type="button" disabled={pending} onClick={onClear} className="text-sm font-semibold text-[#6f6f6a] underline-offset-2 hover:underline disabled:opacity-50">
            {labels.clear}
          </button>
        ) : null}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-primary">
          {logoUrl ? <img src={logoUrl} alt="" className="size-full object-cover" /> : <Icon className="size-5" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{name}</span>
          {kinds ? <span className="block truncate text-sm text-[#6f6f6a]">{kinds}</span> : null}
        </span>
      </div>

      {items.length ? (
        <ul className="mt-2 divide-y divide-[#f0f0ea]">
          {items.map((item) => (
            <li key={item.id} className="flex gap-3 py-3">
              <img src={images.get(item.productId) || '/no-image-1x1.jpg'} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{pickLocalized(item.name, locale)}</p>
                <p className="text-sm font-bold">{formatMoney(item.unitPrice, locale)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <div className="flex items-center rounded-full border border-[#e6e6e0]">
                  <button type="button" aria-label="-" disabled={pending} onClick={() => onQty(item.id, item.quantity - 1)} className="grid size-7 place-items-center disabled:opacity-50">
                    <Minus className="size-3.5" />
                  </button>
                  <span className="w-4 text-center text-sm font-semibold">{item.quantity}</span>
                  <button type="button" aria-label="+" disabled={pending} onClick={() => onQty(item.id, item.quantity + 1)} className="grid size-7 place-items-center disabled:opacity-50">
                    <Plus className="size-3.5" />
                  </button>
                </div>
                <button type="button" aria-label={labels.remove} disabled={pending} onClick={() => onQty(item.id, 0)} className="grid size-8 place-items-center text-[#6f6f6a] disabled:opacity-50">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-[#6f6f6a]">{emptyLabel}</p>
      )}

      {otherStore ? (
        <Link href="/cart" className="mt-3 inline-flex text-sm font-semibold underline">{labels.viewCart}</Link>
      ) : null}

      <div className="mt-4 flex items-center gap-3 border-t border-[#f0f0ea] pt-4">
        <span className="grid size-10 place-items-center rounded-full bg-[#fff6d0]">
          <Bike className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-[#6f6f6a]">{labels.orderType}</span>
          <span className="block text-sm font-semibold">{modeLabel}</span>
        </span>
        <button type="button" onClick={() => document.getElementById('fulfillment')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="text-sm font-semibold underline-offset-2 hover:underline">
          {labels.change}
        </button>
      </div>

      {pricing && items.length ? (
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-[#6f6f6a]">{labels.subtotal} ({labels.items})</span>
            <span className="font-semibold">{formatMoney(pricing.subtotal, locale)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[#6f6f6a]">{labels.deliveryFee}</span>
            <span className={cn('font-semibold', deliveryFree && 'text-emerald-600')}>{deliveryFree ? labels.free : formatMoney(pricing.deliveryFee, locale)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#fff6d0] px-3 py-3">
            <span className="font-bold">{labels.total}</span>
            <span className="text-lg font-bold">{formatMoney(pricing.total, locale)}</span>
          </div>
          <Link href="/checkout" className="mt-2 flex h-12 items-center justify-center gap-2 rounded-full bg-primary text-sm font-bold text-[#111]">
            {labels.checkout}
            <ArrowRight className="size-4 rtl:rotate-180" />
          </Link>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[#f0f0ea] pt-4 text-xs">
        <div className="flex gap-2">
          <ShieldCheck className="size-4 shrink-0" />
          <span>
            <span className="block font-semibold">{labels.secure}</span>
            <span className="text-[#6f6f6a]">{labels.safe}</span>
          </span>
        </div>
        <div className="flex gap-2">
          <Headphones className="size-4 shrink-0" />
          <span>
            <span className="block font-semibold">{labels.support}</span>
            <span className="text-[#6f6f6a]">{labels.help}</span>
          </span>
        </div>
      </div>
    </aside>
  );
}

function StoreInfo({
  description,
  address,
  addressLabel,
  hours,
  hoursLabel,
  everyDay,
  closedLabel,
  reviewsLabel,
  reviews,
  locale,
}: {
  description: string;
  address: string;
  addressLabel: string;
  hours: { dayOfWeek: number; opensAt: string; closesAt: string; closed: boolean }[];
  hoursLabel: string;
  everyDay: string;
  closedLabel: string;
  reviewsLabel: string;
  reviews: { id: string; rating: number; comment: string | null; author: string }[];
  locale: 'en' | 'ar';
}) {
  return (
    <div className="mt-4 space-y-4 rounded-2xl border border-[#eee] bg-[#fafaf8] p-4 text-sm">
      {description ? <p>{description}</p> : null}
      {address ? (
        <div>
          <p className="font-semibold">{addressLabel}</p>
          <p className="mt-1 text-[#6f6f6a]">{address}</p>
        </div>
      ) : null}
      {hours.length ? (
        <div>
          <p className="font-semibold">{hoursLabel}</p>
          <HoursList hours={hours} locale={locale} everyDay={everyDay} closed={closedLabel} />
        </div>
      ) : null}
      {reviews.length ? (
        <div>
          <p className="font-semibold">{reviewsLabel}</p>
          <ul className="mt-2 space-y-3">
            {reviews.map((review) => (
              <li key={review.id}>
                <p className="font-semibold">{review.author} · {review.rating}/5</p>
                {review.comment ? <p className="text-[#6f6f6a]">{review.comment}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function HoursList({
  hours,
  locale,
  everyDay,
  closed,
}: {
  hours: { dayOfWeek: number; opensAt: string; closesAt: string; closed: boolean }[];
  locale: 'en' | 'ar';
  everyDay: string;
  closed: string;
}) {
  const label = (day: number) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + day)));
  const first = hours[0];
  const same = first && hours.every((hour) => hour.opensAt === first.opensAt && hour.closesAt === first.closesAt && hour.closed === first.closed);
  if (same && first) {
    return <p className="mt-1 text-[#6f6f6a]">{first.closed ? closed : `${everyDay} · ${first.opensAt}–${first.closesAt}`}</p>;
  }
  return (
    <ul className="mt-1 space-y-1 text-[#6f6f6a]">
      {hours.map((hour) => (
        <li key={hour.dayOfWeek} className="flex justify-between gap-4">
          <span>{label(hour.dayOfWeek)}</span>
          <span>{hour.closed ? closed : `${hour.opensAt}–${hour.closesAt}`}</span>
        </li>
      ))}
    </ul>
  );
}

function StoreSkeleton() {
  return (
    <div className="mx-auto max-w-[640px] animate-pulse lg:max-w-[1180px]">
      <div className="h-52 bg-[#f3f3ef] sm:h-60 lg:h-72" />
      <div className="space-y-3 px-4 py-4">
        <div className="h-7 w-48 rounded-full bg-[#f3f3ef]" />
        <div className="h-4 w-32 rounded-full bg-[#f3f3ef]" />
        <div className="h-16 rounded-2xl bg-[#f3f3ef]" />
        <div className="h-11 rounded-full bg-[#f3f3ef]" />
      </div>
    </div>
  );
}
