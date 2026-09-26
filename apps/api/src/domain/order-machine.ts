import type { FulfillmentType, OrderStatus } from '@alliva/types';

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY_FOR_PICKUP', 'CANCELLED'],
  READY_FOR_PICKUP: ['ASSIGNED_TO_DRIVER', 'DELIVERED', 'CANCELLED'],
  ASSIGNED_TO_DRIVER: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: ['REFUNDED'],
  REFUNDED: [],
};

const KITCHEN = new Set<OrderStatus>(['PREPARING', 'READY_FOR_PICKUP']);
const DELIVERY = new Set<OrderStatus>(['OUT_FOR_DELIVERY', 'DELIVERED']);
const FRONT = new Set<OrderStatus>(['ACCEPTED', 'CANCELLED', 'PREPARING']);

export function assertTransition(input: {
  from: OrderStatus;
  to: OrderStatus;
  fulfillment: FulfillmentType;
  roles: string[];
}): void {
  const allowed = ORDER_TRANSITIONS[input.from];
  if (!allowed.includes(input.to)) {
    throw new Error(`Cannot move an order from ${input.from} to ${input.to}`);
  }
  if (
    (input.to === 'ASSIGNED_TO_DRIVER' || input.to === 'OUT_FOR_DELIVERY') &&
    input.fulfillment !== 'DELIVERY'
  ) {
    throw new Error('Driver statuses apply only to delivery orders');
  }
  if (input.to === 'DELIVERED' && input.from === 'READY_FOR_PICKUP' && input.fulfillment === 'DELIVERY') {
    throw new Error('Delivery orders must be handed to a driver before delivery');
  }
  if (input.roles.includes('SUPER_ADMIN') || input.roles.includes('ADMIN') || input.roles.includes('MERCHANT_OWNER') || input.roles.includes('MERCHANT_MANAGER') || input.roles.includes('OPERATIONS_MANAGER') || input.roles.includes('OPERATIONS_STAFF')) {
    return;
  }
  if (input.roles.includes('KITCHEN_STAFF') && KITCHEN.has(input.to)) return;
  if (input.roles.includes('DELIVERY_STAFF') && DELIVERY.has(input.to)) return;
  if (input.roles.includes('ORDER_TAKING_STAFF') && FRONT.has(input.to)) return;
  if (input.roles.includes('CUSTOMER') && input.to === 'CANCELLED' && input.from === 'PENDING') return;
  throw new Error('This role cannot apply that order status');
}
