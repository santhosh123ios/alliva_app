import { api } from '@/components/providers';
import type { QueryClient } from '@tanstack/react-query';

export type CartSnapshot = Awaited<ReturnType<typeof api.cart>>;

export const cartQueryKey = ['cart'] as const;

type CartChange = (cart: CartSnapshot) => CartSnapshot;

let nextId = 0;
const pending = new Map<number, CartChange>();
let base: CartSnapshot | undefined;
let newestServer: { id: number; view: CartSnapshot } | null = null;

export function cartQueryOptions() {
  return {
    queryKey: cartQueryKey,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchCart(signal),
    retry: false as const,
  };
}

export async function fetchCart(signal?: AbortSignal) {
  const view = await api.cart();
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  return view;
}

export function cartChangesPending() {
  return pending.size > 0;
}

export function optimisticLine(id: string) {
  return id.startsWith('optimistic:');
}

export function beginCartChange(client: QueryClient, change: CartChange) {
  void client.cancelQueries({ queryKey: cartQueryKey });
  const current = client.getQueryData<CartSnapshot>(cartQueryKey);
  if (pending.size === 0) {
    base = current;
    newestServer = null;
  }
  const id = ++nextId;
  pending.set(id, change);
  const start = current ?? base;
  if (start) client.setQueryData<CartSnapshot>(cartQueryKey, change(start));
  return id;
}

export function settleCartChange(client: QueryClient, id: number, view: CartSnapshot) {
  pending.delete(id);
  if (!newestServer || id >= newestServer.id) newestServer = { id, view };
  const oldest = pending.size ? Math.min(...pending.keys()) : Infinity;
  if (oldest < id) return;
  client.setQueryData(cartQueryKey, applyPending(newestServer.view));
  if (pending.size === 0) {
    base = undefined;
    newestServer = null;
  }
}

export function failCartChange(client: QueryClient, id: number) {
  pending.delete(id);
  const start = newestServer?.view ?? base;
  if (start) client.setQueryData(cartQueryKey, applyPending(start));
  else if (pending.size) client.setQueryData(cartQueryKey, applyPending(emptyCart()));
  if (pending.size === 0) {
    const missing = !base && !newestServer;
    base = undefined;
    newestServer = null;
    if (missing) void client.invalidateQueries({ queryKey: cartQueryKey });
  }
}

export type CartAddInput = {
  productId: string;
  variantId?: string | null;
  addonIds?: string[];
  quantity: number;
  notes?: string;
  replace?: boolean;
  merchantId?: string;
  preview?: {
    name?: { en?: string; ar?: string };
    description?: { en?: string; ar?: string };
    imageUrl?: string | null;
    unitPrice?: string;
    addons?: { id: string; name?: { en?: string; ar?: string }; price: string }[];
  };
};

export function bumpCart(cart: CartSnapshot, input: CartAddInput): CartSnapshot {
  const quantity = input.quantity;
  const variantId = input.variantId || null;
  const notes = input.notes?.trim() || null;
  const addonIds = [...new Set(input.addonIds ?? [])].sort();
  const addons = addonIds.map((id) => {
    const known = input.preview?.addons?.find((addon) => addon.id === id);
    return { id, name: text(known?.name), price: known?.price ?? '0.000' };
  });
  const key = lineKey({ productId: input.productId, variantId, notes, addons });
  const source = input.replace ? [] : cart.items;
  const index = source.findIndex((item) => lineKey(item) === key);
  const unit = input.preview?.unitPrice ?? (index >= 0 ? source[index]!.unitPrice : '0.000');
  const items =
    index >= 0
      ? source.map((item, itemIndex) =>
          itemIndex === index
            ? { ...item, quantity: item.quantity + quantity, lineTotal: money(Number(item.unitPrice) * (item.quantity + quantity)) }
            : item,
        )
      : [
          ...source,
          {
            id: `optimistic:${input.productId}:${variantId ?? ''}:${notes ?? ''}:${addonIds.join(',')}`,
            productId: input.productId,
            variantId,
            name: text(input.preview?.name),
            description: text(input.preview?.description),
            imageUrl: input.preview?.imageUrl ?? null,
            variantName: null,
            variants: [],
            customizable: addonIds.length > 0 || Boolean(notes),
            quantity,
            unitPrice: unit,
            lineTotal: money(Number(unit) * quantity),
            addons,
            notes,
          },
        ];
  const delta = Number(unit) * quantity;
  const switched = Boolean(input.replace && input.merchantId && cart.merchant?.id !== input.merchantId);
  return {
    ...cart,
    merchant: switched ? null : cart.merchant,
    items,
    notes: input.replace ? null : cart.notes,
    pricing: {
      ...cart.pricing,
      subtotal: addMoney(input.replace ? '0.000' : cart.pricing.subtotal, delta),
      total: addMoney(input.replace ? '0.000' : cart.pricing.total, delta),
      discount: input.replace ? '0.000' : cart.pricing.discount,
      promoCode: input.replace ? null : cart.pricing.promoCode,
    },
  };
}

export function setLineQuantity(cart: CartSnapshot, id: string, quantity: number, variantId?: string | null): CartSnapshot {
  const current = cart.items.find((item) => item.id === id);
  if (!current) return cart;
  const nextQuantity = quantity < 1 ? 0 : quantity;
  const delta = Number(current.unitPrice) * (nextQuantity - current.quantity);
  return {
    ...cart,
    items:
      nextQuantity < 1
        ? cart.items.filter((item) => item.id !== id)
        : cart.items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  quantity: nextQuantity,
                  variantId: variantId === undefined ? item.variantId : variantId,
                  lineTotal: money(Number(item.unitPrice) * nextQuantity),
                }
              : item,
          ),
    pricing: {
      ...cart.pricing,
      subtotal: addMoney(cart.pricing.subtotal, delta),
      total: addMoney(cart.pricing.total, delta),
    },
  };
}

export function clearCartLines(cart: CartSnapshot): CartSnapshot {
  return {
    ...cart,
    items: [],
    pricing: { ...cart.pricing, subtotal: '0.000', discount: '0.000', total: '0.000', promoCode: null },
  };
}

function applyPending(start: CartSnapshot) {
  let next = start;
  for (const [, change] of [...pending.entries()].sort((a, b) => a[0] - b[0])) next = change(next);
  return next;
}

function emptyCart(): CartSnapshot {
  const zero = '0.000';
  return {
    id: '',
    merchant: null,
    fulfillmentType: null,
    items: [],
    pricing: {
      subtotal: zero,
      discount: zero,
      deliveryFee: zero,
      deliveryFeeSaved: zero,
      serviceFee: zero,
      tax: zero,
      total: zero,
      currency: 'BHD',
      promoCode: null,
    },
    notes: null,
    scheduledFor: null,
    addressId: null,
    tableId: null,
    paymentMethods: [],
  };
}

function lineKey(item: { productId: string; variantId: string | null; notes: string | null; addons: { id: string }[] }) {
  return [item.productId, item.variantId ?? '', item.notes?.trim() || '', item.addons.map((addon) => addon.id).sort().join(',')].join('|');
}

function text(value?: { en?: string; ar?: string }) {
  return { en: value?.en ?? '', ar: value?.ar ?? '' };
}

function money(amount: number) {
  return Number.isFinite(amount) ? amount.toFixed(3) : '0.000';
}

function addMoney(current: string, delta: number) {
  const next = Number(current) + delta;
  return Number.isFinite(next) ? next.toFixed(3) : current;
}
