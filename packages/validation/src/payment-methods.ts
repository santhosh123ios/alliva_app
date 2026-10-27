import { z } from 'zod';

/** The methods Alliva can offer. Which of them are switched on is decided by the admin in platform settings. */
export const PAYMENT_METHOD_CODES = ['BANK_TRANSFER', 'BENEFIT_PAY', 'TAP_PAY', 'PAYPAL'] as const;

export const paymentMethodCodeSchema = z.enum(PAYMENT_METHOD_CODES);

export type PaymentMethodCode = z.infer<typeof paymentMethodCodeSchema>;

export type PaymentMethodConfig = {
  code: PaymentMethodCode;
  enabled: boolean;
  name: { en: string; ar: string };
};

/** Methods the customer settles outside a payment gateway. The order is placed and the payment stays pending. */
export const OFFLINE_PAYMENT_METHODS: readonly PaymentMethodCode[] = ['BANK_TRANSFER'];

export function isOfflinePaymentMethod(code: string): boolean {
  return (OFFLINE_PAYMENT_METHODS as readonly string[]).includes(code);
}

const DEFAULTS: PaymentMethodConfig[] = [
  { code: 'BANK_TRANSFER', enabled: true, name: { en: 'Bank transfer', ar: 'تحويل بنكي' } },
  { code: 'BENEFIT_PAY', enabled: true, name: { en: 'BenefitPay', ar: 'بنفت باي' } },
  { code: 'TAP_PAY', enabled: true, name: { en: 'Tap Pay', ar: 'تاب باي' } },
  { code: 'PAYPAL', enabled: true, name: { en: 'PayPal', ar: 'باي بال' } },
];

/**
 * Codes used before the catalog was reduced to the four methods above. Stores and saved settings may still carry
 * them, so they are translated instead of being dropped. Cash has no equivalent and is not carried over.
 */
const LEGACY_CODES: Record<string, PaymentMethodCode | null> = {
  CARD: 'TAP_PAY',
  BENEFIT: 'BENEFIT_PAY',
  BENEFIT_PAY: 'BENEFIT_PAY',
  CASH: null,
};

function isCode(value: unknown): value is PaymentMethodCode {
  return typeof value === 'string' && (PAYMENT_METHOD_CODES as readonly string[]).includes(value);
}

/** Maps any stored code (current or legacy) to a current code, or null when it no longer exists. */
export function normalizePaymentMethodCode(value: unknown): PaymentMethodCode | null {
  if (isCode(value)) return value;
  if (typeof value === 'string' && value in LEGACY_CODES) return LEGACY_CODES[value] ?? null;
  return null;
}

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
      // Only current codes carry their saved name and switch; a legacy row must not overwrite a current one.
      if (!isCode(code)) continue;
      const name = (row as { name?: unknown }).name;
      const enabled = (row as { enabled?: unknown }).enabled;
      saved.set(code, {
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

/**
 * A missing store selection accepts every method that is still enabled. An explicit list is translated from any
 * legacy codes and intersected with the enabled catalog, so turning a method off removes it from every store.
 */
export function acceptedPaymentMethods(stored: unknown, catalog: PaymentMethodConfig[]): PaymentMethodCode[] {
  const enabled = catalog.filter((row) => row.enabled).map((row) => row.code);
  if (!Array.isArray(stored)) return enabled;
  const chosen = new Set<PaymentMethodCode>();
  for (const code of stored) {
    const current = normalizePaymentMethodCode(code);
    if (current) chosen.add(current);
  }
  return enabled.filter((code) => chosen.has(code));
}
