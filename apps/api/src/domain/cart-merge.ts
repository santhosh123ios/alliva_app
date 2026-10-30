export type MergeLine = { id: string; productId: string; variantId: string | null; notes: string | null; quantity: number; addonIds: string[] };

export type MergeCart = { id: string; merchantId: string | null; items: MergeLine[] };

export type CartMergePlan =
  | { kind: 'KEEP_CUSTOMER' }
  | { kind: 'ADOPT_GUEST'; dropCustomerCartId: string | null }
  | { kind: 'COMBINE'; updates: { id: string; quantity: number }[]; copies: MergeLine[] };

/** Same product, variant, add-ons and note: the merge treats these as one line. */
export function mergeLineKey(line: { productId: string; variantId: string | null; notes: string | null; addonIds: string[] }) {
  return [line.productId, line.variantId ?? '', line.notes?.trim() || '', [...new Set(line.addonIds)].sort().join(',')].join('|');
}

/**
 * Decide how a guest cart joins the signed-in customer's cart.
 * The guest cart is what the customer just built, so it wins whenever the two carts disagree on the store.
 * A line in both carts keeps the larger quantity instead of adding them, so signing in never doubles an order.
 */
export function planCartMerge(guest: MergeCart | null, customer: MergeCart | null): CartMergePlan {
  if (!guest || !guest.items.length) return { kind: 'KEEP_CUSTOMER' };
  if (!customer) return { kind: 'ADOPT_GUEST', dropCustomerCartId: null };
  if (!customer.items.length || customer.merchantId !== guest.merchantId) return { kind: 'ADOPT_GUEST', dropCustomerCartId: customer.id };
  const existing = new Map<string, MergeLine>();
  for (const line of customer.items) {
    const key = mergeLineKey(line);
    const seen = existing.get(key);
    // Collapse duplicates already sitting in the customer cart.
    existing.set(key, seen ? { ...seen, quantity: Math.max(seen.quantity, line.quantity) } : line);
  }
  const updates = new Map<string, number>();
  const copies = new Map<string, MergeLine>();
  for (const line of guest.items) {
    const key = mergeLineKey(line);
    const match = existing.get(key);
    if (match) {
      const quantity = Math.max(match.quantity, line.quantity, updates.get(match.id) ?? 0);
      if (quantity !== match.quantity) updates.set(match.id, quantity);
      continue;
    }
    const copy = copies.get(key);
    copies.set(key, copy ? { ...copy, quantity: Math.max(copy.quantity, line.quantity) } : line);
  }
  return {
    kind: 'COMBINE',
    updates: [...updates.entries()].map(([id, quantity]) => ({ id, quantity })),
    copies: [...copies.values()],
  };
}

/** Pick the saved address closest to where the customer is, if it is close enough to trust. */
export function nearestAddress<T extends { latitude: number; longitude: number }>(
  addresses: T[],
  distanceKm: (address: T) => number,
  maxKm: number,
): { address: T; distanceKm: number } | null {
  let best: { address: T; distanceKm: number } | null = null;
  for (const address of addresses) {
    const km = distanceKm(address);
    if (!Number.isFinite(km)) continue;
    if (!best || km < best.distanceKm) best = { address, distanceKm: km };
  }
  return best && best.distanceKm <= maxKm ? best : null;
}
