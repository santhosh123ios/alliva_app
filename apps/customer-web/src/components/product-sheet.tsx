import { CartButtonSpinner, flyToCart } from '@/components/cart-motion';
import { DishRatingSummary, DishReviews, useDishReviews } from '@/components/dish-reviews';
import { NoteField, ProductOptions, Quantity, runningTotal, toggleAddonIn, type ProductPayload } from '@/components/product-options';
import { api } from '@/components/providers';
import type { useCartAdd } from '@/components/store-switch';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { cn, DialogDescription, DialogTitle, Sheet, SheetContent, Skeleton } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ClipboardList, ShoppingCart, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';

/**
 * Sizes, options and combos for one dish, in a bottom sheet over the menu (a centred card on desktop),
 * so the diner never leaves the table page to customise it.
 */
export function ProductSheet({ productId, onClose, cartAdd, viewOnly = false }: { productId: string | null; onClose: () => void; cartAdd: ReturnType<typeof useCartAdd>; viewOnly?: boolean }) {
  const t = useTranslations();
  const product = useQuery({ queryKey: ['product', productId], queryFn: () => api.product(productId!), enabled: Boolean(productId) });
  const data = product.data?.id === productId ? product.data : undefined;
  return (
    <Sheet open={Boolean(productId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        aria-describedby={undefined}
        className={cn(
          'inset-x-0 top-auto bottom-0 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[24px] bg-white p-0',
          'lg:inset-auto lg:top-1/2 lg:left-1/2 lg:max-h-[86dvh] lg:w-[480px] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-[24px]',
        )}
      >
        {data ? (
          // Keyed so every dish opens with fresh picks.
          <SheetBody key={data.id} data={data} cartAdd={cartAdd} onClose={onClose} viewOnly={viewOnly} />
        ) : (
          <div className="p-5" aria-busy>
            <DialogTitle className="sr-only">{t('common.loading')}</DialogTitle>
            <Skeleton className="aspect-[16/9] w-full rounded-2xl" />
            <Skeleton className="mt-4 h-7 w-2/3" />
            <Skeleton className="mt-2 h-5 w-24" />
            <Skeleton className="mt-5 h-20 w-full rounded-2xl" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** `viewOnly`: the table has paid, so the add button says to scan again instead of adding. */
function SheetBody({ data, cartAdd, onClose, viewOnly }: { data: ProductPayload; cartAdd: ReturnType<typeof useCartAdd>; onClose: () => void; viewOnly: boolean }) {
  const t = useTranslations();
  const locale = useLocale() as 'en' | 'ar';
  const [variantId, setVariantId] = useState<string | null>(() => data.variants.find((variant) => variant.available)?.id ?? null);
  const [addons, setAddons] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const photoRef = useRef<HTMLImageElement>(null);
  const reviews = useDishReviews(data.id);
  const name = pickLocalized(data.name, locale);
  const description = pickLocalized(data.description, locale);
  const image = data.images?.[0] || data.imageUrl || '/no-image-16x9.jpg';
  const variant = data.variants.find((item) => item.id === variantId) ?? null;
  const fixedAddons = data.addonGroups.filter((group) => group.fixed).flatMap((group) => group.addons);
  const choiceGroups = data.addonGroups.filter((group) => !group.fixed);
  const pickedAddons = choiceGroups.flatMap((group) => group.addons).filter((addon) => addons.includes(addon.id));
  const selectedAddons = [...fixedAddons, ...pickedAddons];
  const missingRequired = choiceGroups.some((group) => addons.filter((addonId) => group.addons.some((addon) => addon.id === addonId)).length < group.minSelect);
  const canAdd = data.available && !missingRequired && (!data.variants.length || Boolean(variant));
  const total = runningTotal(variant?.price ?? data.price, selectedAddons, quantity);

  const add = (event: React.MouseEvent<HTMLButtonElement>) => {
    const placed = cartAdd.requestAdd(data.merchantId, data.merchantName, {
      productId: data.id,
      variantId,
      addonIds: selectedAddons.map((addon) => addon.id),
      quantity,
      notes: notes.trim() || undefined,
      preview: {
        name: data.name,
        description: data.description,
        imageUrl: data.imageUrl,
        unitPrice: runningTotal(variant?.price ?? data.price, selectedAddons, 1),
        addons: selectedAddons.map((addon) => ({ id: addon.id, name: addon.name, price: addon.price })),
      },
    });
    if (!placed) return;
    flyToCart(photoRef.current, event.currentTarget, image);
    onClose();
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="relative">
          <span aria-hidden className="absolute top-2 left-1/2 z-10 h-1 w-10 -translate-x-1/2 rounded-full bg-white/80 lg:hidden" />
          <img ref={photoRef} src={image} alt="" className="aspect-[16/9] w-full bg-[#f3f3ef] object-cover" />
          <button type="button" aria-label={t('customer.tablePage.closeCalls')} onClick={onClose} className="absolute end-3 top-3 grid size-9 place-items-center rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.15)]">
            <X className="size-[18px]" strokeWidth={2.4} />
          </button>
        </div>
        <div className="px-5 pt-4 pb-5">
          <DialogTitle className="text-[22px] leading-tight font-extrabold tracking-[-0.02em] text-[#111]">{name}</DialogTitle>
          <p className="mt-1 text-lg font-bold text-[#111]">{formatMoney(variant?.price ?? data.price, locale)}</p>
          <DishRatingSummary reviews={reviews.data} />
          {description ? <DialogDescription className="mt-2 text-[14px] leading-relaxed text-[#6f6f6a]">{description}</DialogDescription> : null}

          <ProductOptions product={data} variantId={variantId} onVariant={setVariantId} addons={addons} onToggle={(group, addonId) => setAddons((current) => toggleAddonIn(current, group, addonId))} />

          <section className="mt-6">
            <button type="button" aria-expanded={notesOpen} onClick={() => setNotesOpen((open) => !open)} className="flex w-full items-center gap-3 rounded-2xl bg-[#f6f6f4] px-4 py-3.5 text-start">
              <ClipboardList className="size-5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t('customer.specialInstructions')}</span>
                <span className="mt-0.5 block truncate text-sm text-[#8d8d88]">{notes.trim() || t('customer.kitchenNote')}</span>
              </span>
              <ChevronDown className={cn('size-4 shrink-0 text-[#6f6f6a] transition', notesOpen && 'rotate-180')} />
            </button>
            {notesOpen ? <NoteField value={notes} onChange={setNotes} placeholder={t('customer.kitchenNote')} /> : null}
          </section>

          <DishReviews productId={data.id} reviews={reviews.data} />
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-[#eee] bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {viewOnly ? null : <Quantity value={quantity} onChange={setQuantity} decreaseLabel={t('customer.decreaseQty')} increaseLabel={t('customer.increaseQty')} />}
        <button
          type="button"
          disabled={viewOnly || !canAdd || cartAdd.pending}
          aria-busy={cartAdd.pending}
          onClick={add}
          className="inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-bold text-[#111] disabled:opacity-50"
        >
          {cartAdd.pending ? <CartButtonSpinner className="size-4" /> : <ShoppingCart className="size-[18px] shrink-0" strokeWidth={2.2} />}
          <span className="whitespace-nowrap">{viewOnly ? t('customer.tablePage.paidScanAgain') : data.available ? t('customer.add') : t('customer.unavailable')}</span>
          {viewOnly ? null : (
            <>
              <span aria-hidden className="h-4 w-px shrink-0 bg-[#111]/25" />
              <span className="whitespace-nowrap tabular-nums">{formatMoney(total, locale)}</span>
            </>
          )}
        </button>
      </div>
    </>
  );
}
