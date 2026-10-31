import { z } from 'zod';

import { PAYMENT_METHOD_CODES, paymentMethodCodeSchema } from './payment-methods';

export {
  OFFLINE_PAYMENT_METHODS,
  PAYMENT_METHOD_CODES,
  acceptedPaymentMethods,
  defaultPaymentMethods,
  isOfflinePaymentMethod,
  normalizePaymentMethodCode,
  parsePaymentMethods,
  paymentMethodCodeSchema,
  paymentMethodsSettingSchema,
  resolveRegistrationMethods,
  type PaymentMethodCode,
  type PaymentMethodConfig,
} from './payment-methods';

export const localeSchema = z.enum(['en', 'ar']);

export const localizedSchema = z.object({
  en: z.string().min(1),
  ar: z.string().min(1),
});

export const moneySchema = z.string().regex(/^\d+(\.\d{1,3})?$/, 'Amount must be a BHD decimal');

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  rememberDevice: z.boolean().optional(),
});

export const customerRegisterSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  rememberDevice: z.boolean().optional(),
});

export const twoFactorSchema = z.object({
  challengeId: z.uuid(),
  code: z.string().min(4).max(8),
});

export const forgotPasswordSchema = z.object({
  email: z.email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8),
});

export const otpRequestSchema = z.object({
  phone: z.string().regex(/^\+973\d{8}$/, 'Use a Bahrain mobile number (+973)'),
  locale: localeSchema.optional(),
});

export const otpVerifySchema = z.object({
  phone: z.string().regex(/^\+973\d{8}$/),
  code: z.string().min(4).max(8),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
});

export const firebasePhoneSchema = z.object({
  idToken: z.string().min(20).max(8192),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
});

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  locale: localeSchema.optional(),
  email: z.email().optional(),
});

const coordinate = (min: number, max: number, message: string) =>
  z.union([z.string(), z.number()]).transform((value, context) => {
    const parsed = Number(value);
    if (value === '' || !Number.isFinite(parsed) || parsed < min || parsed > max) {
      context.addIssue({ code: 'custom', message });
      return z.NEVER;
    }
    return parsed.toFixed(6);
  });

/** Bahrain only: an address must carry a real map pin, never just typed text. */
export const latitudeSchema = coordinate(25.5, 26.45, 'Drop the pin on a location in Bahrain');
export const longitudeSchema = coordinate(50.3, 50.85, 'Drop the pin on a location in Bahrain');

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const addressSchema = z.object({
  label: z.string().trim().min(1).max(40),
  line1: z.string().trim().max(200).optional(),
  line2: optionalText(200),
  building: optionalText(40),
  flat: optionalText(40),
  road: optionalText(80),
  block: optionalText(20),
  area: optionalText(80),
  city: z.string().trim().min(1).max(80),
  landmark: optionalText(120),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  contactName: optionalText(80),
  contactPhone: z.string().trim().regex(/^\+?\d{8,15}$/, 'Enter a valid mobile number').optional().nullable().or(z.literal('')),
  instructions: optionalText(280),
  isDefault: z.boolean().optional(),
  /** Set by checkout: refuse to save a pin the cart's store cannot deliver to. */
  forCheckout: z.boolean().optional(),
}).refine((value) => Boolean(value.line1?.trim() || value.building?.trim() || value.road?.trim()), {
  message: 'Enter the building, road or address line',
  path: ['building'],
});

export const addressUpdateSchema = z.object({
  label: z.string().trim().min(1).max(40).optional(),
  line1: z.string().trim().max(200).optional(),
  line2: optionalText(200),
  building: optionalText(40),
  flat: optionalText(40),
  road: optionalText(80),
  block: optionalText(20),
  area: optionalText(80),
  city: z.string().trim().min(1).max(80).optional(),
  landmark: optionalText(120),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  contactName: optionalText(80),
  contactPhone: z.string().trim().regex(/^\+?\d{8,15}$/, 'Enter a valid mobile number').optional().nullable().or(z.literal('')),
  instructions: optionalText(280),
  isDefault: z.boolean().optional(),
});

export const guestLocationSchema = z.object({
  latitude: z.union([z.string(), z.number()]),
  longitude: z.union([z.string(), z.number()]),
  label: z.string().max(200).optional().nullable(),
  source: z.enum(['GPS', 'SEARCH', 'PIN', 'AREA']).optional().nullable(),
});

export const deliveryQuoteSchema = z.object({
  addressId: z.uuid().optional().nullable(),
  latitude: z.union([z.string(), z.number()]).optional().nullable(),
  longitude: z.union([z.string(), z.number()]).optional().nullable(),
  merchantId: z.uuid().optional().nullable(),
  branchId: z.uuid().optional().nullable(),
});

const kmSchema = z.string().regex(/^\d+(\.\d{1,3})?$/, 'Distance must be in kilometres');

/** Pricing fields a merchant edits on one DeliverySetting row. Tax is a fraction (0.1 = 10%). */
const deliverySettingFields = z.object({
  deliveryEnabled: z.boolean(),
  freeRadiusKm: kmSchema,
  maxRadiusKm: kmSchema,
  includedKm: kmSchema.optional(),
  baseCharge: moneySchema,
  chargePerStep: moneySchema,
  billingStepKm: kmSchema,
  minCharge: moneySchema.nullable().optional(),
  maxCharge: moneySchema.nullable().optional(),
  freeAboveOrder: moneySchema.nullable().optional(),
  taxRate: z.string().regex(/^(0(\.\d{1,5})?|1(\.0{1,5})?)$/, 'Tax must be between 0% and 100%'),
  promoFreeFrom: z.iso.datetime().nullable().optional(),
  promoFreeUntil: z.iso.datetime().nullable().optional(),
});

type DeliverySettingFields = z.infer<typeof deliverySettingFields>;

function checkDeliverySetting(value: DeliverySettingFields, ctx: z.RefinementCtx) {
  if (Number(value.chargePerStep) > 0 && !(Number(value.billingStepKm) > 0)) {
    ctx.addIssue({ code: 'custom', path: ['billingStepKm'], message: 'Choose a billing step when you charge per step' });
  }
  if (value.minCharge && value.maxCharge && Number(value.minCharge) > Number(value.maxCharge)) {
    ctx.addIssue({ code: 'custom', path: ['minCharge'], message: 'Minimum charge cannot be more than the maximum charge' });
  }
  if (Number(value.maxRadiusKm) > 0 && Number(value.freeRadiusKm) > Number(value.maxRadiusKm)) {
    ctx.addIssue({ code: 'custom', path: ['freeRadiusKm'], message: 'Free delivery radius cannot be larger than the delivery area' });
  }
  if (value.promoFreeFrom && value.promoFreeUntil && new Date(value.promoFreeUntil).getTime() <= new Date(value.promoFreeFrom).getTime()) {
    ctx.addIssue({ code: 'custom', path: ['promoFreeUntil'], message: 'Free delivery promotion must end after it starts' });
  }
}

/** New delivery pricing: no branch or zone is the store default, a branch overrides it, a zone overrides both. */
export const deliverySettingSchema = deliverySettingFields
  .extend({ branchId: z.uuid().nullable().optional(), serviceAreaId: z.uuid().nullable().optional() })
  .superRefine(checkDeliverySetting);

/** Changes to an existing row. The scope stays fixed; `version` rejects edits made over someone else's save. */
export const deliverySettingUpdateSchema = deliverySettingFields
  .extend({ version: z.number().int().positive().optional() })
  .superRefine(checkDeliverySetting);

export const deliveryPreviewSchema = deliverySettingFields
  .extend({
    distancesKm: z.array(z.number().min(0).max(200)).min(1).max(10),
    orderAmount: moneySchema.nullable().optional(),
  })
  .superRefine(checkDeliverySetting);

export const staffSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  roleKey: z.string().min(1),
  merchantId: z.uuid().optional(),
});

export const rolePermissionsSchema = z.object({
  permissionKeys: z.array(z.string().min(1)).min(1),
});

export const merchantUpsertSchema = z.object({
  name: localizedSchema,
  description: localizedSchema,
  slug: z.string().min(2).optional(),
  businessType: z.string().min(1),
  categoryIds: z.array(z.uuid()).min(1),
  phone: z.string().min(8),
  email: z.email(),
  minimumOrder: moneySchema,
  preparationMinutes: z.number().int().min(5).max(180),
  taxNumber: z.string().optional(),
  delivery: z.boolean(),
  takeaway: z.boolean(),
  dineIn: z.boolean(),
  planId: z.uuid().optional(),
  billingInterval: z.enum(['MONTHLY', 'ANNUAL']).optional(),
});

export const merchantRegistrationSchema = z.object({
  businessName: z.string().min(2),
  businessNameAr: z.string().optional(),
  website: z.string().min(4),
  businessType: z.string().min(1),
  categoryId: z.uuid().optional(),
  city: z.string().min(1),
  phone: z.string().min(8),
  email: z.email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  password: z.string().min(8),
  planId: z.uuid(),
  billingInterval: z.enum(['MONTHLY', 'ANNUAL']),
  promoCode: z.string().trim().max(40).optional(),
  referralCode: z.string().trim().max(40).optional(),
  delivery: z.boolean(),
  takeaway: z.boolean(),
  paymentMethods: z.array(paymentMethodCodeSchema).min(1).max(PAYMENT_METHOD_CODES.length).optional(),
});

export const emailAvailabilitySchema = z.object({
  email: z.email(),
});

export const branchSchema = z.object({
  name: localizedSchema,
  line1: z.string().min(1),
  city: z.string().min(1),
  latitude: z.string(),
  longitude: z.string(),
  phone: z.string().optional(),
  managerId: z.uuid().optional(),
});

export const hoursSchema = z.object({
  hours: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      opensAt: z.string().regex(/^\d{2}:\d{2}$/),
      closesAt: z.string().regex(/^\d{2}:\d{2}$/),
      closed: z.boolean(),
    }),
  ),
});

export const productSchema = z.object({
  categoryId: z.uuid(),
  name: localizedSchema,
  description: localizedSchema,
  price: moneySchema,
  compareAtPrice: moneySchema.optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  available: z.boolean().optional(),
  stockQuantity: z.number().int().min(0).optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  variants: z
    .array(
      z.object({
        name: localizedSchema,
        price: moneySchema,
        available: z.boolean().optional(),
      }),
    )
    .optional(),
  addonGroupIds: z.array(z.uuid()).optional(),
  approvalStatus: z.enum(['DRAFT', 'PENDING', 'APPROVED']).optional(),
});

export const productUpdateSchema = z.object({
  categoryId: z.uuid().optional(),
  name: localizedSchema.optional(),
  description: localizedSchema.optional(),
  price: moneySchema.optional(),
  compareAtPrice: moneySchema.optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  available: z.boolean().optional(),
  approvalStatus: z.enum(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED']).optional(),
  stockQuantity: z.number().int().min(0).optional(),
});

const importText = (max: number) =>
  z.preprocess((value) => (typeof value === 'string' ? value.trim() : value), z.string().min(1).max(max));

const importOptionalText = (max: number) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }, z.string().max(max).optional());

export const productImportRowSchema = z.object({
  row: z.number().int().positive().optional(),
  name: importText(160),
  nameAr: importOptionalText(160),
  description: importOptionalText(500),
  descriptionAr: importOptionalText(500),
  category: importText(80),
  price: moneySchema,
  stock: z.number().int().min(0).max(1_000_000).optional(),
  status: z.enum(['active', 'out', 'draft']).optional(),
});

export const offerSchema = z.object({
  title: localizedSchema,
  productId: z.uuid().optional(),
});

export const addonGroupSchema = z.object({
  name: localizedSchema,
  minSelect: z.number().int().min(0),
  maxSelect: z.number().int().min(1),
  addons: z.array(
    z.object({
      name: localizedSchema,
      price: moneySchema,
    }),
  ),
});

export const categorySchema = z.object({
  name: localizedSchema,
  sortOrder: z.number().int().optional(),
});

export const cartItemSchema = z.object({
  productId: z.uuid(),
  variantId: z.uuid().optional().nullable(),
  addonIds: z.array(z.uuid()).optional(),
  quantity: z.number().int().min(1).max(50),
  notes: z.string().max(280).optional(),
  replace: z.boolean().optional(),
});

export const cartContextSchema = z.object({
  fulfillmentType: z.enum(['DELIVERY', 'TAKEAWAY', 'DINE_IN']),
  addressId: z.uuid().optional().nullable(),
  tableId: z.uuid().optional().nullable(),
  scheduledFor: z.iso.datetime().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  exclusiveSlug: z.string().optional().nullable(),
});

export const promoApplySchema = z.object({
  code: z.string().min(2).max(40),
});

export const checkoutSchema = z.object({
  paymentMethod: paymentMethodCodeSchema,
  fulfillmentType: z.enum(['DELIVERY', 'TAKEAWAY', 'DINE_IN']),
  addressId: z.uuid().optional().nullable(),
  tableId: z.uuid().optional().nullable(),
  scheduledFor: z.iso.datetime().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  promoCode: z.string().optional().nullable(),
  /** The total the customer saw. The order is refused if the server total differs. */
  expectedTotal: z.string().regex(/^\d+(\.\d{1,3})?$/).optional().nullable(),
  cartVersion: z.string().max(64).optional().nullable(),
});

export const checkoutValidateSchema = checkoutSchema.partial({ paymentMethod: true });

export const orderTransitionSchema = z.object({
  status: z.enum([
    'ACCEPTED',
    'PREPARING',
    'READY_FOR_PICKUP',
    'ASSIGNED_TO_DRIVER',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'CANCELLED',
    'REFUNDED',
  ]),
  note: z.string().max(500).optional(),
  preparationMinutes: z.number().int().min(1).max(180).optional(),
  driverId: z.uuid().optional(),
  cancellationReason: z.string().max(500).optional(),
});

export const planSchema = z.object({
  code: z.string().min(2).max(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use a lowercase code'),
  name: localizedSchema,
  description: localizedSchema,
  priceMonthly: moneySchema,
  priceAnnual: moneySchema,
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  displayOrder: z.number().int().min(0).optional(),
  recommended: z.boolean().optional(),
  entitlements: z.array(
    z.object({
      key: z.string().min(1),
      value: z.unknown(),
    }),
  ),
});

export const reorderPlansSchema = z.object({
  ids: z.array(z.uuid()).min(1),
});

export const assignSubscriptionSchema = z.object({
  planId: z.uuid(),
  billingInterval: z.enum(['MONTHLY', 'ANNUAL']),
  markPaid: z.boolean().optional(),
});

export const merchantRenewalSchema = z.object({
  planId: z.uuid(),
  billingInterval: z.enum(['MONTHLY', 'ANNUAL']),
  autoRenew: z.boolean(),
  paymentMethod: z.enum(['CARD', 'BENEFIT', 'BANK']).optional(),
});

export const merchantAutoRenewSchema = z.object({
  autoRenew: z.boolean(),
});

export const promoSchema = z.object({
  code: z.string().min(2).max(40),
  description: localizedSchema,
  scope: z.enum(['GLOBAL', 'MERCHANT']),
  merchantId: z.uuid().optional().nullable(),
  discountType: z.enum(['FIXED', 'PERCENTAGE']),
  discountValue: moneySchema,
  maxDiscount: moneySchema.optional().nullable(),
  minimumOrder: moneySchema.optional().nullable(),
  usageLimit: z.number().int().positive().optional().nullable(),
  perCustomerLimit: z.number().int().positive().optional().nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  firstOrderOnly: z.boolean().optional(),
  budget: moneySchema.optional().nullable(),
  categoryIds: z.array(z.uuid()).optional(),
  merchantIds: z.array(z.uuid()).optional(),
});

export const merchantPromoSchema = z
  .object({
    code: z.string().trim().min(2).max(40),
    description: z.string().trim().min(1).max(200),
    descriptionAr: z.string().trim().max(200).optional(),
    discountType: z.enum(['FIXED', 'PERCENTAGE']),
    discountValue: moneySchema,
    minimumOrder: moneySchema.optional().nullable(),
    usageLimit: z.number().int().positive().optional().nullable(),
    perCustomerLimit: z.number().int().positive().optional().nullable(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    firstOrderOnly: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End date must be after the start date' });
    }
    const amount = Number(value.discountValue);
    if (!(amount > 0)) {
      ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Discount must be greater than zero' });
    }
    if (value.discountType === 'PERCENTAGE' && amount > 100) {
      ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Percentage discount cannot exceed 100' });
    }
  });

export const merchantPromoActiveSchema = z.object({
  active: z.boolean(),
});

export const subscriptionQuoteSchema = z.object({
  planId: z.uuid(),
  billingInterval: z.enum(['MONTHLY', 'ANNUAL']),
  promoCode: z.string().trim().max(40).optional(),
  referralCode: z.string().trim().max(40).optional(),
});

export const complaintSchema = z.object({
  source: z.enum(['CUSTOMER', 'MERCHANT', 'DRIVER']),
  category: z.string().min(1),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  subject: z.string().min(3),
  description: z.string().min(3),
  orderId: z.uuid().optional().nullable(),
});

export const complaintUpdateSchema = z.object({
  status: z.enum(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED']).optional(),
  assigneeId: z.uuid().optional().nullable(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  note: z.string().optional(),
  internal: z.boolean().optional(),
  satisfaction: z.number().int().min(1).max(5).optional(),
  requestRefund: z.boolean().optional(),
});

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

export const tableSchema = z.object({
  floorId: z.uuid(),
  name: z.string().min(1),
  number: z.string().min(1),
  capacity: z.number().int().min(1),
  active: z.boolean().optional(),
});

export const tableUpdateSchema = z.object({
  floorId: z.uuid().optional(),
  name: z.string().min(1).optional(),
  number: z.string().min(1).optional(),
  capacity: z.number().int().min(1).optional(),
  active: z.boolean().optional(),
});

export const floorSchema = z.object({
  name: localizedSchema,
});

export const settingsSchema = z.object({
  values: z.record(z.string(), z.unknown()),
});

export const dispatchSchema = z.object({
  orderId: z.uuid(),
  driverId: z.uuid(),
});

export const riderShiftSchema = z.object({
  onShift: z.boolean(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export const riderLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

/** A rider collects an order: the scanned QR text, the code printed on the ticket, or a manual mark on one of their orders. */
export const pickupVerifySchema = z
  .object({
    qr: z.string().trim().min(1).max(200).optional(),
    code: z.string().trim().min(4).max(12).optional(),
    orderId: z.uuid().optional(),
    manual: z.boolean().optional(),
  })
  .refine((value) => Boolean(value.qr || value.code || (value.manual && value.orderId)), { message: 'Scan the QR or enter the pickup code' });

export const riderStatusSchema = z.object({
  status: z.enum(['OUT_FOR_DELIVERY', 'DELIVERED']),
  collectedAmount: moneySchema.optional(),
  note: z.string().trim().max(500).optional(),
});

export const dropoffCorrectionSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  note: z.string().trim().max(300).optional(),
});

export const deliveryIssueTypes = ['CUSTOMER_UNREACHABLE', 'WRONG_ADDRESS', 'ITEM_MISSING', 'DAMAGED', 'PAYMENT_REFUSED', 'OTHER'] as const;

export const deliveryIssueSchema = z
  .object({
    type: z.enum(deliveryIssueTypes),
    note: z.string().trim().max(500).optional(),
  })
  .refine((value) => value.type !== 'OTHER' || Boolean(value.note), { message: 'Describe the issue', path: ['note'] });

export const cashDepositSchema = z.object({
  collectionIds: z.array(z.uuid()).min(1).optional(),
  note: z.string().trim().max(300).optional(),
});

export const cashDepositDecisionSchema = z
  .object({
    decision: z.enum(['CONFIRMED', 'REJECTED']),
    note: z.string().trim().max(300).optional(),
  })
  .refine((value) => value.decision !== 'REJECTED' || Boolean(value.note), { message: 'Say why the deposit is rejected', path: ['note'] });

export const dispatchPlanSchema = z.object({
  branchId: z.uuid().optional(),
  riderIds: z.array(z.uuid()).min(1, 'Pick at least one rider'),
  orderIds: z.array(z.uuid()).optional(),
  maxPerRider: z.number().int().min(1).max(10).default(3),
});

export const dispatchAssignSchema = z.object({
  routes: z
    .array(z.object({ riderId: z.uuid(), orderIds: z.array(z.uuid()).min(1) }))
    .min(1, 'The plan has no routes')
    .refine((routes) => {
      const ids = routes.flatMap((route) => route.orderIds);
      return new Set(ids).size === ids.length;
    }, 'An order can only be in one route'),
});

const storeDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-30');

/** Store dashboards: one day at the till, or a date range for reports. Dates are Bahrain days. */
export const storeDayQuerySchema = z.object({
  date: storeDay.optional(),
  branchId: z.uuid().optional(),
});

export const storeReportQuerySchema = z.object({
  from: storeDay.optional(),
  to: storeDay.optional(),
  branchId: z.uuid().optional(),
});

export const tableStatusSchema = z.object({
  status: z.enum(['AVAILABLE', 'OCCUPIED', 'RESERVED', 'INACTIVE']),
});

/** A diner at a table asking for staff. The table comes from the QR cookie, not the body. */
export const serviceRequestCreateSchema = z.object({
  kind: z.enum(['WAITER', 'BILL', 'HELP']),
});

export const serviceRequestUpdateSchema = z.object({
  status: z.enum(['ACKNOWLEDGED', 'RESOLVED']),
});

const layoutPercent = z.number().min(-50).max(200);
const layoutRect = z.object({ x: layoutPercent, y: layoutPercent, width: z.number().min(0).max(100), height: z.number().min(0).max(100) });

/** The floor plan the owner arranges on the Tables page, in percent of the canvas. */
export const tableLayoutSchema = z.object({
  positions: z.record(z.uuid(), z.object({ x: layoutPercent, y: layoutPercent })),
  zones: z.object({
    order: z.array(z.uuid()).max(200),
    widths: z.record(z.uuid(), z.number().min(0).max(100)),
    heights: z.record(z.uuid(), z.number().min(0).max(100)),
    rects: z.record(z.uuid(), layoutRect),
  }),
});

/** An order taken by floor staff for a table or the counter. Prices are worked out on the server. */
export const staffOrderSchema = z
  .object({
    fulfillmentType: z.enum(['DINE_IN', 'TAKEAWAY']),
    tableId: z.uuid().nullable().optional(),
    branchId: z.uuid().optional(),
    notes: z.string().trim().max(500).optional(),
    items: z
      .array(
        z.object({
          productId: z.uuid(),
          variantId: z.uuid().nullable().optional(),
          addonIds: z.array(z.uuid()).max(30).default([]),
          quantity: z.number().int().min(1).max(50),
          notes: z.string().trim().max(200).optional(),
        }),
      )
      .min(1)
      .max(100),
  })
  .refine((body) => body.fulfillmentType !== 'DINE_IN' || Boolean(body.tableId), { message: 'Choose a table for a dine-in order', path: ['tableId'] });

export const incidentSchema = z.object({
  title: z.string().min(3),
  details: z.string().min(3),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
});

export const shiftNoteSchema = z.object({
  note: z.string().min(3),
});

export const settlementDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().optional(),
});

export const refundDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().optional(),
});

export const closureSchema = z.object({
  reason: z.string().min(3),
  until: z.iso.datetime(),
});

export const bankSchema = z.object({
  bankName: z.string().min(2),
  accountName: z.string().min(2),
  iban: z.string().min(10),
});

export const reportQuerySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  merchantId: z.uuid().optional(),
});

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().optional(),
  status: z.string().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type ProductImportRow = z.infer<typeof productImportRowSchema>;
export type PlanInput = z.infer<typeof planSchema>;
export type PromoInput = z.infer<typeof promoSchema>;
export type MerchantPromoInput = z.infer<typeof merchantPromoSchema>;
export type SubscriptionQuoteInput = z.infer<typeof subscriptionQuoteSchema>;
export type DeliverySettingInput = z.infer<typeof deliverySettingSchema>;
export type DeliverySettingUpdateInput = z.infer<typeof deliverySettingUpdateSchema>;
export type DeliveryPreviewInput = z.infer<typeof deliveryPreviewSchema>;
