import { money, moneyString } from './money';

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
