import type { EditableOptionGroup, ProductOptionEditor } from '@alliva/types';
import type { Prisma, PrismaClient } from '@prisma/client';
import { badRequest } from '../common/errors';
import { dec, loc } from '../common/crypto';

type Db = PrismaClient | Prisma.TransactionClient;

export type ProductOptionGroupsBody = {
  kind: 'STANDARD' | 'COMBO';
  groups: {
    id?: string;
    name: { en: string; ar: string };
    minSelect: number;
    maxSelect: number;
    options: { id?: string; name: { en: string; ar: string }; price: string; available: boolean; productId?: string | null }[];
  }[];
  variants?: { id?: string; name: { en: string; ar: string }; price: string; available: boolean }[];
};

const groupInclude = {
  addons: { orderBy: { sortOrder: 'asc' } },
  _count: { select: { products: true } },
} as const;

type GroupRow = Prisma.AddonGroupGetPayload<{ include: typeof groupInclude }>;

function presentGroup(group: GroupRow, linkedHere: boolean): EditableOptionGroup {
  return {
    id: group.id,
    name: loc(group.name),
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    sharedWith: group._count.products - (linkedHere ? 1 : 0),
    options: group.addons.map((addon) => ({ id: addon.id, name: loc(addon.name), price: dec(addon.price), available: addon.available, productId: addon.productId })),
  };
}

export async function readProductOptionGroups(db: Db, merchantId: string, productId: string): Promise<ProductOptionEditor> {
  const product = await db.product.findFirst({
    where: { id: productId, merchantId, deletedAt: null },
    include: {
      addonGroups: { orderBy: { sortOrder: 'asc' }, include: { addonGroup: { include: groupInclude } } },
      variants: { orderBy: [{ price: 'asc' }, { createdAt: 'asc' }] },
    },
  });
  if (!product) throw badRequest('Product not found');
  return {
    kind: product.kind,
    groups: product.addonGroups.map((link) => presentGroup(link.addonGroup, true)),
    variants: product.variants.map((variant) => ({ id: variant.id, name: loc(variant.name), price: dec(variant.price), available: variant.available })),
  };
}

/** Option groups a merchant can reuse on another product. Combo slots are left out: they belong to one combo. */
export async function optionGroupLibrary(db: Db, merchantId: string): Promise<EditableOptionGroup[]> {
  const groups = await db.addonGroup.findMany({
    where: { merchantId, products: { some: {} }, addons: { none: { productId: { not: null } } } },
    include: groupInclude,
    orderBy: { createdAt: 'asc' },
  });
  return groups.map((group) => presentGroup(group, false));
}

/**
 * Saves the whole list of groups for one product. Existing options are updated in place so carts holding them
 * keep working; groups this product drops are unlinked, and deleted once no product uses them.
 */
export async function saveProductOptionGroups(db: PrismaClient, merchantId: string, productId: string, body: ProductOptionGroupsBody) {
  const product = await db.product.findFirst({ where: { id: productId, merchantId, deletedAt: null } });
  if (!product) throw badRequest('Product not found');
  const combo = body.kind === 'COMBO';
  const itemIds = [...new Set(body.groups.flatMap((group) => group.options.map((option) => option.productId).filter((id): id is string => Boolean(id))))];
  if (!combo && itemIds.length) throw badRequest('Only combos can include other products');
  if (combo && product.kind !== 'COMBO') {
    const usedInCombo = await db.addon.count({ where: { productId, merchantId } });
    if (usedInCombo) throw badRequest('This product is part of a combo, so it cannot become a combo itself');
  }
  const items = itemIds.length
    ? await db.product.findMany({ where: { id: { in: itemIds }, merchantId, deletedAt: null }, select: { id: true, name: true, kind: true } })
    : [];
  if (items.length !== itemIds.length) throw badRequest('A combo item is not one of your products');
  if (items.some((item) => item.id === productId || item.kind === 'COMBO')) throw badRequest('A combo cannot contain itself or another combo');
  const itemName = new Map(items.map((item) => [item.id, loc(item.name)]));
  // Combos are priced as a whole, so they have no sizes.
  const variants = combo ? [] : body.variants;
  const live = variants?.filter((variant) => variant.available) ?? [];
  if (variants?.length && !live.length) throw badRequest('Keep at least one size available');

  await db.$transaction(async (tx) => {
    const before = await tx.productAddonGroup.findMany({ where: { productId }, select: { addonGroupId: true } });
    const keep = new Set<string>();
    for (const [index, input] of body.groups.entries()) {
      const found = input.id
        ? await tx.addonGroup.findFirst({ where: { id: input.id, merchantId }, include: { addons: true, products: { select: { productId: true } } } })
        : null;
      // Combo slots belong to one combo, and shared option groups never hold combo items.
      const owned = found && (combo ? found.products.every((link) => link.productId === productId) : found.addons.every((addon) => !addon.productId)) ? found : null;
      const data = { name: input.name, minSelect: input.minSelect, maxSelect: input.maxSelect, sortOrder: index };
      const group = owned ? await tx.addonGroup.update({ where: { id: owned.id }, data }) : await tx.addonGroup.create({ data: { ...data, merchantId } });
      const existing = new Set((owned?.addons ?? []).map((addon) => addon.id));
      const kept = new Set<string>();
      for (const [position, option] of input.options.entries()) {
        const linked = combo ? option.productId ?? null : null;
        const values = {
          name: linked ? itemName.get(linked)! : option.name,
          price: option.price,
          available: option.available,
          sortOrder: position,
          productId: linked,
        };
        if (option.id && existing.has(option.id)) {
          await tx.addon.update({ where: { id: option.id }, data: values });
          kept.add(option.id);
        } else {
          await tx.addon.create({ data: { ...values, groupId: group.id, merchantId } });
        }
      }
      const dropped = [...existing].filter((id) => !kept.has(id));
      if (dropped.length) await tx.addon.deleteMany({ where: { id: { in: dropped } } });
      await tx.productAddonGroup.upsert({
        where: { productId_addonGroupId: { productId, addonGroupId: group.id } },
        update: { sortOrder: index },
        create: { productId, addonGroupId: group.id, sortOrder: index },
      });
      keep.add(group.id);
    }
    const unlinked = before.map((link) => link.addonGroupId).filter((id) => !keep.has(id));
    if (unlinked.length) {
      await tx.productAddonGroup.deleteMany({ where: { productId, addonGroupId: { in: unlinked } } });
      await tx.addonGroup.deleteMany({ where: { id: { in: unlinked }, merchantId, products: { none: {} } } });
    }
    if (variants) {
      const existing = new Set((await tx.productVariant.findMany({ where: { productId }, select: { id: true } })).map((row) => row.id));
      const kept = new Set<string>();
      for (const variant of variants) {
        const values = { name: variant.name, price: variant.price, available: variant.available };
        if (variant.id && existing.has(variant.id)) {
          await tx.productVariant.update({ where: { id: variant.id }, data: values });
          kept.add(variant.id);
        } else {
          await tx.productVariant.create({ data: { ...values, productId, merchantId } });
        }
      }
      const dropped = [...existing].filter((id) => !kept.has(id));
      if (dropped.length) await tx.productVariant.deleteMany({ where: { id: { in: dropped } } });
    }
    // With sizes, the menu shows the cheapest size's price as the product's price.
    const from = live.length ? live.reduce((low, variant) => (Number(variant.price) < Number(low) ? variant.price : low), live[0]!.price) : undefined;
    await tx.product.update({ where: { id: productId }, data: { kind: body.kind, price: from } });
  });
  return readProductOptionGroups(db, merchantId, productId);
}
