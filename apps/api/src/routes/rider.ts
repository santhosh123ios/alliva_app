import type { Request } from 'express';
import {
  cashDepositDecisionSchema,
  cashDepositSchema,
  deliveryIssueSchema,
  dispatchAssignSchema,
  dispatchPlanSchema,
  dropoffCorrectionSchema,
  pickupVerifySchema,
  riderLocationSchema,
  riderShiftSchema,
  riderStatusSchema,
} from '@alliva/validation';
import { forbidden } from '../common/errors';
import { validate, type RequestUser } from '../common/http';
import { createRoutes } from '../common/routes';
import type { Container } from '../container';
import { parsePoint } from '../domain/geo';

/** The delivery staff app, plus the store side of delivery: pickup codes, cash deposits and dispatch planning. */
export function riderRoutes({ prisma, jwt, rider, dispatch }: Container) {
  const routes = createRoutes({ jwt, prisma }, 'Delivery');
  const param = (request: Request, name: string) => request.params[name] as string;
  const app = { permissions: ['delivery.app'] };
  const storeId = (user: RequestUser) => {
    if (!user.merchantId) throw forbidden('A store account is required');
    return user.merchantId;
  };

  routes.get('/rider/me', app, (request) => rider.profile(request.user!));

  routes.post('/rider/shift', app, (request) => rider.setShift(request.user!, validate(riderShiftSchema, request.body)));

  routes.post('/rider/location', { ...app, throttle: 120 }, (request) => rider.ping(request.user!, validate(riderLocationSchema, request.body)));

  routes.get('/rider/orders', app, (request) => rider.orders(request.user!, parsePoint(request.query.lat, request.query.lng)));

  routes.get('/rider/orders/:id', app, (request) => rider.order(request.user!, param(request, 'id')));

  routes.post('/rider/pickup', { ...app, throttle: 30 }, (request) => rider.verifyPickup(request.user!, validate(pickupVerifySchema, request.body)));

  routes.post('/rider/orders/:id/status', app, (request) => rider.updateStatus(request.user!, param(request, 'id'), validate(riderStatusSchema, request.body)));

  routes.post('/rider/orders/:id/dropoff', app, (request) => rider.correctDropoff(request.user!, param(request, 'id'), validate(dropoffCorrectionSchema, request.body)));

  routes.post('/rider/orders/:id/issues', app, (request) => rider.reportIssue(request.user!, param(request, 'id'), validate(deliveryIssueSchema, request.body)));

  routes.get('/rider/collections', app, (request) => rider.collections(request.user!));

  routes.post('/rider/deposits', app, (request) => rider.deposit(request.user!, validate(cashDepositSchema, request.body)));

  routes.get('/merchant/orders/:id/handoff', { permissions: ['order.view'] }, (request) => rider.handoff(storeId(request.user!), param(request, 'id')));

  routes.get('/merchant/cash-deposits', { permissions: ['cash.confirm'] }, (request) => rider.storeDeposits(storeId(request.user!)));

  routes.post('/merchant/cash-deposits/:id/decision', { permissions: ['cash.confirm'] }, (request) =>
    rider.decideDeposit(request.user!, storeId(request.user!), param(request, 'id'), validate(cashDepositDecisionSchema, request.body)),
  );

  const planner = { permissions: ['dispatch.manage'] };

  routes.get('/merchant/dispatch/board', planner, (request) =>
    dispatch.board(storeId(request.user!), typeof request.query.branchId === 'string' ? request.query.branchId : undefined),
  );

  routes.post('/merchant/dispatch/plan', planner, (request) => dispatch.plan(storeId(request.user!), validate(dispatchPlanSchema, request.body)));

  routes.post('/merchant/dispatch/assign', planner, (request) => dispatch.assign(request.user!, storeId(request.user!), validate(dispatchAssignSchema, request.body)));

  return routes;
}
