'use client';

import { CartButtonSpinner, flyFromButton } from '@/components/cart-motion';
import { Link } from '@/i18n/navigation';
import type { ApiClient } from '@alliva/api-client';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { cn } from '@alliva/ui';

type Home = Awaited<ReturnType<ApiClient['home']>>;
type MerchantCard = Home['merchants'][number];
type ProductCard = Home['topProducts'][number];
import {
  Cake,
  Clock,
  Coffee,
  Flower2,
  ArrowRight,
  Heart,
  Leaf,
  MapPin,
  Plus,
  ShoppingBasket,
  ShoppingCart,
  Star,
  Store,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';

const categoryIcons: Record<string, LucideIcon> = {
  restaurants: UtensilsCrossed,
  cafes: Coffee,
  groceries: ShoppingBasket,
  sweets: Cake,
  healthy: Leaf,
  pharmacy: Plus,
  flowers: Flower2,
};

const logoTones = ['bg-[#1f8a4c] text-white', 'bg-[#5c3d2e] text-white', 'bg-[#f3b6c8] text-[#111]', 'bg-[#ffc400] text-[#111]', 'bg-[#111] text-white'];

export function categoryIcon(slug: string) {
  return categoryIcons[slug] ?? Store;
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return <img src="/logo-on-light.png" alt="Alliva" className={compact ? 'h-6 w-auto' : 'h-8 w-auto'} />;
}

export function HeroBanner({ title, subtitle, action }: { title: string; subtitle: string; action: string }) {
  return (
    <section className="relative h-44 overflow-hidden rounded-[28px] sm:h-52 md:h-56">
      <img src="/hero.jpg" alt="" className="absolute inset-0 size-full object-cover object-center" />
      <div className="absolute inset-0 flex flex-col justify-center bg-gradient-to-r from-black/80 via-black/45 to-transparent px-6 text-white rtl:bg-gradient-to-l md:px-10">
        <h1 className="font-display max-w-[14ch] text-2xl leading-[1.05] font-bold tracking-[-0.03em] sm:text-4xl">{title}</h1>
        <p className="mt-2 max-w-sm text-sm font-medium sm:text-base">{subtitle}</p>
        <a href="#popular" className="mt-4 inline-flex w-fit items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-[#111]">
          {action}
          <ArrowRight className="size-4 rtl:rotate-180" />
        </a>
      </div>
    </section>
  );
}

export function formatDistanceKm(latitude: number | null, longitude: number | null, area: { lat: string; lng: string }) {
  if (latitude == null || longitude == null) return null;
  const fromLat = Number(area.lat);
  const fromLng = Number(area.lng);
  const dLat = ((latitude - fromLat) * Math.PI) / 180;
  const dLng = ((longitude - fromLng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((fromLat * Math.PI) / 180) * Math.cos((latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return (2 * 6371 * Math.asin(Math.sqrt(a))).toFixed(1);
}

export function MerchantTile({
  merchant,
  locale,
  saved,
  saveLabel,
  closedLabel,
  minuteLabel,
  distanceLabel,
  onToggleSave,
}: {
  merchant: MerchantCard;
  locale: 'en' | 'ar';
  saved: boolean;
  saveLabel: string;
  closedLabel: string;
  minuteLabel: string;
  distanceLabel: string | null;
  onToggleSave: () => void;
}) {
  const Icon = categoryIcon(merchant.categorySlugs[0] ?? '');
  const tone = logoTones[(merchant.slug.charCodeAt(0) + merchant.slug.length) % logoTones.length]!;
  const category = merchant.categories.map((item) => pickLocalized(item, locale)).filter(Boolean).join(' · ');
  const rating = Number(merchant.rating);
  return (
    <article className="lift overflow-hidden rounded-2xl border border-[#ecece6] bg-white">
      <div className="relative aspect-video">
        <Link href={`/merchants/${merchant.slug}`} aria-label={pickLocalized(merchant.name, locale)} className="absolute inset-0">
          {merchant.coverUrl ? (
            <img src={merchant.coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <CoverFallback />
          )}
        </Link>
        <button
          type="button"
          aria-pressed={saved}
          aria-label={saveLabel}
          className="absolute end-3 top-3 grid size-9 place-items-center rounded-full bg-white shadow-sm"
          onClick={onToggleSave}
        >
          <Heart className={cn('size-4', saved && 'fill-[#111]')} />
        </button>
        {merchant.isOpen ? null : (
          <span className="pointer-events-none absolute end-3 bottom-3 rounded-full bg-[#111] px-2.5 py-0.5 text-xs font-semibold text-white">{closedLabel}</span>
        )}
      </div>
      <div className="px-3 pb-3">
        <div className={cn('relative z-10 -mt-10 grid size-12 place-items-center overflow-hidden rounded-full border-[3px] border-white shadow-md', tone)}>
          {merchant.logoUrl ? <img src={merchant.logoUrl} alt="" className="size-full object-cover" /> : <Icon className="size-5" />}
        </div>
        <div className="mt-1.5 w-full min-w-0">
          <Link href={`/merchants/${merchant.slug}`} className="block w-full truncate text-[15px] font-semibold">
            {pickLocalized(merchant.name, locale)}
          </Link>
          <p className="w-full truncate text-sm text-[#6f6f6a]">{category}</p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {rating > 0 ? (
            <span className="inline-flex items-center gap-1 font-semibold">
              <Star className="size-3.5 fill-[#FFC400] text-[#FFC400]" />
              {rating.toFixed(1)}
              <span className="font-medium text-[#6f6f6a]">{merchant.reviewCount > 0 ? `(${merchant.reviewCount})` : ''}</span>
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
      </div>
    </article>
  );
}

function CoverFallback() {
  return <img src="/no-image-16x9.jpg" alt="" className="size-full object-cover" />;
}

export function ProductTile({
  product,
  locale,
  addLabel,
  minuteLabel,
  pending,
  onAdd,
}: {
  product: ProductCard;
  locale: 'en' | 'ar';
  addLabel: string;
  minuteLabel?: string | null;
  pending: boolean;
  onAdd: () => void;
}) {
  const rating = Number(product.rating);
  return (
    <article className="lift flex gap-3 rounded-2xl border border-[#ecece6] bg-white p-3">
      <Link href={`/merchants/${product.merchantSlug}/products/${product.id}`} aria-label={pickLocalized(product.name, locale)} className="relative size-24 shrink-0 overflow-hidden rounded-xl bg-white">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" className="size-full object-cover" />
        ) : (
          <img src="/no-image-1x1.jpg" alt="" className="size-full object-cover" />
        )}
        <span aria-hidden className="absolute end-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-white/95 shadow-sm">
          <Heart className="size-3.5" />
        </span>
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <Link href={`/merchants/${product.merchantSlug}/products/${product.id}`} className="truncate font-semibold leading-snug">
          {pickLocalized(product.name, locale)}
        </Link>
        <p className="truncate text-sm text-[#6f6f6a]">{pickLocalized(product.merchantName, locale)}</p>
        {rating > 0 ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1">
              <Star className="size-3.5 fill-[#FFC400] text-[#FFC400]" />
              <span className="font-semibold">{rating.toFixed(1)}</span>
              {product.reviewCount > 0 ? <span className="text-[#6f6f6a]">({product.reviewCount})</span> : null}
            </span>
            {minuteLabel ? (
              <span className="inline-flex items-center gap-1 text-[#6f6f6a]">
                <Clock className="size-3.5" />
                {minuteLabel}
              </span>
            ) : null}
          </p>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <p className="text-sm font-bold">{formatMoney(product.price, locale)}</p>
          <button
            type="button"
            disabled={!product.available || pending}
            aria-busy={pending}
            onClick={(event) => {
              flyFromButton(event.currentTarget, product.imageUrl || '/no-image-1x1.jpg');
              onAdd();
            }}
            className="inline-flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-sm font-bold text-[#111] disabled:opacity-50"
          >
            {pending ? <CartButtonSpinner /> : <ShoppingCart className="size-3.5" />}
            {addLabel}
          </button>
        </div>
      </div>
    </article>
  );
}

export function AreaCard({
  id,
  name,
  subtitle,
  selected,
  onSelect,
}: {
  id: string;
  name: string;
  subtitle: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex min-w-[220px] flex-1 items-center gap-3 rounded-2xl bg-white p-2 text-start shadow-[0_1px_2px_rgba(17,17,17,0.05)] ring-1 ring-black/5',
        selected && 'ring-2 ring-[#111]',
      )}
    >
      <AreaThumb id={id} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{name}</span>
        <span className="block truncate text-sm text-[#6f6f6a]">{subtitle}</span>
      </span>
      <svg viewBox="0 0 20 20" className="size-4 shrink-0 text-[#111] rtl:rotate-180" aria-hidden>
        <path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function AreaThumb({ id }: { id: string }) {
  if (id === 'muharraq') {
    return (
      <svg viewBox="0 0 112 76" className="h-14 w-[4.5rem] shrink-0 rounded-xl" aria-hidden>
        <rect width="112" height="76" fill="#8ec6e8" />
        <path d="M0 48c18 8 30-6 48-2s28 10 64-6v36H0z" fill="#1f6fbf" />
        <path d="M18 46l16-8 16 8v8H18z" fill="#f4f7fb" />
        <rect x="30" y="34" width="4" height="10" fill="#d7e3ee" />
      </svg>
    );
  }
  if (id === 'riffa') {
    return (
      <svg viewBox="0 0 112 76" className="h-14 w-[4.5rem] shrink-0 rounded-xl" aria-hidden>
        <rect width="112" height="76" fill="#f2d7a2" />
        <path d="M0 50h112v26H0z" fill="#e2b56a" />
        <path d="M24 50V30h10v8h8V22h10v16h8V34h10v16h18" fill="#c9842a" />
        <rect x="46" y="22" width="6" height="10" fill="#8b5a2b" />
      </svg>
    );
  }
  if (id === 'isa-town') {
    return (
      <svg viewBox="0 0 112 76" className="h-14 w-[4.5rem] shrink-0 rounded-xl" aria-hidden>
        <rect width="112" height="76" fill="#1d3557" />
        <rect x="10" y="34" width="14" height="42" fill="#f4d35e" />
        <rect x="30" y="22" width="18" height="54" fill="#4cc9f0" />
        <rect x="54" y="40" width="16" height="36" fill="#f72585" />
        <rect x="76" y="28" width="22" height="48" fill="#80ed99" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 112 76" className="h-14 w-[4.5rem] shrink-0 rounded-xl" aria-hidden>
      <rect width="112" height="76" fill="#b9ddf5" />
      <rect y="46" width="112" height="30" fill="#7fdbda" />
      <path d="M18 46V18h16l6 10h8V26h22v20z" fill="#f7f7f5" />
      <path d="M62 46V10h8v12h10V16h12v30z" fill="#dff1fb" />
      <rect x="24" y="26" width="5" height="6" fill="#8ecae6" />
      <rect x="70" y="22" width="4" height="6" fill="#8ecae6" />
    </svg>
  );
}
