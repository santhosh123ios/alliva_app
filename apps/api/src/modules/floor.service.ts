import type { FloorBoard, FloorMenu, ServiceRequestView, TableLayout, TableServiceView } from '@alliva/types';
import { tableLayoutSchema } from '@alliva/validation';
import type { OrderStatus, Prisma, ServiceRequestKind } from '@prisma/client';
import { badRequest, notFound } from '../common/errors';
import { dec, loc } from '../common/crypto';
import { startOfDay } from '../domain/store-day';
import type { PrismaService } from '../prisma/prisma.service';
import type { BillingService } from './billing.service';
import type { OrdersGateway } from './orders.gateway';

/** Orders the floor still has to look after: waiting to be accepted, in the kitchen, or ready to serve. */
const LIVE: OrderStatus[] = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'];
const OPEN_CALLS = ['OPEN', 'ACKNOWLEDGED'] as const;

const requestInclude = { table: { select: { id: true, number: true, name: true } } } satisfies Prisma.ServiceRequestInclude;
type RequestRow = Prisma.ServiceRequestGetPayload<{ include: typeof requestInclude }>;

/** The order taker app: the floor plan, diners calling for staff, and the menu staff order from. */
export class FloorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: OrdersGateway,
    private readonly billing: BillingService,
  ) {}

  async board(user: { id: string; merchantId: string }, branchId?: string, now = new Date()): Promise<FloorBoard> {
    const merchantId = user.merchantId;
    const branch = branchId ? { OR: [{ branchId }, { branchId: null }] } : {};
    const [merchant, tables, requests, orders, servedToday] = await Promise.all([
      this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { tableLayout: true } }),
      this.prisma.diningTable.findMany({
        where: { merchantId, deletedAt: null, active: true, ...branch },
        include: { floor: true, sessions: { where: { closedAt: null }, orderBy: { openedAt: 'desc' }, take: 1 } },
        orderBy: { number: 'asc' },
      }),
      this.prisma.serviceRequest.findMany({ where: { merchantId, status: { in: [...OPEN_CALLS] } }, include: requestInclude, orderBy: { createdAt: 'asc' }, take: 100 }),
      this.prisma.order.findMany({
        where: { merchantId, ...(branchId ? { branchId } : {}), status: { in: LIVE } },
        include: {
          items: { include: { addons: { select: { name: true } } } },
          events: { where: { status: 'READY_FOR_PICKUP' }, select: { createdAt: true }, take: 1 },
          table: { select: { number: true } },
          customer: { include: { user: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
      this.prisma.order.count({ where: { merchantId, fulfillmentType: { not: 'DELIVERY' }, status: 'DELIVERED', updatedAt: { gte: startOfDay(now) } } }),
    ]);
    return {
      layout: readLayout(merchant?.tableLayout),
      tables: tables.map((table) => ({
        id: table.id,
        number: table.number,
        name: table.name,
        capacity: table.capacity,
        status: table.status,
        branchId: table.branchId,
        floor: { id: table.floor.id, name: loc(table.floor.name) },
        openedAt: table.status === 'OCCUPIED' ? table.sessions[0]?.openedAt.toISOString() ?? null : null,
      })),
      requests: await this.present(requests),
      orders: orders.map((order) => ({
        id: order.id,
        number: order.number,
        status: order.status,
        fulfillmentType: order.fulfillmentType,
        total: dec(order.total),
        createdAt: order.createdAt.toISOString(),
        estimatedReadyAt: order.estimatedReadyAt?.toISOString() ?? null,
        readyAt: order.events[0]?.createdAt.toISOString() ?? null,
        tableId: order.tableId,
        tableNumber: order.table?.number ?? null,
        customerName: `${order.customer.user.firstName} ${order.customer.user.lastName}`.trim(),
        notes: order.notes,
        takenByMe: order.createdById === user.id,
        items: order.items.map((item) => ({ name: loc(item.name), quantity: item.quantity, notes: item.notes, addons: item.addons.map((addon) => loc(addon.name)) })),
      })),
      servedToday,
      generatedAt: now.toISOString(),
    };
  }

  /** The whole menu, sold-out items included so staff can tell a diner, grouped as the store sorts it. */
  async menu(merchantId: string): Promise<FloorMenu> {
    const categories = await this.prisma.productCategory.findMany({
      where: { merchantId, deletedAt: null },
      include: {
        catalogCategory: { select: { name: true } },
        products: {
          where: { deletedAt: null, approvalStatus: 'APPROVED' },
          include: {
            variants: { orderBy: { price: 'asc' } },
            addonGroups: { include: { addonGroup: { include: { addons: true } } } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      categories: categories
        .filter((category) => category.products.length)
        .map((category) => ({
          id: category.id,
          name: loc(category.catalogCategory?.name ?? category.name),
          products: category.products.map((product) => ({
            id: product.id,
            name: loc(product.name),
            description: loc(product.description),
            price: dec(product.price),
            imageUrl: product.imageUrl,
            available: product.available,
            variants: product.variants.map((variant) => ({ id: variant.id, name: loc(variant.name), price: dec(variant.price), available: variant.available })),
            addonGroups: product.addonGroups.map(({ addonGroup }) => ({
              id: addonGroup.id,
              name: loc(addonGroup.name),
              minSelect: addonGroup.minSelect,
              maxSelect: addonGroup.maxSelect,
              addons: addonGroup.addons.map((addon) => ({ id: addon.id, name: loc(addon.name), price: dec(addon.price), available: addon.available })),
            })),
          })),
        })),
    };
  }

  /** Staff answer a call: on the way, then done. A done call cannot be reopened. */
  async updateRequest(user: { id: string; merchantId: string }, id: string, status: 'ACKNOWLEDGED' | 'RESOLVED') {
    const row = await this.prisma.serviceRequest.findFirst({ where: { id, merchantId: user.merchantId } });
    if (!row) throw notFound('Call not found');
    if (row.status === 'RESOLVED') throw badRequest('This call is already done');
    const now = new Date();
    const updated = await this.prisma.serviceRequest.update({
      where: { id },
      data: status === 'ACKNOWLEDGED'
        ? { status, acknowledgedAt: row.acknowledgedAt ?? now, acknowledgedById: row.acknowledgedById ?? user.id }
        : { status, resolvedAt: now, resolvedById: user.id, acknowledgedAt: row.acknowledgedAt ?? now, acknowledgedById: row.acknowledgedById ?? user.id },
      include: requestInclude,
    });
    this.gateway.emitServiceRequest(updated);
    return (await this.present([updated]))[0]!;
  }

  async layout(merchantId: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { tableLayout: true } });
    return { layout: readLayout(merchant?.tableLayout) };
  }

  async saveLayout(merchantId: string, layout: TableLayout) {
    await this.prisma.merchant.update({ where: { id: merchantId }, data: { tableLayout: layout as Prisma.InputJsonValue } });
    return { layout };
  }

  /** The diner's table, from the QR cookie, with any call still open there and the bill so far. */
  async tableService(tableId: string | undefined): Promise<TableServiceView> {
    const table = await this.dinerTable(tableId);
    const [requests, bill] = await Promise.all([
      this.prisma.serviceRequest.findMany({ where: { tableId: table.id, status: { in: [...OPEN_CALLS] } }, include: requestInclude, orderBy: { createdAt: 'asc' } }),
      this.billing.dinerBill(table.id),
    ]);
    return { table: { id: table.id, number: table.number, name: table.name }, requests: await this.present(requests), bill };
  }

  /** A diner asks for staff. Asking again for the same thing while it is still open returns the open call. */
  async callStaff(tableId: string | undefined, kind: ServiceRequestKind) {
    const table = await this.dinerTable(tableId);
    const open = await this.prisma.serviceRequest.findFirst({ where: { tableId: table.id, kind, status: { in: [...OPEN_CALLS] } } });
    if (!open) {
      const created = await this.prisma.serviceRequest.create({ data: { merchantId: table.merchantId, tableId: table.id, kind }, include: requestInclude });
      this.gateway.emitServiceRequest(created);
    }
    return this.tableService(table.id);
  }

  private async dinerTable(tableId: string | undefined) {
    if (!tableId || !/^[0-9a-f-]{36}$/i.test(tableId)) throw notFound('Scan the QR code on your table first');
    const table = await this.prisma.diningTable.findFirst({ where: { id: tableId, deletedAt: null, active: true, merchant: { status: 'ACTIVE', deletedAt: null } } });
    if (!table) throw notFound('Scan the QR code on your table first');
    return table;
  }

  private async present(rows: RequestRow[]): Promise<ServiceRequestView[]> {
    const ids = [...new Set(rows.map((row) => row.acknowledgedById).filter((id): id is string => Boolean(id)))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true } }) : [];
    const names = new Map(users.map((user) => [user.id, user.firstName]));
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
}

/** A layout saved before the format settled, or by hand, is ignored rather than trusted. */
function readLayout(value: unknown): TableLayout | null {
  const parsed = tableLayoutSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
