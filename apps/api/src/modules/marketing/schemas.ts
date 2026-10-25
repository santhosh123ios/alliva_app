import { z } from 'zod';
import { LEAD_STATUSES } from '../../domain/marketing';

export const amount = z.string().regex(/^\d+(\.\d{1,3})?$/, 'Enter a valid amount');
const signedAmount = z.string().regex(/^-?\d+(\.\d{1,3})?$/, 'Enter a valid amount');
const percent = z.string().regex(/^\d{1,3}(\.\d{1,3})?$/, 'Enter a valid percent').refine((value) => Number(value) <= 100, 'Percent cannot exceed 100');
const optionalText = (max: number) => z.string().trim().max(max).nullish();
const dateTime = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));
const status = z.enum(LEAD_STATUSES as unknown as [string, ...string[]]);

export const memberSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  employeeId: z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dots, dashes or underscores'),
  email: z.email().max(160),
  phone: z.string().trim().min(8).max(24).nullish(),
  password: z.string().min(8).max(100).nullish(),
  avatarUrl: z.string().trim().max(500).nullish(),
  region: optionalText(80),
  commissionPercent: percent.nullish(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  joinedAt: dateTime.nullish(),
  notes: optionalText(1000),
});

export const staffSchema = memberSchema.extend({
  headUserId: z.uuid(),
  referralCode: z.string().trim().max(32).nullish(),
});

export const memberPatchSchema = memberSchema.omit({ password: true, status: true }).partial();

export const statusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']), reason: optionalText(300) });
export const transferSchema = z.object({ headUserId: z.uuid(), reason: optionalText(300) });
export const referralCodeSchema = z.object({ code: z.string().trim().min(3).max(32) });
export const referralActiveSchema = z.object({ active: z.boolean() });
export const ownProfileSchema = z.object({ phone: z.string().trim().min(8).max(24).nullish(), avatarUrl: z.string().trim().max(500).nullish(), locale: z.enum(['en', 'ar']).optional() });

export const leadSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(8).max(24),
  whatsapp: z.string().trim().max(24).nullish(),
  email: z.union([z.email().max(160), z.literal('')]).nullish(),
  category: optionalText(80),
  city: optionalText(80),
  area: optionalText(80),
  address: optionalText(240),
  mapsUrl: z.union([z.url().max(500), z.literal('')]).nullish(),
  firstVisitAt: dateTime.nullish(),
  interestedPlanId: z.uuid().nullish(),
  expectedRegistrationAt: dateTime.nullish(),
  notes: optionalText(2000),
  status: status.optional(),
  nextFollowUpAt: dateTime.nullish(),
  nextAppointmentAt: dateTime.nullish(),
});
export const leadPatchSchema = leadSchema.omit({ status: true, nextFollowUpAt: true, nextAppointmentAt: true }).partial();
export const leadStatusSchema = z.object({ status, note: optionalText(500) });
export const noteSchema = z.object({ body: z.string().trim().min(2).max(2000) });
export const reassignLeadSchema = z.object({ staffUserId: z.uuid() });
export const visitSchema = z.object({ visitedAt: dateTime, outcome: optionalText(200), notes: optionalText(2000), status: status.optional() });

export const appointmentSchema = z.object({
  leadId: z.uuid().nullish(),
  merchantId: z.uuid().nullish(),
  kind: z.enum(['APPOINTMENT', 'FOLLOW_UP']),
  title: optionalText(160),
  scheduledAt: dateTime,
  notes: optionalText(1000),
});
export const appointmentPatchSchema = z.object({ title: z.string().trim().min(2).max(160).optional(), notes: optionalText(1000) });
export const rescheduleSchema = z.object({ scheduledAt: dateTime, reason: optionalText(300) });
export const cancelSchema = z.object({ reason: optionalText(300) });
export const completeSchema = z.object({ outcome: z.string().trim().min(2).max(500), nextFollowUpAt: dateTime.nullish(), status: status.optional() });

export const storeSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  businessNameAr: z.string().trim().max(120).optional(),
  phone: z.string().trim().min(8).max(24),
  email: z.email().max(160),
  city: z.string().trim().min(2).max(80),
  businessType: z.string().trim().min(1).max(60),
  categoryId: z.uuid(),
  planId: z.uuid().optional(),
  billingInterval: z.enum(['MONTHLY', 'ANNUAL']).optional(),
  promoCode: z.string().trim().max(40).nullish(),
  leadId: z.uuid().nullish(),
});

export const reassignStoreSchema = z.object({ staffUserId: z.uuid(), reason: z.string().trim().min(5).max(300) });

export const withdrawalSchema = z.object({ amount, method: z.string().trim().min(2).max(40), acceptTerms: z.literal(true, { error: 'You must accept the withdrawal terms' }) });
export const withdrawalDecisionSchema = z.object({
  to: z.enum(['UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED']),
  reason: optionalText(300),
  payoutReference: optionalText(120),
  payoutMethod: optionalText(60),
  note: optionalText(300),
});
export const adjustmentSchema = z.object({ amount: signedAmount, reason: z.string().trim().min(5).max(300) });
export const approveCommissionsSchema = z.object({ ids: z.array(z.uuid()).max(500).optional() });

export const refundSchema = z.object({
  amount: amount.optional(),
  reason: z.string().trim().min(5).max(300),
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
  cancelSubscription: z.boolean().optional(),
});

export { percent, signedAmount };
