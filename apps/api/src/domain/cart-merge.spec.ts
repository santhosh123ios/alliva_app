import { mergeLineKey, nearestAddress, planCartMerge, type MergeCart, type MergeLine } from './cart-merge';

const line = (id: string, patch: Partial<MergeLine> = {}): MergeLine => ({
  id,
  productId: 'burger',
  variantId: null,
  notes: null,
  quantity: 1,
  addonIds: [],
  ...patch,
});

const cart = (id: string, merchantId: string | null, items: MergeLine[]): MergeCart => ({ id, merchantId, items });

describe('guest cart merge', () => {
  it('keeps the customer cart when the guest cart is empty or missing', () => {
    expect(planCartMerge(null, cart('c', 'm1', [line('a')]))).toEqual({ kind: 'KEEP_CUSTOMER' });
    expect(planCartMerge(cart('g', 'm1', []), cart('c', 'm1', [line('a')]))).toEqual({ kind: 'KEEP_CUSTOMER' });
  });

  it('adopts the guest cart when the customer has none', () => {
    expect(planCartMerge(cart('g', 'm1', [line('a')]), null)).toEqual({ kind: 'ADOPT_GUEST', dropCustomerCartId: null });
  });

  it('replaces an older cart from another store instead of losing the guest cart', () => {
    expect(planCartMerge(cart('g', 'm2', [line('a')]), cart('c', 'm1', [line('b')]))).toEqual({ kind: 'ADOPT_GUEST', dropCustomerCartId: 'c' });
  });

  it('replaces an empty customer cart', () => {
    expect(planCartMerge(cart('g', 'm1', [line('a')]), cart('c', null, []))).toEqual({ kind: 'ADOPT_GUEST', dropCustomerCartId: 'c' });
  });

  it('does not duplicate a line that exists in both carts', () => {
    const plan = planCartMerge(
      cart('g', 'm1', [line('g1', { quantity: 3 }), line('g2', { productId: 'fries', quantity: 1 })]),
      cart('c', 'm1', [line('c1', { quantity: 2 })]),
    );
    expect(plan).toEqual({
      kind: 'COMBINE',
      updates: [{ id: 'c1', quantity: 3 }],
      copies: [line('g2', { productId: 'fries', quantity: 1 })],
    });
  });

  it('keeps the customer quantity when it is already larger', () => {
    const plan = planCartMerge(cart('g', 'm1', [line('g1', { quantity: 1 })]), cart('c', 'm1', [line('c1', { quantity: 4 })]));
    expect(plan).toEqual({ kind: 'COMBINE', updates: [], copies: [] });
  });

  it('treats different variants, add-ons and notes as different lines', () => {
    const plan = planCartMerge(
      cart('g', 'm1', [
        line('g1', { variantId: 'large' }),
        line('g2', { addonIds: ['cheese'] }),
        line('g3', { notes: 'no onion' }),
      ]),
      cart('c', 'm1', [line('c1')]),
    );
    expect(plan.kind).toBe('COMBINE');
    if (plan.kind === 'COMBINE') expect(plan.copies.map((copy) => copy.id)).toEqual(['g1', 'g2', 'g3']);
  });

  it('matches add-ons regardless of order and notes regardless of spacing', () => {
    expect(mergeLineKey(line('x', { addonIds: ['b', 'a'], notes: ' hot ' }))).toBe(mergeLineKey(line('y', { addonIds: ['a', 'b'], notes: 'hot' })));
  });
});

describe('nearest saved address', () => {
  const addresses = [
    { id: 'home', latitude: 0, longitude: 0, km: 0.2 },
    { id: 'work', latitude: 0, longitude: 0, km: 5 },
  ];

  it('returns the closest address inside the limit', () => {
    expect(nearestAddress(addresses, (row) => row.km, 0.5)?.address.id).toBe('home');
  });

  it('returns nothing when every saved address is too far away', () => {
    expect(nearestAddress(addresses, (row) => row.km + 1, 0.5)).toBeNull();
    expect(nearestAddress([], () => 0, 0.5)).toBeNull();
  });
});
