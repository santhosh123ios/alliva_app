/** One option group (or combo slot) on a product, in display order, as the pricing rules see it. */
export type OptionRule = {
  id: string;
  minSelect: number;
  maxSelect: number;
  options: { id: string; usable: boolean }[];
};

/** A group the diner cannot change: every option is required, like the burger in a burger meal. */
export function isFixedGroup(group: { minSelect: number; options: unknown[] }) {
  return group.options.length > 0 && group.minSelect >= group.options.length;
}

/** Whether every required group still has enough options that can be ordered. */
export function canFulfil(groups: OptionRule[]) {
  return groups.every((group) => group.options.filter((option) => option.usable).length >= group.minSelect);
}

/**
 * Checks a diner's picks against the product's groups and returns them in display order.
 * Options in fixed groups are always included, so clients need not send them.
 */
export function resolveSelections(groups: OptionRule[], chosen: string[]): { ids: string[] } | { error: string } {
  const wanted = new Set(chosen);
  const known = new Set(groups.flatMap((group) => group.options.map((option) => option.id)));
  if ([...wanted].some((id) => !known.has(id))) return { error: 'An option you picked is no longer offered' };
  const ids: string[] = [];
  for (const group of groups) {
    const picked = isFixedGroup(group) ? group.options : group.options.filter((option) => wanted.has(option.id));
    if (picked.some((option) => !option.usable)) return { error: 'An option you picked is unavailable' };
    if (picked.length < group.minSelect) return { error: 'Choose the required options first' };
    if (picked.length > Math.max(group.maxSelect, group.minSelect)) return { error: 'Too many options picked' };
    ids.push(...picked.map((option) => option.id));
  }
  return { ids };
}
