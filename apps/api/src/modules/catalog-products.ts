import type { Prisma, PrismaClient } from '@prisma/client';
import { loc } from '../common/crypto';
import { badRequest } from '../common/errors';
import { categoryNameKey } from './catalog-categories';

type Localized = { en: string; ar: string };

export async function resolveCatalogProduct(
  tx: Prisma.TransactionClient,
  input: {
    merchantId: string;
    name: Localized;
    description: Localized;
    imageUrl?: string | null;
  },
) {
  const key = categoryNameKey(input.name.en || input.name.ar);
  if (!key) throw badRequest('Product name is required');
  let central = await tx.catalogProduct.findFirst({
    where: { OR: [{ normalizedName: key }, { aliases: { has: key } }] },
  });
  central ??= await tx.catalogProduct.upsert({
    where: { normalizedName: key },
    update: {},
    create: {
      normalizedName: key,
      aliases: [...new Set([categoryNameKey(input.name.en), categoryNameKey(input.name.ar)].filter(Boolean))],
      name: input.name,
      description: input.description,
      imageUrl: input.imageUrl,
      status: 'PENDING',
      submittedByMerchantId: input.merchantId,
    },
  });
  if (central.mergedIntoId) {
    const replacement = await tx.catalogProduct.findUnique({ where: { id: central.mergedIntoId } });
    if (replacement) central = replacement;
  }
  return central;
}

export async function mergeCatalogProduct(
  prisma: PrismaClient,
  input: { sourceId: string; targetId: string; actorId: string; note?: string },
) {
  if (input.sourceId === input.targetId) throw badRequest('Choose a different replacement product');
  return prisma.$transaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.catalogProduct.findUnique({ where: { id: input.sourceId } }),
      tx.catalogProduct.findUnique({ where: { id: input.targetId } }),
    ]);
    if (!source || !target || target.status === 'REJECTED') throw badRequest('Choose a valid replacement product');
    await tx.product.updateMany({
      where: { catalogProductId: source.id, OR: [{ imageUrl: null }, { imageUrl: source.imageUrl }] },
      data: { imageUrl: target.imageUrl },
    });
    await tx.product.updateMany({
      where: { catalogProductId: source.id },
      data: {
        catalogProductId: target.id,
        name: target.name as Prisma.InputJsonValue,
        description: target.description as Prisma.InputJsonValue,
      },
    });
    await tx.catalogProduct.update({
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
