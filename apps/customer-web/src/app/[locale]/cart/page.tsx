'use client';

import { CartButtonSpinner, flyFromButton } from '@/components/cart-motion';
import { api } from '@/components/providers';
import { categoryIcon } from '@/components/storefront';
import { Link } from '@/i18n/navigation';
import { areas, usePlace, type FulfillmentMode } from '@/lib/place';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { cn, EmptyState, ErrorState, Skeleton } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Bike,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Headphones,
  Heart,
  Info,
  MapPin,
  Minus,
  MoreVertical,
  Plus,
  QrCode,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Tag,
  Trash2,
  Utensils,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

type CartSnapshot = NonNullable<Awaited<ReturnType<typeof api.cart>>>;
type CartItem = CartSnapshot['items'][number];
type SavedAddress = { id: string; label: string; line1: string; city: string; isDefault: boolean };

const fulfillmentOptions = [
  ['DELIVERY', Bike, 'delivery'],
  ['TAKEAWAY', ShoppingBag, 'pickup'],
  ['DINE_IN', Utensils, 'dineIn'],
] as const;

export default function CartPage() {
  const locale = useLocale() as 'en' | 'ar';
  const t = useTranslations();
  const client = useQueryClient();
  const areaId = usePlace((state) => state.area);
  const setArea = usePlace((state) => state.setArea);
  const fulfillment = usePlace((state) => state.fulfillment);
  const setFulfillment = usePlace((state) => state.setFulfillment);
  const cart = useQuery({ queryKey: ['cart'], queryFn: () => api.cart() });
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const customer = useQuery({
    queryKey: ['customer'],
    queryFn: () => api.customer(),
    enabled: me.data?.kind === 'CUSTOMER',
    retry: false,
  });
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [noteReady, setNoteReady] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);

  const slug = cart.data?.merchant?.slug;
  const store = useQuery({
    queryKey: ['merchant', slug],
    queryFn: () => api.merchant(slug!),
    enabled: Boolean(slug),
  });

  useEffect(() => {
    if (!cart.data || noteReady) return;
    setNote(cart.data.notes ?? '');
    setNoteOpen(Boolean(cart.data.notes));
    setNoteReady(true);
  }, [cart.data, noteReady]);

  useEffect(() => {
    const applied = cart.data?.pricing.promoCode;
    if (applied) setCode(applied);
  }, [cart.data?.pricing.promoCode]);

  const edit = useMutation({
    mutationFn: async (input: { id: string; quantity: number; variantId?: string | null; remove?: boolean }) => {
      await api.guest().catch(() => undefined);
      if (input.remove || input.quantity < 1) return api.removeItem(input.id);
      return api.updateItem(input.id, input.quantity, input.variantId);
    },
    onSuccess: (view) => client.setQueryData(['cart'], view),
    onError: (error: Error) => toast.error(error.message),
  });
  const add = useMutation({
    mutationFn: async (productId: string) => {
      await api.guest().catch(() => undefined);
      return api.addItem({ productId, quantity: 1 });
    },
    onSuccess: (view) => {
      client.setQueryData(['cart'], view);
      toast.success(t('customer.added'));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const clear = useMutation({
    mutationFn: async (ids: string[]) => {
      await api.guest().catch(() => undefined);
      let latest: CartSnapshot | undefined;
      for (const id of ids) latest = await api.removeItem(id);
      return latest;
    },
    onSuccess: (view) => {
      if (view) client.setQueryData(['cart'], view);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const promo = useMutation({
    mutationFn: async () => {
      await api.guest().catch(() => undefined);
      return api.applyPromo(code.trim());
    },
    onSuccess: (view) => {
      client.setQueryData(['cart'], view);
      toast.success(t('customer.promoApplied'));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const context = useMutation({
    mutationFn: async (patch: { fulfillmentType?: FulfillmentMode; addressId?: string | null; notes?: string | null }) => {
      await api.guest().catch(() => undefined);
      const current = client.getQueryData<CartSnapshot>(['cart']);
      return api.cartContext({
        fulfillmentType: patch.fulfillmentType ?? current?.fulfillmentType ?? fulfillment,
        addressId: patch.addressId === undefined ? current?.addressId : patch.addressId,
        tableId: current?.tableId,
        notes: patch.notes === undefined ? note.trim() || null : patch.notes,
      });
    },
    onSuccess: (view) => client.setQueryData(['cart'], view),
    onError: (error: Error) => toast.error(error.message),
  });

  if (cart.isLoading) return <CartSkeleton />;
  if (cart.error) {
    return (
      <>
        <CartHeader backHref="/" />
        <ErrorState title={t('common.error')} body={(cart.error as Error).message} />
      </>
    );
  }
  if (!cart.data?.items.length) {
    return (
      <>
        <CartHeader backHref="/" />
        <EmptyState
          title={t('customer.yourCart')}
          body={t('common.empty')}
          action={
            <Link href="/" className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-bold text-[#111]">
              {t('customer.exploreNearby')}
            </Link>
          }
        />
      </>
    );
  }

  const data = cart.data;
  const merchant = data.merchant;
  const name = merchant ? pickLocalized(merchant.name, locale) : '';
  const kinds = merchant?.categories.map((item) => pickLocalized(item, locale)).filter(Boolean).join(' • ') ?? '';
  const Icon = categoryIcon(merchant?.categorySlugs[0] ?? '');
  const mode = (data.fulfillmentType ?? fulfillment) as FulfillmentMode;
  const modes = fulfillmentOptions.filter(([id]) => !merchant?.fulfillment.length || merchant.fulfillment.includes(id));
  const count = data.items.reduce((sum, item) => sum + item.quantity, 0);
  const inCart = new Set(data.items.map((item) => item.productId));
  const suggestions = (store.data?.categories ?? [])
    .flatMap((category) => category.products)
    .filter((product, index, list) => product.available && !inCart.has(product.id) && list.findIndex((row) => row.id === product.id) === index)
    .slice(0, 3);
  const addresses = ((customer.data as { addresses?: SavedAddress[] } | undefined)?.addresses ?? []).filter((row) => row.id);
  const area = areas.find((item) => item.id === areaId) ?? areas[0]!;
  const selectedAddress = addresses.find((row) => row.id === data.addressId) ?? addresses.find((row) => row.isDefault) ?? addresses[0];
  const addressText = selectedAddress
    ? `${selectedAddress.label} • ${selectedAddress.city}, ${t('customer.bahrain')}`
    : `${locale === 'ar' ? area.ar : area.en}, ${t('customer.bahrain')}`;
  const minutes = merchant?.deliveryMinutes ?? 30;
  const eta = t('customer.minuteRange', { from: Math.max(10, minutes - 5), to: minutes + 5 });
  const delivering = mode === 'DELIVERY';
  const freeDelivery = delivering && (Number(data.pricing.deliveryFee) === 0 || Boolean(merchant?.freeDelivery));
  const backHref = merchant ? `/merchants/${merchant.slug}` : '/';
  const busy = edit.isPending || clear.isPending || context.isPending;

  const selectMode = (id: FulfillmentMode) => {
    setFulfillment(id);
    context.mutate({ fulfillmentType: id, notes: note.trim() || null });
  };

  const saveNote = () => {
    const next = note.trim();
    if (next === (data.notes ?? '')) return;
    context.mutate({ notes: next || null });
  };

  const summary = (
    <Summary
      locale={locale}
      pricing={data.pricing}
      delivering={delivering}
      labels={{
        title: t('customer.orderSummary'),
        subtotal: t('customer.subtotal'),
        items: t('customer.cartItems', { count }),
        deliveryFee: t('customer.deliveryFee'),
        deliveryHint: t('customer.deliveryFeeHint'),
        free: t('customer.free'),
        serviceFee: t('customer.serviceFee'),
        serviceHint: t('customer.serviceFeeHint'),
        discount: t('customer.discount'),
        total: t('customer.total'),
      }}
    />
  );

  const promoField = (placeholder: string) => (
    <PromoField
      code={code}
      onChange={setCode}
      onApply={() => {
        if (code.trim()) promo.mutate();
      }}
      pending={promo.isPending}
      label={t('customer.promoCode')}
      placeholder={placeholder}
      applyLabel={t('customer.apply')}
    />
  );

  const banner = freeDelivery ? <DeliveryBanner title={t('customer.freeDeliveryBadge')} body={t('customer.freeDeliveryNote')} /> : null;

  const address = delivering ? (
    <AddressRow
      text={addressText}
      changeLabel={t('customer.change')}
      addresses={addresses}
      areas={areas.map((item) => ({ id: item.id, label: locale === 'ar' ? item.ar : item.en }))}
      selectedAddressId={selectedAddress?.id ?? null}
      selectedAreaId={area.id}
      manageHref={me.data?.kind === 'CUSTOMER' ? '/profile' : null}
      manageLabel={t('customer.storeAddress')}
      onAddress={(id) => context.mutate({ addressId: id, notes: note.trim() || null })}
      onArea={setArea}
    />
  ) : null;

  const etaRow = delivering ? <EtaRow label={t('customer.estimatedDelivery')} value={eta} /> : null;

  return (
    <div className="lg:pt-2">
      <CartHeader backHref={backHref} menuLabel={t('customer.cartMenu')} clearLabel={t('customer.clearCart')} clearDisabled={busy} onClear={() => clear.mutate(data.items.map((item) => item.id))} />

      <nav className="mb-4 hidden items-center gap-2 text-sm text-[#8d8d88] lg:flex">
        <Link href="/" className="hover:text-[#111]">{t('nav.home')}</Link>
        <span>/</span>
        {merchant ? (
          <Link href={`/merchants/${merchant.slug}`} className="hover:text-[#111]">{name}</Link>
        ) : (
          <span>{name}</span>
        )}
        <span>/</span>
        <span className="font-medium text-[#111]">{t('nav.cart')}</span>
      </nav>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:items-start lg:gap-6">
        <div>
          <div className="hidden lg:block">
            <h1 className="font-display text-4xl font-bold tracking-[-0.03em]">{t('customer.yourCart')}</h1>
            <p className="mt-1 text-[#6f6f6a]">{t('customer.reviewCart')}</p>
          </div>

          <div className="mt-1 flex items-center gap-3 lg:mt-5 lg:rounded-2xl lg:bg-[#efefeb] lg:px-4 lg:py-3">
            <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-primary">
              {merchant?.logoUrl ? <img src={merchant.logoUrl} alt="" className="size-full object-cover" /> : <Icon className="size-6" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-base font-bold">{name}</p>
                {merchant ? (
                  merchant.isOpen ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#e7f8ee] px-2 py-0.5 text-xs font-semibold text-[#1c9a4b]">
                      <span className="size-1.5 rounded-full bg-[#22a85a]" />
                      {t('customer.open')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#f2f2f0] px-2 py-0.5 text-xs font-semibold text-[#6f6f6a]">
                      <span className="size-1.5 rounded-full bg-[#9a9a94]" />
                      {t('customer.closed')}
                    </span>
                  )
                ) : null}
              </div>
              {kinds ? <p className="truncate text-sm text-[#8d8d88]">{kinds}</p> : null}
            </div>
            {merchant ? (
              <Link href={`/merchants/${merchant.slug}`} className="inline-flex shrink-0 items-center gap-0.5 text-sm font-semibold text-[#8a6d00]">
                {t('customer.addMoreItems')}
                <ChevronRight className="size-4 rtl:rotate-180" />
              </Link>
            ) : null}
          </div>

          {modes.length ? (
            <div className="mt-4 grid grid-cols-3 gap-2">
              {modes.map(([id, ModeIcon, label]) => {
                const selected = mode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => selectMode(id)}
                    className={cn(
                      'inline-flex h-11 items-center justify-center gap-1.5 rounded-full border px-2 text-sm font-semibold',
                      selected ? 'border-transparent bg-primary text-[#111]' : 'border-[#e6e6e0] bg-white',
                    )}
                  >
                    <ModeIcon className="size-4 shrink-0" />
                    <span className="truncate">{t(`customer.${label}`)}</span>
                    {id === 'DINE_IN' ? <QrCode className="size-3.5 shrink-0 opacity-70" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          <ul className="mt-4 space-y-3 lg:space-y-0 lg:divide-y lg:divide-[#ecece6]">
            {data.items.map((item) => (
              <CartItem
                key={item.id}
                item={item}
                locale={locale}
                slug={merchant?.slug}
                saved={saved.includes(item.productId)}
                pending={(edit.isPending && edit.variables?.id === item.id) || clear.isPending}
                labels={{
                  customizable: t('customer.customizable'),
                  edit: t('customer.editOptions'),
                  remove: t('customer.remove'),
                  increase: t('customer.increaseQty'),
                  decrease: t('customer.decreaseQty'),
                  save: t('customer.saveItem'),
                }}
                onQty={(quantity) => edit.mutate({ id: item.id, quantity, remove: quantity < 1 })}
                onVariant={(variantId) => edit.mutate({ id: item.id, quantity: item.quantity, variantId })}
                onSave={() => setSaved((current) => (current.includes(item.productId) ? current.filter((id) => id !== item.productId) : [...current, item.productId]))}
              />
            ))}
          </ul>

          {suggestions.length ? (
            <section className="mt-6">
              <h2 className="text-lg font-bold">{t('customer.completeMeal')}</h2>
              <p className="mt-0.5 text-sm text-[#6f6f6a]">{t('customer.completeMealHint')}</p>
              <ul className="mt-3 flex gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-3 lg:overflow-visible">
                {suggestions.map((product) => (
                  <li key={product.id} className="w-[46%] shrink-0 lg:w-auto">
                    <article className="flex h-full flex-col rounded-2xl border border-[#ecece6] bg-white p-2.5">
                      <img src={product.imageUrl || '/no-image-1x1.jpg'} alt="" className="aspect-[4/3] w-full rounded-xl object-cover" />
                      <p className="mt-2 line-clamp-1 text-sm font-semibold">{pickLocalized(product.name, locale)}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-snug text-[#6f6f6a]">{pickLocalized(product.description, locale)}</p>
                      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                        <span className="text-sm font-bold">{formatMoney(product.price, locale)}</span>
                        <button
                          type="button"
                          disabled={add.isPending && add.variables === product.id}
                          aria-busy={add.isPending && add.variables === product.id}
                          onClick={(event) => {
                            flyFromButton(event.currentTarget, product.imageUrl || '/no-image-1x1.jpg');
                            add.mutate(product.id);
                          }}
                          className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-full bg-primary px-2.5 text-sm font-bold text-[#111] disabled:opacity-50"
                        >
                          {add.isPending && add.variables === product.id ? <CartButtonSpinner /> : <Plus className="size-3.5" />}
                          {t('customer.addShort')}
                        </button>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="mt-5 lg:hidden">
            <button
              type="button"
              aria-expanded={noteOpen}
              onClick={() => setNoteOpen((value) => !value)}
              className="flex w-full items-center gap-3 rounded-2xl border border-[#e6e6e0] bg-white px-4 py-3.5 text-start"
            >
              <FileText className="size-5 shrink-0 text-[#6f6f6a]" />
              <span className="min-w-0 flex-1 font-medium">{t('customer.restaurantNote')}</span>
              <ChevronDown className={cn('size-4 shrink-0 transition', noteOpen && 'rotate-180')} />
            </button>
            {noteOpen ? <NoteField note={note} onChange={setNote} onBlur={saveNote} placeholder={t('customer.notePlaceholder')} /> : null}
          </div>

          <div className="relative mt-6 hidden lg:block">
            <p className="mb-2 font-semibold">{t('customer.restaurantNote')}</p>
            <NoteField note={note} onChange={setNote} onBlur={saveNote} placeholder={t('customer.notePlaceholder')} />
          </div>

          <div className="mt-4 lg:hidden">{promoField(t('customer.enterPromo'))}</div>
          <div className="mt-4 rounded-3xl border border-[#eee] bg-white p-4 lg:hidden">{summary}</div>
          {banner ? <div className="mt-3 lg:hidden">{banner}</div> : null}
          {address ? <div className="mt-1 lg:hidden">{address}</div> : null}
          {etaRow ? <div className="lg:hidden">{etaRow}</div> : null}
        </div>

        <aside className="sticky top-24 hidden rounded-3xl border border-[#eee] bg-white p-5 shadow-sm lg:block">
          {summary}
          <div className="mt-4">
            <p className="mb-2 text-sm font-semibold">{t('customer.promoCode')}</p>
            {promoField(t('customer.enterCode'))}
          </div>
          {banner ? <div className="mt-4">{banner}</div> : null}
          {address}
          {etaRow}
          <Link href="/checkout" className="mt-4 flex h-12 items-center justify-center gap-2 rounded-full bg-primary text-sm font-bold text-[#111]">
            {t('customer.proceedCheckout')}
            <ArrowRight className="size-4 rtl:rotate-180" />
          </Link>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[#f0f0ea] pt-4 text-xs">
            <div className="flex gap-2">
              <ShieldCheck className="size-4 shrink-0" />
              <span>
                <span className="block font-semibold">{t('customer.securePayment')}</span>
                <span className="text-[#6f6f6a]">{t('customer.paymentSafe')}</span>
              </span>
            </div>
            <div className="flex gap-2">
              <Headphones className="size-4 shrink-0" />
              <span>
                <span className="block font-semibold">{t('customer.alwaysHere')}</span>
                <span className="text-[#6f6f6a]">{t('customer.hereToHelp')}</span>
              </span>
            </div>
          </div>
        </aside>
      </div>

      <Link
        href="/checkout"
        className="fixed inset-x-4 bottom-[calc(4.65rem+max(0.7rem,env(safe-area-inset-bottom))+1.9rem)] z-40 mx-auto flex max-w-[640px] items-center justify-between gap-3 rounded-full bg-[#111] py-2 ps-5 pe-2 text-white shadow-[0_10px_28px_rgba(0,0,0,0.28)] lg:hidden"
      >
        <span className="min-w-0">
          <span className="block text-[11px] font-medium text-white/60">{t('customer.total')}</span>
          <span className="block truncate text-base font-bold leading-tight">{formatMoney(data.pricing.total, locale)}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-bold text-[#111]">
          {t('customer.proceedCheckout')}
          <ArrowRight className="size-4 rtl:rotate-180" />
        </span>
      </Link>
    </div>
  );
}

function CartHeader({
  backHref,
  menuLabel,
  clearLabel,
  clearDisabled,
  onClear,
}: {
  backHref: string;
  menuLabel?: string;
  clearLabel?: string;
  clearDisabled?: boolean;
  onClear?: () => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-20 -mx-4 -mt-4 flex items-center bg-white px-1 pt-1 pb-3 lg:hidden">
      <Link href={backHref} aria-label={t('customer.back')} className="grid size-11 place-items-center">
        <ChevronLeft className="size-6 rtl:rotate-180" />
      </Link>
      <h1 className="flex-1 text-center text-lg font-bold">{t('customer.yourCart')}</h1>
      {onClear && menuLabel && clearLabel ? (
        <div className="relative">
          <button type="button" aria-label={menuLabel} aria-expanded={open} onClick={() => setOpen((value) => !value)} className="grid size-11 place-items-center">
            <MoreVertical className="size-5" />
          </button>
          {open ? (
            <div className="absolute end-0 z-30 w-44 overflow-hidden rounded-2xl border border-[#eee] bg-white py-1 shadow-lg">
              <button
                type="button"
                disabled={clearDisabled}
                onClick={() => {
                  setOpen(false);
                  onClear();
                }}
                className="flex w-full px-4 py-2.5 text-start text-sm font-semibold disabled:opacity-50"
              >
                {clearLabel}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <span className="size-11" />
      )}
    </header>
  );
}

function CartItem({
  item,
  locale,
  slug,
  saved,
  pending,
  labels,
  onQty,
  onVariant,
  onSave,
}: {
  item: CartItem;
  locale: 'en' | 'ar';
  slug?: string;
  saved: boolean;
  pending: boolean;
  labels: { customizable: string; edit: string; remove: string; increase: string; decrease: string; save: string };
  onQty: (quantity: number) => void;
  onVariant: (variantId: string) => void;
  onSave: () => void;
}) {
  const name = pickLocalized(item.name, locale);
  const description = pickLocalized(item.description, locale);
  const addonText = (item.addons ?? []).map((addon) => pickLocalized(addon.name, locale)).filter(Boolean).join(' · ');
  const price = formatMoney(item.lineTotal, locale);
  const editHref = slug ? `/merchants/${slug}/products/${item.productId}` : undefined;
  const options = (
    <ItemOptions item={item} locale={locale} addonText={addonText} editHref={editHref} editLabel={labels.edit} pending={pending} onVariant={onVariant} />
  );
  const qty = <QtyControl quantity={item.quantity} pending={pending} increase={labels.increase} decrease={labels.decrease} onQty={onQty} />;
  const remove = (
    <button type="button" aria-label={labels.remove} disabled={pending} onClick={() => onQty(0)} className="grid size-9 place-items-center rounded-xl border border-[#e6e6e0] text-[#3f3f3c] disabled:opacity-50">
      <Trash2 className="size-4" />
    </button>
  );
  return (
    <li className="rounded-2xl border border-[#ecece6] bg-white p-3 lg:rounded-none lg:border-0 lg:bg-transparent lg:px-0 lg:py-4">
      <div className="flex gap-3 lg:hidden">
        <img src={item.imageUrl || '/no-image-1x1.jpg'} alt="" className="size-[72px] shrink-0 rounded-2xl object-cover" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <ItemTitle name={name} customizable={item.customizable} label={labels.customizable} />
            <p className="shrink-0 text-sm font-bold">{price}</p>
          </div>
          {description ? <p className="mt-1 line-clamp-2 text-sm leading-snug text-[#6f6f6a]">{description}</p> : null}
          <div className="mt-2 flex items-end justify-between gap-2">
            <div className="min-w-0">{options}</div>
            <div className="flex shrink-0 items-center gap-1.5">
              {qty}
              {remove}
            </div>
          </div>
        </div>
      </div>
      <div className="hidden items-center gap-4 lg:flex">
        <img src={item.imageUrl || '/no-image-1x1.jpg'} alt="" className="size-20 shrink-0 rounded-2xl object-cover" />
        <div className="min-w-0 flex-1">
          <ItemTitle name={name} customizable={item.customizable} label={labels.customizable} />
          {description ? <p className="mt-1 line-clamp-2 text-sm text-[#6f6f6a]">{description}</p> : null}
          <div className="mt-2">{options}</div>
        </div>
        <p className="shrink-0 font-bold">{price}</p>
        <div className="flex shrink-0 items-center gap-1">
          {qty}
          <button type="button" aria-pressed={saved} aria-label={labels.save} onClick={onSave} className="grid size-9 place-items-center text-[#3f3f3c]">
            <Heart className={cn('size-4', saved && 'fill-[#111]')} />
          </button>
          {remove}
        </div>
      </div>
    </li>
  );
}

function ItemTitle({ name, customizable, label }: { name: string; customizable: boolean; label: string }) {
  return (
    <p className="min-w-0 font-semibold leading-snug">
      {name}
      {customizable ? (
        <span className="ms-1.5 inline-flex items-center gap-0.5 align-middle text-xs font-medium whitespace-nowrap text-[#8d8d88]">
          <Sparkles className="size-3.5" />
          {label}
        </span>
      ) : null}
    </p>
  );
}

function ItemOptions({
  item,
  locale,
  addonText,
  editHref,
  editLabel,
  pending,
  onVariant,
}: {
  item: CartItem;
  locale: 'en' | 'ar';
  addonText: string;
  editHref?: string;
  editLabel: string;
  pending: boolean;
  onVariant: (variantId: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {(item.variants ?? []).length ? (
        <label className="relative inline-flex">
          <select
            aria-label={pickLocalized(item.variantName, locale) || editLabel}
            disabled={pending}
            value={item.variantId ?? ''}
            onChange={(event) => {
              if (event.target.value) onVariant(event.target.value);
            }}
            className="h-8 appearance-none rounded-lg border border-[#e6e6e0] bg-white ps-2.5 pe-7 text-sm font-medium outline-none disabled:opacity-50"
          >
            {!item.variantId ? <option value="" /> : null}
            {(item.variants ?? []).map((variant) => (
              <option key={variant.id} value={variant.id}>
                {pickLocalized(variant.name, locale)}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute end-1.5 top-1/2 size-3.5 -translate-y-1/2 text-[#6f6f6a]" />
        </label>
      ) : null}
      {addonText ? <span className="text-sm text-[#3f3f3c]">{addonText}</span> : null}
      {editHref ? (
        <Link href={editHref} className="text-sm font-semibold text-[#2563EB]">
          {editLabel}
        </Link>
      ) : null}
    </div>
  );
}

function QtyControl({
  quantity,
  pending,
  increase,
  decrease,
  onQty,
}: {
  quantity: number;
  pending: boolean;
  increase: string;
  decrease: string;
  onQty: (quantity: number) => void;
}) {
  return (
    <div className="inline-flex h-9 items-center rounded-xl border border-[#e6e6e0] bg-white">
      <button type="button" aria-label={decrease} disabled={pending || quantity <= 1} onClick={() => onQty(quantity - 1)} className="grid size-8 place-items-center disabled:opacity-40">
        <Minus className="size-3.5" />
      </button>
      <span className="w-4 text-center text-sm font-semibold">{quantity}</span>
      <button type="button" aria-label={increase} disabled={pending} onClick={() => onQty(quantity + 1)} className="grid size-8 place-items-center disabled:opacity-40">
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

function NoteField({ note, onChange, onBlur, placeholder }: { note: string; onChange: (value: string) => void; onBlur: () => void; placeholder: string }) {
  return (
    <div className="relative mt-2">
      <textarea
        value={note}
        maxLength={500}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className="min-h-28 w-full resize-none rounded-2xl border border-[#e6e6e0] bg-white p-4 pb-8 text-sm outline-none placeholder:text-[#8d8d88] focus:border-[#111]"
      />
      <span className="pointer-events-none absolute bottom-3 end-4 text-xs text-[#8d8d88]">{note.length}/500</span>
    </div>
  );
}

function PromoField({
  code,
  onChange,
  onApply,
  pending,
  label,
  placeholder,
  applyLabel,
}: {
  code: string;
  onChange: (value: string) => void;
  onApply: () => void;
  pending: boolean;
  label: string;
  placeholder: string;
  applyLabel: string;
}) {
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">{label}</span>
        <Tag className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-[#8d8d88]" />
        <input
          value={code}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="h-12 w-full rounded-xl border border-[#e6e6e0] bg-white ps-10 pe-3 text-sm outline-none placeholder:text-[#8d8d88] focus:border-[#111]"
        />
      </label>
      <button type="submit" disabled={pending || !code.trim()} className="h-12 shrink-0 rounded-xl bg-[#111] px-5 text-sm font-bold text-white disabled:cursor-not-allowed">
        {applyLabel}
      </button>
    </form>
  );
}

function Summary({
  locale,
  pricing,
  delivering,
  labels,
}: {
  locale: 'en' | 'ar';
  pricing: CartSnapshot['pricing'];
  delivering: boolean;
  labels: {
    title: string;
    subtotal: string;
    items: string;
    deliveryFee: string;
    deliveryHint: string;
    free: string;
    serviceFee: string;
    serviceHint: string;
    discount: string;
    total: string;
  };
}) {
  const deliveryFree = Number(pricing.deliveryFee) === 0;
  return (
    <div>
      <h2 className="text-lg font-bold">{labels.title}</h2>
      <div className="mt-3 space-y-2.5 text-sm">
        <Row label={`${labels.subtotal} (${labels.items})`} value={formatMoney(pricing.subtotal, locale)} />
        {delivering ? (
          <Row
            label={labels.deliveryFee}
            hint={labels.deliveryHint}
            value={deliveryFree ? labels.free : formatMoney(pricing.deliveryFee, locale)}
            valueClass={deliveryFree ? 'font-semibold text-[#168A52]' : 'font-semibold'}
          />
        ) : null}
        <Row label={labels.serviceFee} hint={labels.serviceHint} value={formatMoney(pricing.tax, locale)} />
        {Number(pricing.discount) > 0 ? <Row label={labels.discount} value={`− ${formatMoney(pricing.discount, locale)}`} valueClass="font-semibold text-[#168A52]" /> : null}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-2xl bg-[#fff6d0] px-4 py-3">
        <span className="font-bold">{labels.total}</span>
        <span className="text-xl font-extrabold tracking-tight">{formatMoney(pricing.total, locale)}</span>
      </div>
    </div>
  );
}

function Row({ label, value, hint, valueClass = 'font-semibold' }: { label: string; value: string; hint?: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="inline-flex items-center gap-1 text-[#6f6f6a]">
        {label}
        {hint ? <Tip text={hint} /> : null}
      </span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

function Tip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button type="button" aria-label={text} aria-expanded={open} onClick={() => setOpen((value) => !value)} className="text-[#9a9a94]">
        <Info className="size-3.5" />
      </button>
      {open ? <span className="absolute start-0 top-6 z-20 w-56 rounded-xl bg-[#111] px-3 py-2 text-xs leading-snug font-medium text-white shadow-lg">{text}</span> : null}
    </span>
  );
}

function DeliveryBanner({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-[#fff6d0] px-3 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary">
        <Bike className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold">{title}</span>
        <span className="mt-0.5 block text-xs text-[#6f6f6a]">{body}</span>
      </span>
    </div>
  );
}

function AddressRow({
  text,
  changeLabel,
  addresses,
  areas: areaOptions,
  selectedAddressId,
  selectedAreaId,
  manageHref,
  manageLabel,
  onAddress,
  onArea,
}: {
  text: string;
  changeLabel: string;
  addresses: SavedAddress[];
  areas: { id: string; label: string }[];
  selectedAddressId: string | null;
  selectedAreaId: string;
  manageHref: string | null;
  manageLabel: string;
  onAddress: (id: string) => void;
  onArea: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="py-3">
      <div className="flex items-center gap-3">
        <MapPin className="size-5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{text}</span>
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="shrink-0 text-sm font-semibold text-[#2563EB]">
          {changeLabel}
        </button>
      </div>
      {open ? (
        <ul className="mt-2 overflow-hidden rounded-2xl border border-[#eee] bg-white">
          {addresses.length
            ? addresses.map((address) => (
                <li key={address.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onAddress(address.id);
                      setOpen(false);
                    }}
                    className={cn('flex w-full px-4 py-2.5 text-start text-sm font-medium hover:bg-[#f7f7f5]', address.id === selectedAddressId && 'bg-[#fff6d0]')}
                  >
                    {address.label} • {address.city}
                  </button>
                </li>
              ))
            : areaOptions.map((area) => (
                <li key={area.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onArea(area.id);
                      setOpen(false);
                    }}
                    className={cn('flex w-full px-4 py-2.5 text-start text-sm font-medium hover:bg-[#f7f7f5]', area.id === selectedAreaId && 'bg-[#fff6d0]')}
                  >
                    {area.label}
                  </button>
                </li>
              ))}
          {manageHref ? (
            <li>
              <Link href={manageHref} className="flex px-4 py-2.5 text-sm font-semibold text-[#2563EB]">
                {manageLabel}
              </Link>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function EtaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <Clock className="size-5 shrink-0" />
      <span className="min-w-0 flex-1 font-medium">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function CartSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <Skeleton className="h-12 w-full lg:hidden" />
      <Skeleton className="hidden h-10 w-64 lg:block" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-40 w-full lg:hidden" />
    </div>
  );
}
