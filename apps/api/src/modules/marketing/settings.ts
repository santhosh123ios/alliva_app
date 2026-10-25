import { z } from 'zod';
import type { AuditService } from '../../common/audit';
import { badRequest } from '../../common/errors';
import type { RequestUser } from '../../common/http';
import { DEFAULT_REMINDER_OFFSETS_MINUTES, LEAD_STATUSES, normalizeOffsets, referralPrefix, type CommissionBase } from '../../domain/marketing';
import type { RedemptionCadence } from '../../domain/commissions';
import type { PrismaService } from '../../prisma/prisma.service';

export type MarketingSettings = {
  // commission
  staffPercent: string;
  headPercent: string;
  commissionBase: CommissionBase;
  firstPaymentOnly: boolean;
  approval: 'AUTO' | 'MANUAL' | 'HOLD_DAYS';
  holdDays: number;
  refundPolicy: 'PROPORTIONAL';
  // referral
  referralPrefix: string;
  autoGenerateReferral: boolean;
  referralValidation: boolean;
  // appointments
  followUpAlerts: boolean;
  reminderOffsets: number[];
  overdueAlertHours: number;
  notifyHead: boolean;
  // wallet
  cadence: RedemptionCadence;
  minWithdrawal: string;
  payoutMethods: string[];
  withdrawalApproval: 'REQUIRED' | 'AUTO_REVIEW';
  withdrawalActiveOnly: boolean;
  terms: { en: string; ar: string };
  // operations
  leadStatusLabels: Record<string, { en: string; ar: string }>;
  requireHead: boolean;
  allowStaffTransfer: boolean;
  headsCanReassignLeads: boolean;
  headsSeeReports: boolean;
  taxPercent: string;
};

const P = 'marketing.';

const DEFAULT_TERMS = {
  en: 'Commission is credited on the first subscription payment only. Withdrawals are paid after review.',
  ar: 'تُضاف العمولة على أول دفعة اشتراك فقط. تُدفع السحوبات بعد المراجعة.',
};

const LABELS: Record<string, { en: string; ar: string }> = {
  NEW: { en: 'New lead', ar: 'عميل جديد' },
  CONTACTED: { en: 'Contacted', ar: 'تم التواصل' },
  VISITED: { en: 'Visited', ar: 'تمت الزيارة' },
  INTERESTED: { en: 'Interested', ar: 'مهتم' },
  FOLLOW_UP_REQUIRED: { en: 'Follow-up required', ar: 'يتطلب متابعة' },
  APPOINTMENT_SCHEDULED: { en: 'Appointment scheduled', ar: 'تم تحديد موعد' },
  NEGOTIATION: { en: 'Negotiation', ar: 'تفاوض' },
  REGISTRATION_PENDING: { en: 'Registration pending', ar: 'التسجيل قيد الانتظار' },
  REGISTERED: { en: 'Registered', ar: 'مسجل' },
  NOT_INTERESTED: { en: 'Not interested', ar: 'غير مهتم' },
  CLOSED_LOST: { en: 'Closed / lost', ar: 'مغلق / مفقود' },
};

/** Fields whose change affects money and therefore gets a high-priority audit entry. */
const FINANCIAL = new Set<keyof MarketingSettings>([
  'staffPercent',
  'headPercent',
  'commissionBase',
  'firstPaymentOnly',
  'approval',
  'holdDays',
  'refundPolicy',
  'cadence',
  'minWithdrawal',
  'payoutMethods',
  'withdrawalApproval',
  'withdrawalActiveOnly',
]);

const percent = z.string().regex(/^\d{1,3}(\.\d{1,3})?$/).refine((value) => Number(value) <= 100, 'Percent cannot exceed 100');
const amount = z.string().regex(/^\d+(\.\d{1,3})?$/);
const localized = z.object({ en: z.string().min(1).max(80), ar: z.string().min(1).max(80) });

export const marketingSettingsPatchSchema = z
  .object({
    staffPercent: percent,
    headPercent: percent,
    commissionBase: z.enum(['NET_PAID', 'NET_EXCLUDING_TAX']),
    firstPaymentOnly: z.literal(true, { error: 'Commission on renewals is not supported by the current policy' }),
    approval: z.enum(['AUTO', 'MANUAL', 'HOLD_DAYS']),
    holdDays: z.number().int().min(0).max(90),
    refundPolicy: z.literal('PROPORTIONAL'),
    referralPrefix: z.string().trim().min(2).max(8).regex(/^[A-Za-z0-9]+$/),
    autoGenerateReferral: z.boolean(),
    referralValidation: z.boolean(),
    followUpAlerts: z.boolean(),
    reminderOffsets: z.array(z.number().int().min(0).max(60 * 24 * 14)).min(1).max(6),
    overdueAlertHours: z.number().int().min(1).max(168),
    notifyHead: z.boolean(),
    cadence: z.enum(['WEEKLY', 'MONTHLY']),
    minWithdrawal: amount,
    payoutMethods: z.array(z.string().trim().min(2).max(40)).min(1).max(8),
    withdrawalApproval: z.enum(['REQUIRED', 'AUTO_REVIEW']),
    withdrawalActiveOnly: z.boolean(),
    terms: localized.extend({ en: z.string().min(1).max(600), ar: z.string().min(1).max(600) }),
    leadStatusLabels: z.record(z.string(), localized),
    requireHead: z.literal(true, { error: 'Every marketing staff member must belong to a marketing head' }),
    allowStaffTransfer: z.boolean(),
    headsCanReassignLeads: z.boolean(),
    headsSeeReports: z.boolean(),
  })
  .partial()
  .strict();

type Store = Map<string, unknown>;

function num(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}
const fixed = (value: unknown, fallback: string) => {
  const n = num(value, Number.NaN);
  return Number.isFinite(n) ? n.toFixed(3) : fallback;
};
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

export function parseSettings(store: Store): MarketingSettings {
  const get = (key: string) => store.get(`${P}${key}`);
  const terms = get('redemptionTerms') as { en?: string; ar?: string } | undefined;
  const labelRaw = get('leadStatusLabels') as Record<string, { en?: string; ar?: string }> | undefined;
  const labels: Record<string, { en: string; ar: string }> = {};
  for (const status of LEAD_STATUSES) {
    labels[status] = { en: labelRaw?.[status]?.en || LABELS[status]!.en, ar: labelRaw?.[status]?.ar || LABELS[status]!.ar };
  }
  const payout = get('payoutMethods');
  return {
    staffPercent: fixed(get('staffCommissionPercent'), '10.000'),
    headPercent: fixed(get('headCommissionPercent'), '1.000'),
    commissionBase: get('commissionBase') === 'NET_EXCLUDING_TAX' ? 'NET_EXCLUDING_TAX' : 'NET_PAID',
    firstPaymentOnly: true,
    approval: ['AUTO', 'MANUAL', 'HOLD_DAYS'].includes(String(get('commissionApproval'))) ? (get('commissionApproval') as 'AUTO' | 'MANUAL' | 'HOLD_DAYS') : 'AUTO',
    holdDays: num(get('commissionHoldDays'), 0, 0, 90),
    refundPolicy: 'PROPORTIONAL',
    referralPrefix: referralPrefix(typeof get('referralPrefix') === 'string' ? (get('referralPrefix') as string) : 'ALV'),
    autoGenerateReferral: bool(get('generateReferralCode'), true),
    referralValidation: bool(get('referralValidation'), true),
    followUpAlerts: bool(get('followUpAlerts'), true),
    reminderOffsets: normalizeOffsets(get('reminderOffsets') ?? DEFAULT_REMINDER_OFFSETS_MINUTES),
    overdueAlertHours: num(get('overdueAlertHours'), 2, 1, 168),
    notifyHead: bool(get('notifyHead'), true),
    cadence: get('redemptionCadence') === 'MONTHLY' ? 'MONTHLY' : 'WEEKLY',
    minWithdrawal: fixed(get('minRedeemAmount'), '10.000'),
    payoutMethods: Array.isArray(payout) && payout.every((p) => typeof p === 'string') && payout.length ? (payout as string[]) : ['BANK_TRANSFER', 'CASH'],
    withdrawalApproval: get('withdrawalApproval') === 'AUTO_REVIEW' ? 'AUTO_REVIEW' : 'REQUIRED',
    withdrawalActiveOnly: bool(get('withdrawalActiveOnly'), true),
    terms: { en: terms?.en || DEFAULT_TERMS.en, ar: terms?.ar || DEFAULT_TERMS.ar },
    leadStatusLabels: labels,
    requireHead: true,
    allowStaffTransfer: bool(get('allowStaffTransfer'), true),
    headsCanReassignLeads: bool(get('headsCanReassignLeads'), false),
    headsSeeReports: bool(get('headsSeeReports'), true),
    taxPercent: fixed(store.get('taxRate'), '0.000'),
  };
}

/** Maps API field names to the persisted PlatformSetting keys. */
const KEY_MAP: Record<keyof z.infer<typeof marketingSettingsPatchSchema>, string> = {
  staffPercent: 'staffCommissionPercent',
  headPercent: 'headCommissionPercent',
  commissionBase: 'commissionBase',
  firstPaymentOnly: 'promoFirstPaymentOnly',
  approval: 'commissionApproval',
  holdDays: 'commissionHoldDays',
  refundPolicy: 'refundPolicy',
  referralPrefix: 'referralPrefix',
  autoGenerateReferral: 'generateReferralCode',
  referralValidation: 'referralValidation',
  followUpAlerts: 'followUpAlerts',
  reminderOffsets: 'reminderOffsets',
  overdueAlertHours: 'overdueAlertHours',
  notifyHead: 'notifyHead',
  cadence: 'redemptionCadence',
  minWithdrawal: 'minRedeemAmount',
  payoutMethods: 'payoutMethods',
  withdrawalApproval: 'withdrawalApproval',
  withdrawalActiveOnly: 'withdrawalActiveOnly',
  terms: 'redemptionTerms',
  leadStatusLabels: 'leadStatusLabels',
  requireHead: 'requireHead',
  allowStaffTransfer: 'allowStaffTransfer',
  headsCanReassignLeads: 'headsCanReassignLeads',
  headsSeeReports: 'headsSeeReports',
};

export class MarketingSettingsService {
  private cache: { at: number; value: MarketingSettings } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<MarketingSettings> {
    if (this.cache && Date.now() - this.cache.at < 5_000) return this.cache.value;
    const rows = await this.prisma.platformSetting.findMany({
      where: { OR: [{ key: { startsWith: P } }, { key: 'taxRate' }] },
    });
    const value = parseSettings(new Map(rows.map((row) => [row.key, row.value])));
    this.cache = { at: Date.now(), value };
    return value;
  }

  async update(actor: RequestUser, patch: Partial<MarketingSettings>) {
    const parsed = marketingSettingsPatchSchema.safeParse(patch);
    if (!parsed.success) throw badRequest(parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })));
    const before = await this.get();
    const changes: { field: string; from: unknown; to: unknown; financial: boolean }[] = [];
    for (const [field, value] of Object.entries(parsed.data) as [keyof typeof KEY_MAP, unknown][]) {
      if (JSON.stringify(before[field as keyof MarketingSettings]) === JSON.stringify(value)) continue;
      changes.push({ field, from: before[field as keyof MarketingSettings], to: value, financial: FINANCIAL.has(field as keyof MarketingSettings) });
    }
    await this.prisma.$transaction(async (tx) => {
      for (const change of changes) {
        const key = `${P}${KEY_MAP[change.field as keyof typeof KEY_MAP]}`;
        // Percentages and money are stored as numbers/strings exactly as validated.
        const stored = change.field === 'staffPercent' || change.field === 'headPercent' ? Number(change.to) : change.to;
        await tx.platformSetting.upsert({
          where: { key },
          update: { value: stored as never, updatedById: actor.id },
          create: { key, value: stored as never, updatedById: actor.id },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: change.financial ? 'marketing.settings.financial' : 'marketing.settings',
            entityType: 'PlatformSetting',
            entityId: key,
            metadata: { from: change.from, to: change.to } as never,
          },
        });
      }
    });
    this.cache = null;
    return this.get();
  }
}
