'use client';

import { CartButtonSpinner, flyToCart } from '@/components/cart-motion';
import { api } from '@/components/providers';
import { categoryIcon, formatDistanceKm } from '@/components/storefront';
import { Link } from '@/i18n/navigation';
import { areas, usePlace } from '@/lib/place';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { cn, ErrorState, Skeleton } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  Flame,
  Heart,
  Info,
  ListChecks,
  MapPin,
  Minus,
  Plus,
  Share2,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Star,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { use, useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { toast } from 'sonner';

type ProductPayload = NonNullable<Awaited<ReturnType<typeof api.product>>>;
type StorePayload = NonNullable<Awaited<ReturnType<typeof api.merchant>>>;
type Addon = ProductPayload['addonGroups'][number]['addons'][number];

const savedKey = 'alliva.saved-products';
const noteLimit = 250;

export default function ProductPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = use(params);
  const locale = useLocale() as 'en' | 'ar';
  const t = useTranslations();
  const client = useQueryClient();
  const areaId = usePlace((state) => state.area);
  const area = areas.find((item) => item.id === areaId) ?? areas[0]!;
  const product = useQuery({ queryKey: ['product', id], queryFn: () => api.product(id) });
  const merchant = useQuery({ queryKey: ['merchant', slug], queryFn: () => api.merchant(slug) });
  const [variantId, setVariantId] = useState<string | null>(null);
  const [addons, setAddons] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [photo, setPhoto] = useState(0);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const photoRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setSavedIds(readSaved());
  }, []);

  const loadedId = product.data?.id === id ? id : null;
  const productRef = useRef(product.data);
  productRef.current = product.data;
  useEffect(() => {
    const data = productRef.current;
    if (!data || data.id !== loadedId) return;
    const first = data.variants.find((variant) => variant.available);
    setVariantId(first?.id ?? null);
    setAddons([]);
    setQuantity(1);
    setNotes('');
    setPhoto(0);
    setNotesOpen(false);
  }, [loadedId]);

  const add = useMutation({
    mutationFn: async () => {
      await api.guest().catch(() => undefined);
      return api.addItem({
        productId: id,
        variantId,
        addonIds: addons,
        quantity,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: (cartView) => {
      client.setQueryData(['cart'], cartView);
      toast.success(t('customer.added'));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (product.isLoading) return <ProductSkeleton />;
  if (!product.data || product.data.id !== id) return <ErrorState title="Product" body={(product.error as Error)?.message ?? 'Missing'} />;

  const data = product.data;
  const name = pickLocalized(data.name, locale);
  const images = data.images?.length ? data.images : data.imageUrl ? [data.imageUrl] : [];
  const photoIndex = Math.min(photo, Math.max(images.length - 1, 0));
  const variant = data.variants.find((item) => item.id === variantId) ?? null;
  const basePrice = cheapest(data.variants.map((item) => item.price));
  const selectedAddons = data.addonGroups.flatMap((group) => group.addons).filter((addon) => addons.includes(addon.id));
  const total = runningTotal(variant?.price ?? data.price, selectedAddons, quantity);
  const rating = Number(data.rating);
  const popular = rating >= 4.5;
  const saved = savedIds.includes(data.id);
  const missingRequired = data.addonGroups.some((group) => addons.filter((addonId) => group.addons.some((addon) => addon.id === addonId)).length < group.minSelect);
  const canAdd = data.available && !missingRequired && (!data.variants.length || Boolean(variant));
  const related = (merchant.data?.categories ?? []).flatMap((category) => category.products).filter((item) => item.id !== data.id).slice(0, 8);
  const storeName = merchant.data ? pickLocalized(merchant.data.name, locale) : pickLocalized(data.merchantName, locale);

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

  const toggleSaved = (productId: string) => {
    setSavedIds((current) => {
      const next = current.includes(productId) ? current.filter((item) => item !== productId) : [...current, productId];
      window.localStorage.setItem(savedKey, JSON.stringify(next));
      return next;
    });
  };

  const toggleAddon = (group: ProductPayload['addonGroups'][number], addonId: string) => {
    setAddons((current) => {
      if (current.includes(addonId)) return current.filter((item) => item !== addonId);
      const ids = new Set(group.addons.map((addon) => addon.id));
      const chosen = current.filter((item) => ids.has(item));
      if (group.maxSelect > 0 && chosen.length >= group.maxSelect) {
        if (group.maxSelect === 1) return [...current.filter((item) => !ids.has(item)), addonId];
        return current;
      }
      return [...current, addonId];
    });
  };

  const clearSelections = () => {
    const first = data.variants.find((item) => item.available);
    setVariantId(first?.id ?? null);
    setAddons([]);
    setNotes('');
  };

  const chips = [
    ...(variant ? [{ id: variant.id, label: pickLocalized(variant.name, locale) }] : []),
    ...selectedAddons.map((addon) => ({ id: addon.id, label: pickLocalized(addon.name, locale) })),
  ];

  return (
    <div className="pb-24 lg:pb-4">
      <nav aria-label="Breadcrumb" className="mb-4 hidden items-center gap-1.5 text-sm text-[#8d8d88] lg:flex">
        <Link href="/" className="hover:text-[#111]">{t('nav.home')}</Link>
        <ChevronRight className="size-3.5 rtl:rotate-180" />
        <Link href={`/merchants/${slug}`} className="hover:text-[#111]">{storeName}</Link>
        <ChevronRight className="size-3.5 rtl:rotate-180" />
        <span className="font-medium text-[#111]">{name}</span>
      </nav>

      <div className="lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-start lg:gap-10">
        <div>
          <Gallery
            images={images}
            index={photoIndex}
            name={name}
            onSelect={setPhoto}
            backHref={`/merchants/${slug}`}
            backLabel={t('customer.back')}
            shareLabel={t('customer.shareProduct')}
            saveLabel={saved ? t('customer.savedProduct') : t('customer.saveProduct')}
            saved={saved}
            countLabel={images.length > 1 ? t('customer.imageOf', { current: photoIndex + 1, total: images.length }) : null}
            thumbLabel={(thumb) => t('customer.imageOf', { current: thumb + 1, total: images.length })}
            onShare={() => void share()}
            onSave={() => toggleSaved(data.id)}
            photoRef={photoRef}
          />
          <div className="hidden lg:block">
            <StoreCard merchant={merchant.data} fallbackName={storeName} slug={slug} locale={locale} area={area} />
            <AllergenNotice label={t('customer.allergenNotice')} />
            <AlsoLike
              title={t('customer.alsoLike')}
              seeAll={t('customer.seeAll')}
              slug={slug}
              locale={locale}
              products={related}
              savedIds={savedIds}
              saveLabel={t('customer.saveProduct')}
              savedLabel={t('customer.savedProduct')}
              onToggle={toggleSaved}
            />
          </div>
        </div>

        <div className="mt-4 lg:mt-0">
          <div className="hidden flex-wrap items-center gap-2 lg:flex">
            {data.customizable ? <CustomizableBadge label={t('customer.customizable')} /> : null}
            {popular ? <PopularBadge label={t('customer.popularBadge')} /> : null}
          </div>
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-[1.65rem] leading-tight font-extrabold tracking-[-0.03em] text-[#111] lg:mt-3 lg:text-[2rem]">{name}</h1>
            {data.customizable ? (
              <span className="mt-1 shrink-0 lg:hidden">
                <CustomizableBadge label={t('customer.customizable')} />
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-2xl font-extrabold tracking-[-0.03em]">{formatMoney(data.price, locale)}</p>
          {rating > 0 || popular ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              {rating > 0 ? (
                <span className="inline-flex items-center gap-1 font-semibold">
                  <Star className="size-4 fill-[#FFC400] text-[#FFC400]" />
                  {rating.toFixed(1)}
                  {data.reviewCount > 0 ? <span className="font-medium text-[#6f6f6a]">({t('customer.reviewTotal', { count: data.reviewCount })})</span> : null}
                </span>
              ) : null}
              {popular ? (
                <span className="inline-flex items-center gap-2 lg:hidden">
                  {rating > 0 ? <span aria-hidden className="h-4 w-px bg-[#e4e4e0]" /> : null}
                  <PopularBadge label={t('customer.popularBadge')} />
                </span>
              ) : null}
            </div>
          ) : null}
          {pickLocalized(data.description, locale) ? (
            <p className="mt-3 text-[15px] leading-relaxed text-[#6f6f6a]">{pickLocalized(data.description, locale)}</p>
          ) : null}

          <div className="lg:hidden">
            <StoreCard merchant={merchant.data} fallbackName={storeName} slug={slug} locale={locale} area={area} compact />
            <AllergenNotice label={t('customer.allergenNotice')} />
          </div>

          {data.variants.length ? (
            <section className="mt-6">
              <SectionTitle title={t('customer.chooseSize')} badge={<RequiredBadge label={t('customer.requiredSelect', { count: 1 })} />} />
              <div className="mt-3 grid gap-2.5 lg:grid-cols-3">
                {data.variants.map((item) => {
                  const selected = item.id === variantId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={selected}
                      disabled={!item.available}
                      onClick={() => setVariantId(item.id)}
                      className={cn(
                        'flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-start transition disabled:opacity-40 lg:flex-col lg:items-start lg:gap-2 lg:p-4',
                        selected ? 'border-[#f0c84a] bg-[#fff8dc]' : 'border-[#e7e7e1] bg-white',
                      )}
                    >
                      <RadioMark selected={selected} />
                      <span className="min-w-0 flex-1 font-semibold lg:flex-none">{pickLocalized(item.name, locale)}</span>
                      <span className={cn('text-sm font-semibold lg:mt-auto', selected ? 'text-[#111]' : 'text-[#3f3f3c]')}>
                        {priceDelta(item.price, basePrice ?? item.price, locale, t('customer.included'))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {data.addonGroups.map((group) => (
            <section key={group.id} className="mt-6">
              <SectionTitle
                title={data.addonGroups.length === 1 && group.minSelect === 0 ? t('customer.addExtras') : pickLocalized(group.name, locale)}
                badge={
                  group.minSelect > 0 ? (
                    <RequiredBadge
                      label={
                        group.minSelect === group.maxSelect
                          ? t('customer.requiredSelect', { count: group.minSelect })
                          : t('customer.requiredRange', { min: group.minSelect, max: group.maxSelect })
                      }
                    />
                  ) : (
                    <OptionalBadge label={t('customer.optional')} />
                  )
                }
              />
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                {group.addons.map((addon) => {
                  const selected = addons.includes(addon.id);
                  return (
                    <button
                      key={addon.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleAddon(group, addon.id)}
                      className={cn(
                        'flex items-center gap-2 rounded-2xl border px-3 py-3 text-start',
                        selected ? 'border-[#f0c84a] bg-[#fff8dc]' : 'border-[#e7e7e1] bg-white',
                      )}
                    >
                      <CheckBox selected={selected} />
                      <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                        <span className="text-sm font-semibold leading-snug">{pickLocalized(addon.name, locale)}</span>
                        <span className="text-xs font-semibold text-[#3f3f3c]">+ {formatMoney(addon.price, locale)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}

          <section className="mt-6">
            <button
              type="button"
              aria-expanded={notesOpen}
              onClick={() => setNotesOpen((open) => !open)}
              className="flex w-full items-center gap-3 rounded-2xl bg-[#f6f6f4] px-4 py-3.5 text-start lg:hidden"
            >
              <ClipboardList className="size-5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t('customer.specialInstructions')}</span>
                <span className="mt-0.5 block text-sm text-[#8d8d88]">{notes.trim() || t('customer.kitchenNote')}</span>
              </span>
              <ChevronDown className={cn('size-4 shrink-0 text-[#6f6f6a] transition', notesOpen && 'rotate-180')} />
            </button>
            {notesOpen ? <NoteField value={notes} onChange={setNotes} placeholder={t('customer.kitchenNote')} className="lg:hidden" /> : null}
            <div className="hidden lg:block">
              <h2 className="flex items-center gap-2 text-base font-bold">
                <ClipboardList className="size-4" />
                {t('customer.specialInstructions')}
              </h2>
              <NoteField value={notes} onChange={setNotes} placeholder={t('customer.kitchenNote')} />
            </div>
          </section>

          {chips.length ? (
            <div className="mt-4 hidden items-center gap-2 rounded-2xl bg-[#f6f6f4] px-3 py-2.5 lg:flex">
              <ListChecks className="size-4 shrink-0 text-[#6f6f6a]" />
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {chips.map((chip) => (
                  <span key={chip.id} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold shadow-sm">
                    <Check className="size-3 text-[#111]" />
                    {chip.label}
                  </span>
                ))}
              </div>
              <button type="button" onClick={clearSelections} className="shrink-0 text-sm font-semibold text-[#6f6f6a] hover:text-[#111]">
                {t('customer.clearSelections')}
              </button>
            </div>
          ) : null}

          <div className="mt-4 hidden rounded-[28px] border border-[#eee] bg-white p-3 shadow-[0_12px_32px_rgba(17,17,17,0.06)] lg:block">
            <div className="flex items-center gap-3">
              <Quantity value={quantity} onChange={setQuantity} decreaseLabel={t('customer.decreaseQty')} increaseLabel={t('customer.increaseQty')} />
              <p className="min-w-0 flex-1 text-sm">
                <span className="text-[#6f6f6a]">{t('customer.total')}</span>
                <span className="font-bold"> · {formatMoney(total, locale)}</span>
              </p>
              <AddButton
                pending={add.isPending}
                disabled={!canAdd}
                onClick={(event) => {
                  flyToCart(photoRef.current, event.currentTarget, images[photoIndex] || '/no-image-1x1.jpg');
                  add.mutate();
                }}
                label={data.available ? t('customer.add') : t('customer.unavailable')}
                icon
              />
            </div>
            <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-[#8d8d88]">
              <ShieldCheck className="size-3.5" />
              {t('customer.reviewBeforeCheckout')}
            </p>
          </div>
        </div>
      </div>

      <div className="lg:hidden">
        <AlsoLike
          title={t('customer.alsoLike')}
          seeAll={t('customer.seeAll')}
          slug={slug}
          locale={locale}
          products={related}
          savedIds={savedIds}
          saveLabel={t('customer.saveProduct')}
          savedLabel={t('customer.savedProduct')}
          onToggle={toggleSaved}
        />
      </div>

      <div className="fixed inset-x-0 bottom-28 z-30 border-t border-[#eee] bg-white/95 px-3 py-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-[1180px] items-center gap-3">
          <Quantity value={quantity} onChange={setQuantity} decreaseLabel={t('customer.decreaseQty')} increaseLabel={t('customer.increaseQty')} />
          <AddButton
            pending={add.isPending}
            disabled={!canAdd}
            onClick={(event) => {
              flyToCart(photoRef.current, event.currentTarget, images[photoIndex] || '/no-image-1x1.jpg');
              add.mutate();
            }}
            label={data.available ? t('customer.add') : t('customer.unavailable')}
            price={formatMoney(total, locale)}
            wide
          />
        </div>
      </div>
    </div>
  );
}

function Gallery({
  images,
  index,
  name,
  onSelect,
  backHref,
  backLabel,
  shareLabel,
  saveLabel,
  saved,
  countLabel,
  thumbLabel,
  onShare,
  onSave,
  photoRef,
}: {
  images: string[];
  index: number;
  name: string;
  onSelect: (index: number) => void;
  backHref: string;
  backLabel: string;
  shareLabel: string;
  saveLabel: string;
  saved: boolean;
  countLabel: string | null;
  thumbLabel: (index: number) => string;
  onShare: () => void;
  onSave: () => void;
  photoRef: RefObject<HTMLImageElement | null>;
}) {
  const src = images[index] || '/no-image-16x9.jpg';
  return (
    <div>
      <div className="relative -mx-4 -mt-4 h-72 overflow-hidden bg-[#f3f3ef] sm:h-80 lg:mx-0 lg:mt-0 lg:h-auto lg:aspect-[5/4] lg:rounded-[28px]">
        <img ref={photoRef} src={src} alt={name} className="size-full object-cover" />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
          <Link href={backHref} aria-label={backLabel} className="grid size-11 place-items-center rounded-full bg-white shadow-sm">
            <ArrowLeft className="size-5 rtl:rotate-180" />
          </Link>
          <div className="flex gap-2">
            <button type="button" aria-label={shareLabel} onClick={onShare} className="grid size-11 place-items-center rounded-full bg-white shadow-sm">
              <Share2 className="size-5" />
            </button>
            <button type="button" aria-pressed={saved} aria-label={saveLabel} onClick={onSave} className="grid size-11 place-items-center rounded-full bg-white shadow-sm">
              <Heart className={cn('size-5', saved && 'fill-[#111]')} />
            </button>
          </div>
        </div>
        {countLabel ? (
          <span className="absolute end-3 bottom-3 rounded-full bg-[#111]/80 px-2.5 py-1 text-xs font-semibold text-white">{countLabel}</span>
        ) : null}
      </div>
      {images.length > 1 ? (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {images.map((image, imageIndex) => (
            <button
              key={`${image}-${imageIndex}`}
              type="button"
              aria-label={thumbLabel(imageIndex)}
              aria-current={imageIndex === index}
              onClick={() => onSelect(imageIndex)}
              className={cn('size-[4.5rem] shrink-0 overflow-hidden rounded-2xl border-2', imageIndex === index ? 'border-[#111]' : 'border-transparent')}
            >
              <img src={image} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StoreCard({
  merchant,
  fallbackName,
  slug,
  locale,
  area,
  compact = false,
}: {
  merchant: StorePayload | undefined;
  fallbackName: string;
  slug: string;
  locale: 'en' | 'ar';
  area: { lat: string; lng: string };
  compact?: boolean;
}) {
  const t = useTranslations();
  const name = merchant ? pickLocalized(merchant.name, locale) : fallbackName;
  const kinds = (merchant?.businessCategories ?? []).map((item) => pickLocalized(item, locale)).filter(Boolean).join(' • ');
  const Icon = categoryIcon(merchant?.categorySlugs[0] ?? '');
  const rating = Number(merchant?.rating ?? 0);
  const distance = merchant ? formatDistanceKm(Number(merchant.latitude), Number(merchant.longitude), area) : null;
  return (
    <div className={cn('mt-4', compact ? '' : 'rounded-[24px] border border-[#eee] p-4')}>
      <div className="flex items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-[#111] text-white">
          {merchant?.logoUrl ? <img src={merchant.logoUrl} alt="" className="size-full object-cover" /> : <Icon className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{name}</p>
          {kinds ? <p className="truncate text-sm text-[#8d8d88]">{kinds}</p> : null}
        </div>
        <Link
          href={`/merchants/${slug}`}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 text-sm font-semibold',
            compact ? '' : 'h-10 rounded-full border border-[#e6e6e0] px-4',
          )}
        >
          {t('customer.savedPage.viewStore')}
          <ChevronRight className="size-4 rtl:rotate-180" />
        </Link>
      </div>
      {merchant && !compact ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {rating > 0 ? (
            <span className="inline-flex items-center gap-1 font-semibold">
              <Star className="size-3.5 fill-[#FFC400] text-[#FFC400]" />
              {rating.toFixed(1)}
              {merchant.reviewCount > 0 ? <span className="font-medium text-[#6f6f6a]">({merchant.reviewCount})</span> : null}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1 text-[#6f6f6a]">
            <Clock className="size-3.5" />
            {t('customer.minuteRange', { from: Math.max(10, merchant.deliveryMinutes - 5), to: merchant.deliveryMinutes + 5 })}
          </span>
          {distance ? (
            <span className="inline-flex items-center gap-1 text-[#6f6f6a]">
              <MapPin className="size-3.5" />
              {t('customer.distanceKm', { km: distance })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AllergenNotice({ label }: { label: string }) {
  return (
    <p className="mt-3 flex items-center gap-2 rounded-2xl bg-[#f6f6f4] px-3.5 py-3 text-sm text-[#3f3f3c]">
      <Info className="size-4 shrink-0" />
      {label}
    </p>
  );
}

function AlsoLike({
  title,
  seeAll,
  slug,
  locale,
  products,
  savedIds,
  saveLabel,
  savedLabel,
  onToggle,
}: {
  title: string;
  seeAll: string;
  slug: string;
  locale: 'en' | 'ar';
  products: StorePayload['categories'][number]['products'];
  savedIds: string[];
  saveLabel: string;
  savedLabel: string;
  onToggle: (id: string) => void;
}) {
  if (!products.length) return null;
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{title}</h2>
        <Link href={`/merchants/${slug}`} className="inline-flex items-center gap-0.5 text-sm font-semibold">
          {seeAll}
          <ChevronRight className="size-4 rtl:rotate-180" />
        </Link>
      </div>
      <ul className="mt-3 flex gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-3 lg:overflow-visible">
        {products.map((product) => {
          const saved = savedIds.includes(product.id);
          return (
            <li key={product.id} className="w-36 shrink-0 lg:w-auto">
              <div className="relative">
                <Link href={`/merchants/${slug}/products/${product.id}`} className="block overflow-hidden rounded-2xl">
                  <img src={product.imageUrl || '/no-image-1x1.jpg'} alt={pickLocalized(product.name, locale)} className="aspect-square w-full object-cover" />
                </Link>
                <button
                  type="button"
                  aria-pressed={saved}
                  aria-label={saved ? savedLabel : saveLabel}
                  onClick={() => onToggle(product.id)}
                  className="absolute end-2 top-2 grid size-8 place-items-center rounded-full bg-white shadow-sm"
                >
                  <Heart className={cn('size-4', saved && 'fill-[#111]')} />
                </button>
              </div>
              <Link href={`/merchants/${slug}/products/${product.id}`} className="mt-2 block truncate text-sm font-semibold">
                {pickLocalized(product.name, locale)}
              </Link>
              <p className="text-sm font-bold">{formatMoney(product.price, locale)}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SectionTitle({ title, badge }: { title: string; badge: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-bold">{title}</h2>
      {badge}
    </div>
  );
}

function RequiredBadge({ label }: { label: string }) {
  return <span className="shrink-0 rounded-full bg-[#fff6d0] px-2.5 py-1 text-[11px] font-semibold text-[#8a6a00]">{label}</span>;
}

function OptionalBadge({ label }: { label: string }) {
  return <span className="shrink-0 rounded-full bg-[#f3f3f0] px-2.5 py-1 text-[11px] font-semibold text-[#6f6f6a]">{label}</span>;
}

function CustomizableBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#f4f4f1] px-2 py-1 text-xs font-semibold text-[#3f3f3c]">
      <SlidersHorizontal className="size-3.5" />
      {label}
    </span>
  );
}

function PopularBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#fff1e8] px-2 py-1 text-xs font-semibold text-[#e15a2a]">
      <Flame className="size-3.5 fill-[#e15a2a]" />
      {label}
    </span>
  );
}

function RadioMark({ selected }: { selected: boolean }) {
  return (
    <span className={cn('grid size-5 shrink-0 place-items-center rounded-full border-2', selected ? 'border-[#111]' : 'border-[#cfcfc8]')}>
      {selected ? <span className="size-2.5 rounded-full bg-[#111]" /> : null}
    </span>
  );
}

function CheckBox({ selected }: { selected: boolean }) {
  return (
    <span className={cn('grid size-5 shrink-0 place-items-center rounded-md border', selected ? 'border-[#111] bg-primary' : 'border-[#cfcfc8] bg-white')}>
      {selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
    </span>
  );
}

function NoteField({ value, onChange, placeholder, className }: { value: string; onChange: (value: string) => void; placeholder: string; className?: string }) {
  return (
    <div className={cn('relative mt-3', className)}>
      <textarea
        value={value}
        maxLength={noteLimit}
        onChange={(event) => onChange(event.target.value.slice(0, noteLimit))}
        placeholder={placeholder}
        className="min-h-28 w-full resize-none rounded-2xl border border-[#e6e6e0] bg-[#fafaf8] px-4 py-3 pe-16 text-sm outline-none placeholder:text-[#8d8d88] focus:border-[#111]"
      />
      <span className="pointer-events-none absolute end-3 bottom-3 text-xs text-[#8d8d88]">
        {value.length} / {noteLimit}
      </span>
    </div>
  );
}

function Quantity({
  value,
  onChange,
  decreaseLabel,
  increaseLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  decreaseLabel: string;
  increaseLabel: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label={decreaseLabel}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
        className="grid size-10 place-items-center rounded-full border border-[#e4e4e0] disabled:opacity-40"
      >
        <Minus className="size-4" />
      </button>
      <span className="w-6 text-center text-base font-bold">{value}</span>
      <button type="button" aria-label={increaseLabel} onClick={() => onChange(Math.min(99, value + 1))} className="grid size-10 place-items-center rounded-full bg-primary text-[#111]">
        <Plus className="size-4" />
      </button>
    </div>
  );
}

function AddButton({
  pending,
  disabled,
  onClick,
  label,
  price,
  wide = false,
  icon = false,
}: {
  pending: boolean;
  disabled: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  label: string;
  price?: string;
  wide?: boolean;
  icon?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled || pending}
      aria-busy={pending}
      onClick={onClick}
      className={cn(
        'inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-[#111] disabled:opacity-50',
        wide && 'min-w-0 flex-1',
      )}
    >
      {icon && !pending ? <ShoppingCart className="size-4" /> : null}
      {price ? <span>{price}</span> : null}
      {price ? <span aria-hidden className="h-4 w-px bg-[#111]/25" /> : null}
      <span className="truncate">{label}</span>
      {pending ? <CartButtonSpinner className="size-4" /> : <ArrowRight className="size-4 shrink-0 rtl:rotate-180" />}
    </button>
  );
}

function ProductSkeleton() {
  return (
    <div className="lg:grid lg:grid-cols-2 lg:gap-10" aria-busy>
      <Skeleton className="-mx-4 -mt-4 aspect-[4/3] rounded-none lg:mx-0 lg:mt-0 lg:rounded-[28px]" />
      <div className="mt-5 space-y-3 lg:mt-0">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    </div>
  );
}

function cheapest(prices: string[]) {
  if (!prices.length) return null;
  return prices.reduce((lowest, price) => (fils(price) < fils(lowest) ? price : lowest));
}

function priceDelta(price: string, base: string, locale: 'en' | 'ar', included: string) {
  const delta = fils(price) - fils(base);
  if (delta === 0) return included;
  const formatted = formatMoney((Math.abs(delta) / 1000).toFixed(3), locale);
  return delta > 0 ? `+ ${formatted}` : `− ${formatted}`;
}

function runningTotal(unit: string, addons: Addon[], quantity: number) {
  const extra = addons.reduce((sum, addon) => sum + fils(addon.price), 0);
  return ((fils(unit) + extra) * quantity / 1000).toFixed(3);
}

function fils(value: string) {
  return Math.round(Number(value) * 1000);
}

function readSaved() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(savedKey) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
