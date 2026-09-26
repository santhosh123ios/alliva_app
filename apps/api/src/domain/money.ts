import Decimal from 'decimal.js';

Decimal.set({ precision: 24, rounding: Decimal.ROUND_HALF_UP });

export type Money = Decimal;

export function money(value: string | number | Decimal): Decimal {
  return new Decimal(value);
}

export function moneyString(value: Decimal): string {
  return value.toFixed(3);
}

export function zero(): Decimal {
  return new Decimal(0);
}

export function assertNonNegative(value: Decimal, label: string): void {
  if (value.isNeg()) {
    throw new Error(`${label} cannot be negative`);
  }
}
