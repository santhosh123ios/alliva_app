import { money, moneyString } from './money';

/** Available = earned − already paid out − still reserved by open requests. Never negative. */
export function availableBalance(earned: string, withdrawn: string, reserved: string): string {
  const value = money(earned).minus(withdrawn).minus(reserved);
  return moneyString(value.isNeg() ? money(0) : value);
}

export function parseWithdrawalAmount(value: unknown): string {
  const raw = typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(\.\d{1,3})?$/.test(raw) || !money(raw).gt(0)) {
    throw new Error('Enter an amount');
  }
  return moneyString(money(raw));
}
