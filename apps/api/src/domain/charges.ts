import { assertNonNegative, money, moneyString, zero } from './money';

export type ChargeSetting = {
  enabled: boolean;
  mode: 'PERCENTAGE' | 'FIXED';
  amount: string;
  label: { en: string; ar: string };
};

export function readCharge(value: unknown, fallback: ChargeSetting): ChargeSetting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const row = value as { enabled?: unknown; mode?: unknown; amount?: unknown; label?: unknown };
  const label = row.label && typeof row.label === 'object' && !Array.isArray(row.label) ? (row.label as { en?: unknown; ar?: unknown }) : {};
  const amount = typeof row.amount === 'string' || typeof row.amount === 'number' ? String(row.amount) : fallback.amount;
  return {
    enabled: typeof row.enabled === 'boolean' ? row.enabled : fallback.enabled,
    mode: row.mode === 'FIXED' ? 'FIXED' : 'PERCENTAGE',
    amount,
    label: {
      en: typeof label.en === 'string' && label.en.trim() ? label.en : fallback.label.en,
      ar: typeof label.ar === 'string' && label.ar.trim() ? label.ar : fallback.label.ar,
    },
  };
}

export function defaultServiceFee(): ChargeSetting {
  return { enabled: false, mode: 'PERCENTAGE', amount: '0', label: { en: 'Service fee', ar: 'رسوم الخدمة' } };
}

export function disabledTax(): ChargeSetting {
  return { enabled: false, mode: 'PERCENTAGE', amount: '0', label: { en: 'Tax', ar: 'الضريبة' } };
}

/** Charges saved on one store. A store that has not configured them pays neither. */
export function merchantOrderCharges(value: unknown): { serviceFee: ChargeSetting; tax: ChargeSetting } {
  const stored = value && typeof value === 'object' && !Array.isArray(value) ? (value as { serviceFee?: unknown; taxCharge?: unknown }) : null;
  return {
    serviceFee: readCharge(stored?.serviceFee, defaultServiceFee()),
    tax: readCharge(stored?.taxCharge, disabledTax()),
  };
}

/** Admin charges added to a subscription plan price. Missing settings stay off. */
export function platformPlanCharges(values: Map<string, unknown>): { serviceFee: ChargeSetting; tax: ChargeSetting } {
  return {
    serviceFee: readCharge(values.get('serviceFee'), defaultServiceFee()),
    tax: readCharge(values.get('taxCharge'), disabledTax()),
  };
}

export function priceWithCharges(net: string, charges: { serviceFee: ChargeSetting; tax: ChargeSetting }) {
  const base = money(net);
  const serviceFee = chargeMoney(base, charges.serviceFee);
  const tax = chargeMoney(base, charges.tax);
  return {
    serviceFee: moneyString(serviceFee),
    tax: moneyString(tax),
    payable: moneyString(base.plus(serviceFee).plus(tax)),
  };
}

function chargeMoney(base: ReturnType<typeof money>, rule: ChargeSetting) {
  if (!rule.enabled) return zero();
  const amount = rule.mode === 'FIXED' ? money(rule.amount || '0') : base.mul(rule.amount || '0');
  assertNonNegative(amount, 'charge');
  return amount;
}

export function normalizeOrderCharges(value: unknown): { serviceFee: ChargeSetting; taxCharge: ChargeSetting } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Enter a service fee and a tax');
  const row = value as { serviceFee?: unknown; taxCharge?: unknown };
  return {
    serviceFee: normalizeCharge(row.serviceFee),
    taxCharge: normalizeCharge(row.taxCharge),
  };
}

function normalizeCharge(value: unknown): ChargeSetting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Enter a service fee and a tax');
  const row = value as { enabled?: unknown; mode?: unknown; amount?: unknown; label?: unknown };
  const label = row.label && typeof row.label === 'object' && !Array.isArray(row.label) ? (row.label as { en?: unknown; ar?: unknown }) : {};
  const en = typeof label.en === 'string' ? label.en.trim() : '';
  const ar = typeof label.ar === 'string' ? label.ar.trim() : '';
  if (!en || !ar) throw new Error('Enter the label in English and Arabic');
  const mode = row.mode === 'FIXED' ? 'FIXED' : row.mode === 'PERCENTAGE' ? 'PERCENTAGE' : null;
  if (!mode) throw new Error('Choose a percentage or a fixed amount');
  const amount = Number(row.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter a valid amount');
  if (mode === 'PERCENTAGE' && amount > 1) throw new Error('Percentage cannot exceed 100');
  return {
    enabled: row.enabled === true,
    mode,
    amount: mode === 'PERCENTAGE' ? amount.toFixed(5) : amount.toFixed(3),
    label: { en, ar },
  };
}
