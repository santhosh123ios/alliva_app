import { CartButtonSpinner, flyFromButton } from '@/components/cart-motion';
import { ProductSheet } from '@/components/product-sheet';
import { api } from '@/components/providers';
import { useCartAdd } from '@/components/store-switch';
import { categoryIcon, StoreUnavailable } from '@/components/storefront';
import { tableNo, useTableService } from '@/components/table-call';
import { Link, useRouter } from '@/i18n/navigation';
import { beginCartChange, cartQueryOptions, failCartChange, optimisticLine, setLineQuantity, settleCartChange } from '@/lib/cart-cache';
import { ensureGuest } from '@/lib/location';
import { usePlace } from '@/lib/place';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { cn, ErrorState } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, BadgeCheck, Bell, BellRing, Check, CircleHelp, Heart, Loader2, Minus, Plus, ReceiptText, Share2, ShoppingCart, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'use-intl';

type StorePayload = NonNullable<Awaited<ReturnType<typeof api.merchant>>>;
type MenuProduct = StorePayload['categories'][number]['products'][number];

/** The store page a diner lands on after scanning a table QR: the menu, their table's staff buttons and the cart. */
export default function TablePage() {
  const { slug } = useParams() as { slug: string };
  const locale = useLocale() as 'en' | 'ar';
  const t = useTranslations();
  const router = useRouter();
  const client = useQueryClient();
  const setFulfillment = usePlace((state) => state.setFulfillment);
  const [tab, setTab] = useState('popular');
  const [choosing, setChoosing] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const customer = useQuery({ queryKey: ['customer'], queryFn: () => api.customer(), enabled: me.data?.kind === 'CUSTOMER', retry: false });
  const merchant = useQuery({ queryKey: ['merchant', slug], queryFn: () => api.merchant(slug) });
  const cart = useQuery(cartQueryOptions());
  const cartAdd = useCartAdd();
  const table = useTableService();
  const edit = useMutation({
    mutationFn: async ({ id, quantity }: { id: string; quantity: number }) => {
      await api.guest().catch(() => undefined);
      return quantity < 1 ? api.removeItem(id) : api.updateItem(id, quantity);
    },
    onMutate: ({ id, quantity }) => beginCartChange(client, (current) => setLineQuantity(current, id, quantity)),
    onSuccess: (cartView, _variables, changeId) => settleCartChange(client, changeId, cartView),
    onError: (error: Error, _variables, changeId) => {
      if (typeof changeId === 'number') failCartChange(client, changeId);
      toast.error(error.message);
    },
  });

  useEffect(() => {
    // This page sits outside the shell, which is what usually starts the guest session.
    void ensureGuest().catch(() => undefined);
    setFulfillment('DINE_IN');
  }, [setFulfillment]);

  if (merchant.isLoading) return <TableSkeleton />;
  if (merchant.error || !merchant.data) return <ErrorState title="Merchant" body={(merchant.error as Error)?.message ?? 'Missing'} />;

  const data = merchant.data;
  const name = pickLocalized(data.name, locale);
  if (data.temporarilyUnavailable) {
    return <StoreUnavailable name={name} title={t('customer.temporarilyUnavailable')} body={t('customer.storeUnavailableBody')} backLabel={t('customer.back')} />;
  }
  const favourites = (customer.data as { favourites?: { merchantId: string }[] } | undefined)?.favourites ?? [];
  const saved = favourites.some((row) => row.merchantId === data.id);
  const catalog = data.categories.flatMap((category) => category.products.map((product) => ({ ...product, categoryId: category.id })));
  const visible = tab === 'popular' ? catalog.slice() : catalog.filter((product) => product.categoryId === tab);
  if (tab === 'popular') visible.sort((a, b) => Number(b.rating) - Number(a.rating) || b.reviewCount - a.reviewCount);
  const heading = tab === 'popular' ? t('customer.popularAt', { name }) : pickLocalized(data.categories.find((category) => category.id === tab)?.name ?? { en: '', ar: '' }, locale);
  const sameStore = !cart.data?.merchant || cart.data.merchant.id === data.id;
  const count = sameStore ? (cart.data?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0) : 0;
  const Icon = categoryIcon(data.categorySlugs[0] ?? '');
  const lines = sameStore ? (cart.data?.items ?? []) : [];

  /** Switching category while scrolled down starts the new list right under the pinned chips. */
  const selectTab = (next: string) => {
    setTab(next);
    if ((headingRef.current?.getBoundingClientRect().top ?? 0) < 60) headingRef.current?.scrollIntoView({ block: 'start' });
  };

  const toggleSave = () => {
    if (me.data?.kind !== 'CUSTOMER') {
      router.push('/login');
      return;
    }
    void (saved ? api.unfavourite(data.id) : api.favourite(data.id))
      .then(() => client.invalidateQueries({ queryKey: ['customer'] }))
      .catch((error: Error) => toast.error(error.message));
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

  return (
    <div className="min-h-screen bg-white pb-28">
      <div className="mx-auto max-w-[880px] lg:px-6">
        <div className="relative h-[176px] overflow-hidden bg-[#f3f3ef] sm:h-56 lg:mt-6 lg:h-72 lg:rounded-[28px]">
          <img src={data.coverUrl || '/no-image-16x9.jpg'} alt="" className="size-full object-cover" />
          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3.5 lg:p-5">
            <Link href="/" aria-label={t('customer.back')} className="grid size-[34px] place-items-center rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.12)]">
              <ArrowLeft className="size-[18px] rtl:rotate-180" strokeWidth={2.2} />
            </Link>
            <div className="flex gap-2.5">
              <button type="button" aria-label={t('customer.shareStore')} onClick={() => void share()} className="grid size-[34px] place-items-center rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.12)]">
                <Share2 className="size-4" strokeWidth={2.2} />
              </button>
              <button type="button" aria-pressed={saved} aria-label={saved ? t('customer.saved') : t('customer.saveStore')} onClick={toggleSave} className="grid size-[34px] place-items-center rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.12)]">
                <Heart className={cn('size-4', saved && 'fill-[#111]')} strokeWidth={2.2} />
              </button>
            </div>
          </div>
        </div>

        <div className="relative px-[22px] lg:px-0">
          <div className="-mt-[58px] grid size-[66px] place-items-center overflow-hidden rounded-full border-[3px] border-white bg-primary shadow-[0_4px_12px_rgba(0,0,0,0.15)] lg:ms-6 lg:size-20">
            {data.logoUrl ? <img src={data.logoUrl} alt="" className="size-full object-cover" /> : <Icon className="size-7" />}
          </div>

          {/* The chips stay pinned while the dishes scroll underneath. */}
          <div className="sticky top-0 z-20 -mx-[22px] mt-1.5 flex gap-2 overflow-x-auto bg-white px-[22px] py-2 shadow-[0_6px_10px_-8px_rgba(0,0,0,0.15)] [scrollbar-width:none] lg:mx-0 lg:px-0">
            <Chip selected={tab === 'popular'} onClick={() => selectTab('popular')}>{t('customer.storePopular')}</Chip>
            {data.categories.filter((category) => category.products.length > 0).map((category) => (
              <Chip key={category.id} selected={tab === category.id} onClick={() => selectTab(category.id)}>
                {pickLocalized(category.name, locale)}
              </Chip>
            ))}
          </div>

          <h2 ref={headingRef} className="mt-2 scroll-mt-[60px] text-[20px] font-extrabold tracking-[-0.01em] text-[#111]">{heading}</h2>
          {visible.length ? (
            <ul className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:gap-4">
              {visible.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  slug={slug}
                  locale={locale}
                  addLabel={t('customer.tablePage.add', { name: pickLocalized(product.name, locale) })}
                  pending={cartAdd.pendingId === product.id}
                  lines={lines.filter((line) => line.productId === product.id)}
                  labels={{ less: t('customer.remove'), quantity: t('customer.quantity') }}
                  onAdd={() => {
                    // Dishes with sizes, options or combo picks are customised in a sheet, not on their own page.
                    if (product.customizable || product.needsChoice) {
                      setChoosing(product.id);
                      return false;
                    }
                    return cartAdd.addCard(product);
                  }}
                  onQty={(id, quantity) => edit.mutate({ id, quantity })}
                  onCart={() => router.push('/cart')}
                />
              ))}
            </ul>
          ) : (
            <p className="py-8 text-sm text-[#6f6f6a]">{t('customer.noMatches')}</p>
          )}
        </div>
      </div>

      {count > 0 && cart.data ? (
        <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-[640px] items-center justify-between gap-3 rounded-full bg-[#141416] py-1.5 ps-5 pe-1.5 text-white shadow-[0_10px_28px_rgba(0,0,0,0.25)]">
            <div className="flex min-w-0 items-center gap-4">
              <span className="relative shrink-0">
                <ShoppingCart className="size-[22px]" strokeWidth={2} />
                <span className="absolute -top-2.5 -start-1.5 grid size-[18px] place-items-center rounded-full bg-primary text-[11px] font-bold text-[#111]">{count}</span>
              </span>
              <span className="truncate text-[14px]">
                {t('customer.cartItems', { count })} · {formatMoney(cart.data.pricing.total, locale)}
              </span>
            </div>
            <Link href="/cart" className="inline-flex h-[38px] shrink-0 items-center gap-2 rounded-full bg-primary px-4 text-[15px] font-bold text-[#111]">
              {t('customer.viewCart')}
              <ArrowRight className="size-[18px] rtl:rotate-180" strokeWidth={2.4} />
            </Link>
          </div>
        </div>
      ) : null}
      {table.data ? <TableCallButton table={table} raised={count > 0 && Boolean(cart.data)} /> : null}
      <ProductSheet productId={choosing} onClose={() => setChoosing(null)} cartAdd={cartAdd} />
      {cartAdd.dialog}
      {table.dialogs}
    </div>
  );
}

/**
 * A floating bell that opens the table's three staff actions: call staff, the bill and help.
 * A pending call opens its status, where it can be ended; the bell rings while staff are called.
 */
function TableCallButton({ table, raised }: { table: ReturnType<typeof useTableService>; raised: boolean }) {
  const t = useTranslations('customer.tablePage');
  const [open, setOpen] = useState(false);
  const data = table.data!;
  const request = (kind: 'WAITER' | 'BILL' | 'HELP') => data.requests.find((row) => row.kind === kind);
  const pending = data.requests.length > 0;
  const press = (kind: 'WAITER' | 'BILL' | 'HELP') => {
    setOpen(false);
    if (kind === 'BILL' && table.bill) return table.openBill();
    if (request(kind)) return table.openCalls();
    table.call.mutate(kind);
  };
  const actions = [
    { kind: 'WAITER', icon: Bell, label: t('callStaff') },
    { kind: 'BILL', icon: ReceiptText, label: table.bill ? t('viewBill') : t('requestBill') },
    { kind: 'HELP', icon: CircleHelp, label: t('help') },
  ] as const;

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  return (
    <>
      {open ? <button type="button" aria-label={t('closeCalls')} tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default bg-black/20" /> : null}
      <div className={cn('fixed end-4 z-50 flex flex-col items-end gap-3 transition-[bottom] lg:end-[max(1rem,calc((100vw-880px)/2))]', raised ? 'bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4rem)]' : 'bottom-[max(1.25rem,env(safe-area-inset-bottom))]')}>
        {open ? (
          <div id="table-calls" role="menu" className="w-[260px] origin-bottom-right overflow-hidden rounded-[20px] bg-white p-2 shadow-[0_18px_40px_rgba(17,17,17,0.22)] rtl:origin-bottom-left">
            <div className="flex items-center gap-2.5 px-2 pt-1.5 pb-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#fff3c9]">
                <DiningTableIcon className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-[14px] leading-tight font-bold text-[#111]">
                  {t('diningAt', { table: tableNo(data.table.number) })}
                  <BadgeCheck aria-label={t('verified')} className="size-4 shrink-0 fill-primary text-white" strokeWidth={2.2} />
                </span>
                <span className="block text-[11.5px] leading-snug text-[#6f6f6a]">{t('diningNote')}</span>
              </span>
            </div>
            {actions.map(({ kind, icon: ActionIcon, label }) => {
              const row = request(kind);
              const busy = table.call.isPending && table.call.variables === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  disabled={table.call.isPending}
                  onClick={() => press(kind)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-[14px] px-2 py-2 text-start hover:bg-[#fafaf6] disabled:opacity-60',
                    row?.status === 'ACKNOWLEDGED' ? 'bg-[#e3f5ea]' : row ? 'bg-[#fff8dc]' : '',
                  )}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-[#111]">
                    {busy ? <Loader2 className="size-[18px] animate-spin" /> : row?.status === 'ACKNOWLEDGED' ? <Check className="size-[18px]" strokeWidth={2.4} /> : <ActionIcon className="size-[18px]" strokeWidth={2} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-[#111]">{label}</span>
                    {row ? <span className="block text-[11.5px] text-[#5c5c58]">{row.status === 'ACKNOWLEDGED' ? t('onTheWay') : t('staffCalled')}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        <button
          type="button"
          aria-expanded={open}
          aria-controls="table-calls"
          aria-label={open ? t('closeCalls') : t('openCalls')}
          onClick={() => setOpen((value) => !value)}
          className="relative grid size-14 place-items-center rounded-full bg-[#141416] text-primary ring-4 ring-white shadow-[0_10px_28px_rgba(0,0,0,0.25)] active:scale-95"
        >
          {open ? <X className="size-6" strokeWidth={2.4} /> : pending ? <BellRing className="size-6 animate-pulse" strokeWidth={2.2} /> : <Bell className="size-6" strokeWidth={2.2} />}
          {pending && !open ? <span className="absolute top-0 end-0 size-3.5 rounded-full border-2 border-[#141416] bg-[#22a85a]" /> : null}
        </button>
      </div>
    </>
  );
}

/** A dining table with two chairs, as in the design; lucide has no such icon. */
function DiningTableIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M7 9h10" />
      <path d="M12 9v10" />
      <path d="M9 19h6" />
      <path d="M3 5v14" />
      <path d="M3 13h3v6" />
      <path d="M21 5v14" />
      <path d="M21 13h-3v6" />
    </svg>
  );
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'inline-flex h-[30px] shrink-0 items-center rounded-full border px-3.5 text-[12.5px] font-medium text-[#111]',
        selected ? 'border-transparent bg-primary font-semibold' : 'border-[#e3e3de] bg-white',
      )}
    >
      {children}
    </button>
  );
}

type CartLine = NonNullable<Awaited<ReturnType<typeof api.cart>>>['items'][number];

/**
 * Once a dish is in the cart its "+" becomes a stepper. A dish added once (one cart line) steps that line;
 * customised dishes can sit on several lines, so "+" adds another and "−" opens the cart to pick which one.
 */
function ProductCard({
  product,
  slug,
  locale,
  addLabel,
  pending,
  lines,
  labels,
  onAdd,
  onQty,
  onCart,
}: {
  product: MenuProduct;
  slug: string;
  locale: 'en' | 'ar';
  addLabel: string;
  pending: boolean;
  lines: CartLine[];
  labels: { less: string; quantity: string };
  onAdd: () => boolean | void;
  onQty: (id: string, quantity: number) => void;
  onCart: () => void;
}) {
  const href = `/merchants/${slug}/products/${product.id}`;
  const image = product.imageUrl || '/no-image-16x9.jpg';
  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const single = lines.length === 1 ? lines[0] : null;
  const locked = pending || Boolean(single && optimisticLine(single.id));
  const add = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (single && !product.needsChoice) {
      onQty(single.id, single.quantity + 1);
      return;
    }
    if (onAdd() === false) return;
    flyFromButton(event.currentTarget, image);
  };
  return (
    <li className="flex flex-col overflow-hidden rounded-[12px] border border-[#ececE6] bg-white">
      <Link href={href} className="block aspect-[178/82] overflow-hidden bg-[#f3f3ef]">
        <img src={image} alt="" loading="lazy" className="size-full object-cover" />
      </Link>
      <div className="flex flex-1 flex-col px-2.5 pt-2 pb-2.5">
        <Link href={href} className="line-clamp-1 text-[13.5px] leading-snug font-bold text-[#111]">{pickLocalized(product.name, locale)}</Link>
        <p className="mt-0.5 line-clamp-2 min-h-[2.5em] text-[11.5px] leading-[1.25] text-[#6f6f6a]">{pickLocalized(product.description, locale)}</p>
        <div className="mt-auto flex items-center justify-between gap-1.5 pt-1">
          <p className="min-w-0 truncate text-[12.5px] font-bold text-[#111]">{formatMoney(product.price, locale)}</p>
          {quantity > 0 ? (
            <div role="group" aria-label={labels.quantity} className="flex h-[30px] shrink-0 items-center rounded-full bg-primary text-[#111] shadow-sm">
              <button
                type="button"
                aria-label={labels.less}
                disabled={locked}
                onClick={() => (single ? onQty(single.id, single.quantity - 1) : onCart())}
                className="grid size-[30px] place-items-center rounded-full disabled:opacity-50"
              >
                <Minus className="size-4" strokeWidth={2.6} />
              </button>
              <span aria-live="polite" className="min-w-4 text-center text-[13px] font-bold tabular-nums">{quantity}</span>
              <button
                type="button"
                aria-label={addLabel}
                disabled={locked || !product.available}
                onClick={add}
                className="grid size-[30px] place-items-center rounded-full disabled:opacity-50"
              >
                {pending ? <CartButtonSpinner /> : <Plus className="size-4" strokeWidth={2.6} />}
              </button>
            </div>
          ) : (
            <button
              type="button"
              aria-label={addLabel}
              disabled={!product.available || pending}
              aria-busy={pending}
              onClick={add}
              className="grid size-[30px] shrink-0 place-items-center rounded-full bg-primary text-[#111] shadow-sm disabled:opacity-50"
            >
              {pending ? <CartButtonSpinner /> : <Plus className="size-[18px]" strokeWidth={2.6} />}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function TableSkeleton() {
  return (
    <div className="mx-auto max-w-[880px] animate-pulse">
      <div className="h-[176px] bg-[#f3f3ef] sm:h-56 lg:h-72" />
      <div className="space-y-3 px-[22px] py-4">
        <div className="h-7 w-40 rounded-full bg-[#f3f3ef]" />
        <div className="h-4 w-28 rounded-full bg-[#f3f3ef]" />
        <div className="h-14 rounded-2xl bg-[#f3f3ef]" />
        <div className="h-10 rounded-full bg-[#f3f3ef]" />
        <div className="h-24 rounded-2xl bg-[#f3f3ef]" />
      </div>
    </div>
  );
}
