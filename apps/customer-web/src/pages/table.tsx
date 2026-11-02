import { CartButtonSpinner, flyFromButton } from '@/components/cart-motion';
import { ProductSheet } from '@/components/product-sheet';
import { api } from '@/components/providers';
import { useCartAdd } from '@/components/store-switch';
import { categoryIcon, StoreUnavailable } from '@/components/storefront';
import { ScanNotice, TableCallButton, tableNo, useTableLink, useTableService, VisitEnded } from '@/components/table-call';
import { Link, useRouter } from '@/i18n/navigation';
import { beginCartChange, cartQueryOptions, failCartChange, optimisticLine, setLineQuantity, settleCartChange } from '@/lib/cart-cache';
import { ensureGuest } from '@/lib/location';
import { usePlace } from '@/lib/place';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { cn, ErrorState } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Heart, Minus, Plus, ReceiptText, Share2, ShoppingCart } from 'lucide-react';
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
  const link = useTableLink();
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
  // Once the table paid, this visit is over: the menu stays to browse, and scanning again starts a new order.
  const ended = Boolean(table.data?.visitEnded);
  const sentBill = table.bill && !table.bill.settled && table.bill.orders.length ? table.bill : null;
  const cartHref = `/table/${slug}/cart${link}`;

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

          {table.missing && !table.data ? (
            <div className="mt-3">
              <ScanNotice body={t('customer.tablePage.scanToOrder')} />
            </div>
          ) : ended ? (
            <div className="mt-3">
              <VisitEnded title={t('customer.tablePage.visitEndedTitle')} body={t('customer.tablePage.visitEndedBody')} />
            </div>
          ) : table.data?.cleaning ? (
            <div className="mt-3">
              <ScanNotice body={t('customer.tablePage.settingUp')} />
            </div>
          ) : sentBill ? (
            <button type="button" onClick={table.openBill} className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-[#f6f6f3] px-3.5 py-2.5 text-start">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary"><ReceiptText className="size-[18px]" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-bold text-[#111]">{t('customer.tablePage.alreadyOrdered')}</span>
                <span className="block truncate text-[12px] text-[#6f6f6a]">{t('customer.tablePage.ordersSent', { count: sentBill.orders.length, amount: formatMoney(sentBill.total, locale) })}</span>
              </span>
              <span className="shrink-0 text-[13px] font-bold text-[#111] underline underline-offset-2">{t('customer.tablePage.viewBill')}</span>
            </button>
          ) : null}

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
                  locale={locale}
                  addLabel={t('customer.tablePage.add', { name: pickLocalized(product.name, locale) })}
                  pending={cartAdd.pendingId === product.id}
                  disabled={ended}
                  lines={lines.filter((line) => line.productId === product.id)}
                  labels={{ less: t('customer.remove'), quantity: t('customer.tablePage.quantity') }}
                  onAdd={() => {
                    // Dishes with sizes, options or combo picks are customised in a sheet, not on their own page.
                    if (product.customizable || product.needsChoice) {
                      setChoosing(product.id);
                      return false;
                    }
                    return cartAdd.addCard(product);
                  }}
                  onQty={(id, quantity) => edit.mutate({ id, quantity })}
                  onCart={() => router.push(cartHref)}
                  onOpen={() => setChoosing(product.id)}
                />
              ))}
            </ul>
          ) : (
            <p className="py-8 text-sm text-[#6f6f6a]">{t('customer.noMatches')}</p>
          )}
        </div>
      </div>

      {count > 0 && cart.data && !ended ? (
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
            <Link href={cartHref} className="inline-flex h-[38px] shrink-0 items-center gap-2 rounded-full bg-primary px-4 text-[15px] font-bold text-[#111]">
              {t('customer.viewCart')}
              <ArrowRight className="size-[18px] rtl:rotate-180" strokeWidth={2.4} />
            </Link>
          </div>
        </div>
      ) : null}
      {table.data && !ended ? <TableCallButton table={table} lift={count > 0 && cart.data ? 'cartBar' : 'none'} /> : null}
      <ProductSheet productId={choosing} onClose={() => setChoosing(null)} cartAdd={cartAdd} viewOnly={ended} />
      {cartAdd.dialog}
      {table.dialogs}
    </div>
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
  locale,
  addLabel,
  pending,
  disabled,
  lines,
  labels,
  onAdd,
  onQty,
  onCart,
  onOpen,
}: {
  product: MenuProduct;
  locale: 'en' | 'ar';
  addLabel: string;
  pending: boolean;
  disabled: boolean;
  lines: CartLine[];
  labels: { less: string; quantity: string };
  onAdd: () => boolean | void;
  onQty: (id: string, quantity: number) => void;
  onCart: () => void;
  /** Details open in the bottom sheet, so the diner never leaves the table menu. */
  onOpen: () => void;
}) {
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
      <button type="button" tabIndex={-1} aria-hidden onClick={onOpen} className="block aspect-[178/82] w-full overflow-hidden bg-[#f3f3ef]">
        <img src={image} alt="" loading="lazy" className="size-full object-cover" />
      </button>
      <div className="flex flex-1 flex-col px-2.5 pt-2 pb-2.5">
        <button type="button" onClick={onOpen} className="line-clamp-1 text-start text-[13.5px] leading-snug font-bold text-[#111]">{pickLocalized(product.name, locale)}</button>
        <p className="mt-0.5 line-clamp-2 min-h-[2.5em] text-[11.5px] leading-[1.25] text-[#6f6f6a]">{pickLocalized(product.description, locale)}</p>
        <div className="mt-auto flex items-center justify-between gap-1.5 pt-1">
          <p className="min-w-0 truncate text-[12.5px] font-bold text-[#111]">{formatMoney(product.price, locale)}</p>
          {disabled ? null : quantity > 0 ? (
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
