'use client';

import { api } from '@/components/providers';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, EmptyState, ErrorState, Skeleton } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, ChevronDown, ChevronRight, Coffee, Croissant, CupSoda, Folder, ImageIcon, LayoutGrid, List, Menu, MoreHorizontal, Pencil, Plus, Search, Star, Tag, UtensilsCrossed } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

type Status = 'active' | 'out' | 'draft';
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
};
type CatalogCategory = { id: string; name: { en?: string; ar?: string }; sortOrder?: number };

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
  const products = (productsQuery.data ?? []) as CatalogProduct[];
  const categories = ((categoriesQuery.data ?? []) as CatalogCategory[]).slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [status, setStatus] = useState<'all' | Status>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CatalogProduct | 'new' | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!menuId) return;
    const close = () => setMenuId(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuId]);

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

  const previewCategory = categoryId === 'all' ? categories[0]?.id : categoryId;
  const previewProducts = products.filter((product) => statusOf(product) === 'active' && (!previewCategory || product.categoryId === previewCategory));

  const patch = useMutation({
    mutationFn: (input: { id: string; body: Record<string, unknown> }) => api.updateProduct(input.id, input.body),
    onSuccess: () => {
      setNotice('');
      setMenuId(null);
      void client.invalidateQueries({ queryKey: ['merchant', 'products'] });
    },
    onError: (error: Error) => setNotice(error.message),
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
    <div className="flex flex-col gap-4 xl:min-h-0 xl:flex-1 xl:overflow-hidden">
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <section className="inline-grid w-fit grid-cols-2 overflow-hidden rounded-xl border border-[#EEEEEC] bg-white shadow-[0_4px_16px_rgba(17,17,17,0.04)] sm:grid-cols-4">
          <Stat label={t('total')} value={counts.total} marker={<Box className="size-3.5 text-[#8A8A86]" />} />
          <Stat label={t('active')} value={counts.active} marker={<span className="size-2 rounded-full bg-[#22A85A]" />} />
          <Stat label={t('out')} value={counts.out} marker={<span className="size-2 rounded-full bg-[#F5B400]" />} />
          <Stat label={t('drafts')} value={counts.draft} marker={<span className="size-2 rounded-full bg-[#8A8A86]" />} />
        </section>
        <div className="flex flex-wrap gap-2">
          <OutlineButton onClick={() => setCategoriesOpen(true)}><Folder className="size-4" /> {t('manageCategories')}</OutlineButton>
          <OutlineButton onClick={() => setOfferOpen(true)}><Tag className="size-4" /> {t('createOffer')}</OutlineButton>
          <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" onClick={() => setEditing('new')}>
            <Plus className="size-4" /> {t('add')}
          </Button>
        </div>
      </div>

      {notice ? <p className="text-sm font-medium text-[#B42318]">{notice}</p> : null}

      <div className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_280px] xl:grid-rows-[minmax(0,1fr)] xl:overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
          <section className="flex shrink-0 flex-col gap-2 rounded-2xl border border-[#EEEEEC] bg-white p-2 shadow-[0_8px_24px_rgba(17,17,17,0.04)] lg:flex-row lg:items-center">
            <label className="relative flex h-10 w-full items-center lg:w-56">
              <Search className="pointer-events-none absolute start-3 size-4 text-[#8A8A86]" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} className="h-10 w-full rounded-xl bg-[#F7F7F5] ps-9 pe-3 text-sm outline-none" />
            </label>
            <div className="flex w-full min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto overscroll-x-contain px-0.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <Chip active={categoryId === 'all'} onClick={() => setCategoryId('all')}>{t('all')}</Chip>
              {categories.map((category) => (
                <Chip key={category.id} active={categoryId === category.id} onClick={() => setCategoryId(category.id)}>{pickLocalized(category.name, locale)}</Chip>
              ))}
            </div>
            <div className="flex items-center gap-2 lg:ms-auto">
              <label className="relative inline-flex h-10 items-center">
                <select aria-label={t('allStatus')} value={status} onChange={(event) => setStatus(event.target.value as 'all' | Status)} className="h-10 appearance-none rounded-xl border border-[#E8E8E4] bg-white ps-3 pe-8 text-sm font-semibold text-[#161616] outline-none">
                  <option value="all">{t('allStatus')}</option>
                  <option value="active">{t('active')}</option>
                  <option value="out">{t('out')}</option>
                  <option value="draft">{t('drafts')}</option>
                </select>
                <ChevronDown className="pointer-events-none absolute end-2.5 size-4 text-[#8A8A86]" />
              </label>
              <div className="flex rounded-xl border border-[#E8E8E4] p-0.5">
                <button type="button" aria-label={t('grid')} aria-pressed={view === 'grid'} className={`grid size-9 place-items-center rounded-lg ${view === 'grid' ? 'bg-[#FFC400] text-[#161616]' : 'text-[#8A8A86]'}`} onClick={() => setView('grid')}>
                  <LayoutGrid className="size-4" />
                </button>
                <button type="button" aria-label={t('list')} aria-pressed={view === 'list'} className={`grid size-9 place-items-center rounded-lg ${view === 'list' ? 'bg-[#FFC400] text-[#161616]' : 'text-[#8A8A86]'}`} onClick={() => setView('list')}>
                  <List className="size-4" />
                </button>
              </div>
            </div>
          </section>

          {products.length === 0 ? <EmptyState title={t('none')} body={t('noneBody')} /> : null}
          {products.length > 0 && visible.length === 0 ? <p className="text-sm font-medium text-[#8A8A86]">{t('noMatch')}</p> : null}

          <div className={`xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain xl:pe-1 ${view === 'grid' ? 'grid content-start gap-2.5 sm:grid-cols-2 xl:grid-cols-4' : 'grid content-start gap-3'}`}>
            {visible.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                locale={locale}
                view={view}
                menuOpen={menuId === product.id}
                labels={{
                  edit: t('edit'),
                  more: t('more'),
                  featured: t('featured'),
                  status: t(statusOf(product) === 'out' ? 'out' : statusOf(product) === 'draft' ? 'draft' : 'active'),
                  markOut: t('markOut'),
                  markIn: t('markIn'),
                  toDraft: t('toDraft'),
                  publish: t('publish'),
                  feature: t('feature'),
                  unfeature: t('unfeature'),
                }}
                onEdit={() => { setMenuId(null); setEditing(product); }}
                onToggleMenu={() => setMenuId((current) => current === product.id ? null : product.id)}
                onAction={(action) => quick(product, action)}
              />
            ))}
          </div>
        </div>

        <aside className="flex min-h-0 flex-col gap-4 xl:h-full xl:overflow-hidden">
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#EEEEEC] bg-white p-4 shadow-[0_8px_24px_rgba(17,17,17,0.04)]">
            <h2 className="shrink-0 text-base font-semibold text-[#161616]">{t('categories')}</h2>
            <ul className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {categories.map((category) => {
                const count = products.filter((product) => product.categoryId === category.id).length;
                const selected = categoryId === category.id;
                return (
                  <li key={category.id}>
                    <button type="button" onClick={() => setCategoryId(selected ? 'all' : category.id)} className={`flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-start ${selected ? 'bg-[#FFF6D4]' : 'hover:bg-[#F7F7F5]'}`}>
                      <span className="grid size-8 place-items-center rounded-lg bg-[#F7F7F5] text-[#161616]"><CategoryGlyph name={pickLocalized(category.name, 'en')} /></span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#161616]">{pickLocalized(category.name, locale)}</span>
                      <span className="text-sm text-[#8A8A86]">{count}</span>
                      <ChevronRight className="size-4 text-[#C8C8C4] rtl:rotate-180" />
                    </button>
                  </li>
                );
              })}
            </ul>
            <button type="button" onClick={() => setCategoriesOpen(true)} className="mt-3 inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-[#E6E6E2] text-sm font-semibold text-[#161616]">
              <Pencil className="size-4" /> {t('editCategories')}
            </button>
          </section>
          <section className="shrink-0 rounded-2xl border border-[#EEEEEC] bg-white p-4 shadow-[0_8px_24px_rgba(17,17,17,0.04)]">
            <h2 className="text-base font-semibold text-[#161616]">{t('preview')}</h2>
            <div className="mx-auto mt-3 w-full max-w-[240px] rounded-[28px] border border-[#E4E4E0] bg-white p-3">
              <div className="flex items-center justify-between">
                <span aria-hidden className="block h-5 w-20 bg-[#FFC400]" style={{ WebkitMaskImage: 'url(/logo-on-light.png)', maskImage: 'url(/logo-on-light.png)', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskSize: 'contain', maskSize: 'contain', WebkitMaskPosition: 'left center', maskPosition: 'left center' }} />
                <Menu className="size-4 text-[#161616]" />
              </div>
              <div className="mt-3 flex gap-3 overflow-x-auto text-[11px] font-semibold [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {categories.map((category) => (
                  <span key={category.id} className={`shrink-0 whitespace-nowrap ${category.id === previewCategory ? 'text-[#161616]' : 'text-[#A3A39E]'}`}>{pickLocalized(category.name, locale)}</span>
                ))}
              </div>
              <div className="mt-3 flex gap-2 overflow-hidden">
                {previewProducts.slice(0, 2).map((product) => (
                  <div key={product.id} className="w-[48%] min-w-0 shrink-0">
                    <ProductPhoto src={product.imageUrl} alt={pickLocalized(product.name, locale)} className="h-24" />
                    <p className="mt-1.5 truncate text-[11px] font-semibold text-[#161616]">{pickLocalized(product.name, locale)}</p>
                    <p className="text-[11px] font-semibold text-[#161616]">{formatMoney(product.price, locale)}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </aside>
      </div>

      <ProductDialog
        open={editing !== null}
        product={editing === 'new' ? null : editing}
        categories={categories}
        onClose={() => setEditing(null)}
        onNeedCategory={() => { setEditing(null); setCategoriesOpen(true); }}
      />
      <CategoriesDialog open={categoriesOpen} categories={categories} counts={products} onClose={() => setCategoriesOpen(false)} />
      <OfferDialog open={offerOpen} products={products} onClose={() => setOfferOpen(false)} />
    </div>
  );
}

function ProductCard({
  product, locale, view, menuOpen, labels, onEdit, onToggleMenu, onAction,
}: {
  product: CatalogProduct;
  locale: 'en' | 'ar';
  view: 'grid' | 'list';
  menuOpen: boolean;
  labels: { edit: string; more: string; featured: string; status: string; markOut: string; markIn: string; toDraft: string; publish: string; feature: string; unfeature: string };
  onEdit: () => void;
  onToggleMenu: () => void;
  onAction: (action: 'out' | 'in' | 'draft' | 'publish' | 'feature') => void;
}) {
  const status = statusOf(product);
  const featured = Boolean(product.compareAtPrice);
  const name = pickLocalized(product.name, locale);
  const menu = (
    <div className="relative" onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" aria-label={labels.more} aria-expanded={menuOpen} className="grid size-7 place-items-center rounded-lg border border-[#E6E6E2] bg-white text-[#161616]" onClick={onToggleMenu}>
        <MoreHorizontal className="size-4" />
      </button>
      {menuOpen ? (
        <div className="absolute end-0 z-20 mt-1 w-52 rounded-xl border border-[#EEEEEC] bg-white p-1 shadow-lg">
          <MenuItem onClick={() => onAction(status === 'out' ? 'in' : 'out')}>{status === 'out' ? labels.markIn : labels.markOut}</MenuItem>
          <MenuItem onClick={() => onAction(status === 'draft' ? 'publish' : 'draft')}>{status === 'draft' ? labels.publish : labels.toDraft}</MenuItem>
          <MenuItem onClick={() => onAction('feature')}>{featured ? labels.unfeature : labels.feature}</MenuItem>
        </div>
      ) : null}
    </div>
  );
  const actions = (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={onEdit} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#E6E6E2] bg-white px-3 text-sm font-semibold text-[#161616]">
        <Pencil className="size-3.5" /> {labels.edit}
      </button>
      {menu}
    </div>
  );
  const gridActions = (
    <div className="flex items-center gap-1">
      <button type="button" onClick={onEdit} className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#E6E6E2] bg-white px-2 text-xs font-semibold text-[#161616]">
        <Pencil className="size-3" /> {labels.edit}
      </button>
      {menu}
    </div>
  );
  if (view === 'list') {
    return (
      <article className="flex items-center gap-3 rounded-2xl border border-[#EEEEEC] bg-white p-3 shadow-[0_8px_24px_rgba(17,17,17,0.04)]">
        <div className="relative w-24 shrink-0">
          <ProductPhoto src={product.imageUrl} alt={name} className="h-20" />
          {featured ? <FeaturedBadge label={labels.featured} compact /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-[#161616]">{name}</h3>
          <p className="text-sm text-[#8A8A86]">{pickLocalized(product.category, locale)}</p>
          <p className="mt-1 text-sm font-semibold text-[#161616]">{formatMoney(product.price, locale)}</p>
        </div>
        <StatusPill status={status} label={labels.status} />
        {actions}
      </article>
    );
  }
  return (
    <article className="rounded-2xl border border-[#EEEEEC] bg-white p-2 shadow-[0_8px_24px_rgba(17,17,17,0.04)]">
      <div className="relative">
        <ProductPhoto src={product.imageUrl} alt={name} className="h-28" />
        {featured ? <FeaturedBadge label={labels.featured} compact /> : null}
      </div>
      <h3 className="mt-2 truncate text-sm font-semibold text-[#161616]">{name}</h3>
      <p className="truncate text-xs text-[#8A8A86]">{pickLocalized(product.category, locale)}</p>
      <p className="mt-0.5 text-sm font-semibold text-[#161616]">{formatMoney(product.price, locale)}</p>
      <div className="mt-2 flex items-center justify-between gap-1">
        <StatusPill status={status} label={labels.status} />
        {gridActions}
      </div>
    </article>
  );
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
  const fallbackCategory = categories[0]?.id ?? '';
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
            <label className="mt-1.5 grid cursor-pointer place-items-center overflow-hidden rounded-xl border border-dashed border-[#E0E0DC] bg-[#F7F7F5]">
              {imageUrl ? <img src={imageUrl} alt="" className="h-36 w-full object-cover" /> : <span className="flex h-36 flex-col items-center justify-center gap-2 text-sm text-[#8A8A86]"><ImageIcon className="size-5" /> {t('upload')}</span>}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setUploading(true);
                void api.upload(file).then((saved) => setImageUrl(saved.url)).catch((reason: Error) => setError(reason.message)).finally(() => setUploading(false));
              }} />
            </label>
          </div>
          <Field label={t('name')} value={name} onChange={setName} />
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

function CategoriesDialog({ open, categories, counts, onClose }: { open: boolean; categories: CatalogCategory[]; counts: CatalogProduct[]; onClose: () => void }) {
  const t = useTranslations('merchantProducts');
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setName(''); setError(''); } }, [open]);
  const save = useMutation({
    mutationFn: async () => {
      const label = name.trim();
      if (!label) throw new Error(t('categoryRequired'));
      await api.createCategory({ name: { en: label, ar: label }, sortOrder: categories.length });
    },
    onSuccess: () => {
      setName('');
      void client.invalidateQueries({ queryKey: ['merchant', 'categories'] });
    },
    onError: (reason: Error) => setError(reason.message),
  });
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="w-[min(100%-2rem,28rem)]">
        <DialogTitle>{t('manageCategories')}</DialogTitle>
        <DialogDescription>{t('subtitle')}</DialogDescription>
        <ul className="mt-4 max-h-64 space-y-1 overflow-y-auto">
          {categories.map((category) => (
            <li key={category.id} className="flex items-center justify-between rounded-xl bg-[#F7F7F5] px-3 py-2 text-sm">
              <span className="font-semibold text-[#161616]">{pickLocalized(category.name, locale)}</span>
              <span className="text-[#8A8A86]">{counts.filter((product) => product.categoryId === category.id).length}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex gap-2">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('newCategory')} className="h-11 min-w-0 flex-1 rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm outline-none" />
          <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" loading={save.isPending} onClick={() => { setError(''); save.mutate(); }}>{t('addCategory')}</Button>
        </div>
        {error ? <p className="mt-3 text-sm font-medium text-[#B42318]">{error}</p> : null}
      </DialogContent>
    </Dialog>
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

function OutlineButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#E6E6E2] bg-white px-4 text-sm font-semibold text-[#161616]">
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
  if (!src || failed) {
    return <div className={`grid place-items-center rounded-xl bg-[#F3F3F0] text-[#C8C8C4] ${className}`}><ImageIcon className="size-5" /></div>;
  }
  return <img src={src} alt={alt} className={`w-full rounded-xl object-cover ${className}`} onError={() => setFailed(true)} />;
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
