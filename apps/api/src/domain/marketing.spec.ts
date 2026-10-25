import {
  bahrainDayStart,
  buildReferralCode,
  canMoveWithdrawal,
  commissionReversal,
  dueOffsets,
  eligibleAmount,
  evaluatePromo,
  isValidReferralCode,
  normalizeEmail,
  normalizeOffsets,
  normalizePhone,
  planReversal,
  recoveryOffset,
  reminderKey,
  resolveRates,
  summarizeWallet,
  type PromoRules,
} from './marketing';

describe('referral codes', () => {
  it('builds ALV- style codes and rejects malformed ones', () => {
    expect(buildReferralCode('alv', 'Ahmed', 1)).toBe('ALV-AHMED001');
    expect(buildReferralCode('ALV', 'Zoë', 12)).toBe('ALV-ZOE012');
    expect(isValidReferralCode('ALV-AHMED001')).toBe(true);
    expect(isValidReferralCode('bad code')).toBe(false);
    expect(isValidReferralCode('A')).toBe(false);
  });
});

describe('contact normalisation (lead matching)', () => {
  it('treats the same Bahrain number written differently as equal', () => {
    expect(normalizePhone('+973 3366 1001')).toBe('97333661001');
    expect(normalizePhone('33661001')).toBe('97333661001');
    expect(normalizePhone('00973-3366-1001')).toBe('97333661001');
    expect(normalizePhone('')).toBe('');
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });
});

describe('commission rates and base', () => {
  it('uses configured defaults unless a member has an override', () => {
    const defaults = { staffPercent: '10.000', headPercent: '1.000' };
    expect(resolveRates(defaults, {})).toEqual(defaults);
    expect(resolveRates(defaults, { staff: '12.5', head: null })).toEqual({ staffPercent: '12.500', headPercent: '1.000' });
  });

  it('computes the eligible amount from the net paid amount, optionally excluding tax', () => {
    expect(eligibleAmount('18.000', 'NET_PAID', '10')).toBe('18.000');
    expect(eligibleAmount('11.000', 'NET_EXCLUDING_TAX', '10')).toBe('10.000');
    expect(eligibleAmount('11.000', 'NET_EXCLUDING_TAX', '0')).toBe('11.000');
  });
});

describe('proportional commission reversal', () => {
  const base = { commissionAmount: '4.000', paymentAmount: '40.000' };
  it('reverses in proportion to the cumulative refund', () => {
    expect(commissionReversal({ ...base, alreadyReversed: '0.000', cumulativeRefund: '10.000' })).toBe('1.000');
    expect(commissionReversal({ ...base, alreadyReversed: '1.000', cumulativeRefund: '20.000' })).toBe('1.000');
  });
  it('never reverses more than the commission, and a repeated refund total reverses nothing', () => {
    expect(commissionReversal({ ...base, alreadyReversed: '3.000', cumulativeRefund: '999.000' })).toBe('1.000');
    expect(commissionReversal({ ...base, alreadyReversed: '1.000', cumulativeRefund: '10.000' })).toBe('0.000');
    expect(commissionReversal({ commissionAmount: '1.000', alreadyReversed: '0', paymentAmount: '0', cumulativeRefund: '5' })).toBe('0.000');
  });
});

describe('wallet ledger', () => {
  it('summarises buckets and earned / withdrawn totals from ledger rows', () => {
    const summary = summarizeWallet([
      { type: 'COMMISSION_CREDIT', bucket: 'AVAILABLE', amount: '10.000' },
      { type: 'WITHDRAWAL_RESERVE', bucket: 'AVAILABLE', amount: '-4.000' },
      { type: 'WITHDRAWAL_RESERVE', bucket: 'RESERVED', amount: '4.000' },
      { type: 'WITHDRAWAL_PAID', bucket: 'RESERVED', amount: '-4.000' },
    ]);
    expect(summary).toMatchObject({ available: '6.000', reserved: '0.000', earned: '10.000', withdrawn: '4.000' });
  });

  it('takes a reversal from pending first, then available, and records the shortfall', () => {
    expect(planReversal({ amount: '5.000', pending: '2.000', available: '1.000' })).toEqual({ fromPending: '2.000', fromAvailable: '1.000', shortfall: '2.000' });
    expect(planReversal({ amount: '1.000', pending: '0.000', available: '9.000' })).toEqual({ fromPending: '0.000', fromAvailable: '1.000', shortfall: '0.000' });
  });

  it('offsets recovery debt against a new credit without exceeding either amount', () => {
    expect(recoveryOffset('4.000', '1.500')).toBe('1.500');
    expect(recoveryOffset('1.000', '4.000')).toBe('1.000');
    expect(recoveryOffset('4.000', '0.000')).toBe('0.000');
  });
});

describe('promo evaluation', () => {
  const now = new Date('2026-06-15T10:00:00Z');
  const rules: PromoRules = {
    active: true,
    deletedAt: null,
    startsAt: new Date('2026-01-01'),
    endsAt: new Date('2027-01-01'),
    discountType: 'PERCENTAGE',
    discountValue: '10',
    maxDiscount: null,
    minimumAmount: null,
    usageLimit: null,
    perMerchantLimit: null,
    firstTimeMerchantOnly: false,
    planIds: null,
  };
  const ctx = { planId: 'p1', amount: '20.000', totalUses: 0, merchantUses: 0, merchantHasPaidBefore: false, now };

  it('applies a valid promo and returns the payable amount', () => {
    expect(evaluatePromo(rules, ctx)).toEqual({ ok: true, discount: '2.000', payable: '18.000' });
  });
  it('caps the discount at the maximum', () => {
    expect(evaluatePromo({ ...rules, maxDiscount: '1.500' }, ctx)).toEqual({ ok: true, discount: '1.500', payable: '18.500' });
  });
  it('rejects inactive, not-yet-valid, expired, exhausted, wrong-plan, too-small and repeat uses', () => {
    const reason = (override: Partial<PromoRules>, extra: Partial<typeof ctx> = {}) => {
      const verdict = evaluatePromo({ ...rules, ...override }, { ...ctx, ...extra });
      return verdict.ok ? 'ok' : verdict.reason;
    };
    expect(reason({ active: false })).toMatch(/not active/);
    expect(reason({ startsAt: new Date('2027-01-01'), endsAt: new Date('2028-01-01') })).toMatch(/not valid yet/);
    expect(reason({ endsAt: new Date('2026-02-01') })).toMatch(/expired/);
    expect(reason({ usageLimit: 3 }, { totalUses: 3 })).toMatch(/usage limit/);
    expect(reason({ perMerchantLimit: 1 }, { merchantUses: 1 })).toMatch(/already used/);
    expect(reason({ firstTimeMerchantOnly: true }, { merchantHasPaidBefore: true })).toMatch(/first subscription/);
    expect(reason({ planIds: ['other'] })).toMatch(/selected plan/);
    expect(reason({ minimumAmount: '50' })).toMatch(/at least/);
  });
});

describe('reminders', () => {
  const at = new Date('2026-06-15T12:00:00Z');
  it('sends only the most relevant reminder when the scheduler runs late', () => {
    const offsets = normalizeOffsets([1440, 60, 0]);
    expect(dueOffsets(at, offsets, new Date('2026-06-14T12:00:30Z'), 15)).toEqual([1440]);
    expect(dueOffsets(at, offsets, new Date('2026-06-15T11:30:00Z'), 15)).toEqual([60]);
    expect(dueOffsets(at, offsets, new Date('2026-06-14T10:00:00Z'), 15)).toEqual([]);
    expect(dueOffsets(at, offsets, new Date('2026-06-15T12:10:00Z'), 15)).toEqual([0]);
    expect(dueOffsets(at, offsets, new Date('2026-06-15T12:30:00Z'), 15)).toEqual([]);
  });
  it('keys reminders by appointment, time and offset so a reschedule reminds again', () => {
    expect(reminderKey('a1', at, 60)).not.toBe(reminderKey('a1', new Date(at.getTime() + 3_600_000), 60));
    expect(reminderKey('a1', at, 60)).toBe(reminderKey('a1', at, 60));
  });
  it('falls back to the default offsets for invalid input', () => {
    expect(normalizeOffsets('bad')).toEqual([1440, 60, 0]);
    expect(normalizeOffsets([-5, 'x'])).toEqual([1440, 60, 0]);
  });
  it('uses the Bahrain calendar day (UTC+3)', () => {
    expect(bahrainDayStart(new Date('2026-06-15T22:30:00Z')).toISOString()).toBe('2026-06-15T21:00:00.000Z');
  });
});

describe('withdrawal lifecycle', () => {
  it('only allows forward moves and treats paid, rejected and cancelled as final', () => {
    expect(canMoveWithdrawal('REQUESTED', 'UNDER_REVIEW')).toBe(true);
    expect(canMoveWithdrawal('REQUESTED', 'PAID')).toBe(false);
    expect(canMoveWithdrawal('PROCESSING', 'PAID')).toBe(true);
    expect(canMoveWithdrawal('PAID', 'REJECTED')).toBe(false);
    expect(canMoveWithdrawal('REJECTED', 'APPROVED')).toBe(false);
    expect(canMoveWithdrawal('CANCELLED', 'REQUESTED')).toBe(false);
  });
});
