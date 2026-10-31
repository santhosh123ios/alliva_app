import type { FulfillmentType, OrderStatus } from '@alliva/types';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { dec, loc } from '../common/crypto';
import { money, moneyString } from '../domain/money';
import { dayKey, dayRange, hourOf, parseDay, startOfDay } from '../domain/store-day';
import type { PrismaService } from '../prisma/prisma.service';

const KITCHEN: OrderStatus[] = ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'];
const CLOSED: OrderStatus[] = ['CANCELLED', 'REFUNDED'];
const DAY_MS = 24 * 3_600_000;

const SUMMARY_LABELS = {
  orders: 'Orders', completed: 'Completed orders', cancelled: 'Cancelled orders', cancellationRate: 'Cancellation rate (%)',
  sales: 'Sales (BHD)', averageOrder: 'Average order (BHD)', discounts: 'Discounts (BHD)', deliveryFees: 'Delivery fees (BHD)',
  refunds: 'Refunds (BHD)', customers: 'Customers', repeatCustomers: 'Returning customers',
  prepMinutes: 'Average prep time (min)', deliveryMinutes: 'Average delivery time (min)', fulfilmentMinutes: 'Average order to handover (min)',
} as const;

type Event = { status: OrderStatus; createdAt: Date };
type Total = ReturnType<typeof money>;

/** What the kitchen, the till and the reports need from a store's orders. */
export class StoreOpsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tickets for the kitchen display: accepted, cooking and waiting to leave. */
  async kitchen(merchantId: string, branchId?: string, now = new Date()) {
    const orders = await this.prisma.order.findMany({
      where: { merchantId, ...(branchId ? { branchId } : {}), status: { in: KITCHEN } },
      include: {
        items: { include: { addons: { select: { name: true } } } },
        events: { orderBy: { createdAt: 'asc' }, select: { status: true, createdAt: true } },
        table: { select: { number: true } },
        customer: { include: { user: { select: { firstName: true } } } },
        dispatch: { select: { pickupVerifiedAt: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 150,
    });
    return {
      tickets: orders.map((order) => ({
        id: order.id,
        number: order.number,
        status: order.status,
        fulfillmentType: order.fulfillmentType,
        tableNumber: order.table?.number ?? null,
        customerName: order.customer.user.firstName,
        notes: order.notes,
        createdAt: order.createdAt.toISOString(),
        acceptedAt: eventAt(order.events, 'ACCEPTED')?.toISOString() ?? null,
        startedAt: eventAt(order.events, 'PREPARING')?.toISOString() ?? null,
        readyAt: eventAt(order.events, 'READY_FOR_PICKUP')?.toISOString() ?? null,
        scheduledFor: order.scheduledFor?.toISOString() ?? null,
        preparationMinutes: order.preparationMinutes,
        estimatedReadyAt: order.estimatedReadyAt?.toISOString() ?? null,
        items: order.items.map((item) => ({
          id: item.id,
          name: loc(item.name),
          quantity: item.quantity,
          notes: item.notes,
          addons: item.addons.map((addon) => loc(addon.name)),
        })),
      })),
      generatedAt: now.toISOString(),
    };
  }

  /** One store day at the till: sales by payment method, refunds and where the cash is. */
  async takings(merchantId: string, input: { branchId?: string; date?: string }, now = new Date()) {
    const start = parseDay(input.date) ?? startOfDay(now);
    const end = new Date(start.getTime() + DAY_MS);
    const branch = input.branchId ? { branchId: input.branchId } : {};
    const [orders, refunds, deposits, withRiders] = await Promise.all([
      this.prisma.order.findMany({
        where: { merchantId, ...branch, createdAt: { gte: start, lt: end } },
        select: {
          id: true, status: true, fulfillmentType: true, total: true, discount: true, deliveryFee: true, tax: true, createdAt: true,
          payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { method: true, status: true } },
        },
      }),
      this.prisma.refund.findMany({
        where: { merchantId, createdAt: { gte: start, lt: end }, ...(input.branchId ? { order: { branchId: input.branchId } } : {}) },
        select: { amount: true, status: true },
      }),
      this.prisma.cashDeposit.findMany({ where: { merchantId, OR: [{ status: 'SUBMITTED' }, { reviewedAt: { gte: start, lt: end } }] }, select: { amount: true, status: true, reviewedAt: true } }),
      this.prisma.cashCollection.findMany({
        where: { merchantId, status: 'COLLECTED', depositId: null, driverId: { not: null }, ...(input.branchId ? { order: { branchId: input.branchId } } : {}) },
        select: { amount: true, collectedAmount: true },
      }),
    ]);

    const live = orders.filter((order) => !CLOSED.includes(order.status));
    const methods = new Map<string, { method: string; orders: number; amount: Total; paid: Total }>();
    const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, amount: money(0) }));
    for (const order of live) {
      const payment = order.payments[0];
      const key = payment?.method ?? 'UNPAID';
      const row = methods.get(key) ?? { method: key, orders: 0, amount: money(0), paid: money(0) };
      row.orders += 1;
      row.amount = row.amount.plus(dec(order.total));
      // Cash is captured when a counter order is handed over or a bill is settled at the till; card and online when charged.
      if (payment?.status === 'CAPTURED') row.paid = row.paid.plus(dec(order.total));
      methods.set(key, row);
      const slot = hours[hourOf(order.createdAt)]!;
      slot.orders += 1;
      slot.amount = slot.amount.plus(dec(order.total));
    }
    const sum = (rows: { total: unknown }[]) => rows.reduce((total, row) => total.plus(dec(row.total as never)), money(0));
    const gross = sum(live);
    return {
      date: dayKey(start),
      orders: {
        total: orders.length,
        completed: orders.filter((order) => order.status === 'DELIVERED').length,
        open: live.filter((order) => order.status !== 'DELIVERED').length,
        cancelled: orders.filter((order) => order.status === 'CANCELLED').length,
      },
      gross: moneyString(gross),
      completedSales: moneyString(sum(live.filter((order) => order.status === 'DELIVERED'))),
      discounts: moneyString(live.reduce((total, order) => total.plus(dec(order.discount)), money(0))),
      deliveryFees: moneyString(live.reduce((total, order) => total.plus(dec(order.deliveryFee)), money(0))),
      tax: moneyString(live.reduce((total, order) => total.plus(dec(order.tax)), money(0))),
      averageOrder: live.length ? moneyString(gross.div(live.length)) : '0.000',
      byMethod: [...methods.values()]
        .sort((a, b) => b.amount.comparedTo(a.amount))
        .map((row) => ({ method: row.method, orders: row.orders, amount: moneyString(row.amount), paid: moneyString(row.paid), due: moneyString(row.amount.minus(row.paid)) })),
      byHour: hours.filter((row) => row.orders > 0).map((row) => ({ hour: row.hour, orders: row.orders, amount: moneyString(row.amount) })),
      refunds: {
        count: refunds.length,
        requested: moneyString(refunds.filter((row) => row.status === 'REQUESTED' || row.status === 'APPROVED').reduce((total, row) => total.plus(dec(row.amount)), money(0))),
        processed: moneyString(refunds.filter((row) => row.status === 'PROCESSED').reduce((total, row) => total.plus(dec(row.amount)), money(0))),
      },
      cash: {
        withRiders: moneyString(withRiders.reduce((total, row) => total.plus(dec(row.collectedAmount ?? row.amount)), money(0))),
        awaitingConfirmation: moneyString(deposits.filter((row) => row.status === 'SUBMITTED').reduce((total, row) => total.plus(dec(row.amount)), money(0))),
        depositsToReview: deposits.filter((row) => row.status === 'SUBMITTED').length,
        confirmed: moneyString(deposits.filter((row) => row.status === 'CONFIRMED').reduce((total, row) => total.plus(dec(row.amount)), money(0))),
      },
    };
  }

  /** Sales report for a date range: totals, per day, channel, payment, hour, products and service times. */
  async report(merchantId: string, input: { from?: string; to?: string; branchId?: string }, now = new Date()) {
    const range = dayRange(input, now);
    const branch = input.branchId ? { branchId: input.branchId } : {};
    const [orders, refunds] = await Promise.all([
      this.prisma.order.findMany({
        where: { merchantId, ...branch, createdAt: { gte: range.start, lt: range.end } },
        select: {
          id: true, status: true, fulfillmentType: true, customerId: true, total: true, discount: true, deliveryFee: true, createdAt: true,
          items: { select: { productId: true, name: true, quantity: true, lineTotal: true } },
          events: { orderBy: { createdAt: 'asc' }, select: { status: true, createdAt: true } },
          payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { method: true } },
        },
        take: 20_000,
      }),
      this.prisma.refund.findMany({
        where: { merchantId, status: 'PROCESSED', createdAt: { gte: range.start, lt: range.end }, ...(input.branchId ? { order: { branchId: input.branchId } } : {}) },
        select: { amount: true },
      }),
    ]);

    const live = orders.filter((order) => !CLOSED.includes(order.status));
    const sales = live.reduce((total, order) => total.plus(dec(order.total)), money(0));
    const daily = new Map(range.days.map((day) => [day, { date: day, orders: 0, sales: money(0) }]));
    const channels = new Map<FulfillmentType, { orders: number; sales: Total }>();
    const methods = new Map<string, { orders: number; sales: Total }>();
    const hours = Array.from({ length: 24 }, () => 0);
    const products = new Map<string, { name: Record<string, string>; quantity: number; sales: Total }>();
    const customers = new Map<string, number>();
    const prep: number[] = [];
    const delivery: number[] = [];
    const fulfilment: number[] = [];

    for (const order of live) {
      const day = daily.get(dayKey(order.createdAt));
      if (day) {
        day.orders += 1;
        day.sales = day.sales.plus(dec(order.total));
      }
      const channel = channels.get(order.fulfillmentType) ?? { orders: 0, sales: money(0) };
      channel.orders += 1;
      channel.sales = channel.sales.plus(dec(order.total));
      channels.set(order.fulfillmentType, channel);
      const key = order.payments[0]?.method ?? 'UNPAID';
      const method = methods.get(key) ?? { orders: 0, sales: money(0) };
      method.orders += 1;
      method.sales = method.sales.plus(dec(order.total));
      methods.set(key, method);
      hours[hourOf(order.createdAt)]! += 1;
      customers.set(order.customerId, (customers.get(order.customerId) ?? 0) + 1);
      for (const item of order.items) {
        const id = item.productId ?? JSON.stringify(item.name);
        const row = products.get(id) ?? { name: loc(item.name), quantity: 0, sales: money(0) };
        row.quantity += item.quantity;
        row.sales = row.sales.plus(dec(item.lineTotal));
        products.set(id, row);
      }
      const accepted = eventAt(order.events, 'ACCEPTED');
      const ready = eventAt(order.events, 'READY_FOR_PICKUP');
      const out = eventAt(order.events, 'OUT_FOR_DELIVERY');
      const done = eventAt(order.events, 'DELIVERED');
      if (accepted && ready) prep.push(minutes(accepted, ready));
      if (out && done) delivery.push(minutes(out, done));
      if (done) fulfilment.push(minutes(order.createdAt, done));
    }

    const cancelled = orders.filter((order) => order.status === 'CANCELLED').length;
    return {
      from: range.days[0]!,
      to: range.days.at(-1)!,
      summary: {
        orders: live.length,
        completed: live.filter((order) => order.status === 'DELIVERED').length,
        cancelled,
        cancellationRate: orders.length ? Math.round((cancelled / orders.length) * 1000) / 10 : 0,
        sales: moneyString(sales),
        averageOrder: live.length ? moneyString(sales.div(live.length)) : '0.000',
        discounts: moneyString(live.reduce((total, order) => total.plus(dec(order.discount)), money(0))),
        deliveryFees: moneyString(live.reduce((total, order) => total.plus(dec(order.deliveryFee)), money(0))),
        refunds: moneyString(refunds.reduce((total, row) => total.plus(dec(row.amount)), money(0))),
        customers: customers.size,
        repeatCustomers: [...customers.values()].filter((count) => count > 1).length,
        prepMinutes: average(prep),
        deliveryMinutes: average(delivery),
        fulfilmentMinutes: average(fulfilment),
      },
      daily: [...daily.values()].map((row) => ({ date: row.date, orders: row.orders, sales: moneyString(row.sales) })),
      byChannel: [...channels.entries()].map(([type, row]) => ({ type, orders: row.orders, sales: moneyString(row.sales) })).sort((a, b) => b.orders - a.orders),
      byPayment: [...methods.entries()].map(([method, row]) => ({ method, orders: row.orders, sales: moneyString(row.sales) })).sort((a, b) => b.orders - a.orders),
      byHour: hours.map((count, hour) => ({ hour, orders: count })),
      topProducts: [...products.values()]
        .sort((a, b) => b.quantity - a.quantity || b.sales.comparedTo(a.sales))
        .slice(0, 10)
        .map((row) => ({ name: row.name, quantity: row.quantity, sales: moneyString(row.sales) })),
    };
  }

  async reportCsv(merchantId: string, input: { from?: string; to?: string; branchId?: string }) {
    const report = await this.report(merchantId, input);
    const rows: (string | number)[][] = [
      ['Report', `${report.from} to ${report.to}`],
      [],
      ['Metric', 'Value'],
      ...Object.entries(report.summary).map(([key, value]) => [SUMMARY_LABELS[key as keyof typeof SUMMARY_LABELS], value ?? '']),
      [],
      ['Date', 'Orders', 'Sales (BHD)'],
      ...report.daily.map((row) => [row.date, row.orders, row.sales]),
      [],
      ['Channel', 'Orders', 'Sales (BHD)'],
      ...report.byChannel.map((row) => [row.type, row.orders, row.sales]),
      [],
      ['Payment method', 'Orders', 'Sales (BHD)'],
      ...report.byPayment.map((row) => [row.method, row.orders, row.sales]),
      [],
      ['Product', 'Product (Arabic)', 'Quantity', 'Sales (BHD)'],
      ...report.topProducts.map((row) => [row.name.en ?? '', row.name.ar ?? '', row.quantity, row.sales]),
    ];
    // A byte-order mark so spreadsheet apps read the Arabic names as UTF-8.
    return `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  }

  async reportPdf(merchantId: string, input: { from?: string; to?: string; branchId?: string }) {
    const [report, merchant] = await Promise.all([
      this.report(merchantId, input),
      this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { name: true } }),
    ]);
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let page = pdf.addPage([595, 842]);
    let y = 790;
    // The standard PDF fonts only cover Latin text, so Arabic-only names are skipped here; the CSV has both.
    const latin = (text: string) => text.replace(/[^\x20-\x7E]/g, '').trim();
    const line = (text: string, options: { size?: number; strong?: boolean; x?: number } = {}) => {
      if (y < 60) {
        page = pdf.addPage([595, 842]);
        y = 790;
      }
      page.drawText(latin(text), { x: options.x ?? 50, y, size: options.size ?? 11, font: options.strong ? bold : font });
      y -= (options.size ?? 11) + 9;
    };
    const s = report.summary;
    line(latin(loc(merchant?.name ?? {}).en ?? '') || 'Store report', { size: 18, strong: true });
    line(`Sales report, ${report.from} to ${report.to}`, { size: 12 });
    y -= 8;
    line('Summary', { size: 13, strong: true });
    for (const [label, value] of [
      ['Orders', s.orders], ['Completed', s.completed], ['Cancelled', `${s.cancelled} (${s.cancellationRate}%)`],
      ['Sales', `${s.sales} BHD`], ['Average order', `${s.averageOrder} BHD`], ['Discounts', `${s.discounts} BHD`],
      ['Delivery fees', `${s.deliveryFees} BHD`], ['Refunds', `${s.refunds} BHD`], ['Customers', `${s.customers} (${s.repeatCustomers} returning)`],
      ['Average prep time', s.prepMinutes === null ? '-' : `${s.prepMinutes} min`], ['Average delivery time', s.deliveryMinutes === null ? '-' : `${s.deliveryMinutes} min`],
    ] as const) line(`${label}: ${value}`);
    y -= 8;
    line('By day', { size: 13, strong: true });
    for (const row of report.daily) line(`${row.date}    ${row.orders} orders    ${row.sales} BHD`);
    y -= 8;
    line('Top products', { size: 13, strong: true });
    for (const row of report.topProducts) line(`${latin(row.name.en ?? '') || '-'}    x${row.quantity}    ${row.sales} BHD`);
    return Buffer.from(await pdf.save());
  }
}

function eventAt(events: Event[], status: OrderStatus) {
  return events.find((event) => event.status === status)?.createdAt ?? null;
}

function minutes(from: Date, to: Date) {
  return Math.max(0, (to.getTime() - from.getTime()) / 60_000);
}

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : null;
}

function csvCell(value: string | number) {
  const text = String(value);
  // Leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
