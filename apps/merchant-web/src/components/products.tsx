import { api } from '@/components/providers';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, EmptyState, ErrorState, Skeleton } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Box, CheckCircle2, ChevronDown, Coffee, Croissant, CupSoda, Download, Folder, ImageIcon, LayoutGrid, List, Package, Pencil, Plus, Search, Star, Tag, Trash2, Upload, UtensilsCrossed } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SquareCropper } from '@/components/image-cropper';
import { Link } from '@/i18n/navigation';
import { useSearchParams } from 'react-router';

type Status = 'active' | 'out' | 'draft';
type InventoryMethod = 'daily' | 'stock';
type CatalogTab = 'products' | 'categories';
type CatalogProduct = {
  id: string;
  name: { en?: string; ar?: string };
  description?: { en?: string; ar?: string };
  price: string;
  compareAtPrice: string | null;
  imageUrl: string | null;
  approvalStatus: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';
  available: boolean;
  stock: number;
  categoryId: string;
  category: { en?: string; ar?: string };
  catalogProductId?: string | null;
  reviewStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
};
type CatalogCategory = {
  id: string;
  name: { en?: string; ar?: string };
  sortOrder?: number;
  icon?: string | null;
  reviewStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
};
type CentralCategoryOption = {
  id: string;
  name: { en?: string; ar?: string };
  icon?: string | null;
  status: 'PENDING' | 'APPROVED';
};
type CentralProductOption = {
  id: string;
  name: { en?: string; ar?: string };
  description: { en?: string; ar?: string };
  imageUrl?: string | null;
  status: 'PENDING' | 'APPROVED';
};

const statusTone: Record<Status, string> = {
  active: 'bg-[#E7F8EE] text-[#16924A]',
  out: 'bg-[#FDECEA] text-[#D9342B]',
  draft: 'bg-[#F1F1EE] text-[#696965]',
};
const dotTone: Record<Status, string> = {
  active: 'bg-[#22A85A]',
  out: 'bg-[#E5484D]',
  draft: 'bg-[#8A8A86]',
};

export function ProductsPage() {
  const t = useTranslations('merchantProducts');
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const productsQuery = useQuery({ queryKey: ['merchant', 'products'], queryFn: () => api.products() });
  const categoriesQuery = useQuery({ queryKey: ['merchant', 'categories'], queryFn: () => api.categories() });
  const profileQuery = useQuery({ queryKey: ['merchant', 'business'], queryFn: () => api.profile() });
  const products = (productsQuery.data ?? []) as CatalogProduct[];
  const categories = ((categoriesQuery.data ?? []) as CatalogCategory[]).slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [status, setStatus] = useState<'all' | Status>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = useState<string[]>([]);
  const [quickId, setQuickId] = useState<string | null>(null);
  const [dailyQuantity, setDailyQuantity] = useState('40');
  const [editing, setEditing] = useState<CatalogProduct | 'new' | null>(null);
  const [tab, setTab] = useState<CatalogTab>('products');
  const [categoryView, setCategoryView] = useState<'grid' | 'list'>('grid');
  const [categoryQuery, setCategoryQuery] = useState('');
  const [offerOpen, setOfferOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [params] = useSearchParams();

  useEffect(() => {
    if (params.get('new') === '1') setEditing('new');
    if (params.get('offer') === '1') setOfferOpen(true);
  }, [params]);

  const counts = useMemo(() => ({
    total: products.length,
    active: products.filter((product) => statusOf(product) === 'active').length,
    out: products.filter((product) => statusOf(product) === 'out').length,
    draft: products.filter((product) => statusOf(product) === 'draft').length,
  }), [products]);

  const visible = products.filter((product) => {
    if (categoryId !== 'all' && product.categoryId !== categoryId) return false;
    if (status !== 'all' && statusOf(product) !== status) return false;
    const haystack = `${pickLocalized(product.name, locale)} ${pickLocalized(product.category, locale)}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  const quickProduct = products.find((product) => product.id === quickId) ?? products[0];
  const inventoryMode = readInventoryMethod(profileQuery.data);
  const needsMethod = profileQuery.isSuccess && inventoryMode === null;
  const method = inventoryMode ?? 'daily';

  const patch = useMutation({
    mutationFn: (input: { id: string; body: Record<string, unknown> }) => api.updateProduct(input.id, input.body),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: ['merchant', 'products'] });
      const previous = client.getQueryData<CatalogProduct[]>(['merchant', 'products']);
      client.setQueryData<CatalogProduct[]>(['merchant', 'products'], (current) =>
        (current ?? []).map((product) => product.id === input.id ? applyProductPatch(product, input.body) : product),
      );
      return { previous };
    },
    onSuccess: () => setNotice(''),
    onError: (error: Error, _input, context) => {
      if (context?.previous) client.setQueryData(['merchant', 'products'], context.previous);
      setNotice(error.message);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['merchant', 'products'] });
    },
  });

  if (productsQuery.isLoading) return <ProductsSkeleton />;
  if (productsQuery.error) return <ErrorState title="Could not load" body={(productsQuery.error as Error).message} />;

  function quick(product: CatalogProduct, action: 'out' | 'in' | 'draft' | 'publish' | 'feature') {
    if (action === 'out') patch.mutate({ id: product.id, body: { available: false, stockQuantity: 0 } });
    if (action === 'in') patch.mutate({ id: product.id, body: { available: true, approvalStatus: 'APPROVED', stockQuantity: product.stock > 0 ? product.stock : 10 } });
    if (action === 'draft') patch.mutate({ id: product.id, body: { approvalStatus: 'DRAFT', available: false } });
    if (action === 'publish') patch.mutate({ id: product.id, body: { approvalStatus: 'APPROVED', available: true } });
    if (action === 'feature') patch.mutate({ id: product.id, body: { compareAtPrice: product.compareAtPrice ? null : product.price } });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-[-0.03em] text-[#161616]">{t('titleInventory')}</h1>
        <p className="mt-0.5 text-sm text-[#6F6F6B]">{t('inventorySubtitle')}</p>
      </div>

      <div className="flex items-center gap-4 overflow-x-auto border-b border-[#DFDED9] pb-2">
        <div className="flex h-11 shrink-0 items-center gap-2 text-sm font-semibold">
          <TabButton active={tab === 'products'} onClick={() => setTab('products')}>{t('all')}</TabButton>
          <TabButton active={tab === 'categories'} onClick={() => setTab('categories')}>{t('categories')}</TabButton>
          <TabButton active={offerOpen} onClick={() => setOfferOpen(true)}>{t('modifiers')}</TabButton>
        </div>
        <div className="ms-auto grid h-11 shrink-0 grid-cols-4 overflow-hidden rounded-xl border border-[#E5E4DF] bg-white shadow-[0_1px_2px_rgba(18,18,18,.04)]">
          <Metric icon={<Box />} label={t('total')} value={counts.total} tone="bg-[#F6F6F4]" />
          <Metric icon={<CheckCircle2 className="text-[#1FA557]" />} label={t('availableToday')} value={counts.active} tone="bg-[#E7F8EE]" />
          <Metric icon={<AlertCircle className="text-[#F26A21]" />} label={t('lowStock')} value={products.filter((product) => product.stock > 0 && product.stock <= 5).length} tone="bg-[#FFF1E8]" />
          <Metric icon={<Folder />} label={t('categories')} value={categories.length} tone="bg-[#FFF7D6]" />
        </div>
      </div>

      {notice ? <p className="text-sm font-medium text-[#B42318]">{notice}</p> : null}

      {tab === 'categories' ? <CategoriesSection categories={categories} products={products} view={categoryView} query={categoryQuery} onQuery={setCategoryQuery} onView={setCategoryView} /> : null}

      {tab === 'products' ? <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#E2E1DC] bg-white">
            <div className="flex flex-col gap-2 border-b border-[#E8E7E3] p-2.5 lg:flex-row lg:items-center">
              <label className="relative flex h-9 min-w-52 flex-1 items-center">
                <Search className="pointer-events-none absolute start-3 size-4 text-[#8A8A86]" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchSku')} className="h-9 w-full rounded-lg border border-[#E4E3DE] bg-white ps-9 pe-3 text-xs outline-none" />
              </label>
              <Button type="button" variant="yellow" className="h-9 shrink-0 rounded-lg px-3" onClick={() => setEditing('new')}><Plus className="size-4" /> {t('add')}</Button>
              <button type="button" onClick={() => setImportOpen(true)} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[#E6E6E2] bg-white px-3 text-xs font-semibold text-[#161616]"><Upload className="size-4" /> {t('bulkUpload')}</button>
              <div className="flex gap-2 overflow-x-auto">
                <SelectFilter value={categoryId} onChange={setCategoryId} label={t('category')}>
                  <option value="all">{t('allCategories')}</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{pickLocalized(category.name, locale)}</option>)}
                </SelectFilter>
                <SelectFilter value={status} onChange={(value) => setStatus(value as 'all' | Status)} label={t('status')}>
                  <option value="all">{t('allStatus')}</option><option value="active">{t('active')}</option><option value="out">{t('out')}</option><option value="draft">{t('drafts')}</option>
                </SelectFilter>
                <div className="flex h-9 overflow-hidden rounded-lg border border-[#E4E3DE] bg-white">
                  <button type="button" aria-label={t('grid')} className={`grid w-9 place-items-center ${view === 'grid' ? 'bg-[#FFC400]' : ''}`} onClick={() => setView('grid')}><LayoutGrid className="size-4" /></button>
                  <button type="button" aria-label={t('list')} className={`grid w-9 place-items-center border-s border-[#E4E3DE] ${view === 'list' ? 'bg-[#FFC400]' : ''}`} onClick={() => setView('list')}><List className="size-4" /></button>
                </div>
              </div>
            </div>

            {selected.length ? (
              <div className="flex flex-wrap items-center gap-2 border-b border-[#E8E7E3] bg-[#FAFAF8] px-3 py-2 text-xs font-semibold">
                <span className="me-2">{selected.length} {t('selected')}</span>
                <BulkButton icon={<CheckCircle2 />} onClick={() => selected.forEach((id) => { const product = products.find((item) => item.id === id); if (product) quick(product, 'in'); })}>{t('setAvailable')}</BulkButton>
                <BulkButton icon={<AlertCircle />} onClick={() => selected.forEach((id) => { const product = products.find((item) => item.id === id); if (product) quick(product, 'out'); })}>{t('setUnavailable')}</BulkButton>
                <BulkButton icon={<Folder />} onClick={() => setTab('categories')}>{t('changeCategory')}</BulkButton>
                <BulkButton icon={<Trash2 />} danger onClick={() => setSelected([])}>{t('clearSelection')}</BulkButton>
              </div>
            ) : null}

            {products.length === 0 ? <EmptyState title={t('none')} body={t('noneBody')} /> : null}
            {products.length > 0 && visible.length === 0 ? <p className="p-4 text-sm font-medium text-[#8A8A86]">{t('noMatch')}</p> : null}
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="min-w-[780px]">
                <div className="grid grid-cols-[32px_minmax(210px,1.4fr)_110px_90px_72px_145px_82px_72px] items-center border-b border-[#E8E7E3] bg-[#FAFAF8] px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#777772]">
                  <input type="checkbox" checked={visible.length > 0 && visible.every((product) => selected.includes(product.id))} onChange={(event) => setSelected(event.target.checked ? visible.map((product) => product.id) : [])} />
                  <span>{t('product')}</span><span>{t('category')}</span><span>{t('price')}</span><span>{t('quantity')}</span><span>{t('availabilityStock')}</span><span>{t('status')}</span><span>{t('actions')}</span>
                </div>
                {visible.map((product) => (
                  <ProductRow key={product.id} product={product} locale={locale} checked={selected.includes(product.id)} inventoryMode={method} active={quickProduct?.id === product.id} onCheck={() => setSelected((current) => current.includes(product.id) ? current.filter((id) => id !== product.id) : [...current, product.id])} onSelect={() => setQuickId(product.id)} onEdit={() => setEditing(product)} onToggle={() => quick(product, statusOf(product) === 'active' ? 'out' : 'in')} labels={{ edit: t('edit'), daily: t('dailyAvailability'), stock: t('stockQuantity'), available: t('availableToday'), unavailable: t('unavailableToday'), active: t('active'), draft: t('draft') }} />
                ))}
              </div>
            </div>
          </section>
        </div>

        <aside className="rounded-xl border border-[#E2E1DC] bg-white p-3.5 shadow-[0_2px_8px_rgba(18,18,18,.03)]">
          <h2 className="text-base font-bold">{t('quickUpdate')}</h2>
          <p className="text-xs text-[#777772]">{t('quickUpdateHint')}</p>
          {quickProduct ? (
            <>
              <button type="button" onClick={() => setEditing(quickProduct)} className="mt-3 flex w-full items-center gap-3 rounded-lg text-start">
                <ProductPhoto src={quickProduct.imageUrl} alt={pickLocalized(quickProduct.name, locale)} className="size-16 shrink-0" />
                <span className="min-w-0"><strong className="block truncate text-sm">{pickLocalized(quickProduct.name, locale)}</strong><span className="block text-[11px] text-[#777772]">SKU: {quickProduct.id.slice(0, 8).toUpperCase()}</span><strong className="mt-1 block text-sm">{formatMoney(quickProduct.price, locale)}</strong></span>
              </button>
              <QuickSection title={t('productStatus')}>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-[#F5F5F2] p-1">
                  <QuickToggle active={statusOf(quickProduct) === 'active'} onClick={() => quick(quickProduct, 'in')} label={t('active')} />
                  <QuickToggle active={statusOf(quickProduct) !== 'active'} onClick={() => quick(quickProduct, 'draft')} label={t('hidden')} />
                </div>
              </QuickSection>
              <QuickSection title={t('inventoryMethod')}>
                {inventoryMode ? <p className="text-xs font-semibold text-[#161616]">{inventoryMode === 'daily' ? t('dailyAvailability') : t('stockQuantity')}</p> : <p className="text-xs text-[#777772]">{t('chooseMethodFirst')}</p>}
                <Link href="/settings" className="mt-1 inline-block text-xs font-semibold text-[#2871AE]">{t('inventorySettings')} →</Link>
              </QuickSection>
              {method === 'daily' ? (
                <QuickSection title={t('dailySettings')}>
                  <label className="flex items-center justify-between text-xs"><span>{t('availableToday')}</span><input type="checkbox" checked={quickProduct.available} onChange={() => quick(quickProduct, quickProduct.available ? 'out' : 'in')} /></label>
                  <label className="mt-3 block text-xs font-semibold">{t('todayQuantity')}<input type="number" value={dailyQuantity} onChange={(event) => setDailyQuantity(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#DEDDD8] px-3 outline-none" /></label>
                </QuickSection>
              ) : (
                <QuickSection title={t('stockQuantity')}>
                  <label className="block text-xs font-semibold">{t('stock')}<input type="number" value={quickProduct.stock} onChange={(event) => patch.mutate({ id: quickProduct.id, body: { stockQuantity: Math.max(0, Number(event.target.value) || 0) } })} className="mt-1 h-9 w-full rounded-lg border border-[#DEDDD8] px-3 outline-none" /></label>
                </QuickSection>
              )}
              <Button type="button" variant="yellow" className="mt-4 h-10 w-full rounded-lg" disabled={!inventoryMode} onClick={() => patch.mutate({ id: quickProduct.id, body: method === 'daily' ? { stockQuantity: Math.max(0, Number(dailyQuantity) || 0), available: true } : { stockQuantity: quickProduct.stock } })}>{t('saveUpdate')}</Button>
              <button type="button" onClick={() => setEditing(quickProduct)} className="mt-2 h-10 w-full rounded-lg border border-[#292927] text-xs font-semibold">{t('openEditor')} →</button>
            </>
          ) : <p className="mt-4 text-sm text-[#777772]">{t('none')}</p>}
        </aside>
      </div> : null}

      <ProductDialog
        open={editing !== null}
        product={editing === 'new' ? null : editing}
        categories={categories}
        onClose={() => setEditing(null)}
        onNeedCategory={() => { setEditing(null); setTab('categories'); }}
      />
      <InventoryMethodDialog open={needsMethod} />
      <OfferDialog open={offerOpen} products={products} onClose={() => setOfferOpen(false)} />
      <BulkUploadDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

function ProductRow({ product, locale, checked, inventoryMode, active, onCheck, onSelect, onEdit, onToggle, labels }: {
  product: CatalogProduct;
  locale: 'en' | 'ar';
  checked: boolean;
  inventoryMode: 'daily' | 'stock';
  active: boolean;
  onCheck: () => void;
  onSelect: () => void;
  onEdit: () => void;
  onToggle: () => void;
  labels: { edit: string; daily: string; stock: string; available: string; unavailable: string; active: string; draft: string };
}) {
  const state = statusOf(product);
  return (
    <div onClick={onSelect} className={`grid cursor-pointer grid-cols-[32px_minmax(210px,1.4fr)_110px_90px_72px_145px_82px_72px] items-center border-b border-[#EEEDE9] px-3 py-2 text-xs transition-colors last:border-b-0 ${active ? 'bg-[#FFFDF4]' : 'hover:bg-[#FAFAF8]'}`}>
      <input type="checkbox" checked={checked} onClick={(event) => event.stopPropagation()} onChange={onCheck} />
      <div className="flex min-w-0 items-center gap-2.5">
        <ProductPhoto src={product.imageUrl} alt={pickLocalized(product.name, locale)} className="size-10 shrink-0" />
        <span className="min-w-0"><strong className="block truncate text-xs text-[#1B1B19]">{pickLocalized(product.name, locale)}</strong><span className="block truncate text-[10px] text-[#858580]">SKU: {product.id.slice(0, 8).toUpperCase()}</span></span>
      </div>
      <span className="truncate text-[#555550]">{pickLocalized(product.category, locale)}</span>
      <strong>{formatMoney(product.price, locale)}</strong>
      <strong>{product.stock}</strong>
      <button type="button" onClick={(event) => { event.stopPropagation(); onToggle(); }} className="flex items-center gap-2 text-start">
        <span className={`relative h-5 w-9 shrink-0 rounded-full ${state === 'active' ? 'bg-[#25B55B]' : 'bg-[#AAA]'}`}><span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${state === 'active' ? 'end-0.5' : 'start-0.5'}`} /></span>
        <span><strong className="block text-[11px]">{state === 'active' ? labels.available : labels.unavailable}</strong><span className="text-[9px] text-[#858580]">{inventoryMode === 'stock' ? `${product.stock} ${labels.stock}` : labels.daily}</span></span>
      </button>
      <span className="inline-flex w-fit items-center gap-1.5 font-semibold"><span className={`size-1.5 rounded-full ${state === 'active' ? 'bg-[#22A85A]' : state === 'out' ? 'bg-[#E5484D]' : 'bg-[#F5B400]'}`} />{state === 'active' ? labels.active : labels.draft}</span>
      <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(); }} className="h-7 w-fit rounded-md border border-[#DDDCD7] px-2 font-semibold">{labels.edit}</button>
    </div>
  );
}

function Metric({ icon, label, value, tone }: { icon: React.ReactElement<{ className?: string }>; label: string; value: number; tone: string }) {
  return (
    <div className="flex h-full min-w-40 items-center gap-2.5 border-e border-[#E8E7E3] px-3 last:border-e-0">
      <span className={`grid size-7 shrink-0 place-items-center rounded-lg text-[#161616] [&>svg]:size-4 ${tone}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-medium leading-none text-[#777772]">{label}</span>
        <span className="mt-1 block text-sm font-bold leading-none tabular-nums text-[#161616]">{value}</span>
      </span>
    </div>
  );
}

function InventoryChoice({ active, icon, title, body, onClick, compact = false }: { active: boolean; icon: React.ReactNode; title: string; body: string; onClick: () => void; compact?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`flex items-start gap-3 rounded-lg border p-3 text-start ${active ? 'border-[#F2C300] bg-[#FFFCEF] shadow-[0_0_0_1px_#F2C300]' : 'border-[#E3E2DD] bg-white'} ${compact ? 'p-2.5' : ''}`}>
      <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${active ? 'border-[#FFC400] bg-[#FFC400]' : 'border-[#B9B8B3]'}`}>{active ? <span className="size-1.5 rounded-full bg-[#171715]" /> : null}</span>
      <span className="text-[#161616] [&>svg]:size-5">{icon}</span>
      <span><strong className="block text-xs">{title}</strong><span className="block text-[10px] leading-snug text-[#777772]">{body}</span></span>
    </button>
  );
}

function SelectFilter({ value, onChange, label, children }: { value: string; onChange: (value: string) => void; label: string; children: React.ReactNode }) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 min-w-28 appearance-none rounded-lg border border-[#E4E3DE] bg-white ps-3 pe-8 text-xs font-semibold outline-none">{children}</select>
      <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#777772]" />
    </label>
  );
}

function BulkButton({ icon, onClick, children, danger = false }: { icon: React.ReactNode; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return <button type="button" onClick={onClick} className={`inline-flex h-7 items-center gap-1.5 rounded-md border bg-white px-2 ${danger ? 'border-[#F0D7D4] text-[#B42318]' : 'border-[#DDDCD7]'}`}><span className="[&>svg]:size-3">{icon}</span>{children}</button>;
}

function QuickSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-4 border-t border-[#E8E7E3] pt-3"><h3 className="mb-2 text-xs font-bold">{title}</h3>{children}</section>;
}

function QuickToggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button type="button" onClick={onClick} className={`h-7 rounded-md text-[11px] font-semibold ${active ? 'bg-[#DDF5E5] text-[#157A3E] shadow-sm' : 'text-[#777772]'}`}>{label}</button>;
}

function ProductDialog({
  open, product, categories, onClose, onNeedCategory,
}: {
  open: boolean;
  product: CatalogProduct | null;
  categories: CatalogCategory[];
  onClose: () => void;
  onNeedCategory: () => void;
}) {
  const t = useTranslations('merchantProducts');
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('10');
  const [imageUrl, setImageUrl] = useState('');
  const [status, setStatus] = useState<Status>('active');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const fallbackCategory = categories[0]?.id ?? '';
  const optionsQuery = useQuery({
    queryKey: ['merchant', 'product-options', name.trim()],
    queryFn: () => api.productOptions(name.trim()),
    enabled: open && !product && name.trim().length > 0,
    staleTime: 30_000,
  });
  const productOptions = (optionsQuery.data ?? []) as CentralProductOption[];
  useEffect(() => {
    if (!open) return;
    setName(product ? pickLocalized(product.name, locale) : '');
    setDescription(product ? pickLocalized(product.description, locale) : '');
    setCategoryId(product?.categoryId ?? fallbackCategory);
    setPrice(product ? Number(product.price).toFixed(3) : '');
    setStock(String(product?.stock ?? 10));
    setImageUrl(product?.imageUrl ?? '');
    setStatus(product ? statusOf(product) : 'active');
    setError('');
  }, [open, product, locale, fallbackCategory]);
  const save = useMutation({
    mutationFn: async () => {
      const label = name.trim();
      const priced = money(price);
      if (!label || !priced || !categoryId) throw new Error(t('required'));
      const nextStock = status === 'out' ? 0 : Math.max(0, Number(stock) || 0);
      if (status === 'active' && nextStock < 1) throw new Error(t('stockRequired'));
      const copy = description.trim() || label;
      const localizedName = { en: product?.name.en || label, ar: product?.name.ar || label, [locale]: label };
      const localizedDescription = { en: product?.description?.en || copy, ar: product?.description?.ar || copy, [locale]: copy };
      const body = {
        categoryId,
        name: localizedName,
        description: localizedDescription,
        price: priced,
        imageUrl: imageUrl || null,
        available: status === 'active',
        approvalStatus: status === 'draft' ? 'DRAFT' : 'APPROVED',
        stockQuantity: nextStock,
      };
      if (product) await api.updateProduct(product.id, body);
      else await api.createProduct(body);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['merchant', 'products'] });
      onClose();
    },
    onError: (reason: Error) => setError(reason.message),
  });
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[min(100%-2rem,44rem)] w-[min(100%-2rem,32rem)] overflow-y-auto">
        <DialogTitle>{product ? t('editProduct') : t('add')}</DialogTitle>
        <DialogDescription>{t('subtitle')}</DialogDescription>
        <div className="mt-4 grid gap-3">
          <div>
            <p className="text-sm font-semibold text-[#161616]">{t('photo')}</p>
            <label className="relative mx-auto mt-1.5 block size-56 cursor-pointer overflow-hidden rounded-xl border border-dashed border-[#E0E0DC] bg-[#F7F7F5]">
              {imageUrl ? <img src={imageUrl} alt="" className="absolute inset-0 size-full object-cover" /> : <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-[#8A8A86]"><ImageIcon className="size-5" /> {uploading ? '…' : t('upload')}</span>}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                if (cropSource) URL.revokeObjectURL(cropSource);
                setCropSource(URL.createObjectURL(file));
              }} />
            </label>
            <SquareCropper
              source={cropSource}
              title={t('cropPhoto')}
              hint={t('cropHint')}
              zoomLabel={t('zoom')}
              useLabel={t('usePhoto')}
              cancelLabel={t('cancel')}
              onCancel={() => { if (cropSource) URL.revokeObjectURL(cropSource); setCropSource(null); }}
              onUse={(file) => {
                if (cropSource) URL.revokeObjectURL(cropSource);
                setCropSource(null);
                setUploading(true);
                void api.upload(file).then((saved) => setImageUrl(saved.url)).catch((reason: Error) => setError(reason.message)).finally(() => setUploading(false));
              }}
            />
          </div>
          <label className="relative block text-sm font-semibold text-[#161616]">
            {t('name')}
            <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm font-medium outline-none" />
            {!product && name.trim() && productOptions.length ? (
              <span className="absolute inset-x-0 top-[4.5rem] z-30 block rounded-xl border border-[#E4E3DE] bg-white p-1.5 shadow-lg">
                <small className="block px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#777772]">{t('productSuggestions')}</small>
                {productOptions.map((option) => (
                  <button key={option.id} type="button" onClick={() => {
                    setName(pickLocalized(option.name, locale));
                    setDescription(pickLocalized(option.description, locale));
                    setImageUrl(option.imageUrl ?? '');
                  }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start hover:bg-[#F7F7F5]">
                    <ProductPhoto src={option.imageUrl ?? null} alt="" className="size-8 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold">{pickLocalized(option.name, locale)}</span>
                    {option.status === 'PENDING' ? <small className="text-[9px] text-[#9A6700]">{t('productPending')}</small> : null}
                  </button>
                ))}
              </span>
            ) : null}
          </label>
          <Field label={t('description')} value={description} onChange={setDescription} />
          <label className="block text-sm font-semibold text-[#161616]">
            {t('category')}
            <select className="mt-1.5 h-11 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm font-medium outline-none" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              {categories.map((category) => <option key={category.id} value={category.id}>{pickLocalized(category.name, locale)}</option>)}
            </select>
          </label>
          {!categories.length ? <button type="button" className="text-start text-sm font-semibold text-[#161616] underline" onClick={onNeedCategory}>{t('addCategory')}</button> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('price')} value={price} onChange={setPrice} />
            <Field label={t('stock')} value={stock} onChange={setStock} type="number" />
          </div>
          <label className="block text-sm font-semibold text-[#161616]">
            {t('status')}
            <select className="mt-1.5 h-11 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm font-medium outline-none" value={status} onChange={(event) => setStatus(event.target.value as Status)}>
              <option value="active">{t('active')}</option>
              <option value="out">{t('out')}</option>
              <option value="draft">{t('draft')}</option>
            </select>
          </label>
        </div>
        {error ? <p className="mt-3 text-sm font-medium text-[#B42318]">{error}</p> : null}
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" loading={save.isPending || uploading} onClick={() => { setError(''); save.mutate(); }}>{t('save')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`shrink-0 rounded-lg px-3 py-1.5 ${active ? 'bg-[#FFC400] text-[#161616]' : 'text-[#666662]'}`}>{children}</button>;
}

function readInventoryMethod(data: unknown): InventoryMethod | null {
  const value = (data as { inventoryMethod?: string } | undefined)?.inventoryMethod;
  if (value === 'DAILY') return 'daily';
  if (value === 'STOCK') return 'stock';
  return null;
}

function InventoryMethodDialog({ open }: { open: boolean }) {
  const t = useTranslations('merchantProducts');
  const client = useQueryClient();
  const [choice, setChoice] = useState<InventoryMethod | null>(null);
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: (method: InventoryMethod) => api.updateProfile({ inventoryMethod: method === 'daily' ? 'DAILY' : 'STOCK' }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['merchant', 'business'] }); },
    onError: (reason: Error) => setError(reason.message),
  });
  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent hideClose className="w-[min(100%-2rem,36rem)]">
        <DialogTitle>{t('chooseInventoryTitle')}</DialogTitle>
        <DialogDescription>{t('chooseInventoryHint')}</DialogDescription>
        <div className="mt-4 grid gap-2">
          <InventoryChoice active={choice === 'daily'} icon={<UtensilsCrossed />} title={t('dailyAvailability')} body={t('dailyAvailabilityHint')} onClick={() => setChoice('daily')} />
          <InventoryChoice active={choice === 'stock'} icon={<Package />} title={t('stockQuantity')} body={t('stockQuantityHint')} onClick={() => setChoice('stock')} />
        </div>
        {error ? <p className="mt-3 text-sm font-medium text-[#B42318]">{error}</p> : null}
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" disabled={!choice} loading={save.isPending} onClick={() => { if (!choice) return; setError(''); save.mutate(choice); }}>{t('useMethod')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function InventorySettings({ method }: { method: InventoryMethod | null }) {
  const t = useTranslations('merchantProducts');
  const client = useQueryClient();
  const [choice, setChoice] = useState<InventoryMethod>(method ?? 'daily');
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { if (method) setChoice(method); }, [method]);
  const save = useMutation({
    mutationFn: (next: InventoryMethod) => api.updateProfile({ inventoryMethod: next === 'daily' ? 'DAILY' : 'STOCK' }),
    onSuccess: () => {
      setSaved(t('methodSaved'));
      setError('');
      void client.invalidateQueries({ queryKey: ['merchant', 'business'] });
    },
    onError: (reason: Error) => { setSaved(''); setError(reason.message); },
  });
  return (
    <section className="@container rounded-xl border border-[#E2E1DC] bg-white p-4">
      <h2 className="font-bold text-[#161616]">{t('twoWays')}</h2>
      <p className="mt-1 text-sm text-[#777772]">{t('inventorySettingsHint')}</p>
      <div className="mt-4 grid gap-2 @min-[32rem]:grid-cols-2">
        <InventoryChoice active={choice === 'daily'} icon={<UtensilsCrossed />} title={t('dailyAvailability')} body={t('dailyAvailabilityHint')} onClick={() => { setChoice('daily'); setSaved(''); }} />
        <InventoryChoice active={choice === 'stock'} icon={<Package />} title={t('stockQuantity')} body={t('stockQuantityHint')} onClick={() => { setChoice('stock'); setSaved(''); }} />
      </div>
      {error ? <p className="mt-3 text-sm font-medium text-[#B42318]">{error}</p> : null}
      {saved ? <p className="mt-3 text-sm font-semibold text-[#157A3E]">{saved}</p> : null}
      <Button type="button" variant="yellow" className="mt-4 h-10 rounded-lg px-4" loading={save.isPending} onClick={() => save.mutate(choice)}>{t('saveUpdate')}</Button>
    </section>
  );
}

function CategoriesSection({ categories, products, view, query, onQuery, onView }: {
  categories: CatalogCategory[];
  products: CatalogProduct[];
  view: 'grid' | 'list';
  query: string;
  onQuery: (value: string) => void;
  onView: (view: 'grid' | 'list') => void;
}) {
  const t = useTranslations('merchantProducts');
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const optionsQuery = useQuery({
    queryKey: ['merchant', 'category-options', name.trim()],
    queryFn: () => api.categoryOptions(name.trim()),
    enabled: name.trim().length > 0,
    staleTime: 30_000,
  });
  const options = (optionsQuery.data ?? []) as CentralCategoryOption[];
  const visible = categories.filter((category) => pickLocalized(category.name, locale).toLowerCase().includes(query.trim().toLowerCase()));
  const countOf = (id: string) => products.filter((product) => product.categoryId === id).length;
  const create = useMutation({
    mutationFn: async () => {
      const label = name.trim();
      if (!label) throw new Error(t('categoryRequired'));
      await api.createCategory({ name: { en: label, ar: label }, sortOrder: categories.length });
    },
    onSuccess: () => {
      setName('');
      setError('');
      setSaved(t('categorySaved'));
      void client.invalidateQueries({ queryKey: ['merchant', 'categories'] });
    },
    onError: (reason: Error) => { setSaved(''); setError(reason.message); },
  });
  const rename = useMutation({
    mutationFn: async (category: CatalogCategory) => {
      const label = draft.trim();
      if (!label) throw new Error(t('categoryRequired'));
      const next = { en: category.name.en || label, ar: category.name.ar || label, [locale]: label };
      await api.updateCategory(category.id, { name: next });
    },
    onSuccess: () => {
      setEditingId(null);
      setError('');
      setSaved(t('categorySaved'));
      void client.invalidateQueries({ queryKey: ['merchant', 'categories'] });
      void client.invalidateQueries({ queryKey: ['merchant', 'products'] });
    },
    onError: (reason: Error) => { setSaved(''); setError(reason.message); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteCategory(id),
    onSuccess: () => {
      setError('');
      void client.invalidateQueries({ queryKey: ['merchant', 'categories'] });
    },
    onError: (reason: Error) => setError(reason.message),
  });
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#E2E1DC] bg-white">
      <div className="flex flex-col gap-2 border-b border-[#E8E7E3] p-3 lg:flex-row lg:items-center">
        <label className="relative flex h-9 min-w-52 flex-1 items-center">
          <Search className="pointer-events-none absolute start-3 size-4 text-[#8A8A86]" />
          <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={t('categorySearch')} className="h-9 w-full rounded-lg border border-[#E4E3DE] bg-white ps-9 pe-3 text-xs outline-none" />
        </label>
        <div className="flex gap-2">
          <div className="relative">
            <input value={name} onChange={(event) => { setName(event.target.value); setSaved(''); }} placeholder={t('newCategory')} className="h-9 w-52 rounded-lg border border-[#E4E3DE] px-3 text-xs outline-none" />
            {name.trim() && options.length ? (
              <div className="absolute end-0 top-10 z-20 w-64 rounded-xl border border-[#E4E3DE] bg-white p-1.5 shadow-lg">
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#777772]">{t('categorySuggestions')}</p>
                {options.map((option) => (
                  <button key={option.id} type="button" onClick={() => setName(pickLocalized(option.name, locale))} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start text-xs hover:bg-[#F7F7F5]">
                    <span className="grid size-7 place-items-center overflow-hidden rounded-lg bg-[#FFF7D6]"><CategoryIcon icon={option.icon} name={pickLocalized(option.name, locale)} /></span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{pickLocalized(option.name, locale)}</span>
                    {option.status === 'PENDING' ? <span className="text-[9px] text-[#9A6700]">{t('categoryPending')}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <Button type="button" variant="yellow" className="h-9 rounded-lg px-3" loading={create.isPending} onClick={() => { setError(''); setSaved(''); create.mutate(); }}><Plus className="size-4" /> {t('addCategory')}</Button>
          <div className="flex h-9 overflow-hidden rounded-lg border border-[#E4E3DE] bg-white">
            <button type="button" aria-label={t('grid')} className={`grid w-9 place-items-center ${view === 'grid' ? 'bg-[#FFC400]' : ''}`} onClick={() => onView('grid')}><LayoutGrid className="size-4" /></button>
            <button type="button" aria-label={t('list')} className={`grid w-9 place-items-center border-s border-[#E4E3DE] ${view === 'list' ? 'bg-[#FFC400]' : ''}`} onClick={() => onView('list')}><List className="size-4" /></button>
          </div>
        </div>
      </div>
      {error ? <p className="px-3 pt-3 text-sm font-medium text-[#B42318]">{error}</p> : null}
      {saved ? <p className="px-3 pt-3 text-sm font-medium text-[#157A3E]">{saved}</p> : null}
      {categories.length === 0 ? <EmptyState title={t('categoryEmpty')} body={t('categoryEmptyBody')} /> : null}
      {categories.length > 0 && visible.length === 0 ? <p className="p-4 text-sm font-medium text-[#8A8A86]">{t('noMatch')}</p> : null}
      {view === 'grid' ? (
        <div className="grid gap-3 overflow-auto p-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((category) => (
            <CategoryCard key={category.id} category={category} locale={locale} editing={editingId === category.id} draft={draft} onDraft={setDraft} onEdit={() => { setEditingId(category.id); setDraft(pickLocalized(category.name, locale)); }} onCancel={() => setEditingId(null)} onSave={() => rename.mutate(category)} onDelete={() => remove.mutate(category.id)} saving={rename.isPending} removing={remove.isPending} labels={{ products: t('categoryCount', { count: countOf(category.id) }), rename: t('rename'), remove: t('deleteCategory'), save: t('saveUpdate'), cancel: t('cancel'), pending: t('categoryPending') }} />
          ))}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="grid grid-cols-[minmax(180px,1fr)_120px_160px] items-center border-b border-[#E8E7E3] bg-[#FAFAF8] px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#777772]">
            <span>{t('category')}</span><span>{t('product')}</span><span>{t('actions')}</span>
          </div>
          {visible.map((category) => (
            <div key={category.id} className="grid grid-cols-[minmax(180px,1fr)_120px_160px] items-center border-b border-[#EEEDE9] px-3 py-2 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-[#FFF7D6] text-[#161616]"><CategoryIcon icon={category.icon} name={pickLocalized(category.name, locale)} /></span>
                {editingId === category.id ? <input value={draft} onChange={(event) => setDraft(event.target.value)} className="h-8 min-w-0 flex-1 rounded-lg border border-[#DEDDD8] px-2 text-sm outline-none" /> : <span className="truncate font-semibold">{pickLocalized(category.name, locale)}</span>}
              </div>
              <span className="text-xs text-[#777772]">{t('categoryCount', { count: countOf(category.id) })}</span>
              <CategoryActions editing={editingId === category.id} onEdit={() => { setEditingId(category.id); setDraft(pickLocalized(category.name, locale)); }} onCancel={() => setEditingId(null)} onSave={() => rename.mutate(category)} onDelete={() => remove.mutate(category.id)} saving={rename.isPending} removing={remove.isPending} labels={{ rename: t('rename'), remove: t('deleteCategory'), save: t('saveUpdate'), cancel: t('cancel') }} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CategoryCard({ category, locale, editing, draft, onDraft, onEdit, onCancel, onSave, onDelete, saving, removing, labels }: {
  category: CatalogCategory;
  locale: 'en' | 'ar';
  editing: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
  removing: boolean;
  labels: { products: string; rename: string; remove: string; save: string; cancel: string; pending: string };
}) {
  const label = pickLocalized(category.name, locale);
  return (
    <article className="flex flex-col rounded-xl border border-[#E6E5E0] bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="grid size-10 place-items-center overflow-hidden rounded-lg bg-[#FFF7D6] text-[#161616]"><CategoryIcon icon={category.icon} name={label} /></span>
        <span className="text-end text-[11px] font-semibold text-[#777772]">{labels.products}{category.reviewStatus === 'PENDING' ? <small className="block text-[#9A6700]">{labels.pending}</small> : null}</span>
      </div>
      {editing ? <input value={draft} onChange={(event) => onDraft(event.target.value)} className="mt-3 h-9 rounded-lg border border-[#DEDDD8] px-2 text-sm outline-none" /> : <h3 className="mt-3 truncate text-sm font-bold text-[#161616]">{label}</h3>}
      <div className="mt-3">
        <CategoryActions editing={editing} onEdit={onEdit} onCancel={onCancel} onSave={onSave} onDelete={onDelete} saving={saving} removing={removing} labels={labels} />
      </div>
    </article>
  );
}

function CategoryActions({ editing, onEdit, onCancel, onSave, onDelete, saving, removing, labels }: {
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
  removing: boolean;
  labels: { rename: string; remove: string; save: string; cancel: string };
}) {
  if (editing) {
    return (
      <div className="flex gap-1">
        <Button type="button" variant="yellow" className="h-8 rounded-lg px-2 text-xs" loading={saving} onClick={onSave}>{labels.save}</Button>
        <button type="button" onClick={onCancel} className="h-8 rounded-lg border border-[#DDDCD7] px-2 text-xs font-semibold">{labels.cancel}</button>
      </div>
    );
  }
  return (
    <div className="flex gap-1">
      <button type="button" onClick={onEdit} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#DDDCD7] px-2 text-xs font-semibold"><Pencil className="size-3.5" /> {labels.rename}</button>
      <button type="button" onClick={onDelete} disabled={removing} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#F0D7D4] px-2 text-xs font-semibold text-[#B42318]"><Trash2 className="size-3.5" /> {labels.remove}</button>
    </div>
  );
}

function OfferDialog({ open, products, onClose }: { open: boolean; products: CatalogProduct[]; onClose: () => void }) {
  const t = useTranslations('merchantProducts');
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const [title, setTitle] = useState('');
  const [productId, setProductId] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setTitle(''); setProductId(''); setError(''); } }, [open]);
  const save = useMutation({
    mutationFn: async () => {
      const label = title.trim();
      if (!label) throw new Error(t('offerRequired'));
      await api.createOffer({ title: { en: label, ar: label }, ...(productId ? { productId } : {}) });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['merchant', 'products'] });
      onClose();
    },
    onError: (reason: Error) => setError(reason.message),
  });
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="w-[min(100%-2rem,28rem)]">
        <DialogTitle>{t('createOffer')}</DialogTitle>
        <DialogDescription>{t('subtitle')}</DialogDescription>
        <div className="mt-4 grid gap-3">
          <Field label={t('offerTitle')} value={title} onChange={setTitle} />
          <label className="block text-sm font-semibold text-[#161616]">
            {t('featureProduct')}
            <select className="mt-1.5 h-11 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm font-medium outline-none" value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="">{t('noFeature')}</option>
              {products.map((product) => <option key={product.id} value={product.id}>{pickLocalized(product.name, locale)}</option>)}
            </select>
          </label>
        </div>
        {error ? <p className="mt-3 text-sm font-medium text-[#B42318]">{error}</p> : null}
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" loading={save.isPending} onClick={() => { setError(''); save.mutate(); }}>{t('saveOffer')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ImportIssue = 'name' | 'category' | 'price' | 'stock' | 'status' | 'activeStock';
type ImportDraft = {
  row: number;
  name: string;
  nameAr?: string;
  description?: string;
  descriptionAr?: string;
  category: string;
  price: string;
  stock?: number;
  status?: 'active' | 'out' | 'draft';
};
type ParsedCatalog = { rows: ImportDraft[]; errors: { row: number; code: ImportIssue }[]; fatal?: 'empty' | 'header' | 'limit' };

function BulkUploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('merchantProducts');
  const client = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedCatalog | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    setFileName('');
    setParsed(null);
    setError('');
    setResult(null);
    if (inputRef.current) inputRef.current.value = '';
  }, [open]);
  const issueText: Record<ImportIssue, string> = {
    name: t('missingName'),
    category: t('missingCategory'),
    price: t('missingPrice'),
    stock: t('badStock'),
    status: t('badStatus'),
    activeStock: t('stockRequired'),
  };
  const fatalText = parsed?.fatal === 'header' ? t('importHeader') : parsed?.fatal === 'limit' ? t('importTooMany') : parsed?.fatal === 'empty' ? t('importEmpty') : '';
  function readFile(file: File) {
    const csv = file.name.toLowerCase().endsWith('.csv') || file.type.includes('csv') || file.type === 'text/plain' || file.type === '';
    if (!csv) { setError(t('csvOnly')); return; }
    if (file.size > 1_000_000) { setError(t('fileTooLarge')); return; }
    void file.text().then((text) => {
      setFileName(file.name);
      setParsed(parseCatalogCsv(text));
      setError('');
      setResult(null);
    }).catch(() => setError(t('csvOnly')));
  }
  const save = useMutation({
    mutationFn: () => api.importProducts((parsed?.rows ?? []).map((row) => ({
      row: row.row,
      name: row.name,
      category: row.category,
      price: row.price,
      ...(row.nameAr ? { nameAr: row.nameAr } : {}),
      ...(row.description ? { description: row.description } : {}),
      ...(row.descriptionAr ? { descriptionAr: row.descriptionAr } : {}),
      ...(row.stock !== undefined ? { stock: row.stock } : {}),
      ...(row.status ? { status: row.status } : {}),
    }))),
    onSuccess: (saved) => {
      setResult(saved);
      void client.invalidateQueries({ queryKey: ['merchant', 'products'] });
      void client.invalidateQueries({ queryKey: ['merchant', 'categories'] });
    },
    onError: (reason: Error) => setError(reason.message),
  });
  const preview = parsed?.rows.slice(0, 6) ?? [];
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[min(100%-2rem,44rem)] w-[min(100%-2rem,40rem)] overflow-y-auto">
        <DialogTitle>{t('bulkUploadTitle')}</DialogTitle>
        <DialogDescription>{t('bulkUploadHint')}</DialogDescription>
        <p className="mt-3 text-xs leading-relaxed text-[#6F6F6B]">{t('bulkStatusHint')}</p>
        <p className="mt-1 text-xs leading-relaxed text-[#6F6F6B]">{t('bulkSample')}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => downloadText('products-template.csv', '\uFEFFname,name_ar,description,description_ar,category,price,stock,status\r\n')} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#E6E6E2] bg-white px-3 text-sm font-semibold"><Download className="size-4" /> {t('downloadTemplate')}</button>
          <button type="button" onClick={() => { void api.exportProducts().then((csv) => downloadText('products.csv', csv)).catch((reason: Error) => setError(reason.message)); }} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#E6E6E2] bg-white px-3 text-sm font-semibold"><Download className="size-4" /> {t('downloadCatalog')}</button>
        </div>
        <label onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) readFile(file); }} className="mt-4 grid cursor-pointer place-items-center rounded-xl border border-dashed border-[#E0E0DC] bg-[#F7F7F5] px-4 py-8 text-center">
          <Upload className="size-5 text-[#8A8A86]" />
          <span className="mt-2 text-sm font-semibold text-[#161616]">{fileName || t('chooseFile')}</span>
          <span className="mt-1 text-xs text-[#8A8A86]">{t('bulkColumns')}</span>
          <input ref={inputRef} type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) readFile(file); }} />
        </label>
        {fatalText ? <p className="mt-3 text-sm font-medium text-[#B42318]">{fatalText}</p> : null}
        {parsed && !parsed.fatal ? (
          <div className="mt-4">
            <p className="text-sm font-semibold text-[#161616]">{t('rowsReady', { count: parsed.rows.length })}</p>
            {parsed.errors.length ? <p className="mt-1 text-sm font-medium text-[#B42318]">{t('rowsInvalid', { count: parsed.errors.length })}</p> : null}
            {preview.length ? (
              <div className="mt-2 max-h-48 overflow-auto rounded-xl border border-[#E8E7E3]">
                <table className="w-full text-start text-xs">
                  <thead className="bg-[#FAFAF8] text-[10px] font-semibold uppercase tracking-wide text-[#777772]">
                    <tr><th className="px-3 py-2 font-semibold">{t('product')}</th><th className="px-3 py-2 font-semibold">{t('category')}</th><th className="px-3 py-2 font-semibold">{t('price')}</th><th className="px-3 py-2 font-semibold">{t('stock')}</th><th className="px-3 py-2 font-semibold">{t('status')}</th></tr>
                  </thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr key={row.row} className="border-t border-[#E8E7E3]">
                        <td className="px-3 py-2 font-semibold">{row.name}</td>
                        <td className="px-3 py-2">{row.category}</td>
                        <td className="px-3 py-2">{row.price}</td>
                        <td className="px-3 py-2">{row.stock ?? '—'}</td>
                        <td className="px-3 py-2">{row.status ?? t('active')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {parsed.errors.slice(0, 6).map((issue) => <p key={`${issue.row}-${issue.code}`} className="mt-1 text-xs font-medium text-[#B42318]">{t('rowLabel')} {issue.row}: {issueText[issue.code]}</p>)}
          </div>
        ) : null}
        {error ? <p className="mt-3 text-sm font-medium text-[#B42318]">{error}</p> : null}
        {result ? <p className="mt-3 text-sm font-semibold text-[#157A3E]">{t('importCreated', { count: result.created })} {t('importUpdated', { count: result.updated })}</p> : null}
        <div className="mt-4 flex justify-end">
          {result ? <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" onClick={onClose}>{t('importDone')}</Button> : <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" loading={save.isPending} disabled={!parsed?.rows.length} onClick={() => { setError(''); save.mutate(); }}>{t('importProducts')}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function parseCatalogCsv(text: string): ParsedCatalog {
  const table = splitCsv(text);
  if (!table.length) return { rows: [], errors: [], fatal: 'empty' };
  const header = table[0]?.map((cell) => cell.trim().toLowerCase().replace(/[\s-]+/g, '_')) ?? [];
  const columns = header.map((cell) => HEADER_ALIASES[cell] ?? '');
  if (!columns.includes('name') || !columns.includes('price')) return { rows: [], errors: [], fatal: 'header' };
  const body = table.slice(1).filter((line) => line.some((cell) => cell.trim()));
  if (!body.length) return { rows: [], errors: [], fatal: 'empty' };
  if (body.length > 500) return { rows: [], errors: [], fatal: 'limit' };
  const hasCategory = columns.includes('category');
  const rows: ImportDraft[] = [];
  const errors: { row: number; code: ImportIssue }[] = [];
  body.forEach((line, index) => {
    const rowNumber = index + 2;
    const value = (key: string) => {
      const at = columns.indexOf(key);
      return at === -1 ? '' : (line[at] ?? '').trim();
    };
    const name = value('name');
    const category = hasCategory ? value('category') : 'General';
    const price = normalizePrice(value('price'));
    const stockText = value('stock');
    const stock = stockText ? Number(stockText) : undefined;
    const status = readStatus(value('status'), stock);
    const issue = !name ? 'name' : !category ? 'category' : !price ? 'price' : stockText && (!Number.isInteger(stock) || (stock ?? 0) < 0) ? 'stock' : status === 'invalid' ? 'status' : status === 'active' && stock === 0 ? 'activeStock' : null;
    if (issue) { errors.push({ row: rowNumber, code: issue }); return; }
    const nameAr = value('nameAr');
    const description = value('description');
    const descriptionAr = value('descriptionAr');
    rows.push({
      row: rowNumber,
      name,
      category,
      price: price!,
      ...(nameAr ? { nameAr } : {}),
      ...(description ? { description } : {}),
      ...(descriptionAr ? { descriptionAr } : {}),
      ...(stock !== undefined ? { stock } : {}),
      ...(status && status !== 'invalid' ? { status } : {}),
    });
  });
  return { rows, errors };
}

const HEADER_ALIASES: Record<string, string> = {
  name: 'name',
  product: 'name',
  product_name: 'name',
  name_en: 'name',
  english_name: 'name',
  name_ar: 'nameAr',
  arabic_name: 'nameAr',
  name_arabic: 'nameAr',
  description: 'description',
  description_en: 'description',
  description_ar: 'descriptionAr',
  category: 'category',
  category_name: 'category',
  price: 'price',
  stock: 'stock',
  quantity: 'stock',
  qty: 'stock',
  status: 'status',
};

function readStatus(value: string, stock: number | undefined): 'active' | 'out' | 'draft' | 'invalid' | undefined {
  const text = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!text) return undefined;
  if (text === 'approved') return stock === 0 ? 'out' : 'active';
  if (['active', 'available', 'in', 'in_stock'].includes(text)) return 'active';
  if (['out', 'unavailable', 'sold_out', 'out_of_stock'].includes(text)) return 'out';
  if (['draft', 'hidden', 'pending', 'rejected'].includes(text)) return 'draft';
  return 'invalid';
}

function normalizePrice(raw: string) {
  const text = raw.trim().replace(/bhd/ig, '').trim();
  const normalized = /^\d+,\d{1,3}$/.test(text) ? text.replace(',', '.') : text.replace(/,/g, '');
  const cleaned = normalized.replace(/[^\d.]/g, '');
  if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount.toFixed(3);
}

function splitCsv(text: string) {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const headerLine = source.split('\n')[0] ?? '';
  const delimiter = countChar(headerLine, ';') > countChar(headerLine, ',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { cell += '"'; index += 1; }
        else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += char ?? '';
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((line) => line.some((value) => value.trim()));
}

function countChar(line: string, char: string) {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const current = line[index];
    if (current === '"') {
      if (quoted && line[index + 1] === '"') { index += 1; continue; }
      quoted = !quoted;
    } else if (!quoted && current === char) count += 1;
  }
  return count;
}

function ProductsSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-12 w-80 rounded-xl" />
        <div className="flex gap-2"><Skeleton className="h-11 w-40 rounded-xl" /><Skeleton className="h-11 w-32 rounded-xl" /><Skeleton className="h-11 w-32 rounded-xl" /></div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <Skeleton className="h-14 w-full rounded-2xl" />
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-56 rounded-2xl" />)}</div>
        </div>
        <div className="flex h-full min-h-80 flex-col gap-4"><Skeleton className="min-h-40 flex-1 rounded-2xl" /><Skeleton className="h-64 shrink-0 rounded-2xl" /></div>
      </div>
    </div>
  );
}

function Stat({ label, value, marker }: { label: string; value: number; marker: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-[#EEEEEC] px-3 py-2 odd:border-e even:border-b sm:border-b-0 sm:border-e sm:px-3.5 sm:last:border-e-0">
      <span className="grid size-6 shrink-0 place-items-center">{marker}</span>
      <div className="leading-tight">
        <p className="text-[11px] text-[#8A8A86]">{label}</p>
        <p className="text-sm font-semibold text-[#161616]">{value}</p>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`h-10 shrink-0 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold ${active ? 'bg-[#FFC400] text-[#161616]' : 'border border-[#E8E8E4] bg-white text-[#161616]'}`}>
      {children}
    </button>
  );
}

function StatusPill({ status, label }: { status: Status; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone[status]}`}>
      <span className={`size-1.5 rounded-full ${dotTone[status]}`} />
      {label}
    </span>
  );
}

function FeaturedBadge({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <span className={`absolute start-2 top-2 inline-flex items-center gap-1 rounded-full bg-[#FFC400] font-semibold text-[#161616] shadow-sm ${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]'}`}>
      <Star className="size-3 fill-current" />
      {compact ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}

function ProductPhoto({ src, alt, className }: { src: string | null; alt: string; className: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`relative block shrink-0 overflow-hidden rounded-xl bg-[#F3F3F0] text-[#C8C8C4] ${className}`}>
      {!src || failed ? <span className="grid size-full place-items-center"><ImageIcon className="size-5" /></span> : <img src={src} alt={alt} className="absolute inset-0 size-full object-cover" onError={() => setFailed(true)} />}
    </span>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="block w-full rounded-lg px-3 py-2 text-start text-sm font-medium text-[#161616] hover:bg-[#F7F7F5]">{children}</button>;
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block text-sm font-semibold text-[#161616]">
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm font-medium outline-none" />
    </label>
  );
}

function CategoryGlyph({ name }: { name: string }) {
  const value = name.toLowerCase();
  const className = 'size-4';
  if (value.includes('coffee')) return <Coffee className={className} />;
  if (value.includes('bakery') || value.includes('pastry')) return <Croissant className={className} />;
  if (value.includes('breakfast') || value.includes('kitchen')) return <UtensilsCrossed className={className} />;
  if (value.includes('drink')) return <CupSoda className={className} />;
  return <LayoutGrid className={className} />;
}

function CategoryIcon({ icon, name }: { icon?: string | null; name: string }) {
  if (icon && (/^https?:\/\//.test(icon) || icon.startsWith('/'))) {
    return <img src={icon} alt="" className="size-full object-cover" />;
  }
  if (icon) return <span className="text-base">{icon}</span>;
  return <CategoryGlyph name={name} />;
}

function applyProductPatch(product: CatalogProduct, body: Record<string, unknown>): CatalogProduct {
  return {
    ...product,
    ...(typeof body.available === 'boolean' ? { available: body.available } : {}),
    ...(typeof body.approvalStatus === 'string' ? { approvalStatus: body.approvalStatus as CatalogProduct['approvalStatus'] } : {}),
    ...(typeof body.stockQuantity === 'number' ? { stock: body.stockQuantity } : {}),
    ...('compareAtPrice' in body ? { compareAtPrice: (body.compareAtPrice as string | null) ?? null } : {}),
    ...(typeof body.categoryId === 'string' ? { categoryId: body.categoryId } : {}),
    ...(typeof body.price === 'string' ? { price: body.price } : {}),
    ...('imageUrl' in body ? { imageUrl: (body.imageUrl as string | null) ?? null } : {}),
  };
}

function statusOf(product: CatalogProduct): Status {
  if (product.approvalStatus !== 'APPROVED') return 'draft';
  if (!product.available || product.stock <= 0) return 'out';
  return 'active';
}

function money(value: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount.toFixed(3);
}
