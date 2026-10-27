import { acceptedPaymentMethods, parsePaymentMethods, resolveRegistrationMethods } from '@alliva/validation';
import { badRequest } from '../common/errors';
import type { PrismaService } from '../prisma/prisma.service';

export const PAYMENT_METHODS_KEY = 'paymentMethods';

export async function paymentMethodsForRegistration(prisma: PrismaService, requested?: readonly string[]) {
  const row = await prisma.platformSetting.findUnique({ where: { key: PAYMENT_METHODS_KEY } });
  const chosen = resolveRegistrationMethods(requested, parsePaymentMethods(row?.value));
  if (!chosen) throw badRequest('Choose a payment method that is available');
  return chosen;
}

export async function publicPaymentMethods(prisma: PrismaService) {
  const row = await prisma.platformSetting.findUnique({ where: { key: PAYMENT_METHODS_KEY } });
  return parsePaymentMethods(row?.value)
    .filter((method) => method.enabled)
    .map(({ code, name }) => ({ code, name }));
}

export async function storePaymentChoices(prisma: PrismaService, merchantId: string) {
  const [setting, merchant] = await Promise.all([
    prisma.platformSetting.findUnique({ where: { key: PAYMENT_METHODS_KEY } }),
    prisma.merchant.findUnique({ where: { id: merchantId }, select: { acceptedPaymentMethods: true } }),
  ]);
  const catalog = parsePaymentMethods(setting?.value);
  const codes = acceptedPaymentMethods(merchant?.acceptedPaymentMethods, catalog);
  return catalog.filter((method) => codes.includes(method.code)).map(({ code, name }) => ({ code, name }));
}
