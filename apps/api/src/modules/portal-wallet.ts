import type { Prisma, PrismaClient } from '@prisma/client';
import { dec } from '../common/crypto';
import { badRequest } from '../common/errors';
import { availableBalance, parseWithdrawalAmount } from '../domain/wallet';
import { money, moneyString } from '../domain/money';

type Db = PrismaClient | Prisma.TransactionClient;

const reservedSettlement = ['DRAFT', 'PENDING_APPROVAL'] as const;
const paidSettlement = ['APPROVED', 'PAID'] as const;
const heldReward = ['REQUESTED', 'PAID'] as const;

export type WalletTransaction = { id: string; createdAt: string; type: 'EARNED' | 'WITHDRAWAL' | 'REWARD'; amount: string };
export type WalletWithdrawal = { id: string; createdAt: string; amount: string; status: string };

async function merchantPosition(db: Db, merchantId: string) {
  const [owed, settled, pending] = await Promise.all([
    db.order.aggregate({ where: { merchantId, status: 'DELIVERED' }, _sum: { merchantNet: true } }),
    db.settlement.aggregate({ where: { merchantId, status: { in: [...paidSettlement] } }, _sum: { amount: true } }),
    db.settlement.aggregate({ where: { merchantId, status: { in: [...reservedSettlement] } }, _sum: { amount: true } }),
  ]);
  return {
    available: availableBalance(dec(owed._sum.merchantNet), dec(settled._sum.amount), dec(pending._sum.amount)),
    pending: moneyString(money(dec(pending._sum.amount))),
    withdrawn: moneyString(money(dec(settled._sum.amount))),
  };
}

export async function merchantWallet(db: Db, merchantId: string) {
  const [position, ledger, withdrawals] = await Promise.all([
    merchantPosition(db, merchantId),
    db.ledgerEntry.findMany({
      where: { merchantId, type: { in: ['MERCHANT_AMOUNT', 'SETTLEMENT_ADJUSTMENT'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    db.settlement.findMany({ where: { merchantId }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  return {
    ...position,
    transactions: ledger.map((row): WalletTransaction => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      type: row.type === 'MERCHANT_AMOUNT' ? 'EARNED' : 'WITHDRAWAL',
      amount: row.type === 'MERCHANT_AMOUNT' ? moneyString(money(dec(row.amount))) : moneyString(money(dec(row.amount)).neg()),
    })),
    withdrawals: withdrawals.map((row): WalletWithdrawal => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      amount: moneyString(money(dec(row.amount))),
      status: row.status,
    })),
  };
}

export async function requestMerchantWithdrawal(db: PrismaClient, merchantId: string, actorId: string, rawAmount: unknown) {
  const amount = withdrawalAmount(rawAmount);
  const settlement = await db.$transaction(async (tx) => {
    const position = await merchantPosition(tx, merchantId);
    if (money(amount).gt(position.available)) throw badRequest('Amount is more than the available balance');
    const now = new Date();
    return tx.settlement.create({
      data: {
        merchantId,
        amount,
        status: 'PENDING_APPROVAL',
        periodStart: now,
        periodEnd: now,
        note: 'Withdrawal request',
        createdById: actorId,
      },
    });
  });
  return { id: settlement.id, amount: moneyString(money(dec(settlement.amount))), status: settlement.status };
}

export async function customerRewardAvailable(db: Db, customerId: string, rewardBalance: { toFixed: (digits: number) => string }) {
  const held = await db.customerWithdrawal.aggregate({
    where: { customerId, status: { in: [...heldReward] } },
    _sum: { amount: true },
  });
  return availableBalance(dec(rewardBalance), dec(held._sum.amount), '0.000');
}

export async function customerWallet(db: Db, userId: string) {
  const customer = await db.customer.findUnique({
    where: { userId },
    include: { withdrawals: { orderBy: { createdAt: 'desc' }, take: 50 } },
  });
  if (!customer) throw badRequest('Customer profile missing');
  const available = await customerRewardAvailable(db, customer.id, customer.rewardBalance);
  const balance = money(dec(customer.rewardBalance));
  const transactions: WalletTransaction[] = [];
  if (balance.gt(0)) {
    transactions.push({ id: `reward:${customer.id}`, createdAt: customer.createdAt.toISOString(), type: 'REWARD', amount: moneyString(balance) });
  }
  for (const row of customer.withdrawals) {
    if (row.status === 'REJECTED') continue;
    transactions.push({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      type: 'WITHDRAWAL',
      amount: moneyString(money(dec(row.amount)).neg()),
    });
  }
  transactions.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return {
    available,
    pending: moneyString(customer.withdrawals.filter((row) => row.status === 'REQUESTED').reduce((sum, row) => sum.plus(dec(row.amount)), money(0))),
    withdrawn: moneyString(customer.withdrawals.filter((row) => row.status === 'PAID').reduce((sum, row) => sum.plus(dec(row.amount)), money(0))),
    transactions,
    withdrawals: customer.withdrawals.map((row): WalletWithdrawal => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      amount: moneyString(money(dec(row.amount))),
      status: row.status,
    })),
  };
}

export async function requestCustomerWithdrawal(db: PrismaClient, userId: string, rawAmount: unknown) {
  const amount = withdrawalAmount(rawAmount);
  const created = await db.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { userId } });
    if (!customer) throw badRequest('Customer profile missing');
    const available = await customerRewardAvailable(tx, customer.id, customer.rewardBalance);
    if (money(amount).gt(available)) throw badRequest('Amount is more than the available balance');
    return tx.customerWithdrawal.create({ data: { customerId: customer.id, amount } });
  });
  return { id: created.id, amount: moneyString(money(dec(created.amount))), status: created.status };
}

function withdrawalAmount(value: unknown): string {
  try {
    return parseWithdrawalAmount(value);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'Enter an amount');
  }
}
