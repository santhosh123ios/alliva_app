import { dec, loc } from '../common/crypto';
import { canFulfil, isFixedGroup, resolveSelections, type OptionRule } from '../domain/product-options';

/** Prisma include for a product's option groups and combo slots, in the order the merchant set. */
export const optionGroupsInclude = {
  orderBy: { sortOrder: 'asc' },
  include: {
    addonGroup: {
      include: {
        addons: {
          orderBy: { sortOrder: 'asc' },
          include: {
            product: {
              select: { id: true, name: true, imageUrl: true, price: true, available: true, deletedAt: true, approvalStatus: true, inventory: { select: { quantity: true } } },
            },
          },
        },
      },
    },
  },
} as const;

type LinkedProduct = {
  id: string;
  name: unknown;
  imageUrl: string | null;
  available: boolean;
  deletedAt: Date | null;
  approvalStatus: string;
  inventory: { quantity: number }[];
};

export type OptionGroupLink = {
  addonGroup: {
    id: string;
    name: unknown;
    minSelect: number;
    maxSelect: number;
    addons: { id: string; name: unknown; price: { toFixed(digits: number): string }; available: boolean; productId: string | null; product: LinkedProduct | null }[];
  };
};

/** A combo item can be ordered while its product is live and in stock. */
export function linkedProductUsable(product: LinkedProduct) {
  const stock = product.inventory.length ? product.inventory.reduce((sum, row) => sum + row.quantity, 0) : 1;
  return product.available && !product.deletedAt && product.approvalStatus === 'APPROVED' && stock > 0;
}

/** The groups as diners and staff see them; combo options carry their product's live name and photo. */
export function presentOptionGroups(links: OptionGroupLink[]) {
  return links.map(({ addonGroup: group }) => {
    const addons = group.addons.map((addon) => ({
      id: addon.id,
      name: addon.product ? loc(addon.product.name) : loc(addon.name),
      price: dec(addon.price),
      available: addon.available && (!addon.product || linkedProductUsable(addon.product)),
      productId: addon.productId,
      imageUrl: addon.product?.imageUrl ?? null,
    }));
    return {
      id: group.id,
      name: loc(group.name),
      minSelect: group.minSelect,
      maxSelect: Math.max(group.maxSelect, group.minSelect),
      fixed: isFixedGroup({ minSelect: group.minSelect, options: addons }),
      addons,
    };
  });
}

export function optionRules(links: OptionGroupLink[]): OptionRule[] {
  return presentOptionGroups(links).map((group) => ({
    id: group.id,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    options: group.addons.map((addon) => ({ id: addon.id, usable: addon.available })),
  }));
}

export function optionsFulfillable(links: OptionGroupLink[]) {
  return canFulfil(optionRules(links));
}

/** Picks in display order with fixed combo items filled in, or throws the reason they cannot be ordered. */
export function checkedSelections(links: OptionGroupLink[], chosen: string[], fail: (message: string) => Error) {
  const result = resolveSelections(optionRules(links), chosen);
  if ('error' in result) throw fail(result.error);
  return result.ids;
}
