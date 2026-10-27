import { z } from 'zod';

export const PAYMENT_METHOD_CODES = ['CARD', 'BENEFIT', 'BENEFIT_PAY', 'CASH'] as const;

export const paymentMethodCodeSchema = z.enum(PAYMENT_METHOD_CODES);

export type PaymentMethodCode = z.infer<typeof paymentMethodCodeSchema>;

export type PaymentMethodConfig = {
  code: PaymentMethodCode;
  enabled: boolean;
  name: { en: string; ar: string };
};

const DEFAULTS: PaymentMethodConfig[] = [
  { code: 'CARD', enabled: true, name: { en: 'Card', ar: 'بطاقة' } },
  { code: 'BENEFIT', enabled: true, name: { en: 'Benefit', ar: 'بنفت' } },
  { code: 'BENEFIT_PAY', enabled: true, name: { en: 'BenefitPay', ar: 'بنفت باي' } },
  { code: 'CASH', enabled: true, name: { en: 'Cash', ar: 'نقداً' } },
];

export function defaultPaymentMethods(): PaymentMethodConfig[] {
  return DEFAULTS.map((row) => ({ code: row.code, enabled: row.enabled, name: { ...row.name } }));
}

/** Reads the platform catalog. Unknown or missing rows fall back to the built-in methods. */
export function parsePaymentMethods(value: unknown): PaymentMethodConfig[] {
  const saved = new Map<PaymentMethodCode, { enabled?: boolean; en?: string; ar?: string }>();
  if (Array.isArray(value)) {
    for (const row of value) {
      if (!row || typeof row !== 'object') continue;
      const code = (row as { code?: unknown }).code;
      if (typeof code !== 'string' || !PAYMENT_METHOD_CODES.includes(code as PaymentMethodCode)) continue;
      const name = (row as { name?: unknown }).name;
      const enabled = (row as { enabled?: unknown }).enabled;
      saved.set(code as PaymentMethodCode, {
        enabled: typeof enabled === 'boolean' ? enabled : undefined,
        en: name && typeof name === 'object' && typeof (name as { en?: unknown }).en === 'string' ? (name as { en: string }).en.trim() : undefined,
        ar: name && typeof name === 'object' && typeof (name as { ar?: unknown }).ar === 'string' ? (name as { ar: string }).ar.trim() : undefined,
      });
    }
  }
  return defaultPaymentMethods().map((row) => {
    const overlay = saved.get(row.code);
    if (!overlay) return row;
    return {
      code: row.code,
      enabled: overlay.enabled ?? row.enabled,
      name: { en: overlay.en || row.name.en, ar: overlay.ar || row.name.ar },
    };
  });
}

export const paymentMethodsSettingSchema = z
  .array(
    z.object({
      code: paymentMethodCodeSchema,
      enabled: z.boolean(),
      name: z.object({
        en: z.string().trim().min(1).max(40),
        ar: z.string().trim().min(1).max(40),
      }),
    }),
  )
  .length(PAYMENT_METHOD_CODES.length)
  .refine((rows) => new Set(rows.map((row) => row.code)).size === rows.length, { message: 'List each payment method once' })
  .refine((rows) => rows.some((row) => row.enabled), { message: 'Enable at least one payment method' });

/**
 * Methods a new store may accept. An omitted selection means every method the platform currently offers.
 * Returns null when the request names a method that is turned off.
 */
export function resolveRegistrationMethods(requested: readonly string[] | undefined, catalog: PaymentMethodConfig[]): PaymentMethodCode[] | null {
  const enabled = catalog.filter((row) => row.enabled).map((row) => row.code);
  const source = requested?.length ? [...new Set(requested)] : [...enabled];
  if (!source.length) return null;
  const chosen: PaymentMethodCode[] = [];
  for (const code of source) {
    if (!enabled.includes(code as PaymentMethodCode)) return null;
    chosen.push(code as PaymentMethodCode);
  }
  return chosen;
}

/** A missing store selection accepts every method that is still enabled. An explicit list is intersected with that catalog. */
export function acceptedPaymentMethods(stored: unknown, catalog: PaymentMethodConfig[]): PaymentMethodCode[] {
  const enabled = catalog.filter((row) => row.enabled).map((row) => row.code);
  if (!Array.isArray(stored)) return enabled;
  const chosen = new Set(stored.filter((code): code is PaymentMethodCode => typeof code === 'string' && PAYMENT_METHOD_CODES.includes(code as PaymentMethodCode)));
  return enabled.filter((code) => chosen.has(code));
}
