import { money, moneyString, zero } from './money';

export type LedgerDraft = {
  type:
    | 'CUSTOMER_PAYMENT'
    | 'CASH_COLLECTION'
    | 'GATEWAY_FEE'
    | 'MERCHANT_AMOUNT'
    | 'PLATFORM_COMMISSION'
    | 'DRIVER_PAYMENT'
    | 'MARKETING_COMMISSION'
    | 'REFUND'
    | 'SETTLEMENT_ADJUSTMENT';
  amount: string;
  debitAccount: string;
  creditAccount: string;
  referenceType: string;
  referenceId: string;
};

export type CaptureSplitInput = {
  total: string;
  foodAfterDiscount: string;
  tax: string;
  deliveryFee: string;
  commissionRate: string;
  gatewayRate: string;
  payDriver: boolean;
  referenceId: string;
};

export function buildCaptureLedger(input: CaptureSplitInput): LedgerDraft[] {
  const total = money(input.total);
  const food = money(input.foodAfterDiscount);
  const tax = money(input.tax);
  const delivery = money(input.deliveryFee);
  const commission = food.mul(input.commissionRate);
  const merchantNet = food.minus(commission);
  const gatewayFee = total.mul(input.gatewayRate);
  const driver = input.payDriver ? delivery : zero();
  const lines: LedgerDraft[] = [
    entry('CUSTOMER_PAYMENT', total, 'gateway_clearing', 'customer_payments', input.referenceId),
    entry('GATEWAY_FEE', gatewayFee, 'gateway_fees', 'gateway_clearing', input.referenceId),
    entry('PLATFORM_COMMISSION', commission, 'merchant_payable', 'platform_revenue', input.referenceId),
    entry('MERCHANT_AMOUNT', merchantNet, 'merchant_payable', 'merchant_payable_net', input.referenceId),
    entry('DRIVER_PAYMENT', driver, 'delivery_expense', 'driver_payable', input.referenceId),
  ].filter((line) => money(line.amount).gt(0));

  const outflow = commission.plus(merchantNet).plus(driver).plus(gatewayFee);
  const expected = food.plus(delivery).plus(tax);
  if (!expected.minus(total).abs().lt('0.001')) {
    throw new Error('Order total does not match the priced components');
  }
  if (merchantNet.isNeg()) throw new Error('Merchant net cannot be negative');
  void outflow;
  return lines;
}

export function buildRefundLedger(amount: string, referenceId: string): LedgerDraft {
  return entry('REFUND', money(amount), 'refunds', 'gateway_clearing', referenceId);
}

export function assertLedgerImmutable(action: string): void {
  if (['update', 'updateMany', 'delete', 'deleteMany', 'upsert'].includes(action)) {
    throw new Error('Ledger entries are immutable');
  }
}

function entry(
  type: LedgerDraft['type'],
  amount: ReturnType<typeof money>,
  debitAccount: string,
  creditAccount: string,
  referenceId: string,
): LedgerDraft {
  return {
    type,
    amount: moneyString(amount),
    debitAccount,
    creditAccount,
    referenceType: 'ORDER',
    referenceId,
  };
}
