import type { api } from '@/components/providers';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { cn } from '@alliva/ui';
import { Check, Minus, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';

export type ProductPayload = NonNullable<Awaited<ReturnType<typeof api.product>>>;
type AddonGroup = ProductPayload['addonGroups'][number];
type Addon = AddonGroup['addons'][number];

const noteLimit = 250;

/** Picking an option: a single-choice group swaps its pick, a full multi-choice group ignores the tap. */
export function toggleAddonIn(current: string[], group: AddonGroup, addonId: string) {
  if (current.includes(addonId)) return current.filter((item) => item !== addonId);
  const ids = new Set(group.addons.map((addon) => addon.id));
  const chosen = current.filter((item) => ids.has(item));
  if (group.maxSelect > 0 && chosen.length >= group.maxSelect) {
    if (group.maxSelect === 1) return [...current.filter((item) => !ids.has(item)), addonId];
    return current;
  }
  return [...current, addonId];
}

/** Everything a diner picks before adding: size, what a combo includes, and each option group. Shared by the product page and the menu's bottom sheet. */
export function ProductOptions({
  product,
  variantId,
  onVariant,
  addons,
  onToggle,
}: {
  product: ProductPayload;
  variantId: string | null;
  onVariant: (id: string) => void;
  addons: string[];
  onToggle: (group: AddonGroup, addonId: string) => void;
}) {
  const t = useTranslations();
  const locale = useLocale() as 'en' | 'ar';
  const basePrice = cheapest(product.variants.map((item) => item.price));
  // Fixed combo items are always in the order, so they are shown as included rather than offered as picks.
  const fixedAddons = product.addonGroups.filter((group) => group.fixed).flatMap((group) => group.addons);
  const choiceGroups = product.addonGroups.filter((group) => !group.fixed);
  return (
    <>
      {product.variants.length ? (
        <section className="mt-6">
          <SectionTitle title={t('customer.chooseSize')} badge={<RequiredBadge label={t('customer.requiredSelect', { count: 1 })} />} />
          <div className="mt-3 grid gap-2.5 lg:grid-cols-3">
            {product.variants.map((item) => {
              const selected = item.id === variantId;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={!item.available}
                  onClick={() => onVariant(item.id)}
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

      {fixedAddons.length ? (
        <section className="mt-6">
          <SectionTitle title={t('customer.comboIncludes')} badge={<OptionalBadge label={t('customer.included')} />} />
          <ul className="mt-3 grid gap-2">
            {fixedAddons.map((addon) => (
              <li key={addon.id} className="flex items-center gap-3 rounded-2xl border border-[#e7e7e1] bg-[#f6f6f4] px-3 py-2.5">
                <OptionPhoto src={addon.imageUrl} />
                <span className="min-w-0 flex-1 text-sm font-semibold">{pickLocalized(addon.name, locale)}</span>
                <Check className="size-4 shrink-0 text-[#3f3f3c]" strokeWidth={3} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {choiceGroups.map((group) => {
        const combo = group.addons.some((addon) => addon.productId);
        return (
        <section key={group.id} className="mt-6">
          <SectionTitle
            title={choiceGroups.length === 1 && group.minSelect === 0 && !combo ? t('customer.addExtras') : pickLocalized(group.name, locale)}
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
                <OptionalBadge label={group.maxSelect > 1 ? t('customer.optionalUpTo', { count: group.maxSelect }) : t('customer.optional')} />
              )
            }
          />
          <div className={cn('mt-3 grid gap-2.5', combo ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2')}>
            {group.addons.map((addon) => {
              const selected = addons.includes(addon.id);
              return (
                <button
                  key={addon.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={!addon.available}
                  onClick={() => onToggle(group, addon.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-2xl border px-3 py-3 text-start disabled:opacity-45',
                    selected ? 'border-[#f0c84a] bg-[#fff8dc]' : 'border-[#e7e7e1] bg-white',
                  )}
                >
                  {group.maxSelect === 1 ? <RadioMark selected={selected} /> : <CheckBox selected={selected} />}
                  {combo ? <OptionPhoto src={addon.imageUrl} /> : null}
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold leading-snug">{pickLocalized(addon.name, locale)}</span>
                    {!addon.available ? (
                      <span className="text-xs font-semibold text-[#8d8d88]">{t('customer.soldOut')}</span>
                    ) : fils(addon.price) > 0 ? (
                      <span className="text-xs font-semibold text-[#3f3f3c]">+ {formatMoney(addon.price, locale)}</span>
                    ) : combo ? (
                      <span className="text-xs font-semibold text-[#8d8d88]">{t('customer.included')}</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        );
      })}
    </>
  );
}

export function SectionTitle({ title, badge }: { title: string; badge: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-bold">{title}</h2>
      {badge}
    </div>
  );
}

export function RequiredBadge({ label }: { label: string }) {
  return <span className="shrink-0 rounded-full bg-[#fff6d0] px-2.5 py-1 text-[11px] font-semibold text-[#8a6a00]">{label}</span>;
}

export function OptionalBadge({ label }: { label: string }) {
  return <span className="shrink-0 rounded-full bg-[#f3f3f0] px-2.5 py-1 text-[11px] font-semibold text-[#6f6f6a]">{label}</span>;
}

export function RadioMark({ selected }: { selected: boolean }) {
  return (
    <span className={cn('grid size-5 shrink-0 place-items-center rounded-full border-2', selected ? 'border-[#111]' : 'border-[#cfcfc8]')}>
      {selected ? <span className="size-2.5 rounded-full bg-[#111]" /> : null}
    </span>
  );
}

export function OptionPhoto({ src }: { src: string | null }) {
  return (
    <span className="relative size-10 shrink-0 overflow-hidden rounded-xl bg-[#efefea]">
      <img src={src || '/no-image-1x1.jpg'} alt="" className="absolute inset-0 size-full object-cover" />
    </span>
  );
}

export function CheckBox({ selected }: { selected: boolean }) {
  return (
    <span className={cn('grid size-5 shrink-0 place-items-center rounded-md border', selected ? 'border-[#111] bg-primary' : 'border-[#cfcfc8] bg-white')}>
      {selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
    </span>
  );
}

export function NoteField({ value, onChange, placeholder, className }: { value: string; onChange: (value: string) => void; placeholder: string; className?: string }) {
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

export function Quantity({
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

export function cheapest(prices: string[]) {
  if (!prices.length) return null;
  return prices.reduce((lowest, price) => (fils(price) < fils(lowest) ? price : lowest));
}

export function priceDelta(price: string, base: string, locale: 'en' | 'ar', included: string) {
  const delta = fils(price) - fils(base);
  if (delta === 0) return included;
  const formatted = formatMoney((Math.abs(delta) / 1000).toFixed(3), locale);
  return delta > 0 ? `+ ${formatted}` : `− ${formatted}`;
}

export function runningTotal(unit: string, addons: Addon[], quantity: number) {
  const extra = addons.reduce((sum, addon) => sum + fils(addon.price), 0);
  return ((fils(unit) + extra) * quantity / 1000).toFixed(3);
}

export function fils(value: string) {
  return Math.round(Number(value) * 1000);
}
