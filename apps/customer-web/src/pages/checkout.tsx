import { AddressForm } from '@/components/address-form';
import { api } from '@/components/providers';
import { useRouter } from '@/i18n/navigation';
import { cartQueryKey, cartQueryOptions } from '@/lib/cart-cache';
import { errorCode, errorMessage, problemMessage } from '@/lib/checkout-errors';
import { chooseAddress, useLocationStore } from '@/lib/location';
import { usePlace, type FulfillmentMode } from '@/lib/place';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, EmptyState, Skeleton, Spinner, Textarea } from '@alliva/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bike, Check, ChevronDown, Clock, MapPin, Phone, Plus, ShoppingBag, Store, Utensils } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'use-intl';

type Summary = Awaited<ReturnType<typeof api.validateCheckout>>;
type Address = Awaited<ReturnType<typeof api.addresses>>[number];
type PaymentCode = Summary['paymentMethods'][number]['code'];

const modeIcons = { DELIVERY: Bike, TAKEAWAY: ShoppingBag, DINE_IN: Utensils } as const;
const modeLabels = { DELIVERY: 'delivery', TAKEAWAY: 'pickup', DINE_IN: 'dineIn' } as const;

export default function CheckoutPage() {
  const router = useRouter();
  const client = useQueryClient();
  const t = useTranslations();
  const c = useTranslations('customer.checkoutPage');
  const e = useTranslations('customer.checkoutErrors');
  const locale = useLocale() as 'en' | 'ar';
  const here = useLocationStore((state) => state.point);
  const chosenAddressId = useLocationStore((state) => state.addressId);
  const revision = useLocationStore((state) => state.revision);
  const setPreferredMode = usePlace((state) => state.setFulfillment);
  const preferredMode = usePlace((state) => state.fulfillment);

  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const customer = me.data?.kind === 'CUSTOMER';
  const cart = useQuery(cartQueryOptions());
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: () => api.addresses(), enabled: customer });
  const nearest = useQuery({
    queryKey: ['addresses', 'nearest', here?.lat.toFixed(4), here?.lng.toFixed(4)],
    queryFn: () => api.nearestAddress(here!.lat.toFixed(6), here!.lng.toFixed(6)),
    enabled: customer && Boolean(here) && Boolean(addresses.data?.length),
    retry: 1,
  });

  const [mode, setMode] = useState<FulfillmentMode | null>(null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [autoPicked, setAutoPicked] = useState<'nearest' | 'default' | null>(null);
  const [farFromSaved, setFarFromSaved] = useState(false);
  const [payment, setPayment] = useState<PaymentCode | null>(null);
  const [notes, setNotes] = useState('');
  const [picker, setPicker] = useState(false);
  const [adding, setAdding] = useState(false);
  const decided = useRef(false);
  const attempt = useRef<string | null>(null);

  // Not signed in: go to sign-in and come straight back here. The guest cart is kept and merged on the server.
  useEffect(() => {
    if (me.isError || (me.data && !customer)) router.replace(`/login?next=${encodeURIComponent('/checkout')}`);
  }, [me.isError, me.data, customer, router]);

  const merchant = cart.data?.merchant ?? null;
  const offered = (merchant?.fulfillment ?? ['DELIVERY']) as FulfillmentMode[];
  const activeMode: FulfillmentMode = mode ?? (cart.data?.fulfillmentType as FulfillmentMode | null) ?? (offered.includes(preferredMode) ? preferredMode : offered[0] ?? 'DELIVERY');
  const delivering = activeMode === 'DELIVERY';

  // A new choice in the header while checkout is open: follow a saved address, or re-pick for a new spot on the map.
  const seenRevision = useRef(revision);
  useEffect(() => {
    if (revision === seenRevision.current) return;
    seenRevision.current = revision;
    decided.current = false;
    setAddressId(null);
    setAutoPicked(null);
    setFarFromSaved(false);
  }, [revision]);

  // Pick the address once: the saved address chosen in the header; otherwise the saved address nearest to
  // where the customer is now, if it is close enough. If they are far from every saved address we do not guess.
  useEffect(() => {
    if (decided.current || !addresses.data || !cart.data) return;
    const list = addresses.data;
    if (!list.length) {
      decided.current = true;
      if (delivering) setAdding(true);
      return;
    }
    const chosen = chosenAddressId ? list.find((row) => row.id === chosenAddressId) : undefined;
    if (chosen) {
      decided.current = true;
      setAddressId(chosen.id);
      return;
    }
    if (here) {
      if (nearest.isLoading) return;
      decided.current = true;
      if (nearest.data?.address) {
        setAddressId(nearest.data.address.id);
        setAutoPicked('nearest');
      } else if (nearest.data) {
        setFarFromSaved(true);
      } else {
        const fallback = list.find((row) => row.id === cart.data?.addressId) ?? list.find((row) => row.isDefault) ?? list[0]!;
        setAddressId(fallback.id);
        setAutoPicked('default');
      }
      return;
    }
    decided.current = true;
    const fallback = list.find((row) => row.id === cart.data?.addressId) ?? list.find((row) => row.isDefault) ?? list[0]!;
    setAddressId(fallback.id);
    setAutoPicked('default');
  }, [addresses.data, cart.data, here, chosenAddressId, nearest.isLoading, nearest.data, delivering, revision]);

  const ready = customer && Boolean(cart.data?.items.length) && (!delivering || Boolean(addressId));
  const summary = useQuery({
    queryKey: ['checkout', activeMode, delivering ? addressId : null, payment, cart.data?.version],
    queryFn: ({ signal }) => api.validateCheckout({ fulfillmentType: activeMode, addressId: delivering ? addressId : null, paymentMethod: payment ?? undefined }, { signal }),
    enabled: ready,
    placeholderData: keepPreviousData,
    retry: (count, error) => count < 2 && !errorCode(error),
    retryDelay: (count) => Math.min(800 * 2 ** count, 4000),
    staleTime: 0,
  });
  const view = summary.data;
  const methods = view?.paymentMethods ?? cart.data?.paymentMethods ?? [];

  useEffect(() => {
    if (!methods.length) return;
    if (!payment || !methods.some((method) => method.code === payment)) setPayment(methods[0]!.code);
  }, [methods, payment]);

  useEffect(() => {
    if (cart.data?.notes && !notes) setNotes(cart.data.notes);
    // Only seed once from the cart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.data?.notes]);

  // A new address, order type or cart means a new attempt; the same attempt reuses its key so a retry never double-orders.
  useEffect(() => {
    attempt.current = null;
  }, [activeMode, addressId, payment, view?.cartVersion, view?.pricing?.total]);

  const place = useMutation({
    mutationFn: () => {
      attempt.current ??= crypto.randomUUID();
      return api.checkout(
        {
          paymentMethod: payment,
          fulfillmentType: activeMode,
          addressId: delivering ? addressId : null,
          notes: notes.trim() || null,
          expectedTotal: view?.pricing?.total ?? null,
          cartVersion: view?.cartVersion ?? null,
        },
        attempt.current,
      );
    },
    onSuccess: (order) => {
      client.removeQueries({ queryKey: ['checkout'] });
      void client.invalidateQueries({ queryKey: cartQueryKey });
      router.replace(`/orders/${order.id}`);
    },
    onError: (error) => {
      const code = errorCode(error);
      if (code === 'AUTH_REQUIRED') {
        toast.error(e('authExpired'));
        router.replace(`/login?next=${encodeURIComponent('/checkout')}`);
        return;
      }
      toast.error(e(errorMessage(error)));
      if (code === 'CART_CHANGED' || code === 'TOTAL_CHANGED' || code === 'PRODUCT_UNAVAILABLE') void client.invalidateQueries({ queryKey: cartQueryKey });
      void summary.refetch();
    },
  });

  const selected = addresses.data?.find((row) => row.id === addressId) ?? null;
  const validating = summary.isFetching;
  const problems = view?.problems ?? [];
  const blocked = !view || !view.canPlace || validating || place.isPending || !payment || (delivering && !selected);
  const contact = selected?.contactPhone || me.data?.phone || null;
  const minutes = view?.delivery?.available ? view.delivery.estimatedMinutes : merchant?.deliveryMinutes ?? 30;

  const chooseMode = (next: FulfillmentMode) => {
    setMode(next);
    setPreferredMode(next);
  };

  const onSaved = (address: Address) => {
    client.setQueryData<Address[]>(['addresses'], (current) => [address, ...(current ?? []).map((row) => (address.isDefault ? { ...row, isDefault: false } : row))]);
    void client.invalidateQueries({ queryKey: ['customer'] });
    setAddressId(address.id);
    setAutoPicked(null);
    setFarFromSaved(false);
    setAdding(false);
    setPicker(false);
    chooseAddress(address);
    toast.success(c('addressSaved'));
  };

  if (me.isLoading || cart.isLoading || (customer && addresses.isLoading)) return <CheckoutSkeleton />;
  if (!customer) return <CheckoutSkeleton />;
  if (!cart.data?.items.length) {
    return (
      <EmptyState
        title={e('cartEmpty')}
        body={c('emptyBody')}
        action={
          <button type="button" onClick={() => router.push('/')} className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-bold text-[#111]">
            {t('customer.exploreNearby')}
          </button>
        }
      />
    );
  }

  const storeName = merchant ? pickLocalized(merchant.name, locale) : '';
  const branchName = view?.branch ? pickLocalized(view.branch.name, locale) : null;
  const pricing = view?.pricing ?? null;
  const deliveryQuote = view?.delivery ?? null;

  const placeButton = (
    <Button type="button" variant="yellow" className="h-12 w-full rounded-full text-base font-bold" loading={place.isPending} disabled={blocked} onClick={() => place.mutate()}>
      {validating && !place.isPending ? (
        <>
          <Spinner className="size-4" />
          {c('checking')}
        </>
      ) : pricing ? (
        c('placeOrder', { total: formatMoney(pricing.total, locale) })
      ) : (
        c('placeOrderPlain')
      )}
    </Button>
  );

  return (
    <div className="pb-28 lg:pb-0">
      <h1 className="font-display text-3xl font-bold tracking-[-0.03em] lg:text-4xl">{c('title')}</h1>
      <div className="mt-5 lg:grid lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start lg:gap-6">
        <div className="space-y-4">
          <section className="flex items-center gap-3 rounded-3xl border border-[#ecece6] bg-white p-4">
            <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-primary">
              {merchant?.logoUrl ? <img src={merchant.logoUrl} alt="" className="size-full object-cover" /> : <Store className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{storeName}</p>
              <p className="truncate text-sm text-[#6f6f6a]">{branchName ? c('branch', { branch: branchName }) : view?.branch?.address ?? ''}</p>
            </div>
          </section>

          {offered.length > 1 ? (
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={c('orderType')}>
              {offered.map((id) => {
                const Icon = modeIcons[id];
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={activeMode === id}
                    onClick={() => chooseMode(id)}
                    className={cn('inline-flex h-11 items-center justify-center gap-1.5 rounded-full border text-sm font-semibold', activeMode === id ? 'border-transparent bg-primary text-[#111]' : 'border-[#e6e6e0] bg-white')}
                  >
                    <Icon className="size-4" />
                    {t(`customer.${modeLabels[id]}`)}
                  </button>
                );
              })}
            </div>
          ) : null}

          {delivering ? (
            <section className="rounded-3xl border border-[#ecece6] bg-white p-4" aria-labelledby="delivery-address">
              <div className="flex items-center justify-between gap-3">
                <h2 id="delivery-address" className="font-bold">{c('deliveryAddress')}</h2>
                {addresses.data?.length ? (
                  <button type="button" className="text-sm font-semibold text-[#8a6d00]" onClick={() => setPicker(true)}>
                    {selected ? c('changeAddress') : c('chooseAddress')}
                  </button>
                ) : null}
              </div>
              {selected ? (
                <div className="mt-3 flex gap-3">
                  <MapPin className="mt-0.5 size-5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {selected.label}
                      {autoPicked === 'nearest' ? <span className="ms-2 rounded-full bg-[#e7f8ee] px-2 py-0.5 text-xs font-semibold text-[#1c9a4b]">{c('nearestBadge')}</span> : null}
                    </p>
                    <p className="text-sm text-[#6f6f6a]">{formatAddressLine(selected)}</p>
                    {autoPicked === 'default' && here ? <p className="mt-1 text-xs text-[#8a6d00]">{c('confirmAddress')}</p> : null}
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-2xl bg-[#fff6d0] px-4 py-3 text-sm text-[#5c4700]">
                  <p className="font-semibold">{farFromSaved ? c('farTitle') : e('addressRequired')}</p>
                  {farFromSaved ? <p className="mt-0.5">{c('farBody')}</p> : null}
                </div>
              )}
              {!selected && !adding ? (
                <Button type="button" variant="outline" className="mt-3 h-11 w-full rounded-full" onClick={() => setAdding(true)}>
                  <Plus className="size-4" />
                  {c('addAddress')}
                </Button>
              ) : null}
              {adding && !addresses.data?.length ? (
                <div className="mt-4 border-t border-[#f0f0ea] pt-4">
                  <AddressForm forCheckout onSaved={onSaved} />
                </div>
              ) : null}
              {selected ? (
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <Fact icon={Clock} label={c('eta')} value={validating ? null : t('customer.minuteRange', { from: Math.max(10, minutes - 5), to: minutes + 5 })} />
                  <Fact icon={MapPin} label={c('distance')} value={validating ? null : deliveryQuote?.distance ? c('km', { km: Number(deliveryQuote.distance).toFixed(1) }) : '—'} />
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-3xl border border-[#ecece6] bg-white p-4" aria-labelledby="order-items">
            <h2 id="order-items" className="font-bold">{c('items', { count: cart.data.items.reduce((sum, item) => sum + item.quantity, 0) })}</h2>
            <ul className="mt-3 divide-y divide-[#f0f0ea]">
              {(view?.items.length ? view.items : cart.data.items).map((item) => (
                <li key={item.id} className="flex gap-3 py-2.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#f2f2ef] text-xs font-bold">{item.quantity}×</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{pickLocalized(item.name, locale)}</p>
                    {[item.variantName ? pickLocalized(item.variantName, locale) : null, ...item.addons.map((addon) => pickLocalized(addon.name, locale)), item.notes]
                      .filter(Boolean)
                      .map((text, index) => (
                        <p key={index} className="text-xs text-[#6f6f6a]">{text}</p>
                      ))}
                  </div>
                  <span className="text-sm font-semibold">{formatMoney(item.lineTotal, locale)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-3 rounded-3xl border border-[#ecece6] bg-white p-4">
            <div>
              <label htmlFor="payment-method" className="font-bold">{c('payment')}</label>
              {methods.length ? (
                <select
                  id="payment-method"
                  className="mt-2 h-11 w-full rounded-xl border border-[#e6e6e0] bg-white px-3"
                  value={payment ?? ''}
                  onChange={(event) => setPayment(event.target.value as PaymentCode)}
                >
                  {methods.map((method) => (
                    <option key={method.code} value={method.code}>{pickLocalized(method.name, locale)}</option>
                  ))}
                </select>
              ) : (
                <p className="mt-2 text-sm text-[#B42318]">{e('paymentUnavailable')}</p>
              )}
            </div>
            <div>
              <label htmlFor="checkout-notes" className="font-bold">{c('notes')}</label>
              <Textarea id="checkout-notes" className="mt-2" rows={2} maxLength={500} value={notes} placeholder={c('notesPlaceholder')} onChange={(event) => setNotes(event.target.value)} />
            </div>
            {contact ? (
              <p className="flex items-center gap-2 text-sm text-[#6f6f6a]">
                <Phone className="size-4" />
                {c('contact')}: <span dir="ltr" className="font-semibold text-[#111]">{contact}</span>
              </p>
            ) : null}
          </section>
        </div>

        <aside className="mt-4 rounded-3xl border border-[#ecece6] bg-white p-5 lg:sticky lg:top-24 lg:mt-0">
          <h2 className="font-bold">{c('summary')}</h2>
          <PriceSummary pricing={pricing} quote={deliveryQuote} delivering={delivering} loading={validating || (!view && summary.isLoading)} />
          {problems.length ? (
            <ul role="alert" className="mt-4 space-y-2">
              {problems.map((problem) => (
                <li key={problem.code} className="flex gap-2 rounded-2xl bg-[#fff6d0] px-3 py-2.5 text-sm font-medium text-[#5c4700]">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {e(problemMessage(problem.code))}
                </li>
              ))}
            </ul>
          ) : null}
          {summary.isError && !view ? (
            <div role="alert" className="mt-4 rounded-2xl bg-[#fdecea] px-3 py-2.5 text-sm font-medium text-[#B42318]">
              {e(errorMessage(summary.error))}
              <button type="button" className="ms-2 underline" onClick={() => void summary.refetch()}>{c('retry')}</button>
            </div>
          ) : null}
          <div className="mt-4 hidden lg:block">{placeButton}</div>
          <p className="mt-3 text-center text-xs text-[#8d8d88]">{c('serverCheck')}</p>
        </aside>
      </div>

      <div className="fixed inset-x-4 bottom-[calc(4.65rem+max(0.7rem,env(safe-area-inset-bottom))+1.9rem)] z-40 mx-auto max-w-[640px] lg:hidden">{placeButton}</div>

      <Dialog open={picker} onOpenChange={(open) => { setPicker(open); if (!open) setAdding(false); }}>
        <DialogContent className="max-h-[92dvh] w-[min(100%-1.5rem,36rem)] overflow-y-auto p-5">
          <DialogTitle>{adding ? c('addAddress') : c('chooseAddress')}</DialogTitle>
          <DialogDescription>{adding ? c('addAddressBody') : c('chooseAddressBody')}</DialogDescription>
          {adding ? (
            <div className="mt-4">
              <AddressForm forCheckout onSaved={onSaved} onCancel={() => setAdding(false)} />
            </div>
          ) : (
            <>
              <ul className="mt-4 space-y-2">
                {(addresses.data ?? []).map((address) => (
                  <li key={address.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setAddressId(address.id);
                        setAutoPicked(null);
                        setFarFromSaved(false);
                        setPicker(false);
                        chooseAddress(address);
                      }}
                      className={cn('flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-start', address.id === addressId ? 'border-[#111] bg-[#fff6d0]' : 'border-[#e6e6e0] bg-white')}
                    >
                      <MapPin className="mt-0.5 size-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{address.label}</span>
                        <span className="block text-sm text-[#6f6f6a]">{formatAddressLine(address)}</span>
                      </span>
                      {address.id === addressId ? <Check className="size-4 shrink-0" /> : null}
                    </button>
                  </li>
                ))}
              </ul>
              <Button type="button" variant="outline" className="mt-3 h-11 w-full rounded-full" onClick={() => setAdding(true)}>
                <Plus className="size-4" />
                {c('addAddress')}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PriceSummary({ pricing, quote, delivering, loading }: { pricing: Summary['pricing']; quote: Summary['delivery']; delivering: boolean; loading: boolean }) {
  const c = useTranslations('customer.checkoutPage');
  const t = useTranslations('customer');
  const locale = useLocale() as 'en' | 'ar';
  const [open, setOpen] = useState(false);
  const money = (value: string | undefined) => (value === undefined ? '—' : formatMoney(value, locale));
  const breakdown = useMemo(() => {
    const summary = quote?.summary;
    if (!quote?.available || !summary) return null;
    return summary;
  }, [quote]);
  if (!pricing) {
    return (
      <div className="mt-3 space-y-2" aria-busy>
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-5 w-full" />)}
      </div>
    );
  }
  const itemsTax = (Number(pricing.tax) - Number(pricing.deliveryTax ?? 0)).toFixed(3);
  return (
    <dl className={cn('mt-3 space-y-2 text-sm', loading && 'opacity-60')} aria-busy={loading}>
      <Line label={t('subtotal')} value={money(pricing.subtotal)} />
      {Number(pricing.discount) > 0 ? <Line label={pricing.promoCode ? c('promo', { code: pricing.promoCode }) : t('discount')} value={`− ${money(pricing.discount)}`} tone="good" /> : null}
      {delivering ? (
        <div>
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-1">
              {t('deliveryFee')}
              {breakdown ? (
                <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="inline-flex items-center text-xs font-semibold text-[#8a6d00]">
                  {c('howCalculated')}
                  <ChevronDown className={cn('size-3.5 transition', open && 'rotate-180')} />
                </button>
              ) : null}
            </dt>
            <dd className="font-semibold">
              {loading ? <Spinner className="inline size-3.5" /> : Number(pricing.deliveryFee) === 0 && quote?.available ? <span className="text-[#1c9a4b]">{t('free')}</span> : money(pricing.deliveryFee)}
            </dd>
          </div>
          {open && breakdown && quote ? (
            <ul className="mt-2 space-y-1 rounded-2xl bg-[#f7f7f5] px-3 py-2 text-xs text-[#4b4b47]">
              <li>{c('breakdownDistance', { km: Number(quote.distance ?? 0).toFixed(2), method: breakdown.method === 'ROAD' ? c('roadDistance') : c('straightDistance') })}</li>
              {Number(breakdown.freeRadiusKm) > 0 ? <li>{c('breakdownFree', { km: Number(breakdown.freeRadiusKm).toString() })}</li> : null}
              {Number(breakdown.baseCharge) > 0 ? <li>{c('breakdownBase', { fee: money(breakdown.baseCharge) })}</li> : null}
              {breakdown.billingUnits > 0 ? (
                <li>{c('breakdownSteps', { km: Number(breakdown.chargeableKm).toFixed(2), units: breakdown.billingUnits, step: Number(breakdown.billingStepKm).toString(), rate: money(breakdown.ratePerStep) })}</li>
              ) : null}
              {quote.freeDelivery ? <li className="font-semibold text-[#1c9a4b]">{c(`freeReason.${quote.freeReason ?? 'WITHIN_FREE_RADIUS'}`)}</li> : null}
              {/* The platform-wide minimum-order rule can still waive a charged quote. */}
              {!quote.freeDelivery && Number(pricing.deliveryFeeSaved) > 0 ? (
                <li className="font-semibold text-[#1c9a4b]">{c('waived', { fee: money(pricing.deliveryFeeSaved) })}</li>
              ) : null}
              {!quote.freeDelivery && Number(pricing.deliveryFeeSaved) === 0 && quote.freeAboveOrder ? <li>{c('freeAbove', { amount: money(quote.freeAboveOrder) })}</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
      {Number(pricing.serviceFee) > 0 ? <Line label={pricing.serviceFeeLabel ? pickLocalized(pricing.serviceFeeLabel, locale) : t('serviceFee')} value={money(pricing.serviceFee)} /> : null}
      {Number(itemsTax) > 0 ? <Line label={pricing.taxLabel ? pickLocalized(pricing.taxLabel, locale) : t('tax')} value={money(itemsTax)} /> : null}
      {Number(pricing.deliveryTax ?? 0) > 0 ? <Line label={c('deliveryTax')} value={money(pricing.deliveryTax)} /> : null}
      <div className="flex items-center justify-between gap-3 border-t border-[#f0f0ea] pt-3 text-base">
        <dt className="font-bold">{c('payable')}</dt>
        <dd className="font-bold">{loading ? <Spinner className="inline size-4" /> : money(pricing.total)}</dd>
      </div>
    </dl>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: 'good' }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[#4b4b47]">{label}</dt>
      <dd className={cn('font-semibold', tone === 'good' && 'text-[#1c9a4b]')}>{value}</dd>
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-[#f7f7f5] px-3 py-2">
      <Icon className="size-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-[#6f6f6a]">{label}</p>
        <p className="truncate font-semibold">{value ?? <Spinner className="inline size-3.5" />}</p>
      </div>
    </div>
  );
}

function formatAddressLine(address: Address) {
  return [address.line1, address.area, address.city].filter((part, index, list) => part && list.indexOf(part) === index).join(', ');
}

function CheckoutSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <Skeleton className="h-9 w-40" />
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_23rem] lg:gap-6">
        <div className="space-y-4">
          <Skeleton className="h-20 rounded-3xl" />
          <Skeleton className="h-36 rounded-3xl" />
          <Skeleton className="h-48 rounded-3xl" />
        </div>
        <Skeleton className="mt-4 h-72 rounded-3xl lg:mt-0" />
      </div>
    </div>
  );
}
