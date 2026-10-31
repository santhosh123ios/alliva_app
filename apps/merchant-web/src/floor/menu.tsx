import { api } from '@/components/providers';
import { Link, useRouter } from '@/i18n/navigation';
import type { FloorBoard, FloorMenuProduct, LocalizedText } from '@alliva/types';
import { cn, EmptyState, ErrorState, Skeleton, toast } from '@alliva/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChefHat, LayoutGrid, Minus, Plus, Search, ShoppingBag, StickyNote, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';
import { floorKey, tableNo, money, useDraft, useFloorBoard, useFloorLocale, useFloorMenu, useFloorSettings, type Locale } from './shared';

const text = (value: LocalizedText, locale: Locale) => value[locale] || value.en;

export default function FloorMenu() {
  const t = useTranslations('floor.menu');
  const locale = useFloorLocale();
  const menu = useFloorMenu();
  const draft = useDraft();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [picking, setPicking] = useState<FloorMenuProduct | null>(null);
  const reviewing = params.get('review') === '1';
  const setReviewing = (on: boolean) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (on) next.set('review', '1');
    else next.delete('review');
    return next;
  }, { replace: true });

  const categories = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (menu.data?.categories ?? [])
      .filter((row) => category === 'all' || row.id === category)
      .map((row) => ({ ...row, products: needle ? row.products.filter((product) => `${product.name.en} ${product.name.ar}`.toLowerCase().includes(needle)) : row.products }))
      .filter((row) => row.products.length);
  }, [menu.data, category, query]);

  function quickAdd(product: FloorMenuProduct) {
    const customisable = product.variants.length > 0 || product.addonGroups.some((group) => group.addons.length);
    if (customisable) return setPicking(product);
    draft.add({ productId: product.id, variantId: null, addonIds: [], quantity: 1, notes: '', name: product.name, detail: [], unitPrice: product.price });
    toast.success(t('added', { name: text(product.name, locale) }), { duration: 1200 });
  }

  if (menu.isLoading) return <div className="space-y-3"><Skeleton className="h-14 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /></div>;
  if (menu.error) return <ErrorState title={t('loadFailed')} body={(menu.error as Error).message} />;
  if (!menu.data?.categories.length) return <EmptyState title={t('empty')} body={t('emptyBody')} />;

  return (
    <div className="space-y-3">
      <TargetBar />

      <div className="sticky top-14 z-20 -mx-4 space-y-2 bg-[#F7F7F5]/95 px-4 pb-2 pt-1 backdrop-blur">
        <label className="relative flex items-center">
          <Search className="pointer-events-none absolute start-3 size-4 text-[#8A8A86]" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} className="h-11 w-full rounded-xl border border-[#E6E6E2] bg-white pe-3 ps-9 text-sm outline-none focus:border-[#111111]" />
        </label>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
          <button type="button" aria-pressed={category === 'all'} onClick={() => setCategory('all')} className={cn('h-9 shrink-0 rounded-full px-4 text-sm font-semibold', category === 'all' ? 'bg-[#111111] text-white' : 'bg-white text-[#5C5C58]')}>{t('all')}</button>
          {menu.data.categories.map((row) => (
            <button key={row.id} type="button" aria-pressed={category === row.id} onClick={() => setCategory(row.id)} className={cn('h-9 shrink-0 rounded-full px-4 text-sm font-semibold', category === row.id ? 'bg-[#111111] text-white' : 'bg-white text-[#5C5C58]')}>{text(row.name, locale)}</button>
          ))}
        </div>
      </div>

      {categories.length ? categories.map((row) => (
        <section key={row.id}>
          <h2 className="mb-2 px-1 text-sm font-semibold text-[#696965]">{text(row.name, locale)}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {row.products.map((product) => <ProductRow key={product.id} product={product} onAdd={() => quickAdd(product)} />)}
          </div>
        </section>
      )) : <p className="py-10 text-center text-sm text-[#8A8A86]">{t('noMatch')}</p>}

      {draft.count ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(max(0.7rem,env(safe-area-inset-bottom))+5.4rem)] z-40 px-3 lg:bottom-4">
          <button type="button" onClick={() => setReviewing(true)} className="pointer-events-auto mx-auto flex h-12 w-full max-w-[520px] items-center gap-3 rounded-2xl bg-[#111111] px-4 text-sm font-semibold text-white shadow-[0_10px_28px_rgba(0,0,0,0.25)]">
            <ShoppingBag className="size-4" />
            <span className="flex-1 text-start">{t('review', { count: draft.count })}</span>
            <span className="tabular-nums">{money(draft.subtotal, locale)}</span>
          </button>
        </div>
      ) : null}

      {picking ? <ProductSheet product={picking} onClose={() => setPicking(null)} /> : null}
      {reviewing ? <ReviewSheet onClose={() => setReviewing(false)} /> : null}
    </div>
  );
}

/** Who this order is for. Takeaway needs no table; dine-in is picked from the floor plan. */
function TargetBar() {
  const t = useTranslations('floor.menu');
  const draft = useDraft();
  const target = draft.target;
  return (
    <section className="flex items-center gap-3 rounded-2xl bg-white p-3">
      <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl text-base font-bold', target ? 'bg-[#FFC400] text-[#111111]' : 'bg-[#F2F2EF] text-[#8A8A86]')}>
        {target?.kind === 'DINE_IN' ? tableNo(target.tableNumber) : <ShoppingBag className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[#696965]">{t('orderingFor')}</p>
        <p className="truncate font-semibold">{target?.kind === 'DINE_IN' ? t('table', { table: tableNo(target.tableNumber) }) : target ? t('takeaway') : t('noTarget')}</p>
      </div>
      <Link href="/floor/tables" aria-label={t('pickTable')} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-[#E6E6E2] px-3 text-sm font-semibold"><LayoutGrid className="size-4" /><span className="hidden sm:inline">{t('pickTable')}</span></Link>
      {target?.kind !== 'TAKEAWAY' ? (
        <button type="button" aria-label={t('takeaway')} onClick={() => draft.setTarget({ kind: 'TAKEAWAY' })} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-[#E6E6E2] px-3 text-sm font-semibold"><ShoppingBag className="size-4" /><span className="hidden sm:inline">{t('takeaway')}</span></button>
      ) : null}
    </section>
  );
}

function ProductRow({ product, onAdd }: { product: FloorMenuProduct; onAdd: () => void }) {
  const t = useTranslations('floor.menu');
  const locale = useFloorLocale();
  const draft = useDraft();
  const inDraft = draft.lines.filter((line) => line.productId === product.id).reduce((sum, line) => sum + line.quantity, 0);
  const from = product.variants.length ? Math.min(...product.variants.map((variant) => Number(variant.price))) : Number(product.price);
  return (
    <article className={cn('flex gap-3 rounded-2xl bg-white p-3', !product.available && 'opacity-60')}>
      {product.imageUrl ? <img src={product.imageUrl} alt="" className="size-16 shrink-0 rounded-xl object-cover" loading="lazy" /> : null}
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold leading-snug">{text(product.name, locale)}</h3>
        {text(product.description, locale) ? <p className="line-clamp-2 text-xs text-[#696965]">{text(product.description, locale)}</p> : null}
        <p className="mt-1 text-sm font-semibold tabular-nums">{product.variants.length ? t('from', { price: money(from, locale) }) : money(product.price, locale)}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between">
        {product.available ? (
          <button type="button" onClick={onAdd} aria-label={t('add', { name: text(product.name, locale) })} className="relative grid size-11 place-items-center rounded-xl bg-[#FFC400] text-[#111111]">
            <Plus className="size-5" />
            {inDraft ? <span className="absolute -end-1.5 -top-1.5 grid min-w-5 place-items-center rounded-full bg-[#111111] px-1 text-[11px] font-bold text-white">{inDraft}</span> : null}
          </button>
        ) : <span className="rounded-full bg-[#FDECEA] px-2.5 py-1 text-xs font-semibold text-[#B42318]">{t('soldOut')}</span>}
      </div>
    </article>
  );
}

function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  const t = useTranslations('floor.menu');
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white sm:rounded-3xl">
        <header className="flex items-center gap-3 border-b border-[#F0F0EC] px-5 py-4">
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t('close')} className="grid size-9 place-items-center rounded-full bg-[#F2F2EF]"><X className="size-4" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <footer className="border-t border-[#F0F0EC] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">{footer}</footer>
      </div>
    </div>
  );
}

function Stepper({ value, onChange, min = 1 }: { value: number; onChange: (next: number) => void; min?: number }) {
  const t = useTranslations('floor.menu');
  return (
    <div className="flex h-11 items-center rounded-xl border border-[#E6E6E2]">
      <button type="button" aria-label={t('less')} onClick={() => onChange(Math.max(min, value - 1))} className="grid h-full w-11 place-items-center"><Minus className="size-4" /></button>
      <span className="w-8 text-center font-semibold tabular-nums">{value}</span>
      <button type="button" aria-label={t('more')} onClick={() => onChange(Math.min(50, value + 1))} className="grid h-full w-11 place-items-center"><Plus className="size-4" /></button>
    </div>
  );
}

/** Size, extras, a note for the kitchen and how many. */
function ProductSheet({ product, onClose }: { product: FloorMenuProduct; onClose: () => void }) {
  const t = useTranslations('floor.menu');
  const locale = useFloorLocale();
  const draft = useDraft();
  const variants = product.variants.filter((variant) => variant.available);
  const [variantId, setVariantId] = useState<string | null>(variants[0]?.id ?? null);
  const [addons, setAddons] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const groups = product.addonGroups.filter((group) => group.addons.some((addon) => addon.available));
  const missing = groups.find((group) => group.addons.filter((addon) => addons.includes(addon.id)).length < group.minSelect);
  const variant = variants.find((row) => row.id === variantId) ?? null;
  const chosen = groups.flatMap((group) => group.addons).filter((addon) => addons.includes(addon.id));
  const unit = Number(variant?.price ?? product.price) + chosen.reduce((sum, addon) => sum + Number(addon.price), 0);

  function toggle(groupId: string, addonId: string) {
    const group = groups.find((row) => row.id === groupId)!;
    setAddons((current) => {
      if (current.includes(addonId)) return current.filter((id) => id !== addonId);
      const inGroup = group.addons.filter((addon) => current.includes(addon.id)).map((addon) => addon.id);
      // A pick-one group swaps the choice; a pick-many group stops at its limit.
      if (group.maxSelect === 1) return [...current.filter((id) => !inGroup.includes(id)), addonId];
      if (group.maxSelect > 0 && inGroup.length >= group.maxSelect) return current;
      return [...current, addonId];
    });
  }

  function add() {
    draft.add({
      productId: product.id,
      variantId,
      addonIds: [...addons].sort(),
      quantity,
      notes: notes.trim(),
      name: product.name,
      detail: [...(variant ? [variant.name] : []), ...chosen.map((addon) => addon.name)],
      unitPrice: unit.toFixed(3),
    });
    toast.success(t('added', { name: text(product.name, locale) }), { duration: 1200 });
    onClose();
  }

  return (
    <Sheet
      title={text(product.name, locale)}
      onClose={onClose}
      footer={(
        <div className="flex items-center gap-3">
          <Stepper value={quantity} onChange={setQuantity} />
          <button type="button" disabled={Boolean(missing)} onClick={add} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#FFC400] text-sm font-semibold text-[#111111] disabled:opacity-50">
            {missing ? t('choose', { group: text(missing.name, locale) }) : t('addFor', { price: money(unit * quantity, locale) })}
          </button>
        </div>
      )}
    >
      <div className="space-y-5">
        {variants.length ? (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">{t('size')}</legend>
            <div className="grid gap-2">
              {variants.map((row) => (
                <label key={row.id} className={cn('flex h-12 cursor-pointer items-center gap-3 rounded-xl border px-3', variantId === row.id ? 'border-[#111111] bg-[#FAFAF8]' : 'border-[#E6E6E2]')}>
                  <input type="radio" name="variant" checked={variantId === row.id} onChange={() => setVariantId(row.id)} className="size-4 accent-[#111111]" />
                  <span className="flex-1 text-sm font-medium">{text(row.name, locale)}</span>
                  <span className="text-sm tabular-nums">{money(row.price, locale)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {groups.map((group) => (
          <fieldset key={group.id}>
            <legend className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
              {text(group.name, locale)}
              <span className="text-xs font-normal text-[#696965]">{group.minSelect > 0 ? t('required', { count: group.minSelect }) : t('optional', { count: group.maxSelect })}</span>
            </legend>
            <div className="grid gap-2">
              {group.addons.filter((addon) => addon.available).map((addon) => (
                <label key={addon.id} className={cn('flex h-12 cursor-pointer items-center gap-3 rounded-xl border px-3', addons.includes(addon.id) ? 'border-[#111111] bg-[#FAFAF8]' : 'border-[#E6E6E2]')}>
                  <input type={group.maxSelect === 1 ? 'radio' : 'checkbox'} name={group.id} checked={addons.includes(addon.id)} onChange={() => toggle(group.id, addon.id)} className="size-4 accent-[#111111]" />
                  <span className="flex-1 text-sm font-medium">{text(addon.name, locale)}</span>
                  {Number(addon.price) > 0 ? <span className="text-sm tabular-nums">+{money(addon.price, locale)}</span> : null}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <label className="block">
          <span className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><StickyNote className="size-4" />{t('note')}</span>
          <input value={notes} maxLength={200} onChange={(event) => setNotes(event.target.value)} placeholder={t('notePlaceholder')} className="h-11 w-full rounded-xl border border-[#E6E6E2] px-3 text-sm outline-none focus:border-[#111111]" />
        </label>
      </div>
    </Sheet>
  );
}

/** The whole order before it goes to the kitchen. */
function ReviewSheet({ onClose }: { onClose: () => void }) {
  const t = useTranslations('floor.menu');
  const locale = useFloorLocale();
  const draft = useDraft();
  const router = useRouter();
  const client = useQueryClient();
  const { branchId } = useFloorSettings();
  const board = useFloorBoard();
  const place = useMutation({
    mutationFn: () => api.staffOrder({
      fulfillmentType: draft.target!.kind,
      tableId: draft.target!.kind === 'DINE_IN' ? draft.target!.tableId : null,
      branchId: branchId || undefined,
      notes: draft.notes.trim() || undefined,
      items: draft.lines.map((line) => ({ productId: line.productId, variantId: line.variantId, addonIds: line.addonIds, quantity: line.quantity, notes: line.notes || undefined })),
    }),
    onSuccess: (order) => {
      toast.success(t('sent', { number: order.number }));
      // Show the table as seated right away; the socket refresh fills in the rest.
      if (order.tableNumber) {
        client.setQueryData<FloorBoard>(floorKey(branchId), (current) => current && { ...current, tables: current.tables.map((row) => (row.number === order.tableNumber ? { ...row, status: 'OCCUPIED' } : row)) });
      }
      void client.invalidateQueries({ queryKey: ['merchant', 'floor', 'board'] });
      void client.invalidateQueries({ queryKey: ['merchant', 'orders'] });
      draft.clear();
      router.push(`/floor/orders?open=${order.id}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const table = draft.target?.kind === 'DINE_IN' ? board.data?.tables.find((row) => row.id === (draft.target as { tableId: string }).tableId) : null;

  return (
    <Sheet
      title={t('reviewTitle')}
      onClose={onClose}
      footer={(
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#696965]">{t('subtotal')}</span>
            <span className="font-semibold tabular-nums">{money(draft.subtotal, locale)}</span>
          </div>
          {draft.target ? (
            <button type="button" disabled={!draft.count || place.isPending} onClick={() => place.mutate()} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#111111] text-sm font-semibold text-white disabled:opacity-50">
              <ChefHat className="size-4" />{place.isPending ? t('sending') : t('send')}
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Link href="/floor/tables" className="flex h-12 items-center justify-center rounded-xl bg-[#111111] text-sm font-semibold text-white">{t('pickTable')}</Link>
              <button type="button" onClick={() => draft.setTarget({ kind: 'TAKEAWAY' })} className="h-12 rounded-xl border border-[#E6E6E2] text-sm font-semibold">{t('takeaway')}</button>
            </div>
          )}
          <p className="text-center text-xs text-[#8A8A86]">{t('payNote')}</p>
        </div>
      )}
    >
      <p className="mb-3 rounded-xl bg-[#FFF8DC] px-3 py-2 text-sm font-semibold">
        {draft.target?.kind === 'DINE_IN' ? t('table', { table: tableNo(draft.target.tableNumber) }) : draft.target ? t('takeaway') : t('noTarget')}
        {table && table.status === 'RESERVED' ? <span className="ms-2 text-xs font-normal text-[#2F6FED]">{t('reservedWarning')}</span> : null}
      </p>
      {draft.lines.length ? (
        <ul className="divide-y divide-[#F0F0EC]">
          {draft.lines.map((line) => (
            <li key={line.key} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{text(line.name, locale)}</p>
                {line.detail.length ? <p className="text-xs text-[#696965]">{line.detail.map((part) => text(part, locale)).join(' · ')}</p> : null}
                {line.notes ? <p className="text-xs text-[#8A5A00]"><bdi>{line.notes}</bdi></p> : null}
                <p className="text-sm tabular-nums">{money(Number(line.unitPrice) * line.quantity, locale)}</p>
              </div>
              <Stepper value={line.quantity} min={0} onChange={(next) => draft.setQuantity(line.key, next)} />
            </li>
          ))}
        </ul>
      ) : <p className="py-6 text-center text-sm text-[#8A8A86]">{t('emptyDraft')}</p>}
      <label className="mt-3 block">
        <span className="mb-1.5 block text-sm font-semibold">{t('orderNote')}</span>
        <textarea value={draft.notes} maxLength={500} rows={2} onChange={(event) => draft.setNotes(event.target.value)} placeholder={t('orderNotePlaceholder')} className="w-full rounded-xl border border-[#E6E6E2] px-3 py-2 text-sm outline-none focus:border-[#111111]" />
      </label>
    </Sheet>
  );
}
