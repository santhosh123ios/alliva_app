import type { AuditService } from '../../common/audit';
import { badRequest, notFound } from '../../common/errors';
import type { RequestUser } from '../../common/http';
import { loc } from '../../common/crypto';
import { CLOSED_LEAD_STATUSES, normalizeEmail, normalizePhone, normalizeReferralCode } from '../../domain/marketing';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MarketingSettingsService } from './settings';
import { fullName, notify, recordActivity, type Db } from './shared';

export type ResolvedReferral = {
  referralCodeId: string;
  staffUserId: string;
  headUserId: string | null;
  code: string;
  staffFirstName: string;
};

export class MarketingReferralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: MarketingSettingsService,
  ) {}

  /**
   * Resolves a referral code to the staff member and head who earn the attribution.
   * Only an active code of an active staff member is accepted. Promo codes are never looked at here.
   */
  async resolve(raw: string, db: Db = this.prisma): Promise<ResolvedReferral> {
    const code = normalizeReferralCode(raw);
    const settings = await this.settings.get();
    const row = await db.marketingReferralCode.findUnique({ where: { code }, include: { profile: { include: { user: true } } } });
    const staff = row?.profile;
    const bad = badRequest('This referral code is not valid');
    if (!row || !staff || staff.kind !== 'STAFF') throw bad;
    if (settings.referralValidation && (!row.active || staff.status !== 'ACTIVE')) throw bad;
    return {
      referralCodeId: row.id,
      staffUserId: staff.userId,
      headUserId: staff.parentUserId,
      code: row.code,
      staffFirstName: staff.user.firstName,
    };
  }

  async validate(raw: string) {
    try {
      const resolved = await this.resolve(raw);
      return { valid: true as const, code: resolved.code, staffName: resolved.staffFirstName };
    } catch {
      return { valid: false as const, reason: 'This referral code is not valid' };
    }
  }

  /**
   * Creates the immutable attribution row. `merchantId` is unique, so a merchant is attributed exactly once and
   * a retried request fails instead of creating a second (or different) owner.
   */
  async attribute(
    db: Db,
    input: {
      merchantId: string;
      resolved: ResolvedReferral;
      source: 'SIGNUP' | 'STAFF_PORTAL' | 'ADMIN';
      actorId: string;
      contact: { phone?: string | null; email?: string | null };
      merchantName: string;
    },
  ) {
    const { resolved } = input;
    const referral = await db.merchantReferral.create({
      data: {
        merchantId: input.merchantId,
        marketingUserId: resolved.staffUserId,
        headUserId: resolved.headUserId,
        referralCodeId: resolved.referralCodeId,
        codeUsed: resolved.code,
        source: input.source,
      },
    });
    await recordActivity(db, {
      authorId: input.actorId,
      staffUserId: resolved.staffUserId,
      headUserId: resolved.headUserId,
      merchantId: input.merchantId,
      kind: 'MERCHANT_REGISTERED',
      body: `${input.merchantName || 'A store'} registered with ${resolved.code}`,
      toStatus: 'REGISTERED',
      metadata: { code: resolved.code, source: input.source },
    });
    const link = `/stores?store=${input.merchantId}`;
    await notify(db, {
      userId: resolved.staffUserId,
      title: { en: 'New store registered', ar: 'تسجيل متجر جديد' },
      body: { en: `${input.merchantName} registered with your referral code`, ar: `${input.merchantName} سجّل باستخدام رمز الإحالة الخاص بك` },
      link,
      entityType: 'Merchant',
      entityId: input.merchantId,
      dedupeKey: `referral:${input.merchantId}:staff`,
    });
    if (resolved.headUserId) {
      await notify(db, {
        userId: resolved.headUserId,
        title: { en: 'New team store', ar: 'متجر جديد للفريق' },
        body: { en: `${input.merchantName} registered through your team`, ar: `${input.merchantName} سجّل عبر فريقك` },
        link,
        entityType: 'Merchant',
        entityId: input.merchantId,
        dedupeKey: `referral:${input.merchantId}:head`,
      });
    }
    await this.matchLead(db, input.merchantId, resolved.staffUserId, input.contact, input.actorId, resolved.headUserId);
    return referral;
  }

  /**
   * Safe lead matching. A lead is linked to the merchant only when it belongs to the same staff member, is still open,
   * and shares the merchant's phone number or email after normalisation. Exactly one candidate must match; business
   * names are never used, so unrelated leads are not merged by accident.
   */
  async matchLead(db: Db, merchantId: string, staffUserId: string, contact: { phone?: string | null; email?: string | null }, actorId: string, headUserId: string | null) {
    const phone = normalizePhone(contact.phone);
    const email = normalizeEmail(contact.email);
    if (!phone && !email) return null;
    const leads = await db.marketingLead.findMany({ where: { marketingUserId: staffUserId, merchantId: null, status: { notIn: CLOSED_LEAD_STATUSES as never[] } } });
    const matches = leads.filter((lead) => {
      const samePhone = phone && [lead.phone, lead.whatsapp].some((value) => normalizePhone(value) === phone);
      const sameEmail = email && normalizeEmail(lead.email) === email;
      return samePhone || sameEmail;
    });
    if (matches.length !== 1) return null;
    const lead = matches[0]!;
    await db.marketingLead.update({ where: { id: lead.id }, data: { merchantId, status: 'REGISTERED', followUpAt: null, appointmentAt: null } });
    await db.marketingAppointment.updateMany({ where: { leadId: lead.id, status: 'SCHEDULED' }, data: { status: 'CANCELLED', outcome: 'Lead registered as a merchant' } });
    await recordActivity(db, {
      authorId: actorId,
      staffUserId,
      headUserId,
      leadId: lead.id,
      merchantId,
      kind: 'STATUS',
      body: 'Lead matched to the registered merchant by contact details',
      fromStatus: lead.status,
      toStatus: 'REGISTERED',
    });
    return lead.id;
  }

  /**
   * Authorized administrative change of attribution. Blocked once a commission has been generated, because
   * moving the merchant afterwards would orphan money that was already credited.
   */
  async reassign(actor: RequestUser, merchantId: string, staffUserId: string, reason: string) {
    if (!reason.trim()) throw badRequest('A reason is required');
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) throw notFound('Merchant not found');
    const staff = await this.prisma.marketingProfile.findUnique({ where: { userId: staffUserId }, include: { user: true } });
    if (!staff || staff.kind !== 'STAFF') throw badRequest('Choose a marketing staff member');
    if (staff.status !== 'ACTIVE') throw badRequest('That staff member is not active');
    const existing = await this.prisma.merchantReferral.findUnique({ where: { merchantId } });
    if (existing?.commissionPaymentId) throw badRequest('A commission was already generated for this merchant, so attribution can no longer be changed');
    const codeRow = staff.referralCode ? await this.prisma.marketingReferralCode.findUnique({ where: { code: staff.referralCode } }) : null;
    await this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.merchantReferral.update({
          where: { id: existing.id },
          data: { marketingUserId: staffUserId, headUserId: staff.parentUserId, referralCodeId: codeRow?.id ?? null, codeUsed: staff.referralCode ?? existing.codeUsed, source: 'ADMIN' },
        });
      } else {
        await tx.merchantReferral.create({
          data: { merchantId, marketingUserId: staffUserId, headUserId: staff.parentUserId, referralCodeId: codeRow?.id ?? null, codeUsed: staff.referralCode ?? 'ADMIN', source: 'ADMIN' },
        });
      }
      await recordActivity(tx, {
        authorId: actor.id,
        staffUserId,
        headUserId: staff.parentUserId,
        merchantId,
        kind: 'MERCHANT_REGISTERED',
        body: `${loc(merchant.name).en} was assigned to ${fullName(staff.user)} by an admin`,
        metadata: { fromStaffUserId: existing?.marketingUserId ?? null, reason },
      });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'marketing.referral.reassign', entityType: 'Merchant', entityId: merchantId, metadata: { from: existing?.marketingUserId ?? null, to: staffUserId, reason } as never },
      });
    });
    return { ok: true };
  }
}
