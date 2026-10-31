import type { AuthUser, FulfillmentType, OrderStatus } from '@alliva/types';

export type PortalRole =
  | 'MERCHANT_OWNER'
  | 'MERCHANT_MANAGER'
  | 'ORDER_TAKING_STAFF'
  | 'KITCHEN_STAFF'
  | 'BILLING_STAFF'
  | 'DELIVERY_STAFF'
  | 'REPORT_VIEWER';

type User = Pick<AuthUser, 'roles' | 'permissions'>;

/** Most senior first: a user with several roles lands where the senior one would. */
const PRECEDENCE: PortalRole[] = ['MERCHANT_OWNER', 'MERCHANT_MANAGER', 'BILLING_STAFF', 'ORDER_TAKING_STAFF', 'KITCHEN_STAFF', 'REPORT_VIEWER', 'DELIVERY_STAFF'];

export function portalRole(user: Pick<AuthUser, 'roles'>): PortalRole {
  return PRECEDENCE.find((role) => user.roles.includes(role)) ?? 'MERCHANT_OWNER';
}

/** Riders get the mobile app and nothing else. */
export function isRider(user: Pick<AuthUser, 'roles'>) {
  return portalRole(user) === 'DELIVERY_STAFF';
}

/** Kitchen staff work from the full-screen kitchen display. */
export function isKitchenOnly(user: Pick<AuthUser, 'roles'>) {
  return portalRole(user) === 'KITCHEN_STAFF';
}

/** Order takers work the floor from the phone and tablet app. */
export function isOrderTaker(user: Pick<AuthUser, 'roles'>) {
  return portalRole(user) === 'ORDER_TAKING_STAFF';
}

/** Billing staff work the till from the phone and tablet app. */
export function isBillingStaff(user: Pick<AuthUser, 'roles'>) {
  return portalRole(user) === 'BILLING_STAFF';
}

export function landingFor(user: Pick<AuthUser, 'roles'>) {
  if (isRider(user)) return '/rider';
  if (isKitchenOnly(user)) return '/kitchen';
  if (isOrderTaker(user)) return '/floor';
  if (isBillingStaff(user)) return '/billing';
  return '/dashboard';
}

const MANAGERS: PortalRole[] = ['MERCHANT_OWNER', 'MERCHANT_MANAGER'];

/**
 * Who sees each workspace section. A section needs its permission (owners always have it)
 * and, where `roles` is set, one of those roles, so each role gets a focused menu.
 */
const SECTIONS: Record<string, { permission?: string; roles?: PortalRole[] }> = {
  dashboard: {},
  orders: { permission: 'order.view', roles: [...MANAGERS, 'ORDER_TAKING_STAFF', 'BILLING_STAFF'] },
  kitchen: { permission: 'order.update', roles: [...MANAGERS, 'KITCHEN_STAFF'] },
  floor: { permission: 'order.view', roles: [...MANAGERS, 'ORDER_TAKING_STAFF'] },
  billing: { permission: 'payment.view', roles: [...MANAGERS, 'BILLING_STAFF'] },
  dispatch: { permission: 'dispatch.manage' },
  products: { permission: 'catalog.manage' },
  promos: { permission: 'promo.manage' },
  reports: { permission: 'report.export', roles: [...MANAGERS, 'REPORT_VIEWER'] },
  business: { permission: 'merchant.profile.manage' },
  staff: { permission: 'staff.manage' },
  tables: { permission: 'order.view', roles: [...MANAGERS, 'ORDER_TAKING_STAFF'] },
  payments: { permission: 'payment.view', roles: [...MANAGERS, 'BILLING_STAFF'] },
  referral: { permission: 'payment.view', roles: [...MANAGERS, 'BILLING_STAFF'] },
  subscription: { roles: ['MERCHANT_OWNER'] },
  settings: { permission: 'merchant.profile.manage' },
};

export function hasPermission(user: User, permission: string) {
  return user.roles.includes('MERCHANT_OWNER') || user.permissions.includes(permission);
}

/** Whether the user may open a workspace section, by its first path segment (`orders`, `tables`…). */
export function canOpen(user: User, section: string) {
  if (isRider(user)) return false;
  const rule = SECTIONS[section];
  if (!rule) return MANAGERS.some((role) => user.roles.includes(role));
  if (rule.roles && !rule.roles.some((role) => user.roles.includes(role))) return false;
  return !rule.permission || hasPermission(user, rule.permission);
}

const STORE_WIDE: PortalRole[] = ['MERCHANT_OWNER', 'MERCHANT_MANAGER'];
const KITCHEN = new Set<OrderStatus>(['PREPARING', 'READY_FOR_PICKUP']);
const FRONT = new Set<OrderStatus>(['ACCEPTED', 'CANCELLED', 'PREPARING']);

/** Mirrors the API's role check for order statuses, so screens only offer buttons that will work. */
export function canSetStatus(user: Pick<AuthUser, 'roles'>, to: OrderStatus, fulfillment: FulfillmentType) {
  if (user.roles.some((role) => STORE_WIDE.includes(role as PortalRole))) return true;
  if (user.roles.includes('KITCHEN_STAFF') && KITCHEN.has(to)) return true;
  if (user.roles.includes('ORDER_TAKING_STAFF') && (FRONT.has(to) || (to === 'DELIVERED' && fulfillment !== 'DELIVERY'))) return true;
  return false;
}
