import { applySubscriptionDiscount } from './commissions';
import { money, moneyString } from './money';

// ---------------------------------------------------------------------------
// Lead pipeline
// ---------------------------------------------------------------------------

export const LEAD_STATUSES = [
  'NEW',
  'CONTACTED',
  'VISITED',
  'INTERESTED',
  'FOLLOW_UP_REQUIRED',
  'APPOINTMENT_SCHEDULED',
  'NEGOTIATION',
  'REGISTRATION_PENDING',
  'REGISTERED',
  'NOT_INTERESTED',
  'CLOSED_LOST',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Statuses a lead can no longer be worked from, other than by reopening. */
export const CLOSED_LEAD_STATUSES: LeadStatus[] = ['REGISTERED', 'NOT_INTERESTED', 'CLOSED_LOST'];

// ---------------------------------------------------------------------------
// Contact normalisation (used for safe lead <-> merchant matching)
// ---------------------------------------------------------------------------

export function normalizePhone(raw?: string | null): string {
  if (!raw) return '';
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 8) digits = `973${digits}`;
  return digits;
}

export function normalizeEmail(raw?: string | null): string {
  return (raw ?? '').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Referral codes
// ---------------------------------------------------------------------------

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,31}$/;

export function normalizeReferralCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidReferralCode(code: string): boolean {
  return CODE_RE.test(code);
}

export function referralPrefix(raw?: string | null): string {
  const clean = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (clean || 'ALV').slice(0, 8);
}

export function referralNameStem(firstName: string): string {
  const letters = firstName.normalize('NFKD').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return (letters.length >= 2 ? letters : `${letters}ALV`).slice(0, 10);
}

/** ALV-AHMED001 style code; sequence is zero padded to 3 digits. */
export function buildReferralCode(prefix: string, firstName: string, sequence: number): string {
  return `${referralPrefix(prefix)}-${referralNameStem(firstName)}${String(sequence).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Commission policy
// ---------------------------------------------------------------------------

export type CommissionBase = 'NET_PAID' | 'NET_EXCLUDING_TAX';

export type CommissionRates = { staffPercent: string; headPercent: string };

export function resolveRates(
  defaults: CommissionRates,
  overrides: { staff?: { toString(): string } | null; head?: { toString(): string } | null },
): CommissionRates {
  return {
    staffPercent: overrides.staff != null ? money(overrides.staff.toString()).toFixed(3) : defaults.staffPercent,
    headPercent: overrides.head != null ? money(overrides.head.toString()).toFixed(3) : defaults.headPercent,
  };
}

/**
 * The amount commission is calculated on: what the merchant actually paid after discounts,
 * optionally excluding tax when the policy says so. Never negative.
 */
export function eligibleAmount(paidAmount: string, base: CommissionBase, taxPercent: string): string {
  const paid = money(paidAmount);
  if (base === 'NET_EXCLUDING_TAX' && money(taxPercent).gt(0)) {
    return moneyString(paid.div(money(1).plus(money(taxPercent).div(100))));
  }
  return moneyString(paid.isNeg() ? money(0) : paid);
}

export function percentOf(amount: string, percent: string): string {
  return moneyString(money(amount).mul(percent).div(100));
}

/**
 * Cumulative proportional reversal. Using the cumulative refund ratio (instead of reversing each refund
 * independently) avoids rounding drift: a series of partial refunds that adds up to the full payment
 * always reverses exactly the full commission.
 */
export function commissionReversal(input: {
  commissionAmount: string;
  alreadyReversed: string;
  paymentAmount: string;
  cumulativeRefund: string;
}): string {
  const payment = money(input.paymentAmount);
  if (payment.lte(0)) return moneyString(money(0));
  const ratio = money(input.cumulativeRefund).div(payment);
  const bounded = ratio.gt(1) ? money(1) : ratio.isNeg() ? money(0) : ratio;
  const target = money(input.commissionAmount).mul(bounded);
  const owed = target.minus(money(input.alreadyReversed));
  const cap = money(input.commissionAmount).minus(money(input.alreadyReversed));
  const value = owed.gt(cap) ? cap : owed;
  return moneyString(value.isNeg() ? money(0) : value);
}

// ---------------------------------------------------------------------------
// Wallet ledger
// ---------------------------------------------------------------------------

export type WalletTxType =
  | 'COMMISSION_CREDIT'
  | 'COMMISSION_REVERSAL'
  | 'APPROVAL'
  | 'RECOVERY'
  | 'WITHDRAWAL_RESERVE'
  | 'WITHDRAWAL_RELEASE'
  | 'WITHDRAWAL_PAID'
  | 'ADMIN_ADJUSTMENT'
  | 'OPENING_BALANCE';
export type WalletBucket = 'PENDING' | 'AVAILABLE' | 'RESERVED' | 'RECOVERY';
export type WalletRow = { type: WalletTxType; bucket: WalletBucket; amount: string };

export type WalletSummary = {
  pending: string;
  available: string;
  reserved: string;
  recovery: string;
  earned: string;
  withdrawn: string;
};

/** Pure summary of ledger rows. The wallet columns are a cache of this function applied to every row. */
export function summarizeWallet(rows: WalletRow[]): WalletSummary {
  let pending = money(0);
  let available = money(0);
  let reserved = money(0);
  let recovery = money(0);
  let earned = money(0);
  let withdrawn = money(0);
  for (const row of rows) {
    const amount = money(row.amount);
    if (row.bucket === 'PENDING') pending = pending.plus(amount);
    else if (row.bucket === 'AVAILABLE') available = available.plus(amount);
    else if (row.bucket === 'RESERVED') reserved = reserved.plus(amount);
    else recovery = recovery.plus(amount);

    if (row.type === 'COMMISSION_CREDIT') earned = earned.plus(amount);
    // A reversal reduces what was earned, whichever bucket absorbed it; the unrecovered part sits in RECOVERY.
    if (row.type === 'COMMISSION_REVERSAL') earned = earned.plus(row.bucket === 'RECOVERY' ? amount.neg() : amount);
    if (row.type === 'WITHDRAWAL_PAID') withdrawn = withdrawn.plus(amount.abs());
  }
  return {
    pending: moneyString(pending),
    available: moneyString(available),
    reserved: moneyString(reserved),
    recovery: moneyString(recovery),
    earned: moneyString(earned),
    withdrawn: moneyString(withdrawn),
  };
}

/**
 * Splits a commission reversal between the buckets that can absorb it. Anything the wallet cannot cover is
 * tracked as recovery debt and netted against future credits.
 */
export function planReversal(input: { amount: string; pending: string; available: string }) {
  let left = money(input.amount);
  const fromPending = money(input.pending).lt(left) ? money(input.pending) : left;
  left = left.minus(fromPending);
  const fromAvailable = money(input.available).lt(left) ? money(input.available) : left;
  left = left.minus(fromAvailable);
  return { fromPending: moneyString(fromPending), fromAvailable: moneyString(fromAvailable), shortfall: moneyString(left) };
}

/** When a credit lands in AVAILABLE and the wallet owes recovery debt, the debt is settled first. */
export function recoveryOffset(credit: string, recoveryDue: string): string {
  const c = money(credit);
  const due = money(recoveryDue);
  return moneyString(c.lt(due) ? c : due);
}

// ---------------------------------------------------------------------------
// Promo codes for subscriptions
// ---------------------------------------------------------------------------

export type PromoRules = {
  active: boolean;
  deletedAt: Date | null;
  startsAt: Date;
  endsAt: Date;
  discountType: 'FIXED' | 'PERCENTAGE';
  discountValue: string;
  maxDiscount: string | null;
  minimumAmount: string | null;
  usageLimit: number | null;
  perMerchantLimit: number | null;
  firstTimeMerchantOnly: boolean;
  planIds: string[] | null;
};

export type PromoContext = {
  planId: string;
  amount: string;
  totalUses: number;
  merchantUses: number;
  merchantHasPaidBefore: boolean;
  now?: Date;
};

export type PromoVerdict =
  | { ok: true; discount: string; payable: string }
  | { ok: false; reason: string };

export function promoStatus(rules: Pick<PromoRules, 'active' | 'deletedAt' | 'endsAt'>, now = new Date()): 'ACTIVE' | 'INACTIVE' | 'EXPIRED' {
  if (rules.deletedAt || !rules.active) return 'INACTIVE';
  return rules.endsAt < now ? 'EXPIRED' : 'ACTIVE';
}

export function evaluatePromo(rules: PromoRules, context: PromoContext): PromoVerdict {
  const now = context.now ?? new Date();
  if (rules.deletedAt || !rules.active) return { ok: false, reason: 'This promo code is not active' };
  if (rules.startsAt > now) return { ok: false, reason: 'This promo code is not valid yet' };
  if (rules.endsAt < now) return { ok: false, reason: 'This promo code has expired' };
  if (rules.usageLimit != null && context.totalUses >= rules.usageLimit) return { ok: false, reason: 'This promo code has reached its usage limit' };
  if (rules.perMerchantLimit != null && context.merchantUses >= rules.perMerchantLimit) {
    return { ok: false, reason: 'You have already used this promo code' };
  }
  if (rules.firstTimeMerchantOnly && context.merchantHasPaidBefore) {
    return { ok: false, reason: 'This promo code is only for a first subscription' };
  }
  if (rules.planIds && rules.planIds.length && !rules.planIds.includes(context.planId)) {
    return { ok: false, reason: 'This promo code does not apply to the selected plan' };
  }
  if (rules.minimumAmount != null && money(context.amount).lt(money(rules.minimumAmount))) {
    return { ok: false, reason: `This promo code needs a subscription of at least BHD ${money(rules.minimumAmount).toFixed(3)}` };
  }
  let payable = applySubscriptionDiscount(context.amount, rules.discountType, rules.discountValue);
  let discount = money(context.amount).minus(money(payable));
  if (rules.maxDiscount != null && discount.gt(money(rules.maxDiscount))) {
    discount = money(rules.maxDiscount);
    payable = moneyString(money(context.amount).minus(discount));
  }
  if (discount.lte(0)) return { ok: false, reason: 'This promo code gives no discount on this plan' };
  return { ok: true, discount: moneyString(discount), payable };
}

// ---------------------------------------------------------------------------
// Reminders (time handling is always UTC instants; Bahrain is only used for display and day boundaries)
// ---------------------------------------------------------------------------

export const DEFAULT_REMINDER_OFFSETS_MINUTES = [1440, 60, 0];

export function normalizeOffsets(value: unknown): number[] {
  if (!Array.isArray(value)) return DEFAULT_REMINDER_OFFSETS_MINUTES;
  const offsets = [...new Set(value.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 60 * 24 * 14))];
  return offsets.length ? offsets.sort((a, b) => b - a) : DEFAULT_REMINDER_OFFSETS_MINUTES;
}

/**
 * Offsets whose reminder time has passed but whose appointment has not started yet (or is within the grace window).
 * A late scheduler run still sends the most relevant reminder only: older offsets that are already superseded by a
 * smaller one are skipped, so a single run never sends "24h before" and "1h before" for the same appointment.
 */
export function dueOffsets(scheduledAt: Date, offsets: number[], now: Date, graceMinutes = 15): number[] {
  const msToStart = scheduledAt.getTime() - now.getTime();
  const due = offsets.filter((offset) => msToStart <= offset * 60_000 && msToStart >= -graceMinutes * 60_000);
  if (!due.length) return [];
  return [Math.min(...due)];
}

export function reminderKey(appointmentId: string, scheduledAt: Date, offset: number): string {
  return `appt:${appointmentId}:${scheduledAt.getTime()}:${offset}`;
}

const bahrainFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bahrain',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatBahrain(date: Date): string {
  return bahrainFormatter.format(date).replace(',', '');
}

export function bahrainDayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bahrain', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Start of the Bahrain calendar day (UTC+3, no DST) containing `date`, as a UTC instant. */
export function bahrainDayStart(date: Date): Date {
  return new Date(new Date(`${bahrainDayKey(date)}T00:00:00.000Z`).getTime() - 3 * 3_600_000);
}

// ---------------------------------------------------------------------------
// Withdrawal lifecycle
// ---------------------------------------------------------------------------

export type WithdrawalStatus = 'REQUESTED' | 'UNDER_REVIEW' | 'APPROVED' | 'PROCESSING' | 'PAID' | 'REJECTED' | 'CANCELLED';

const WITHDRAWAL_FLOW: Record<WithdrawalStatus, WithdrawalStatus[]> = {
  REQUESTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['PROCESSING', 'PAID', 'REJECTED'],
  PROCESSING: ['PAID', 'REJECTED'],
  PAID: [],
  REJECTED: [],
  CANCELLED: [],
};

export function withdrawalNext(from: WithdrawalStatus): WithdrawalStatus[] {
  return WITHDRAWAL_FLOW[from] ?? [];
}

export function canMoveWithdrawal(from: WithdrawalStatus, to: WithdrawalStatus): boolean {
  return withdrawalNext(from).includes(to);
}

/** Statuses that hold the requested amount in the reserved bucket. */
export const RESERVING_WITHDRAWALS: WithdrawalStatus[] = ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING'];
/** Statuses that count as "a withdrawal was made this period" for the weekly/monthly cadence. */
export const CADENCE_WITHDRAWALS: WithdrawalStatus[] = ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'PAID'];
