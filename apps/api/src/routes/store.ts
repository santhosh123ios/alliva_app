import { storeDayQuerySchema, storeReportQuerySchema } from '@alliva/validation';
import { badRequest, forbidden } from '../common/errors';
import { validate, type RequestUser } from '../common/http';
import { createRoutes } from '../common/routes';
import { riderOnly } from '../domain/order-machine';
import type { Container } from '../container';

/** Store staff screens: the kitchen display, the day's takings and the sales reports. */
export function storeRoutes({ prisma, jwt, storeOps }: Container) {
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
