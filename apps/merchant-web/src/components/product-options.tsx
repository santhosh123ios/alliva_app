import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import type { EditableOptionGroup, ProductKind, ProductOptionEditor } from '@alliva/types';
import { ArrowDown, ArrowUp, Layers, Lock, Plus, Ruler, Shuffle, Trash2, X } from 'lucide-react';
import { useTranslations } from 'use-intl';

type Locale = 'en' | 'ar';
type Text = { en: string; ar: string };

export type DraftOption = { key: string; id?: string; name: Text; price: string; available: boolean; productId: string | null };
export type DraftGroup = { key: string; id?: string; name: Text; minSelect: number; maxSelect: number; sharedWith: number; fixed: boolean; options: DraftOption[] };
export type DraftSize = { key: string; id?: string; name: Text; price: string; available: boolean };
export type ComboItem = { id: string; name: { en?: string; ar?: string }; price: string; imageUrl: string | null };

let seed = 0;
const nextKey = () => `draft-${++seed}`;

const emptyText = (): Text => ({ en: '', ar: '' });

/** Edits one language and keeps the other, filling it with the same text until it is translated. */
function withText(previous: Text, locale: Locale, value: string): Text {
  const other: Locale = locale === 'en' ? 'ar' : 'en';
  const mirrored = !previous[other] || previous[other] === previous[locale];
  return { ...previous, [locale]: value, ...(mirrored ? { [other]: value } : {}) } as Text;
}

export function toDraftGroups(groups: EditableOptionGroup[]): DraftGroup[] {
  return groups.map((group) => ({
    key: nextKey(),
    id: group.id,
    name: { en: group.name.en ?? '', ar: group.name.ar ?? '' },
    minSelect: group.minSelect,
    maxSelect: Math.max(group.maxSelect, 1),
    sharedWith: group.sharedWith,
    fixed: group.options.length > 0 && group.minSelect >= group.options.length && group.options.every((option) => option.productId),
    options: group.options.map((option) => ({
      key: nextKey(),
      id: option.id,
      name: { en: option.name.en ?? '', ar: option.name.ar ?? '' },
      price: option.price,
      available: option.available,
      productId: option.productId,
    })),
  }));
}

export function toDraftSizes(sizes: ProductOptionEditor['variants']): DraftSize[] {
  return sizes.map((size) => ({ key: nextKey(), id: size.id, name: { en: size.name.en ?? '', ar: size.name.ar ?? '' }, price: size.price, available: size.available }));
}

/** Checks the sizes and turns them into the API body, or returns the first problem as a message key. */
export function sizesToBody(sizes: DraftSize[]) {
  const rows = sizes.map((size) => ({ id: size.id, name: size.name, price: normalise(size.price), available: size.available }));
  if (rows.some((row) => !row.name.en.trim() || !row.name.ar.trim())) return { error: 'sizeNameMissing' as const };
  if (rows.some((row) => row.price === null || !Number(row.price))) return { error: 'sizePriceInvalid' as const };
  if (rows.length && !rows.some((row) => row.available)) return { error: 'sizeNoneAvailable' as const };
  return { body: rows as { id?: string; name: Text; price: string; available: boolean }[] };
}

/** The cheapest size still on sale: what the menu shows as the product's price. */
export function sizesFrom(sizes: DraftSize[]) {
  const prices = sizes.filter((size) => size.available).map((size) => Number(size.price)).filter((price) => price > 0);
  return prices.length ? Math.min(...prices).toFixed(3) : null;
}

const sizePresets: { key: 'presetSizes' | 'presetPortions'; names: { en: string; ar: string }[] }[] = [
  { key: 'presetSizes', names: [{ en: 'Small', ar: 'صغير' }, { en: 'Medium', ar: 'وسط' }, { en: 'Large', ar: 'كبير' }] },
  { key: 'presetPortions', names: [{ en: 'Quarter', ar: 'ربع' }, { en: 'Half', ar: 'نصف' }, { en: 'Full', ar: 'كامل' }] },
];

/** Sizes or portions of one product, each with its own full price. Diners must pick one. */
export function SizesEditor({ sizes, onChange, locale }: { sizes: DraftSize[]; onChange: (sizes: DraftSize[]) => void; locale: Locale }) {
  const t = useTranslations('merchantProducts');
  const set = (key: string, patch: Partial<DraftSize>) => onChange(sizes.map((size) => (size.key === key ? { ...size, ...patch } : size)));
  const add = () => onChange([...sizes, { key: nextKey(), name: emptyText(), price: '', available: true }]);
  return (
    <section className="min-w-0 rounded-xl border border-border-strong bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-semibold text-info">
          <Ruler className="size-3" />
          {t('sizesTitle')}
        </span>
        {sizes.length ? <span className="text-[11px] font-semibold text-muted-foreground">{t('optionRequired')} · {t('pickOne')}</span> : null}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t('sizesHint')}</p>
      {sizes.length ? (
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2">
          {sizes.map((size) => (
            <div key={size.key} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <input
                aria-label={t('sizeName')}
                value={size.name[locale]}
                placeholder={t('sizeNamePlaceholder')}
                onChange={(event) => set(size.key, { name: withText(size.name, locale, event.target.value) })}
                className="h-10 min-w-0 flex-1 basis-40 rounded-lg border border-border bg-muted px-3 text-sm font-medium text-foreground outline-none placeholder:text-subtle"
              />
              <span className="relative inline-flex w-28 shrink-0 items-center">
                <input
                  aria-label={t('sizePrice')}
                  inputMode="decimal"
                  value={size.price}
                  placeholder="0.000"
                  onChange={(event) => set(size.key, { price: event.target.value })}
                  className="h-10 w-full rounded-lg border border-border bg-muted px-2.5 text-sm font-medium tabular-nums text-foreground outline-none placeholder:text-subtle"
                />
              </span>
              <label className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <input type="checkbox" checked={size.available} onChange={(event) => set(size.key, { available: event.target.checked })} className="size-4 accent-[var(--color-primary)]" />
                {t('optionAvailable')}
              </label>
              <IconButton label={t('removeSize')} onClick={() => onChange(sizes.filter((row) => row.key !== size.key))}><X className="size-4" /></IconButton>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={add} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-foreground hover:bg-muted">
          <Plus className="size-4" /> {t('addSize')}
        </button>
        {!sizes.length
          ? sizePresets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => onChange(preset.names.map((name) => ({ key: nextKey(), name, price: '', available: true })))}
                className="inline-flex h-8 items-center rounded-full border border-border-strong px-3 text-xs font-semibold text-muted-foreground hover:bg-muted"
              >
                {t(preset.key)}
              </button>
            ))
          : null}
      </div>
    </section>
  );
}

/** A copy of a library group for this product: same group id, so it stays shared. */
function fromLibrary(group: EditableOptionGroup): DraftGroup {
  return { ...toDraftGroups([group])[0]!, sharedWith: group.sharedWith };
}

/** Checks the drafts and turns them into the API body, or returns the first problem as a message key. */
export function draftsToBody(kind: ProductKind, groups: DraftGroup[], products: ComboItem[]) {
  const names = new Map(products.map((product) => [product.id, product.name]));
  if (kind === 'COMBO' && !groups.length) return { error: 'comboEmpty' as const };
  const body = {
    kind,
    groups: groups.map((group) => ({
      id: group.id,
      name: group.fixed ? fixedName(group, names) ?? group.name : group.name,
      minSelect: group.fixed ? group.options.length : group.minSelect,
      maxSelect: group.fixed ? group.options.length : Math.max(group.maxSelect, group.minSelect, 1),
      options: group.options.map((option) => {
        const product = option.productId ? names.get(option.productId) : undefined;
        const name = kind === 'COMBO' && product ? { en: product.en || product.ar || '', ar: product.ar || product.en || '' } : option.name;
        return { id: option.id, name, price: normalise(option.price), available: option.available, productId: kind === 'COMBO' ? option.productId : null };
      }),
    })),
  };
  for (const group of body.groups) {
    if (!group.name.en.trim() || !group.name.ar.trim()) return { error: 'groupNameMissing' as const };
    if (!group.options.length) return { error: 'optionsMissing' as const };
    if (kind === 'COMBO' && group.options.some((option) => !option.productId)) return { error: 'productMissing' as const };
    if (group.options.some((option) => !option.name.en.trim() || !option.name.ar.trim())) return { error: 'optionNameMissing' as const };
    if (group.options.some((option) => option.price === null)) return { error: 'optionPriceInvalid' as const };
    if (group.minSelect > group.options.length) return { error: 'minTooHigh' as const };
  }
  return { body: body as typeof body & { groups: { options: { price: string }[] }[] } };
}

/** A fixed combo item is named after its product, since diners never see it as a choice. */
function fixedName(group: DraftGroup, names: Map<string, { en?: string; ar?: string }>) {
  const product = group.options[0]?.productId ? names.get(group.options[0].productId) : undefined;
  return product ? { en: product.en || product.ar || '', ar: product.ar || product.en || '' } : undefined;
}

function normalise(value: string) {
  const trimmed = value.trim() || '0';
  if (!/^\d+(\.\d{1,3})?$/.test(trimmed)) return null;
  return Number(trimmed).toFixed(3);
}

export function OptionGroupsEditor({
  kind,
  groups,
  onChange,
  locale,
  library,
  products,
  basePrice,
}: {
  kind: ProductKind;
  groups: DraftGroup[];
  onChange: (groups: DraftGroup[]) => void;
  locale: Locale;
  library: EditableOptionGroup[];
  products: ComboItem[];
  basePrice: string;
}) {
  const t = useTranslations('merchantProducts');
  const combo = kind === 'COMBO';
  const update = (key: string, patch: Partial<DraftGroup>) => onChange(groups.map((group) => (group.key === key ? { ...group, ...patch } : group)));
  const move = (index: number, step: number) => {
    const next = [...groups];
    const [row] = next.splice(index, 1);
    next.splice(index + step, 0, row!);
    onChange(next);
  };
  const reusable = library.filter((group) => !groups.some((draft) => draft.id === group.id));

  const addGroup = (fixed: boolean) =>
    onChange([
      ...groups,
      {
        key: nextKey(),
        name: emptyText(),
        minSelect: fixed || combo ? 1 : 0,
        maxSelect: 1,
        sharedWith: 0,
        fixed,
        options: [{ key: nextKey(), name: emptyText(), price: '', available: true, productId: null }],
      },
    ]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <p className="text-sm text-muted-foreground">{combo ? t('comboIntro') : t('optionsIntro')}</p>
      {!groups.length ? (
        <div className="grid place-items-center gap-1 rounded-xl border border-dashed border-border-strong px-4 py-6 text-center">
          <Layers className="size-5 text-subtle" />
          <p className="text-sm font-semibold">{combo ? t('noComboItems') : t('noOptions')}</p>
        </div>
      ) : null}
      {groups.map((group, index) => (
        <GroupCard
          key={group.key}
          group={group}
          combo={combo}
          locale={locale}
          products={products}
          first={index === 0}
          last={index === groups.length - 1}
          onChange={(patch) => update(group.key, patch)}
          onRemove={() => onChange(groups.filter((row) => row.key !== group.key))}
          onMove={(step) => move(index, step)}
        />
      ))}
      <div className="flex flex-wrap gap-2">
        {combo ? (
          <>
            <AddButton onClick={() => addGroup(true)} icon={<Lock className="size-4" />}>{t('addFixedItem')}</AddButton>
            <AddButton onClick={() => addGroup(false)} icon={<Shuffle className="size-4" />}>{t('addChoiceSlot')}</AddButton>
          </>
        ) : (
          <>
            <AddButton onClick={() => addGroup(false)} icon={<Plus className="size-4" />}>{t('addGroup')}</AddButton>
            {reusable.length ? (
              <select
                aria-label={t('useExisting')}
                value=""
                onChange={(event) => {
                  const picked = reusable.find((group) => group.id === event.target.value);
                  if (picked) onChange([...groups, fromLibrary(picked)]);
                }}
                className="h-10 min-w-0 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground outline-none"
              >
                <option value="">{t('useExisting')}</option>
                {reusable.map((group) => (
                  <option key={group.id} value={group.id}>
                    {pickLocalized(group.name, locale)} · {group.options.length}
                  </option>
                ))}
              </select>
            ) : null}
          </>
        )}
      </div>
      {combo && groups.length ? <ComboSummary groups={groups} products={products} basePrice={basePrice} locale={locale} /> : null}
    </div>
  );
}

function GroupCard({
  group,
  combo,
  locale,
  products,
  first,
  last,
  onChange,
  onRemove,
  onMove,
}: {
  group: DraftGroup;
  combo: boolean;
  locale: Locale;
  products: ComboItem[];
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<DraftGroup>) => void;
  onRemove: () => void;
  onMove: (step: number) => void;
}) {
  const t = useTranslations('merchantProducts');
  const required = group.minSelect > 0;
  const multiple = group.maxSelect > 1;
  const count = group.options.length;
  const setOption = (key: string, patch: Partial<DraftOption>) => onChange({ options: group.options.map((option) => (option.key === key ? { ...option, ...patch } : option)) });
  const removeOption = (key: string) => {
    const options = group.options.filter((option) => option.key !== key);
    onChange({ options, minSelect: Math.min(group.minSelect, Math.max(options.length, required ? 1 : 0)), maxSelect: Math.max(1, Math.min(group.maxSelect, options.length || 1)) });
  };
  const addOption = () => onChange({ options: [...group.options, { key: nextKey(), name: emptyText(), price: '', available: true, productId: null }] });

  return (
    <section className="min-w-0 rounded-xl border border-border-strong bg-card p-3">
      <div className="flex items-start gap-2">
        <span className={`mt-1 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${group.fixed ? 'bg-surface-2 text-muted-foreground' : 'bg-primary-soft text-primary-soft-foreground'}`}>
          {group.fixed ? <Lock className="size-3" /> : combo ? <Shuffle className="size-3" /> : <Layers className="size-3" />}
          {group.fixed ? t('fixedItem') : combo ? t('choiceSlot') : t('optionGroup')}
        </span>
        <span className="flex-1" />
        <IconButton label={t('moveUp')} disabled={first} onClick={() => onMove(-1)}><ArrowUp className="size-4" /></IconButton>
        <IconButton label={t('moveDown')} disabled={last} onClick={() => onMove(1)}><ArrowDown className="size-4" /></IconButton>
        <IconButton label={t('removeGroup')} danger onClick={onRemove}><Trash2 className="size-4" /></IconButton>
      </div>

      {group.fixed ? null : <label className="mt-2 block text-xs font-semibold text-muted-foreground">
        {combo ? t('slotName') : t('groupName')}
        <input
          value={group.name[locale]}
          placeholder={combo ? t('slotNamePlaceholder') : t('groupNamePlaceholder')}
          onChange={(event) => onChange({ name: withText(group.name, locale, event.target.value) })}
          className="mt-1 h-10 w-full rounded-lg border border-border bg-muted px-3 text-sm font-medium text-foreground outline-none placeholder:text-subtle"
        />
      </label>}

      {group.sharedWith > 0 ? <p className="mt-2 rounded-lg bg-warning-soft px-2.5 py-1.5 text-xs font-medium text-warning">{t('sharedGroup', { count: group.sharedWith })}</p> : null}

      {!group.fixed ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Segmented
            value={required ? 'required' : 'optional'}
            onChange={(value) => onChange({ minSelect: value === 'required' ? Math.max(1, Math.min(group.minSelect || 1, count)) : 0 })}
            options={[{ value: 'required', label: t('optionRequired') }, { value: 'optional', label: t('optionOptional') }]}
          />
          <Segmented
            value={multiple ? 'many' : 'one'}
            onChange={(value) => onChange(value === 'many' ? { maxSelect: Math.max(2, Math.min(count, 2)) } : { maxSelect: 1, minSelect: Math.min(group.minSelect, 1) })}
            options={[{ value: 'one', label: t('pickOne') }, { value: 'many', label: t('pickSeveral') }]}
          />
          {multiple ? (
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              {required ? <Stepper label={t('minPicks')} value={group.minSelect} min={1} max={Math.min(group.maxSelect, count)} onChange={(minSelect) => onChange({ minSelect })} /> : null}
              <Stepper label={t('maxPicks')} value={group.maxSelect} min={Math.max(2, group.minSelect)} max={Math.max(count, 2)} onChange={(maxSelect) => onChange({ maxSelect })} />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2">
        {group.options.map((option) =>
          combo ? (
            <div key={option.key} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <select
                aria-label={t('chooseProduct')}
                value={option.productId ?? ''}
                onChange={(event) => setOption(option.key, { productId: event.target.value || null })}
                className="h-10 min-w-0 flex-1 basis-48 rounded-lg border border-border bg-muted px-2 text-sm font-medium text-foreground outline-none"
              >
                <option value="">{t('chooseProduct')}</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {pickLocalized(product.name, locale)} · {formatMoney(product.price, locale)}
                  </option>
                ))}
              </select>
              {!group.fixed ? <PriceInput label={t('extraPrice')} value={option.price} onChange={(price) => setOption(option.key, { price })} /> : null}
              {count > 1 ? <IconButton label={t('removeOption')} onClick={() => removeOption(option.key)}><X className="size-4" /></IconButton> : null}
            </div>
          ) : (
            <div key={option.key} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <input
                aria-label={t('optionName')}
                value={option.name[locale]}
                placeholder={t('optionNamePlaceholder')}
                onChange={(event) => setOption(option.key, { name: withText(option.name, locale, event.target.value) })}
                className="h-10 min-w-0 flex-1 basis-40 rounded-lg border border-border bg-muted px-3 text-sm font-medium text-foreground outline-none placeholder:text-subtle"
              />
              <PriceInput label={t('extraPrice')} value={option.price} onChange={(price) => setOption(option.key, { price })} />
              <label className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <input type="checkbox" checked={option.available} onChange={(event) => setOption(option.key, { available: event.target.checked })} className="size-4 accent-[var(--color-primary)]" />
                {t('optionAvailable')}
              </label>
              {count > 1 ? <IconButton label={t('removeOption')} onClick={() => removeOption(option.key)}><X className="size-4" /></IconButton> : null}
            </div>
          ),
        )}
        {!group.fixed ? (
          <button type="button" onClick={addOption} className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-foreground hover:bg-muted">
            <Plus className="size-4" /> {combo ? t('addChoice') : t('addOption')}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** What the diner pays at least, against buying the cheapest picks on their own. */
function ComboSummary({ groups, products, basePrice, locale }: { groups: DraftGroup[]; products: ComboItem[]; basePrice: string; locale: Locale }) {
  const t = useTranslations('merchantProducts');
  const priceOf = new Map(products.map((product) => [product.id, Number(product.price)]));
  let from = Number(basePrice) || 0;
  let separate = 0;
  for (const group of groups) {
    const picks = group.fixed ? group.options.length : group.minSelect;
    if (!picks) continue;
    const ranked = group.options
      .filter((option) => option.productId)
      .map((option) => ({ extra: Number(option.price) || 0, alone: priceOf.get(option.productId!) ?? 0 }))
      .sort((a, b) => a.extra - b.extra)
      .slice(0, picks);
    from += ranked.reduce((sum, row) => sum + row.extra, 0);
    separate += ranked.reduce((sum, row) => sum + row.alone, 0);
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2.5 text-sm">
      <strong>{t('comboFrom', { price: formatMoney(from.toFixed(3), locale) })}</strong>
      {separate > 0 ? <span className="text-muted-foreground">{t('comboSeparate', { price: formatMoney(separate.toFixed(3), locale) })}</span> : null}
    </div>
  );
}

function Segmented({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`h-8 rounded-md text-xs font-semibold ${value === option.value ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground">
      {label}
      <span className="inline-flex items-center rounded-lg border border-border bg-card">
        <button type="button" aria-label={`${label} −`} disabled={value <= min} onClick={() => onChange(value - 1)} className="h-8 w-8 text-base text-foreground disabled:opacity-30">−</button>
        <span className="w-6 text-center text-sm tabular-nums text-foreground">{value}</span>
        <button type="button" aria-label={`${label} +`} disabled={value >= max} onClick={() => onChange(value + 1)} className="h-8 w-8 text-base text-foreground disabled:opacity-30">+</button>
      </span>
    </span>
  );
}

function PriceInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <span className="relative inline-flex w-28 shrink-0 items-center">
      <span className="pointer-events-none absolute start-2.5 text-sm font-semibold text-subtle">+</span>
      <input
        aria-label={label}
        inputMode="decimal"
        value={value}
        placeholder="0.000"
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-border bg-muted ps-6 pe-2 text-sm font-medium tabular-nums text-foreground outline-none placeholder:text-subtle"
      />
    </span>
  );
}

function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid size-8 shrink-0 place-items-center rounded-lg disabled:opacity-30 ${danger ? 'text-destructive hover:bg-destructive-soft' : 'text-muted-foreground hover:bg-muted'}`}
    >
      {children}
    </button>
  );
}

function AddButton({ onClick, icon, children }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border-strong bg-card px-3 text-sm font-semibold text-foreground hover:bg-muted">
      {icon}
      {children}
    </button>
  );
}
