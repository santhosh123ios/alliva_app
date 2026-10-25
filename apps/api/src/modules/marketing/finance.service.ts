import type { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { AuditService } from '../../common/audit';
import { dec, loc } from '../../common/crypto';
import { badRequest, forbidden, notFound } from '../../common/errors';
import type { RequestUser } from '../../common/http';
import { dateRange, paged, pageQuery, readQuery } from '../../common/paging';
import { calculateSubscriptionCommission, redemptionAllowed, nextRedemptionAt } from '../../domain/commissions';
import {
  CADENCE_WITHDRAWALS,
  canMoveWithdrawal,
  commissionReversal,
  eligibleAmount,
  planReversal,
  recoveryOffset,
  resolveRates,
  summarizeWallet,
  type WalletBucket,
  type WalletTxType,
  type WithdrawalStatus,
} from '../../domain/marketing';
import { money, moneyString } from '../../domain/money';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MarketingScope } from './scope';
import type { MarketingSettingsService } from './settings';
import { fullName, notify, recordActivity, type Db } from './shared';

type Tx = Prisma.TransactionClient;

export type WalletRowInput = {
  type: WalletTxType;
  bucket: WalletBucket;
  amount: string;
  reference: string;
  reason?: string;
  commissionEntryId?: string;
  withdrawalId?: string;
  createdById?: string;
};

export class MarketingFinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: MarketingSettingsService,
  ) {}

  // ====================================================================== wallet ledger

  /** Serialises every wallet mutation for a user. Creates the wallet row first so there is always something to lock. */
  private async lockWallet(tx: Tx, userId: string) {
    await tx.$executeRaw`INSERT INTO "MarketingWallet" ("userId", "updatedAt") VALUES (${userId}::uuid, now()) ON CONFLICT ("userId") DO NOTHING`;
    await tx.$queryRaw`SELECT "userId" FROM "MarketingWallet" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
  }

  /**
   * Appends ledger rows and updates the cached wallet columns in the same transaction.
   * Every row has a unique reference: if any reference already exists the whole batch is skipped, which makes
   * retried events and duplicate callbacks harmless. Returns false when the batch was a duplicate.
   */
  async post(tx: Tx, userId: string, rows: WalletRowInput[]): Promise<boolean> {
    if (!rows.length) return true;
    await this.lockWallet(tx, userId);
    const existing = await tx.marketingWalletTransaction.count({ where: { reference: { in: rows.map((row) => row.reference) } } });
    if (existing > 0) return false;
    await tx.marketingWalletTransaction.createMany({
      data: rows.map((row) => ({
        userId,
        type: row.type,
        bucket: row.bucket,
        amount: row.amount,
        reference: row.reference,
        reason: row.reason ?? null,
        commissionEntryId: row.commissionEntryId ?? null,
        withdrawalId: row.withdrawalId ?? null,
        createdById: row.createdById ?? null,
      })),
    });
    const delta = summarizeWallet(rows);
    const wallet = await tx.marketingWallet.update({
      where: { userId },
      data: {
        balance: { increment: delta.available },
        pendingBalance: { increment: delta.pending },
        reservedBalance: { increment: delta.reserved },
        recoveryDue: { increment: delta.recovery },
        totalEarned: { increment: delta.earned },
        totalWithdrawn: { increment: delta.withdrawn },
      },
    });
    for (const [label, value] of [['available', wallet.balance], ['pending', wallet.pendingBalance], ['reserved', wallet.reservedBalance], ['recovery', wallet.recoveryDue]] as const) {
      if (money(dec(value)).isNeg()) throw new Error(`Wallet ${label} balance cannot be negative`);
    }
    return true;
  }

  /** Credits commission into the right bucket, settling any recovery debt first. */
  private async credit(tx: Tx, userId: string, amount: string, entryId: string, bucket: 'PENDING' | 'AVAILABLE') {
    const rows: WalletRowInput[] = [
      { type: 'COMMISSION_CREDIT', bucket, amount, reference: `commission:${entryId}:credit`, commissionEntryId: entryId },
    ];
    if (bucket === 'AVAILABLE') rows.push(...(await this.offsetRows(tx, userId, amount, `commission:${entryId}`, entryId)));
    return this.post(tx, userId, rows);
  }

  private async offsetRows(tx: Tx, userId: string, credit: string, refBase: string, entryId?: string): Promise<WalletRowInput[]> {
    await this.lockWallet(tx, userId);
    const wallet = await tx.marketingWallet.findUnique({ where: { userId } });
    const offset = recoveryOffset(credit, dec(wallet?.recoveryDue));
    if (!money(offset).gt(0)) return [];
    return [
      { type: 'RECOVERY', bucket: 'AVAILABLE', amount: `-${offset}`, reference: `${refBase}:recover:available`, commissionEntryId: entryId, reason: 'Recovery of a refunded commission' },
      { type: 'RECOVERY', bucket: 'RECOVERY', amount: `-${offset}`, reference: `${refBase}:recover:debt`, commissionEntryId: entryId, reason: 'Recovery of a refunded commission' },
    ];
  }

  /** Recomputes the wallet from the ledger and reports any drift from the cached columns. */
  async reconcile(userId: string) {
    const [rows, wallet] = await Promise.all([
      this.prisma.marketingWalletTransaction.findMany({ where: { userId }, select: { type: true, bucket: true, amount: true } }),
      this.prisma.marketingWallet.findUnique({ where: { userId } }),
    ]);
    const ledger = summarizeWallet(rows.map((row) => ({ type: row.type, bucket: row.bucket, amount: dec(row.amount) })));
    const cached = {
      available: dec(wallet?.balance),
      pending: dec(wallet?.pendingBalance),
      reserved: dec(wallet?.reservedBalance),
      recovery: dec(wallet?.recoveryDue),
    };
    const consistent = ledger.available === cached.available && ledger.pending === cached.pending && ledger.reserved === cached.reserved && ledger.recovery === cached.recovery;
    return { consistent, ledger, cached };
  }

  // ====================================================================== commission generation

  /**
   * Generates staff and head commission for a verified payment. Runs inside the payment transaction.
   *
   * Idempotency / double-credit protection (three independent layers):
   *  1. `MerchantReferral.commissionPaymentId` is claimed with a conditional UPDATE, so only one payment per merchant
   *     can ever produce commission, even under concurrent calls.
   *  2. `CommissionEntry` is unique on (payment, tier).
   *  3. Wallet ledger rows have unique references per entry.
   */
  async onVerifiedPayment(
    tx: Tx,
    payment: { id: string; merchantId: string; amount: string; status: string; verifiedAt: Date | null; isRenewal: boolean },
    actorId?: string,
  ) {
    if (!payment.verifiedAt || payment.status !== 'CAPTURED') {
      throw new Error('Commission is only generated from verified subscription payments');
    }
    if (payment.isRenewal) return [];
    const referral = await tx.merchantReferral.findUnique({ where: { merchantId: payment.merchantId } });
    if (!referral) return [];
    const claimed = await tx.merchantReferral.updateMany({ where: { id: referral.id, commissionPaymentId: null }, data: { commissionPaymentId: payment.id } });
    if (claimed.count === 0) return [];

    const settings = await this.settings.get();
    const [staffProfile, headProfile] = await Promise.all([
      tx.marketingProfile.findUnique({ where: { userId: referral.marketingUserId } }),
      referral.headUserId ? tx.marketingProfile.findUnique({ where: { userId: referral.headUserId } }) : Promise.resolve(null),
    ]);
    if (!staffProfile) return [];
    const legacyHead = staffProfile.kind === 'HEAD';
    const rates = resolveRates(
      { staffPercent: settings.staffPercent, headPercent: settings.headPercent },
      { staff: staffProfile.staffCommissionPercent, head: headProfile?.headOverridePercent },
    );
    const base = eligibleAmount(payment.amount, settings.commissionBase, settings.taxPercent);
    const split = calculateSubscriptionCommission({
      paymentAmount: base,
      staffPercent: rates.staffPercent,
      headOverridePercent: headProfile && !legacyHead ? rates.headPercent : '0',
      maxCommission: staffProfile.maxCommission ? dec(staffProfile.maxCommission) : null,
      isRenewal: false,
      renewalEnabled: false,
      paymentVerified: true,
    });
    if (!split) return [];

    const immediate = settings.approval === 'AUTO' || (settings.approval === 'HOLD_DAYS' && settings.holdDays === 0);
    const now = new Date();
    const pendingUntil = settings.approval === 'HOLD_DAYS' ? new Date(now.getTime() + settings.holdDays * 86_400_000) : now;
    const plan: { userId: string; tier: 'STAFF' | 'HEAD'; amount: string; rate: string }[] = [];
    if (money(split.staffAmount).gt(0)) plan.push({ userId: staffProfile.userId, tier: legacyHead ? 'HEAD' : 'STAFF', amount: split.staffAmount, rate: rates.staffPercent });
    if (headProfile && !legacyHead && money(split.headAmount).gt(0)) plan.push({ userId: headProfile.userId, tier: 'HEAD', amount: split.headAmount, rate: rates.headPercent });

    const entries = [];
    for (const item of plan) {
      const entry = await tx.commissionEntry.create({
        data: {
          subscriptionPaymentId: payment.id,
          merchantId: payment.merchantId,
          beneficiaryUserId: item.userId,
          staffUserId: referral.marketingUserId,
          headUserId: referral.headUserId,
          tier: item.tier,
          eligibleAmount: base,
          ratePercent: item.rate,
          amount: item.amount,
          status: immediate ? 'APPROVED' : 'PENDING',
          pendingUntil,
          approvedAt: immediate ? now : null,
        },
      });
      await this.credit(tx, item.userId, item.amount, entry.id, immediate ? 'AVAILABLE' : 'PENDING');
      await tx.ledgerEntry.create({
        data: {
          type: 'MARKETING_COMMISSION',
          amount: item.amount,
          debitAccount: 'platform_revenue',
          creditAccount: 'marketing_payable',
          referenceType: 'SUBSCRIPTION_PAYMENT',
          referenceId: payment.id,
          merchantId: payment.merchantId,
          idempotencyKey: `${payment.id}:MARKETING:${item.tier}`,
          createdById: actorId ?? null,
        },
      });
      await notify(tx, {
        userId: item.userId,
        title: { en: 'Commission earned', ar: 'تم احتساب عمولة' },
        body: { en: `You earned BHD ${item.amount}${immediate ? '' : ' (pending approval)'}`, ar: `حصلت على ${item.amount} د.ب${immediate ? '' : ' (بانتظار الموافقة)'}` },
        link: '/commission',
        entityType: 'CommissionEntry',
        entityId: entry.id,
        dedupeKey: `commission:${entry.id}`,
      });
      entries.push(entry);
    }
    await recordActivity(tx, {
      authorId: actorId ?? referral.marketingUserId,
      staffUserId: referral.marketingUserId,
      headUserId: referral.headUserId,
      merchantId: payment.merchantId,
      kind: 'SUBSCRIPTION_ACTIVATED',
      body: `First subscription payment of BHD ${payment.amount} verified`,
      metadata: { paymentId: payment.id },
    });
    if (entries.length) {
      await recordActivity(tx, {
        authorId: actorId ?? referral.marketingUserId,
        staffUserId: referral.marketingUserId,
        headUserId: referral.headUserId,
        merchantId: payment.merchantId,
        kind: 'COMMISSION_EARNED',
        body: `Commission generated: ${entries.map((entry) => `${entry.tier} BHD ${dec(entry.amount)}`).join(', ')}`,
        metadata: { paymentId: payment.id, entryIds: entries.map((entry) => entry.id) },
      });
    }
    return entries;
  }

  // ====================================================================== approval

  async approve(actor: RequestUser, ids?: string[]) {
    const where: Prisma.CommissionEntryWhereInput = { status: 'PENDING', ...(ids?.length ? { id: { in: ids } } : {}) };
    const pending = await this.prisma.commissionEntry.findMany({ where, select: { id: true } });
    let approved = 0;
    for (const row of pending) approved += (await this.approveOne(row.id, actor.id)) ? 1 : 0;
    if (approved) await this.audit.log({ actorId: actor.id, action: 'marketing.commission.approve', entityType: 'CommissionEntry', metadata: { count: approved, ids: ids ?? 'all' } as never });
    return { approved };
  }

  /** Approves pending entries whose hold period has passed (policy HOLD_DAYS). Called by the scheduler. */
  async approveDue(now = new Date()) {
    const settings = await this.settings.get();
    if (settings.approval !== 'HOLD_DAYS') return 0;
    const due = await this.prisma.commissionEntry.findMany({ where: { status: 'PENDING', pendingUntil: { lte: now } }, select: { id: true } });
    let count = 0;
    for (const row of due) count += (await this.approveOne(row.id, null)) ? 1 : 0;
    return count;
  }

  private async approveOne(id: string, actorId: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.commissionEntry.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: actorId } });
      if (claimed.count === 0) return false;
      const entry = await tx.commissionEntry.findUniqueOrThrow({ where: { id } });
      const live = moneyString(money(dec(entry.amount)).minus(money(dec(entry.reversedAmount))));
      if (!money(live).gt(0)) return true;
      const rows: WalletRowInput[] = [
        { type: 'APPROVAL', bucket: 'PENDING', amount: `-${live}`, reference: `approve:${id}:out`, commissionEntryId: id },
        { type: 'APPROVAL', bucket: 'AVAILABLE', amount: live, reference: `approve:${id}:in`, commissionEntryId: id },
        ...(await this.offsetRows(tx, entry.beneficiaryUserId, live, `approve:${id}`, id)),
      ];
      await this.post(tx, entry.beneficiaryUserId, rows);
      return true;
    });
  }

  // ====================================================================== subscription refunds

  /**
   * Admin refund of a subscription payment (full or partial). Commission is reversed in proportion to the cumulative
   * refund, never touching entries or wallets more than once per refund (unique adjustment + ledger references).
   */
  async refundPayment(actor: RequestUser, paymentId: string, input: { amount?: string; reason: string; idempotencyKey?: string; cancelSubscription?: boolean }) {
    if (!input.reason?.trim()) throw badRequest('A refund reason is required');
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "SubscriptionPayment" WHERE "id" = ${paymentId}::uuid FOR UPDATE`;
        const payment = await tx.subscriptionPayment.findUnique({ where: { id: paymentId } });
        if (!payment) throw notFound('Payment not found');
        if (!payment.verifiedAt || !['CAPTURED', 'PARTIALLY_REFUNDED'].includes(payment.status)) throw badRequest('Only a verified payment can be refunded');
        const paid = money(dec(payment.amount));
        const refundedBefore = money(dec(payment.refundedAmount));
        const remaining = paid.minus(refundedBefore);
        const amount = input.amount ? money(input.amount) : remaining;
        if (amount.lte(0)) throw badRequest('Enter a refund amount greater than zero');
        if (amount.gt(remaining)) throw badRequest(`The refund cannot exceed the remaining BHD ${moneyString(remaining)}`);
        const key = input.idempotencyKey ?? `refund:${paymentId}:${moneyString(refundedBefore)}:${moneyString(amount)}`;
        const duplicate = await tx.subscriptionRefund.findUnique({ where: { idempotencyKey: key } });
        if (duplicate) return { refundId: duplicate.id, duplicate: true, status: payment.status, refunded: dec(payment.refundedAmount) };

        const refund = await tx.subscriptionRefund.create({
          data: { paymentId, merchantId: payment.merchantId, amount: moneyString(amount), reason: input.reason.trim(), idempotencyKey: key, createdById: actor.id },
        });
        const cumulative = refundedBefore.plus(amount);
        const fully = cumulative.gte(paid);
        await tx.subscriptionPayment.update({
          where: { id: paymentId },
          data: { refundedAmount: moneyString(cumulative), status: fully ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
        });
        await tx.ledgerEntry.create({
          data: {
            type: 'REFUND',
            amount: moneyString(amount),
            debitAccount: 'platform_revenue',
            creditAccount: 'merchant_refund',
            referenceType: 'SUBSCRIPTION_REFUND',
            referenceId: refund.id,
            merchantId: payment.merchantId,
            idempotencyKey: `refund:${refund.id}`,
            createdById: actor.id,
          },
        });
        const entries = await tx.commissionEntry.findMany({ where: { subscriptionPaymentId: paymentId } });
        for (const entry of entries) await this.reverseEntry(tx, entry, { paid: moneyString(paid), cumulative: moneyString(cumulative), refundId: refund.id, actorId: actor.id, reason: input.reason.trim() });
        if (input.cancelSubscription ?? fully) {
          await tx.merchantSubscription.updateMany({ where: { id: payment.subscriptionId }, data: { status: 'CANCELLED' } });
        }
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'subscription.refund',
            entityType: 'SubscriptionPayment',
            entityId: paymentId,
            metadata: { refundId: refund.id, amount: moneyString(amount), fully, reason: input.reason.trim() } as never,
          },
        });
        return { refundId: refund.id, duplicate: false, status: fully ? 'REFUNDED' : 'PARTIALLY_REFUNDED', refunded: moneyString(cumulative) };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    return result;
  }

  private async reverseEntry(
    tx: Tx,
    entry: { id: string; beneficiaryUserId: string; staffUserId: string | null; headUserId: string | null; merchantId: string; status: string; amount: Prisma.Decimal; reversedAmount: Prisma.Decimal },
    ctx: { paid: string; cumulative: string; refundId: string; actorId: string; reason: string },
  ) {
    const reversal = commissionReversal({ commissionAmount: dec(entry.amount), alreadyReversed: dec(entry.reversedAmount), paymentAmount: ctx.paid, cumulativeRefund: ctx.cumulative });
    if (!money(reversal).gt(0)) return;
    await tx.commissionAdjustment.create({
      data: { commissionEntryId: entry.id, refundId: ctx.refundId, amount: reversal, reason: ctx.reason, createdById: ctx.actorId },
    });
    const total = money(dec(entry.reversedAmount)).plus(money(reversal));
    const fully = total.gte(money(dec(entry.amount)));
    await tx.commissionEntry.update({ where: { id: entry.id }, data: { reversedAmount: moneyString(total), status: fully ? 'REVERSED' : entry.status === 'PENDING' ? 'PENDING' : 'APPROVED' } });

    await this.lockWallet(tx, entry.beneficiaryUserId);
    const wallet = await tx.marketingWallet.findUniqueOrThrow({ where: { userId: entry.beneficiaryUserId } });
    const split = planReversal({ amount: reversal, pending: entry.status === 'PENDING' ? dec(wallet.pendingBalance) : '0', available: dec(wallet.balance) });
    const base = `reversal:${entry.id}:${ctx.refundId}`;
    const rows: WalletRowInput[] = [];
    if (money(split.fromPending).gt(0)) rows.push({ type: 'COMMISSION_REVERSAL', bucket: 'PENDING', amount: `-${split.fromPending}`, reference: `${base}:pending`, commissionEntryId: entry.id, reason: ctx.reason });
    if (money(split.fromAvailable).gt(0)) rows.push({ type: 'COMMISSION_REVERSAL', bucket: 'AVAILABLE', amount: `-${split.fromAvailable}`, reference: `${base}:available`, commissionEntryId: entry.id, reason: ctx.reason });
    if (money(split.shortfall).gt(0)) rows.push({ type: 'COMMISSION_REVERSAL', bucket: 'RECOVERY', amount: split.shortfall, reference: `${base}:recovery`, commissionEntryId: entry.id, reason: `${ctx.reason} (already withdrawn; recovered from future commission)` });
    await this.post(tx, entry.beneficiaryUserId, rows);
    await notify(tx, {
      userId: entry.beneficiaryUserId,
      title: { en: 'Commission adjusted', ar: 'تعديل العمولة' },
      body: { en: `BHD ${reversal} was deducted after a subscription refund`, ar: `تم خصم ${reversal} د.ب بعد استرداد اشتراك` },
      link: '/commission',
      entityType: 'CommissionEntry',
      entityId: entry.id,
      dedupeKey: `reversal:${entry.id}:${ctx.refundId}`,
    });
  }

  // ====================================================================== admin adjustments

  async adjustWallet(actor: RequestUser, userId: string, input: { amount: string; reason: string }) {
    const reason = input.reason?.trim();
    if (!reason || reason.length < 5) throw badRequest('A reason of at least 5 characters is required');
    const amount = money(input.amount);
    if (amount.isZero()) throw badRequest('Enter a non-zero amount');
    const profile = await this.prisma.marketingProfile.findUnique({ where: { userId } });
    if (!profile) throw notFound('Marketing member not found');
    const ref = `adjust:${randomUUID()}`;
    await this.prisma.$transaction(async (tx) => {
      await this.post(tx, userId, [{ type: 'ADMIN_ADJUSTMENT', bucket: 'AVAILABLE', amount: moneyString(amount), reference: ref, reason, createdById: actor.id }]);
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'marketing.wallet.adjust', entityType: 'MarketingWallet', entityId: userId, metadata: { amount: moneyString(amount), reason, reference: ref } as never } });
      await notify(tx, {
        userId,
        title: { en: 'Wallet adjusted', ar: 'تعديل المحفظة' },
        body: { en: `An admin adjusted your wallet by BHD ${moneyString(amount)}: ${reason}`, ar: `قام المسؤول بتعديل محفظتك بمقدار ${moneyString(amount)} د.ب: ${reason}` },
        link: '/wallet',
        dedupeKey: `adjust:${ref}`,
      });
    }).catch((error: unknown) => {
      if (error instanceof Error && /cannot be negative|check constraint/i.test(error.message)) throw badRequest('The adjustment would make the available balance negative');
      throw error;
    });
    return { ok: true, reference: ref };
  }

  // ====================================================================== withdrawals

  async requestWithdrawal(actor: RequestUser, input: { amount: string; method: string; acceptTerms: boolean }) {
    if (!input.acceptTerms) throw badRequest('Accept the terms to request a withdrawal');
    const settings = await this.settings.get();
    const profile = await this.prisma.marketingProfile.findUnique({ where: { userId: actor.id } });
    if (!profile) throw forbidden('No marketing account');
    if (settings.withdrawalActiveOnly && profile.status !== 'ACTIVE') throw forbidden('This account cannot request withdrawals');
    if (!settings.payoutMethods.includes(input.method)) throw badRequest('Choose an available payout method');
    const requested = money(input.amount);
    if (requested.lte(0)) throw badRequest('Enter an amount to withdraw');
    if (requested.lt(money(settings.minWithdrawal))) throw badRequest(`The minimum withdrawal is BHD ${settings.minWithdrawal}`);

    return this.prisma.$transaction(async (tx) => {
      await this.lockWallet(tx, actor.id);
      const last = await tx.marketingRedemption.findFirst({ where: { userId: actor.id, status: { in: CADENCE_WITHDRAWALS as never[] } }, orderBy: { createdAt: 'desc' } });
      if (!redemptionAllowed(last?.createdAt ?? null, settings.cadence)) throw badRequest(`A withdrawal was already requested for this ${settings.cadence === 'WEEKLY' ? 'week' : 'month'}`);
      const wallet = await tx.marketingWallet.findUniqueOrThrow({ where: { userId: actor.id } });
      if (money(dec(wallet.balance)).lt(requested)) throw badRequest('The amount is more than your available balance');
      const row = await tx.marketingRedemption.create({
        data: {
          userId: actor.id,
          amount: moneyString(requested),
          termsAcceptedAt: new Date(),
          payoutMethod: input.method,
          status: settings.withdrawalApproval === 'AUTO_REVIEW' ? 'UNDER_REVIEW' : 'REQUESTED',
        },
      });
      await this.post(tx, actor.id, [
        { type: 'WITHDRAWAL_RESERVE', bucket: 'AVAILABLE', amount: `-${moneyString(requested)}`, reference: `withdrawal:${row.id}:reserve:out`, withdrawalId: row.id },
        { type: 'WITHDRAWAL_RESERVE', bucket: 'RESERVED', amount: moneyString(requested), reference: `withdrawal:${row.id}:reserve:in`, withdrawalId: row.id },
      ]);
      await recordActivity(tx, {
        authorId: actor.id,
        staffUserId: profile.kind === 'STAFF' ? actor.id : null,
        headUserId: profile.kind === 'STAFF' ? profile.parentUserId : actor.id,
        kind: 'WITHDRAWAL_REQUESTED',
        body: `Withdrawal of BHD ${moneyString(requested)} requested`,
        metadata: { withdrawalId: row.id },
      });
      return this.presentWithdrawal(row);
    });
  }

  async cancelWithdrawal(actor: RequestUser, id: string) {
    const row = await this.prisma.marketingRedemption.findUnique({ where: { id } });
    if (!row || row.userId !== actor.id) throw notFound('Withdrawal not found');
    return this.transition(actor, id, 'CANCELLED', { actorIsOwner: true });
  }

  /** Admin moves a withdrawal through review, approval, processing and payment. */
  async decideWithdrawal(
    actor: RequestUser,
    id: string,
    to: Exclude<WithdrawalStatus, 'REQUESTED' | 'CANCELLED'>,
    input: { payoutMethod?: string; payoutReference?: string; note?: string; reason?: string },
  ) {
    if (to === 'PAID' && !input.payoutReference?.trim()) throw badRequest('Record the payout reference before marking a withdrawal as paid');
    if (to === 'REJECTED' && !(input.reason ?? input.note)?.trim()) throw badRequest('A rejection reason is required');
    return this.transition(actor, id, to, input);
  }

  private async transition(
    actor: RequestUser,
    id: string,
    to: WithdrawalStatus,
    input: { payoutMethod?: string; payoutReference?: string; note?: string; reason?: string; actorIsOwner?: boolean },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.marketingRedemption.findUnique({ where: { id } });
      if (!current) throw notFound('Withdrawal not found');
      const from = current.status as WithdrawalStatus;
      if (!canMoveWithdrawal(from, to)) throw badRequest(`A withdrawal that is ${from.toLowerCase().replace('_', ' ')} cannot be moved to ${to.toLowerCase().replace('_', ' ')}`);
      const now = new Date();
      const amount = dec(current.amount);
      const claimed = await tx.marketingRedemption.updateMany({
        where: { id, status: from },
        data: {
          status: to,
          ...(to === 'UNDER_REVIEW' || to === 'APPROVED' || to === 'REJECTED' ? { reviewedById: actor.id, reviewedAt: now } : {}),
          ...(to === 'PAID' ? { paidById: actor.id, paidAt: now, payoutReference: input.payoutReference?.trim(), payoutMethod: input.payoutMethod ?? current.payoutMethod } : {}),
          ...(to === 'PROCESSING' && input.payoutMethod ? { payoutMethod: input.payoutMethod } : {}),
          ...(to === 'REJECTED' ? { rejectionReason: (input.reason ?? input.note)?.trim() } : {}),
          ...(input.note ? { note: input.note } : {}),
        },
      });
      if (claimed.count === 0) throw badRequest('This withdrawal was just updated by someone else');
      if (to === 'PAID') {
        await this.post(tx, current.userId, [{ type: 'WITHDRAWAL_PAID', bucket: 'RESERVED', amount: `-${amount}`, reference: `withdrawal:${id}:paid`, withdrawalId: id, createdById: actor.id }]);
        await tx.ledgerEntry.create({
          data: {
            type: 'MARKETING_PAYOUT',
            amount,
            debitAccount: 'marketing_payable',
            creditAccount: 'marketing_payout',
            referenceType: 'MARKETING_REDEMPTION',
            referenceId: id,
            idempotencyKey: `${id}:MARKETING_PAYOUT`,
            createdById: actor.id,
          },
        });
      }
      if (to === 'REJECTED' || to === 'CANCELLED') {
        await this.post(tx, current.userId, [
          { type: 'WITHDRAWAL_RELEASE', bucket: 'RESERVED', amount: `-${amount}`, reference: `withdrawal:${id}:release:out`, withdrawalId: id, createdById: actor.id },
          { type: 'WITHDRAWAL_RELEASE', bucket: 'AVAILABLE', amount, reference: `withdrawal:${id}:release:in`, withdrawalId: id, createdById: actor.id },
        ]);
      }
      await tx.auditLog.create({
        data: { actorId: actor.id, action: `marketing.withdrawal.${to.toLowerCase()}`, entityType: 'MarketingRedemption', entityId: id, metadata: { from, amount, payoutReference: input.payoutReference ?? null } as never },
      });
      if (!input.actorIsOwner) {
        await notify(tx, {
          userId: current.userId,
          title: { en: 'Withdrawal update', ar: 'تحديث السحب' },
          body: { en: `Your withdrawal of BHD ${amount} is now ${to.toLowerCase().replace('_', ' ')}`, ar: `أصبح سحبك بقيمة ${amount} د.ب ${to}` },
          link: '/wallet',
          entityType: 'MarketingRedemption',
          entityId: id,
          dedupeKey: `withdrawal:${id}:${to}`,
        });
      }
      return this.presentWithdrawal(await tx.marketingRedemption.findUniqueOrThrow({ where: { id } }));
    });
  }

  private presentWithdrawal(row: Prisma.MarketingRedemptionGetPayload<object>) {
    return {
      id: row.id,
      userId: row.userId,
      amount: dec(row.amount),
      status: row.status,
      payoutMethod: row.payoutMethod,
      payoutReference: row.payoutReference,
      rejectionReason: row.rejectionReason,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      paidAt: row.paidAt?.toISOString() ?? null,
    };
  }

  // ====================================================================== reads

  async wallet(scope: MarketingScope, requestedUserId?: string | null) {
    const userId = scope.walletOwner(requestedUserId);
    const [wallet, settings, last, open] = await Promise.all([
      this.prisma.marketingWallet.findUnique({ where: { userId } }),
      this.settings.get(),
      this.prisma.marketingRedemption.findFirst({ where: { userId, status: { in: CADENCE_WITHDRAWALS as never[] } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.marketingRedemption.count({ where: { userId, status: { in: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING'] } } }),
    ]);
    const available = money(dec(wallet?.balance));
    const canWithdraw = available.gte(money(settings.minWithdrawal)) && redemptionAllowed(last?.createdAt ?? null, settings.cadence);
    return {
      userId,
      currency: 'BHD',
      available: dec(wallet?.balance),
      pending: dec(wallet?.pendingBalance),
      reserved: dec(wallet?.reservedBalance),
      recoveryDue: dec(wallet?.recoveryDue),
      totalEarned: dec(wallet?.totalEarned),
      totalWithdrawn: dec(wallet?.totalWithdrawn),
      withdrawal: {
        cadence: settings.cadence,
        minimum: settings.minWithdrawal,
        methods: settings.payoutMethods,
        terms: settings.terms,
        canRequest: canWithdraw,
        nextAt: nextRedemptionAt(last?.createdAt ?? null, settings.cadence)?.toISOString() ?? null,
        openRequests: open,
      },
    };
  }

  async transactions(scope: MarketingScope, query: Record<string, unknown>) {
    const page = pageQuery(query);
    const raw = readQuery(query);
    const range = dateRange(raw);
    const userId = scope.isAdmin ? raw.userId : scope.userId;
    const where: Prisma.MarketingWalletTransactionWhereInput = {
      ...(userId ? { userId } : {}),
      ...(raw.type ? { type: raw.type as never } : {}),
      ...(raw.bucket ? { bucket: raw.bucket as never } : {}),
      ...(range ? { createdAt: range } : {}),
      ...(page.q ? { OR: [{ reference: { contains: page.q, mode: 'insensitive' } }, { reason: { contains: page.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.marketingWalletTransaction.findMany({ where, include: { user: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.pageSize }),
      this.prisma.marketingWalletTransaction.count({ where }),
    ]);
    return paged(
      rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        userName: fullName(row.user),
        type: row.type,
        bucket: row.bucket,
        amount: dec(row.amount),
        reference: row.reference,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
    );
  }

  async commissions(scope: MarketingScope, query: Record<string, unknown>) {
    const page = pageQuery(query);
    const raw = readQuery(query);
    const range = dateRange(raw);
    const and: Prisma.CommissionEntryWhereInput[] = [scope.commissions()];
    if (raw.status) and.push({ status: raw.status as never });
    if (raw.staffId) and.push({ staffUserId: raw.staffId });
    if (raw.headId && scope.isAdmin) and.push({ headUserId: raw.headId });
    if (raw.merchantId) and.push({ merchantId: raw.merchantId });
    if (raw.tier) and.push({ tier: raw.tier });
    if (raw.own === 'true' && !scope.isAdmin) and.push({ beneficiaryUserId: scope.userId });
    if (range) and.push({ createdAt: range });
    const where: Prisma.CommissionEntryWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.commissionEntry.findMany({ where, include: { subscriptionPayment: { include: { subscription: { include: { plan: true } } } }, adjustments: true }, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.pageSize }),
      this.prisma.commissionEntry.count({ where }),
    ]);
    const userIds = [...new Set(rows.flatMap((row) => [row.beneficiaryUserId, row.staffUserId, row.headUserId].filter(Boolean) as string[]))];
    const [users, merchants] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }),
      this.prisma.merchant.findMany({ where: { id: { in: rows.map((row) => row.merchantId) } }, select: { id: true, name: true } }),
    ]);
    const names = new Map(users.map((user) => [user.id, fullName(user)]));
    const merchantNames = new Map(merchants.map((row) => [row.id, loc(row.name).en]));
    return paged(
      rows.map((row) => ({
        id: row.id,
        merchantId: row.merchantId,
        merchantName: merchantNames.get(row.merchantId) ?? '',
        beneficiaryId: row.beneficiaryUserId,
        beneficiaryName: names.get(row.beneficiaryUserId) ?? '',
        staffId: row.staffUserId,
        staffName: row.staffUserId ? names.get(row.staffUserId) ?? '' : '',
        headId: row.headUserId,
        headName: row.headUserId ? names.get(row.headUserId) ?? '' : '',
        tier: row.tier,
        paymentId: row.subscriptionPaymentId,
        paymentReference: row.subscriptionPayment.idempotencyKey,
        planName: loc(row.subscriptionPayment.subscription.plan.name).en,
        eligibleAmount: dec(row.eligibleAmount),
        ratePercent: dec(row.ratePercent),
        amount: dec(row.amount),
        reversedAmount: dec(row.reversedAmount),
        netAmount: moneyString(money(dec(row.amount)).minus(money(dec(row.reversedAmount)))),
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        approvedAt: row.approvedAt?.toISOString() ?? null,
        adjustments: row.adjustments.map((adj) => ({ id: adj.id, amount: dec(adj.amount), reason: adj.reason, refundId: adj.refundId, createdAt: adj.createdAt.toISOString() })),
      })),
      total,
      page,
    );
  }

  async withdrawals(scope: MarketingScope, query: Record<string, unknown>) {
    const page = pageQuery(query);
    const raw = readQuery(query);
    const range = dateRange(raw);
    const where: Prisma.MarketingRedemptionWhereInput = {
      ...(scope.isAdmin ? (raw.userId ? { userId: raw.userId } : {}) : { userId: scope.userId }),
      ...(raw.status ? { status: raw.status as never } : {}),
      ...(range ? { createdAt: range } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.marketingRedemption.findMany({ where, include: { user: { select: { firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.pageSize }),
      this.prisma.marketingRedemption.count({ where }),
    ]);
    return paged(rows.map((row) => ({ ...this.presentWithdrawal(row), userName: fullName(row.user), email: row.user.email })), total, page);
  }

  async walletsOverview(query: Record<string, unknown>) {
    const page = pageQuery(query);
    const where: Prisma.MarketingWalletWhereInput = page.q ? { user: { OR: [{ firstName: { contains: page.q, mode: 'insensitive' } }, { lastName: { contains: page.q, mode: 'insensitive' } }, { email: { contains: page.q, mode: 'insensitive' } }] } } : {};
    const [rows, total] = await Promise.all([
      this.prisma.marketingWallet.findMany({ where, include: { user: { select: { firstName: true, lastName: true, marketingProfile: { select: { kind: true } } } } }, orderBy: { updatedAt: 'desc' }, skip: page.skip, take: page.pageSize }),
      this.prisma.marketingWallet.count({ where }),
    ]);
    return paged(
      rows.map((row) => ({
        userId: row.userId,
        name: fullName(row.user),
        kind: row.user.marketingProfile?.kind ?? null,
        available: dec(row.balance),
        pending: dec(row.pendingBalance),
        reserved: dec(row.reservedBalance),
        recoveryDue: dec(row.recoveryDue),
        totalEarned: dec(row.totalEarned),
        totalWithdrawn: dec(row.totalWithdrawn),
      })),
      total,
      page,
    );
  }
}

export type { Db };
