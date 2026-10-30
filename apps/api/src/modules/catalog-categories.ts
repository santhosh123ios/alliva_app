import type { Prisma, PrismaClient } from '@prisma/client';
import { loc } from '../common/crypto';
import { badRequest } from '../common/errors';

type LocalizedName = { en: string; ar: string };

export function categoryNameKey(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

export async function resolveMerchantCategory(
  tx: Prisma.TransactionClient,
  input: { merchantId: string; name: LocalizedName; sortOrder: number },
) {
  const key = categoryNameKey(input.name.en || input.name.ar);
  if (!key) throw badRequest('Category name is required');
  let central = await tx.catalogCategory.findFirst({
    where: { OR: [{ normalizedName: key }, { aliases: { has: key } }] },
  });
  central ??= await tx.catalogCategory.upsert({
      where: { normalizedName: key },
      update: {},
      create: {
        normalizedName: key,
        aliases: [...new Set([categoryNameKey(input.name.en), categoryNameKey(input.name.ar)].filter(Boolean))],
        name: input.name,
        status: 'PENDING',
        submittedByMerchantId: input.merchantId,
      },
    });
  if (central.mergedIntoId) {
    const replacement = await tx.catalogCategory.findUnique({ where: { id: central.mergedIntoId } });
    if (replacement) central = replacement;
  }
  const existing = await tx.productCategory.findFirst({
    where: { merchantId: input.merchantId, catalogCategoryId: central.id },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) {
    if (existing.deletedAt) {
      return tx.productCategory.update({
        where: { id: existing.id },
        data: { deletedAt: null, name: central.name as Prisma.InputJsonValue, sortOrder: input.sortOrder },
      });
    }
    return existing;
  }
  return tx.productCategory.create({
    data: {
      merchantId: input.merchantId,
      catalogCategoryId: central.id,
      name: central.name as Prisma.InputJsonValue,
      sortOrder: input.sortOrder,
    },
  });
}

export async function replaceMerchantCategory(
  tx: Prisma.TransactionClient,
  input: { merchantId: string; localCategoryId: string; name: LocalizedName },
) {
  const source = await tx.productCategory.findFirst({
    where: { id: input.localCategoryId, merchantId: input.merchantId, deletedAt: null },
  });
  if (!source) throw badRequest('Category not found');
  const target = await resolveMerchantCategory(tx, {
    merchantId: input.merchantId,
    name: input.name,
    sortOrder: source.sortOrder,
  });
  if (target.id === source.id) return target;
  await tx.product.updateMany({
    where: { merchantId: input.merchantId, categoryId: source.id },
    data: { categoryId: target.id },
  });
  await tx.productCategory.update({ where: { id: source.id }, data: { deletedAt: new Date() } });
  return target;
}

export async function mergeCatalogCategory(
  prisma: PrismaClient,
  input: { sourceId: string; targetId: string; actorId: string; note?: string },
) {
  if (input.sourceId === input.targetId) throw badRequest('Choose a different replacement category');
  return prisma.$transaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.catalogCategory.findUnique({ where: { id: input.sourceId } }),
      tx.catalogCategory.findUnique({ where: { id: input.targetId } }),
    ]);
    if (!source || !target || target.status === 'REJECTED') throw badRequest('Choose a valid replacement category');
    const localCategories = await tx.productCategory.findMany({
      where: { catalogCategoryId: source.id, deletedAt: null },
    });
    for (const local of localCategories) {
      const existingTarget = await tx.productCategory.findFirst({
        where: {
          merchantId: local.merchantId,
          catalogCategoryId: target.id,
          deletedAt: null,
          NOT: { id: local.id },
        },
      });
      if (existingTarget) {
        await tx.product.updateMany({
          where: { merchantId: local.merchantId, categoryId: local.id },
          data: { categoryId: existingTarget.id },
        });
        await tx.productCategory.update({ where: { id: local.id }, data: { deletedAt: new Date() } });
      } else {
        await tx.productCategory.update({
          where: { id: local.id },
          data: { catalogCategoryId: target.id, name: target.name as Prisma.InputJsonValue },
        });
      }
    }
    await tx.catalogCategory.update({
      where: { id: source.id },
      data: {
        status: 'REJECTED',
        mergedIntoId: target.id,
        reviewedById: input.actorId,
        reviewNote: input.note?.trim() || `Merged into ${loc(target.name).en}`,
      },
    });
    return { ok: true };
  });
}
