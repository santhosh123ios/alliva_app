import { serviceRequestUpdateSchema, staffOrderSchema, storeDayQuerySchema, storeReportQuerySchema, tableLayoutSchema } from '@alliva/validation';
import type { TableLayout } from '@alliva/types';
import { badRequest, forbidden } from '../common/errors';
import type { Request } from 'express';
import { validate, type RequestUser } from '../common/http';
import { createRoutes } from '../common/routes';
import { riderOnly } from '../domain/order-machine';
import type { Container } from '../container';

/** Store staff screens: the kitchen display, the order taker app, the day's takings and the sales reports. */
export function storeRoutes({ prisma, jwt, storeOps, floor, commerce }: Container) {
  const routes = createRoutes({ jwt, prisma }, 'Store');
  const storeId = (user: RequestUser) => {
    if (!user.merchantId) throw forbidden('A store account is required');
    return user.merchantId;
  };
  /** A branch filter must belong to the caller's store. */
  const ownBranch = async (merchantId: string, branchId?: string) => {
    if (!branchId) return undefined;
    const branch = await prisma.branch.findFirst({ where: { id: branchId, merchantId }, select: { id: true } });
    if (!branch) throw badRequest('Branch not found');
    return branch.id;
  };

  routes.get('/merchant/kitchen', { permissions: ['order.update'] }, async (request) => {
    const merchantId = storeId(request.user!);
    if (riderOnly(request.user!.roles)) throw forbidden('Riders use the delivery app');
    const { branchId } = validate<{ branchId?: string }>(storeDayQuerySchema, request.query);
    return storeOps.kitchen(merchantId, await ownBranch(merchantId, branchId));
  });

  const param = (request: Request, name: string) => request.params[name] as string;

  /** Floor staff: riders have order permissions too, but work from the delivery app. */
  const floorStaff = (user: RequestUser) => {
    const merchantId = storeId(user);
    if (riderOnly(user.roles)) throw forbidden('Riders use the delivery app');
    return { id: user.id, merchantId };
  };

  routes.get('/merchant/floor', { permissions: ['order.view'] }, async (request) => {
    const staff = floorStaff(request.user!);
    const { branchId } = validate<{ branchId?: string }>(storeDayQuerySchema, request.query);
    return floor.board(staff, await ownBranch(staff.merchantId, branchId));
  });

  routes.get('/merchant/floor/menu', { permissions: ['order.view'] }, (request) => floor.menu(floorStaff(request.user!).merchantId));

  routes.post('/merchant/floor/orders', { permissions: ['order.update'], throttle: 60 }, async (request) => {
    const staff = floorStaff(request.user!);
    const body = validate<{ fulfillmentType: 'DINE_IN' | 'TAKEAWAY'; tableId?: string | null; branchId?: string; notes?: string; items: { productId: string; variantId?: string | null; addonIds: string[]; quantity: number; notes?: string }[] }>(staffOrderSchema, request.body);
    return commerce.staffOrder(staff, { ...body, branchId: await ownBranch(staff.merchantId, body.branchId) });
  });

  routes.post('/merchant/service-requests/:id', { permissions: ['order.view'] }, (request) =>
    floor.updateRequest(floorStaff(request.user!), param(request, 'id'), validate<{ status: 'ACKNOWLEDGED' | 'RESOLVED' }>(serviceRequestUpdateSchema, request.body).status),
  );

  routes.get('/merchant/table-layout', { permissions: ['order.view'] }, (request) => floor.layout(storeId(request.user!)));

  routes.put('/merchant/table-layout', { permissions: ['table.manage'] }, (request) =>
    floor.saveLayout(storeId(request.user!), validate<TableLayout>(tableLayoutSchema, request.body)),
  );

  routes.get('/merchant/takings', { permissions: ['payment.view'] }, async (request) => {
    const merchantId = storeId(request.user!);
    const query = validate<{ date?: string; branchId?: string }>(storeDayQuerySchema, request.query);
    return storeOps.takings(merchantId, { date: query.date, branchId: await ownBranch(merchantId, query.branchId) });
  });

  routes.get('/merchant/reports', { permissions: ['report.export'] }, async (request) => {
    const merchantId = storeId(request.user!);
    const query = validate<{ from?: string; to?: string; branchId?: string }>(storeReportQuerySchema, request.query);
    return storeOps.report(merchantId, { ...query, branchId: await ownBranch(merchantId, query.branchId) });
  });

  routes.get('/merchant/reports/export.csv', { permissions: ['report.export'] }, async (request, response) => {
    const merchantId = storeId(request.user!);
    const query = validate<{ from?: string; to?: string; branchId?: string }>(storeReportQuerySchema, request.query);
    const csv = await storeOps.reportCsv(merchantId, { ...query, branchId: await ownBranch(merchantId, query.branchId) });
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="sales-report.csv"');
    response.send(csv);
  });

  routes.get('/merchant/reports/export.pdf', { permissions: ['report.export'] }, async (request, response) => {
    const merchantId = storeId(request.user!);
    const query = validate<{ from?: string; to?: string; branchId?: string }>(storeReportQuerySchema, request.query);
    const file = await storeOps.reportPdf(merchantId, { ...query, branchId: await ownBranch(merchantId, query.branchId) });
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', 'attachment; filename="sales-report.pdf"');
    response.send(file);
  });

  return routes;
}
