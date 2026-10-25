import { money, moneyString } from './money';

export type RedemptionCadence = 'WEEKLY' | 'MONTHLY';

export type CommissionInput = {
  paymentAmount: string;
  staffPercent: string;
  headOverridePercent: string;
  maxCommission: string | null;
  isRenewal: boolean;
  renewalEnabled: boolean;
  paymentVerified: boolean;
};

export type CommissionSplit = {
  staffAmount: string;
  headAmount: string;
};

export function calculateSubscriptionCommission(input: CommissionInput): CommissionSplit | null {
  if (!input.paymentVerified) {
    throw new Error('Commission is only generated from verified subscription payments');
  }
  if (input.isRenewal && !input.renewalEnabled) return null;
  let staff = money(input.paymentAmount).mul(input.staffPercent).div(100);
  let head = money(input.paymentAmount).mul(input.headOverridePercent).div(100);
  const total = staff.plus(head);
  if (input.maxCommission) {
    const max = money(input.maxCommission);
    if (total.gt(max) && total.gt(0)) {
      const ratio = max.div(total);
      staff = staff.mul(ratio);
      head = head.mul(ratio);
    }
  }
  return { staffAmount: moneyString(staff), headAmount: moneyString(head) };
}

export function applySubscriptionDiscount(amount: string, type: 'FIXED' | 'PERCENTAGE', value: string): string {
  const base = money(amount);
  const cut = type === 'PERCENTAGE' ? base.mul(value).div(100) : money(value);
  const charged = base.minus(cut);
  return moneyString(charged.isNeg() ? money(0) : charged);
}

export function redemptionAllowed(lastAt: Date | null, cadence: RedemptionCadence, now = new Date()): boolean {
  if (!lastAt) return true;
  if (cadence === 'WEEKLY') return now.getTime() - lastAt.getTime() >= 7 * 24 * 60 * 60 * 1000;
  return bahrainMonth(lastAt) !== bahrainMonth(now);
}

export function nextRedemptionAt(lastAt: Date | null, cadence: RedemptionCadence, now = new Date()): Date | null {
  if (!lastAt || redemptionAllowed(lastAt, cadence, now)) return null;
  if (cadence === 'WEEKLY') return new Date(lastAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bahrain', year: 'numeric', month: '2-digit' }).formatToParts(lastAt);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  return new Date(Date.UTC(year, month, 1) - 3 * 60 * 60 * 1000);
}

function bahrainMonth(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bahrain', year: 'numeric', month: '2-digit' }).format(date).slice(0, 7);
}
