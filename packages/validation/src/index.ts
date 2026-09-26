import { z } from 'zod';

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
});

export const otpVerifySchema = z.object({
  phone: z.string().regex(/^\+973\d{8}$/),
  code: z.string().min(4).max(8),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
});

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  locale: localeSchema.optional(),
  email: z.email().optional(),
});

export const addressSchema = z.object({
  label: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  latitude: z.string(),
  longitude: z.string(),
  instructions: z.string().optional(),
  isDefault: z.boolean().optional(),
});

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
  promoCode: z.string().max(40).optional(),
  delivery: z.boolean(),
  takeaway: z.boolean(),
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
  paymentMethod: z.enum(['CARD', 'BENEFIT', 'BENEFIT_PAY', 'CASH']),
  fulfillmentType: z.enum(['DELIVERY', 'TAKEAWAY', 'DINE_IN']),
  addressId: z.uuid().optional().nullable(),
  tableId: z.uuid().optional().nullable(),
  scheduledFor: z.iso.datetime().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  promoCode: z.string().optional().nullable(),
});

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

export const marketingProfileSchema = z.object({
  userId: z.uuid(),
  parentUserId: z.uuid().optional().nullable(),
  staffCommissionPercent: moneySchema,
  headOverridePercent: moneySchema,
  renewalCommissionEnabled: z.boolean(),
  maxCommission: moneySchema.optional().nullable(),
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
export type PlanInput = z.infer<typeof planSchema>;
export type PromoInput = z.infer<typeof promoSchema>;
