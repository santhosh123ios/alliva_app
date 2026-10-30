import type { Prisma, PrismaClient } from '@prisma/client';
import { productImportRowSchema, type ProductImportRow } from '@alliva/validation';
import { loc } from '../common/crypto';
import { badRequest } from '../common/errors';
import { resolveMerchantCategory } from './catalog-categories';
import { resolveCatalogProduct } from './catalog-products';
import type { PlatformService } from './platform.service';

type ImportRow = { row: number; data: ProductImportRow };
type Named = { en: string; ar: string };
type Match = { id: string; name: Named; description: Named };

export async function importCatalogProducts(
  prisma: PrismaClient,
  platform: PlatformService,
  user: { id: string; merchantId: string },
  rawRows: unknown[],
) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) throw badRequest('Upload at least one product');
  if (rawRows.length > 500) throw badRequest('Upload 500 products or fewer at a time');

  const errors: { row: number; message: string }[] = [];
  const valid: ImportRow[] = [];
  rawRows.forEach((raw, index) => {
    const row = rowNumber(raw, index);
    const parsed = productImportRowSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({ row, message: parsed.error.issues[0]?.message ?? 'Invalid row' });
      return;
    }
    valid.push({ row, data: parsed.data });
  });
  if (!valid.length) throw badRequest(errors[0]?.message ?? 'No valid product rows');

  const branch = await prisma.branch.findFirst({ where: { merchantId: user.merchantId } });
  if (!branch) throw badRequest('Create a branch first');

  const existing = await prisma.product.findMany({
    where: { merchantId: user.merchantId },
    select: { name: true, deletedAt: true },
  });
  const known = new Set<string>();
  for (const product of existing) {
    if (product.deletedAt) continue;
    const name = loc(product.name);
    if (name.en) known.add(nameKey(name.en));
    if (name.ar) known.add(nameKey(name.ar));
  }
  const creating = new Set<string>();
  for (const item of valid) {
    const english = nameKey(item.data.name);
    const arabic = item.data.nameAr ? nameKey(item.data.nameAr) : '';
    if (known.has(english) || (arabic && known.has(arabic)) || creating.has(english)) continue;
    creating.add(english);
  }
  if (creating.size) await platform.assertMerchantLimit(user.merchantId, 'productLimit', creating.size);

  return prisma.$transaction(async (tx) => {
    const categories = await tx.productCategory.findMany({ where: { merchantId: user.merchantId, deletedAt: null } });
    const categoryByName = new Map<string, string>();
    for (const category of categories) {
      const name = loc(category.name);
      if (name.en) categoryByName.set(nameKey(name.en), category.id);
      if (name.ar) categoryByName.set(nameKey(name.ar), category.id);
    }

    const products = await tx.product.findMany({
      where: { merchantId: user.merchantId },
      select: { id: true, slug: true, name: true, description: true, deletedAt: true },
    });
    const taken = new Set(products.map((product) => product.slug));
    const byName = new Map<string, Match>();
    for (const product of products) {
      if (product.deletedAt) continue;
      remember(byName, { id: product.id, name: loc(product.name), description: loc(product.description) });
    }

    let created = 0;
    let updated = 0;
    let nextSort = categories.length;
    for (const item of valid) {
      const categoryId = await categoryIdFor(tx, user.merchantId, item.data.category, categoryByName, () => nextSort++);
      const state = inventoryFromImport(item.data);
      const match = byName.get(nameKey(item.data.name)) ?? (item.data.nameAr ? byName.get(nameKey(item.data.nameAr)) : undefined);
      const name = { en: item.data.name, ar: item.data.nameAr || match?.name.ar || item.data.name };
      const description = copyFor(item.data, match);
      const central = await resolveCatalogProduct(tx, { merchantId: user.merchantId, name, description });
      const canonicalName = loc(central.name);
      const canonicalDescription = loc(central.description);
      if (match) {
        await tx.product.update({
          where: { id: match.id },
          data: {
            categoryId,
            catalogProductId: central.id,
            name: canonicalName,
            description: canonicalDescription,
            price: item.data.price,
            available: state.available,
            approvalStatus: state.approvalStatus,
            updatedById: user.id,
          },
        });
        await setStock(tx, user.merchantId, branch.id, match.id, state.stockQuantity);
        match.name = canonicalName;
        match.description = canonicalDescription;
        remember(byName, match);
        updated += 1;
        continue;
      }
      const product = await tx.product.create({
        data: {
          merchantId: user.merchantId,
          catalogProductId: central.id,
          categoryId,
          slug: uniqueSlug(canonicalName.en, taken),
          name: canonicalName,
          description: canonicalDescription,
          price: item.data.price,
          available: state.available,
          approvalStatus: state.approvalStatus,
          createdById: user.id,
          inventory: { create: { merchantId: user.merchantId, branchId: branch.id, quantity: state.stockQuantity, lowStockThreshold: 5 } },
        },
        select: { id: true },
      });
      remember(byName, { id: product.id, name: canonicalName, description: canonicalDescription });
      created += 1;
    }
    return { created, updated, errors };
  }, { timeout: 20_000 });
}

function inventoryFromImport(row: ProductImportRow) {
  if (row.status === 'draft') return { approvalStatus: 'DRAFT' as const, available: false, stockQuantity: row.stock ?? 0 };
  if (row.status === 'out' || row.stock === 0) return { approvalStatus: 'APPROVED' as const, available: false, stockQuantity: 0 };
  return { approvalStatus: 'APPROVED' as const, available: true, stockQuantity: row.stock ?? 20 };
}

function copyFor(row: ProductImportRow, match: Match | undefined): Named {
  if (match) {
    return {
      en: row.description || match.description.en || row.name,
      ar: row.descriptionAr || match.description.ar || row.description || match.description.en || row.name,
    };
  }
  return {
    en: row.description || row.name,
    ar: row.descriptionAr || row.description || row.name,
  };
}

async function categoryIdFor(
  tx: Prisma.TransactionClient,
  merchantId: string,
  label: string,
  categoryByName: Map<string, string>,
  nextSort: () => number,
) {
  const existing = categoryByName.get(nameKey(label));
  if (existing) return existing;
  const category = await resolveMerchantCategory(tx, {
    merchantId,
    name: { en: label, ar: label },
    sortOrder: nextSort(),
  });
  categoryByName.set(nameKey(label), category.id);
  return category.id;
}

async function setStock(tx: Prisma.TransactionClient, merchantId: string, branchId: string, productId: string, quantity: number) {
  const items = await tx.inventoryItem.findMany({ where: { productId, merchantId } });
  if (!items.length) {
    await tx.inventoryItem.create({ data: { merchantId, branchId, productId, quantity, lowStockThreshold: 5 } });
    return;
  }
  if (quantity === 0) {
    await tx.inventoryItem.updateMany({ where: { productId, merchantId }, data: { quantity: 0 } });
    return;
  }
  const first = items[0];
  if (first) await tx.inventoryItem.update({ where: { id: first.id }, data: { quantity } });
}

function remember(byName: Map<string, Match>, match: Match) {
  if (match.name.en) byName.set(nameKey(match.name.en), match);
  if (match.name.ar) byName.set(nameKey(match.name.ar), match);
}

function rowNumber(raw: unknown, index: number) {
  if (raw && typeof raw === 'object' && 'row' in raw && typeof raw.row === 'number') return raw.row;
  return index + 1;
}

function nameKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

function uniqueSlug(value: string, taken: Set<string>) {
  const root = (value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item').slice(0, 60);
  let slug = root;
  let n = 2;
  while (taken.has(slug)) {
    slug = `${root}-${n}`;
    n += 1;
  }
  taken.add(slug);
  return slug;
}
