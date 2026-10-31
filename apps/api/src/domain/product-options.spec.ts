import { canFulfil, isFixedGroup, resolveSelections, type OptionRule } from './product-options';

const group = (id: string, minSelect: number, maxSelect: number, options: string[], unusable: string[] = []): OptionRule => ({
  id,
  minSelect,
  maxSelect,
  options: options.map((option) => ({ id: option, usable: !unusable.includes(option) })),
});

describe('product options', () => {
  const meal = [group('main', 1, 1, ['burger']), group('side', 1, 1, ['fries', 'salad']), group('extras', 0, 2, ['cheese', 'bacon', 'egg'])];

  it('treats a group whose every option is required as fixed', () => {
    expect(isFixedGroup(meal[0]!)).toBe(true);
    expect(isFixedGroup(meal[1]!)).toBe(false);
  });

  it('adds fixed items and returns picks in display order', () => {
    expect(resolveSelections(meal, ['cheese', 'salad'])).toEqual({ ids: ['burger', 'salad', 'cheese'] });
  });

  it('rejects missing required picks, too many picks and unknown options', () => {
    expect(resolveSelections(meal, [])).toEqual({ error: 'Choose the required options first' });
    expect(resolveSelections(meal, ['fries', 'cheese', 'bacon', 'egg'])).toEqual({ error: 'Too many options picked' });
    expect(resolveSelections(meal, ['fries', 'salad'])).toEqual({ error: 'Too many options picked' });
    expect(resolveSelections(meal, ['fries', 'ghost'])).toEqual({ error: 'An option you picked is no longer offered' });
  });

  it('rejects unavailable picks and flags combos that cannot be made', () => {
    const soldOut = [group('main', 1, 1, ['burger'], ['burger']), group('side', 1, 1, ['fries', 'salad'], ['fries'])];
    expect(resolveSelections(soldOut, ['salad'])).toEqual({ error: 'An option you picked is unavailable' });
    expect(canFulfil(soldOut)).toBe(false);
    expect(canFulfil(meal)).toBe(true);
  });
});
