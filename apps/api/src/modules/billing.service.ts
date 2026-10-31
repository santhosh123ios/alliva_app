import type { BillingBoard, BillMethod, BillOrder, CashDrawerView, DinerBill, OpenBill, PaidBill, ServiceRequestView } from '@alliva/types';
import { Prisma, type OrderStatus } from '@prisma/client';
import { badRequest, notFound } from '../common/errors';
import { dec, loc } from '../common/crypto';
import { money, moneyString } from '../domain/money';
import { startOfDay } from '../domain/store-day';
import type { PrismaService } from '../prisma/prisma.service';
import type { CommerceService } from './commerce.service';
import type { OrdersGateway } from './orders.gateway';

/** Cancelled and refunded orders never reach a bill. */
const NOT_BILLABLE: OrderStatus[] = ['CANCELLED', 'REFUNDED'];
/** A bill nobody settled is dropped from the till after a day, so last night's tables do not pile up. */
const OPEN_WINDOW_MS = 24 * 60 * 60_000;
/** How long a diner still sees the receipt after paying, before the table is fresh for the next guests. */
const RECEIPT_WINDOW_MS = 20 * 60_000;

const orderInclude = {
  items: { include: { addons: { select: { name: true } } } },
  payments: { orderBy: { createdAt: 'desc' }, take: 1 },
  table: { select: { id: true, number: true, name: true } },
  customer: { include: { user: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.OrderInclude;
type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

const billInclude = { orders: { include: orderInclude, orderBy: { createdAt: 'asc' } }, table: { select: { id: true, number: true, name: true } } } satisfies Prisma.BillInclude;
type BillRow = Prisma.BillGetPayload<{ include: typeof billInclude }>;

type Staff = { id: string; merchantId: string };
type Method = 'CASH' | 'CARD' | 'BENEFIT_PAY';

/** Paid in the app before the guest reached the till. Cash is only ever taken at the till. */
function prepaid(order: OrderRow) {
  const payment = order.payments[0];
  return payment?.status === 'CAPTURED' && payment.method !== 'CASH';
}

function sum(rows: OrderRow[], pick: (order: OrderRow) => Prisma.Decimal) {
  return rows.reduce((total, order) => total.plus(dec(pick(order))), money(0));
}

/** The billing app: tables and counter orders still to pay, settling them at the till, and the cash drawer. */
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: OrdersGateway,
    private readonly commerce: CommerceService,
  ) {}

  async board(user: Staff, branchId?: string, now = new Date()): Promise<BillingBoard> {
    const merchantId = user.merchantId;
    const [orders, bills, requests, drawer] = await Promise.all([
      this.openOrders(merchantId, { branchId }, now),
      this.prisma.bill.findMany({
        where: { merchantId, settledAt: { gte: startOfDay(now) }, ...(branchId ? { branchId } : {}) },
        include: billInclude,
        orderBy: { settledAt: 'desc' },
        take: 100,
      }),
      this.prisma.serviceRequest.findMany({
        where: { merchantId, kind: 'BILL', status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        include: { table: { select: { id: true, number: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.cashDrawer.findFirst({ where: { merchantId, branchId: branchId ?? null, closedAt: null }, orderBy: { openedAt: 'desc' } }),
    ]);
    const callers = new Set(requests.map((row) => row.tableId));
    const open = this.group(orders).map((bill) => ({ ...bill, requested: Boolean(bill.table && callers.has(bill.table.id)) }));
    const paid = await this.presentBills(bills);
    const byMethod = new Map<BillMethod, { method: BillMethod; bills: number; amount: Prisma.Decimal }>();
    for (const bill of paid) {
      const row = byMethod.get(bill.method) ?? { method: bill.method, bills: 0, amount: money(0) };
      row.bills += 1;
      row.amount = row.amount.plus(bill.method === 'ONLINE' ? bill.prepaid : bill.collected);
      byMethod.set(bill.method, row);
    }
    return {
      open: open.sort((a, b) => Number(b.requested) - Number(a.requested) || a.openedAt.localeCompare(b.openedAt)),
      paid,
      requests: await this.presentRequests(requests),
      drawer: drawer ? await this.presentDrawer(drawer) : null,
      today: {
        bills: paid.length,
        collected: moneyString(paid.reduce((total, bill) => total.plus(bill.collected), money(0))),
        byMethod: [...byMethod.values()].sort((a, b) => b.amount.comparedTo(a.amount)).map((row) => ({ ...row, amount: moneyString(row.amount) })),
        due: moneyString(open.reduce((total, bill) => total.plus(bill.due), money(0))),
      },
      generatedAt: now.toISOString(),
    };
  }

  /**
   * Takes payment for a table or a counter order. The ids must be every unpaid order the till showed for that
   * table, so an order that arrives while the guest is paying is not closed off unpaid.
   */
  async settle(user: Staff, input: { orderIds: string[]; method: Method; tendered?: string; branchId?: string }, now = new Date()): Promise<PaidBill> {
    const ids = [...new Set(input.orderIds)];
    const orders = await this.prisma.order.findMany({ where: { id: { in: ids }, merchantId: user.merchantId }, include: orderInclude });
    if (orders.length !== ids.length) throw notFound('Order not found');
    if (orders.some((order) => order.billId)) throw badRequest('This bill is already paid');
    if (orders.some((order) => NOT_BILLABLE.includes(order.status) || order.fulfillmentType === 'DELIVERY')) throw badRequest('This order cannot be paid at the till');
    const tableIds = new Set(orders.map((order) => (order.fulfillmentType === 'DINE_IN' ? order.tableId : null)));
    if (tableIds.size !== 1) throw badRequest('Settle one table at a time');
    const tableId = [...tableIds][0] ?? null;
    if (tableId) {
      const current = await this.openOrders(user.merchantId, { tableId }, now);
      if (current.some((order) => !ids.includes(order.id))) throw badRequest('A new order reached this table. Check the bill again.');
    } else if (orders.length !== 1) {
      throw badRequest('Settle one counter order at a time');
    }

    const owing = orders.filter((order) => !prepaid(order));
    const due = sum(owing, (order) => order.total);
    const total = sum(orders, (order) => order.total);
    let tendered: Prisma.Decimal | null = null;
    if (input.method === 'CASH' && due.gt(0)) {
      tendered = money(input.tendered ?? '0');
      if (tendered.lt(due)) throw badRequest('The cash received is less than the bill');
    }
    const branchId = input.branchId ?? orders[0]!.branchId;
    const drawer = input.method === 'CASH' && due.gt(0)
      ? await this.prisma.cashDrawer.findFirst({ where: { merchantId: user.merchantId, branchId: input.branchId ?? null, closedAt: null }, orderBy: { openedAt: 'desc' } })
      : null;
    // A bill with nothing left to pay keeps the method the guest paid with in the app.
    const method = due.gt(0) ? input.method : ((orders[0]!.payments[0]?.method as Method | undefined) ?? input.method);

    const bill = await this.withNextNumber(user.merchantId, (number) =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.bill.create({
          data: {
            merchantId: user.merchantId,
            branchId,
            number,
            tableId,
            method,
            subtotal: moneyString(sum(orders, (order) => order.subtotal)),
            discount: moneyString(sum(orders, (order) => order.discount)),
            serviceFee: moneyString(sum(orders, (order) => order.serviceFee)),
            tax: moneyString(sum(orders, (order) => order.tax)),
            total: moneyString(total),
            prepaid: moneyString(total.minus(due)),
            collected: moneyString(due),
            tendered: tendered ? moneyString(tendered) : null,
            change: tendered ? moneyString(tendered.minus(due)) : null,
            cashDrawerId: drawer?.id ?? null,
            settledById: user.id,
            settledAt: now,
          },
        });
        const claimed = await tx.order.updateMany({ where: { id: { in: ids }, billId: null }, data: { billId: created.id } });
        if (claimed.count !== ids.length) throw badRequest('This bill is already paid');
        for (const order of owing) {
          const payment = order.payments[0];
          const data = { method: input.method, provider: input.method === 'CASH' ? 'CASH' : 'TERMINAL', status: 'CAPTURED', gatewayFee: '0' } as const;
          if (payment) await tx.payment.update({ where: { id: payment.id }, data });
          else await tx.payment.create({ data: { ...data, orderId: order.id, customerId: order.customerId, merchantId: order.merchantId, amount: dec(order.total), idempotencyKey: `bill:${created.id}:${order.id}`, createdById: user.id } });
          if (input.method === 'CASH') {
            // Cash taken at the till is in the store's hands straight away: nothing for a rider to deposit.
            await tx.cashCollection.upsert({
              where: { orderId: order.id },
              update: { status: 'CONFIRMED', driverId: null, collectedAmount: dec(order.total), collectedAt: now },
              create: { orderId: order.id, merchantId: order.merchantId, amount: dec(order.total), status: 'CONFIRMED', collectedAmount: dec(order.total), collectedAt: now },
            });
          } else {
            await tx.cashCollection.deleteMany({ where: { orderId: order.id, status: 'PENDING' } });
          }
        }
        if (tableId) {
          await tx.tableSession.updateMany({ where: { tableId, closedAt: null }, data: { closedAt: now } });
          await tx.diningTable.update({ where: { id: tableId }, data: { status: 'AVAILABLE' } });
          await tx.serviceRequest.updateMany({
            where: { tableId, kind: 'BILL', status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
            data: { status: 'RESOLVED', resolvedAt: now, resolvedById: user.id },
          });
        }
        return tx.bill.findUniqueOrThrow({ where: { id: created.id }, include: billInclude });
      }),
    );

    // Orders already served were booked when they went out; anything served later is booked by the kitchen flow.
    for (const order of owing.filter((row) => row.status === 'DELIVERED')) {
      const booked = await this.prisma.ledgerEntry.findFirst({ where: { referenceId: order.id, type: 'CUSTOMER_PAYMENT' } });
      if (!booked) await this.commerce.postLedger(order.id, '0', false);
    }
    for (const order of orders) this.gateway.emit({ id: order.id, merchantId: order.merchantId, customerId: order.customerId });
    if (tableId) this.gateway.emitServiceRequest({ id: bill.id, merchantId: user.merchantId, tableId, status: 'RESOLVED', kind: 'BILL' });
    return (await this.presentBills([bill]))[0]!;
  }

  async openDrawer(user: Staff, input: { openingFloat: string; branchId?: string }) {
    const open = await this.prisma.cashDrawer.findFirst({ where: { merchantId: user.merchantId, branchId: input.branchId ?? null, closedAt: null } });
    if (open) throw badRequest('The drawer is already open');
    const drawer = await this.prisma.cashDrawer.create({ data: { merchantId: user.merchantId, branchId: input.branchId ?? null, openingFloat: input.openingFloat, openedById: user.id } });
    return this.presentDrawer(drawer);
  }

  async closeDrawer(user: Staff, id: string, input: { countedAmount: string; note?: string }) {
    const drawer = await this.prisma.cashDrawer.findFirst({ where: { id, merchantId: user.merchantId } });
    if (!drawer) throw notFound('Drawer not found');
    if (drawer.closedAt) throw badRequest('This drawer is already closed');
    const cash = await this.drawerCash(drawer.id);
    const closed = await this.prisma.cashDrawer.update({
      where: { id },
      data: { expectedAmount: moneyString(money(dec(drawer.openingFloat)).plus(cash.amount)), countedAmount: input.countedAmount, note: input.note || null, closedById: user.id, closedAt: new Date() },
    });
    return this.presentDrawer(closed);
  }

  /** The last closed drawers, newest first, for the shift history. */
  async drawers(user: Staff, branchId?: string) {
    const rows = await this.prisma.cashDrawer.findMany({ where: { merchantId: user.merchantId, ...(branchId ? { branchId } : {}), closedAt: { not: null } }, orderBy: { closedAt: 'desc' }, take: 14 });
    return { drawers: await Promise.all(rows.map((row) => this.presentDrawer(row))) };
  }

  /** What a diner's table has ordered and still owes, or the receipt for a few minutes after paying. */
  async dinerBill(tableId: string, now = new Date()): Promise<DinerBill | null> {
    const table = await this.prisma.diningTable.findUnique({ where: { id: tableId }, select: { merchantId: true } });
    if (!table) return null;
    const orders = await this.openOrders(table.merchantId, { tableId }, now);
    if (orders.length) return this.dinerSummary(orders, null);
    const last = await this.prisma.bill.findFirst({ where: { tableId, settledAt: { gte: new Date(now.getTime() - RECEIPT_WINDOW_MS) } }, include: billInclude, orderBy: { settledAt: 'desc' } });
    if (!last) return null;
    return this.dinerSummary(last.orders, { number: last.number, method: billMethod(last), settledAt: last.settledAt.toISOString() });
  }

  private dinerSummary(orders: OrderRow[], settled: DinerBill['settled']): DinerBill {
    const total = sum(orders, (order) => order.total);
    const paid = settled ? total : sum(orders.filter(prepaid), (order) => order.total);
    return {
      orders: orders.map((order) => ({
        number: order.number,
        status: order.status,
        paid: Boolean(settled) || prepaid(order),
        total: dec(order.total),
        items: order.items.map((item) => ({ name: loc(item.name), quantity: item.quantity, total: dec(item.lineTotal) })),
      })),
      subtotal: moneyString(sum(orders, (order) => order.subtotal)),
      discount: moneyString(sum(orders, (order) => order.discount)),
      serviceFee: moneyString(sum(orders, (order) => order.serviceFee)),
      tax: moneyString(sum(orders, (order) => order.tax)),
      total: moneyString(total),
      paid: moneyString(paid),
      due: moneyString(total.minus(paid)),
      settled,
    };
  }

  /** Orders the till still has to take payment for: every unpaid table order, and counter orders not yet paid. */
  private async openOrders(merchantId: string, scope: { branchId?: string; tableId?: string }, now: Date) {
    const orders = await this.prisma.order.findMany({
      where: {
        merchantId,
        billId: null,
        status: { notIn: NOT_BILLABLE },
        fulfillmentType: scope.tableId ? 'DINE_IN' : { not: 'DELIVERY' },
        createdAt: { gte: new Date(now.getTime() - OPEN_WINDOW_MS) },
        ...(scope.branchId ? { branchId: scope.branchId } : {}),
        ...(scope.tableId ? { tableId: scope.tableId } : {}),
      },
      include: orderInclude,
      orderBy: { createdAt: 'asc' },
      take: 300,
    });
    // A counter order paid in the app has nothing left for the till.
    return orders.filter((order) => (order.fulfillmentType === 'DINE_IN' && order.tableId) || !prepaid(order));
  }

  private group(orders: OrderRow[]): Omit<OpenBill, 'requested'>[] {
    const tables = new Map<string, OrderRow[]>();
    const bills: Omit<OpenBill, 'requested'>[] = [];
    for (const order of orders) {
      if (order.fulfillmentType === 'DINE_IN' && order.tableId) tables.set(order.tableId, [...(tables.get(order.tableId) ?? []), order]);
      else bills.push(this.openBill(`order:${order.id}`, [order]));
    }
    for (const [tableId, rows] of tables) bills.push(this.openBill(`table:${tableId}`, rows));
    return bills;
  }

  private openBill(key: string, orders: OrderRow[]): Omit<OpenBill, 'requested'> {
    const first = orders[0]!;
    const total = sum(orders, (order) => order.total);
    const paidAhead = sum(orders.filter(prepaid), (order) => order.total);
    const table = first.fulfillmentType === 'DINE_IN' ? first.table : null;
    return {
      key,
      kind: table ? 'TABLE' : 'COUNTER',
      table,
      customerName: table ? null : `${first.customer.user.firstName} ${first.customer.user.lastName}`.trim(),
      orders: orders.map(presentOrder),
      openedAt: first.createdAt.toISOString(),
      subtotal: moneyString(sum(orders, (order) => order.subtotal)),
      discount: moneyString(sum(orders, (order) => order.discount)),
      serviceFee: moneyString(sum(orders, (order) => order.serviceFee)),
      tax: moneyString(sum(orders, (order) => order.tax)),
      total: moneyString(total),
      prepaid: moneyString(paidAhead),
      due: moneyString(total.minus(paidAhead)),
      served: orders.every((order) => order.status === 'DELIVERED'),
    };
  }

  private async presentBills(rows: BillRow[]): Promise<PaidBill[]> {
    const names = await this.names(rows.map((row) => row.settledById));
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      kind: row.tableId ? 'TABLE' : 'COUNTER',
      table: row.table,
      method: billMethod(row),
      subtotal: dec(row.subtotal),
      discount: dec(row.discount),
      serviceFee: dec(row.serviceFee),
      tax: dec(row.tax),
      total: dec(row.total),
      prepaid: dec(row.prepaid),
      collected: dec(row.collected),
      tendered: row.tendered ? dec(row.tendered) : null,
      change: row.change ? dec(row.change) : null,
      settledAt: row.settledAt.toISOString(),
      settledBy: names.get(row.settledById) ?? null,
      orders: row.orders.map(presentOrder),
    }));
  }

  private async presentDrawer(row: Prisma.CashDrawerGetPayload<object>): Promise<CashDrawerView> {
    const [cash, names] = await Promise.all([this.drawerCash(row.id), this.names([row.openedById, row.closedById])]);
    const expected = row.expectedAmount ? money(dec(row.expectedAmount)) : money(dec(row.openingFloat)).plus(cash.amount);
    return {
      id: row.id,
      openedAt: row.openedAt.toISOString(),
      openedBy: names.get(row.openedById) ?? null,
      openingFloat: dec(row.openingFloat),
      cashSales: moneyString(cash.amount),
      bills: cash.bills,
      expected: moneyString(expected),
      closedAt: row.closedAt?.toISOString() ?? null,
      closedBy: row.closedById ? names.get(row.closedById) ?? null : null,
      countedAmount: row.countedAmount ? dec(row.countedAmount) : null,
      difference: row.countedAmount ? moneyString(money(dec(row.countedAmount)).minus(expected)) : null,
      note: row.note,
    };
  }

  /** Cash bills taken into a drawer. A bill's collected amount is already net of the change handed back. */
  private async drawerCash(drawerId: string) {
    const totals = await this.prisma.bill.aggregate({ where: { cashDrawerId: drawerId, method: 'CASH' }, _sum: { collected: true }, _count: true });
    return { amount: money(dec(totals._sum.collected)), bills: totals._count };
  }

  private async presentRequests(rows: Prisma.ServiceRequestGetPayload<{ include: { table: { select: { id: true; number: true; name: true } } } }>[]): Promise<ServiceRequestView[]> {
    const names = await this.names(rows.map((row) => row.acknowledgedById));
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      table: row.table,
      createdAt: row.createdAt.toISOString(),
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      acknowledgedBy: row.acknowledgedById ? names.get(row.acknowledgedById) ?? null : null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    }));
  }

  private async names(ids: (string | null)[]) {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    const users = wanted.length ? await this.prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, firstName: true } }) : [];
    return new Map(users.map((user) => [user.id, user.firstName]));
  }

  /** Bills are numbered per store. Two tills settling at once retry with the next number. */
  private async withNextNumber<T>(merchantId: string, run: (number: string) => Promise<T>) {
    for (let attempt = 0; ; attempt += 1) {
      const count = await this.prisma.bill.count({ where: { merchantId } });
      const number = `B-${String(count + 1 + attempt).padStart(5, '0')}`;
      try {
        return await run(number);
      } catch (error) {
        const clash = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!clash || attempt >= 4) throw error;
      }
    }
  }
}

function billMethod(row: { method: string; collected: Prisma.Decimal }): BillMethod {
  if (money(dec(row.collected)).isZero()) return 'ONLINE';
  return row.method === 'CASH' || row.method === 'CARD' ? row.method : 'BENEFIT_PAY';
}

function presentOrder(order: OrderRow): BillOrder {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    fulfillmentType: order.fulfillmentType,
    createdAt: order.createdAt.toISOString(),
    paid: prepaid(order),
    method: order.payments[0]?.method ?? null,
    subtotal: dec(order.subtotal),
    discount: dec(order.discount),
    serviceFee: dec(order.serviceFee),
    tax: dec(order.tax),
    total: dec(order.total),
    items: order.items.map((item) => ({
      name: loc(item.name),
      quantity: item.quantity,
      unitPrice: dec(item.unitPrice),
      total: dec(item.lineTotal),
      addons: item.addons.map((addon) => loc(addon.name)),
      notes: item.notes,
    })),
  };
}
