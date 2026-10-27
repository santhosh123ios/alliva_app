import type { Prisma } from '@prisma/client';
import type { AuditService } from '../../common/audit';
import { dec, loc } from '../../common/crypto';
import { badRequest, forbidden, notFound } from '../../common/errors';
import type { RequestUser } from '../../common/http';
import { dateRange, paged, pageQuery, parseDate, readQuery } from '../../common/paging';
import { money, moneyString } from '../../domain/money';
import { CLOSED_LEAD_STATUSES, LEAD_STATUSES, normalizePhone, type LeadStatus } from '../../domain/marketing';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PlatformService } from '../platform.service';
import type { MarketingPromoService } from './promo.service';
import type { MarketingReferralService } from './referral.service';
import type { MarketingScope } from './scope';
import type { MarketingSettingsService } from './settings';
import { paymentMethodsForRegistration } from '../payment-methods';
import { fullName, isUniqueViolation, notify, recordActivity, type Db } from './shared';

export type LeadInput = {
  businessName: string;
  contactName: string;
  phone: string;
  whatsapp?: string | null;
  email?: string | null;
  category?: string | null;
  city?: string | null;
  area?: string | null;
  address?: string | null;
  mapsUrl?: string | null;
  firstVisitAt?: string | null;
  interestedPlanId?: string | null;
  expectedRegistrationAt?: string | null;
  notes?: string | null;
  status?: LeadStatus;
  nextFollowUpAt?: string | null;
  nextAppointmentAt?: string | null;
};

const EARLY_STATUSES: LeadStatus[] = ['NEW', 'CONTACTED', 'VISITED', 'INTERESTED', 'FOLLOW_UP_REQUIRED', 'APPOINTMENT_SCHEDULED'];

export class MarketingPipelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: MarketingSettingsService,
    private readonly referrals: MarketingReferralService,
    private readonly promos: MarketingPromoService,
    private readonly platform: PlatformService,
  ) {}

  private requireStaff(scope: MarketingScope) {
    if (!scope.isStaff) throw forbidden('Only marketing staff can record leads and visits');
  }

  private async staffContext(scope: MarketingScope) {
    this.requireStaff(scope);
    const profile = await this.prisma.marketingProfile.findUnique({ where: { userId: scope.userId } });
    if (!profile || profile.kind !== 'STAFF') throw forbidden('No marketing staff account');
    return profile;
  }

  /** Staff may only touch their own lead; everyone else gets 404 so ids cannot be probed. */
  private async ownLead(scope: MarketingScope, id: string, db: Db = this.prisma) {
    this.requireStaff(scope);
    const lead = await db.marketingLead.findFirst({ where: { id, marketingUserId: scope.userId } });
    if (!lead) throw notFound('Lead not found');
    return lead;
  }

  // ====================================================================== leads

  async listLeads(scope: MarketingScope, query: Record<string, unknown>) {
    const page = pageQuery(query);
    const raw = readQuery(query);
    const range = dateRange(raw);
    // Heads and staff see every open lead. A lead leaves this list once it is connected to a store.
    const and: Prisma.MarketingLeadWhereInput[] = [scope.isAdmin ? scope.leads() : { merchantId: null }];
    if (raw.status) and.push({ status: { in: raw.status.split(',').filter((s) => (LEAD_STATUSES as readonly string[]).includes(s)) as never[] } });
    if (raw.staffId) {
      scope.assertStaff(raw.staffId);
      and.push({ marketingUserId: raw.staffId });
    }
    if (raw.headId && scope.isAdmin) and.push({ headUserId: raw.headId });
    if (raw.category) and.push({ category: raw.category });
    if (raw.area) and.push({ OR: [{ area: { contains: raw.area, mode: 'insensitive' } }, { city: { contains: raw.area, mode: 'insensitive' } }] });
    if (raw.planId) and.push({ interestedPlanId: raw.planId });
    if (range) and.push({ createdAt: range });
    if (raw.attention === 'true') {
      const stale = new Date(Date.now() - 7 * 86_400_000);
      and.push({ status: { notIn: CLOSED_LEAD_STATUSES as never[] }, OR: [{ updatedAt: { lt: stale } }, { followUpAt: { lt: new Date() } }] });
    }
    if (page.q) {
      const digits = normalizePhone(page.q);
      and.push({
        OR: [
          { businessName: { contains: page.q, mode: 'insensitive' } },
          { contactName: { contains: page.q, mode: 'insensitive' } },
          { email: { contains: page.q, mode: 'insensitive' } },
          { area: { contains: page.q, mode: 'insensitive' } },
          { phone: { contains: page.q } },
          ...(digits.length >= 4 ? [{ phone: { contains: digits.slice(-8) } }] : []),
        ],
      });
    }
    const where: Prisma.MarketingLeadWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.marketingLead.findMany({ where, include: { marketingUser: { select: { firstName: true, lastName: true } }, interestedPlan: { select: { name: true } } }, orderBy: { updatedAt: 'desc' }, skip: page.skip, take: page.pageSize }),
      this.prisma.marketingLead.count({ where }),
    ]);
    return paged(rows.map((row) => this.presentLead(row)), total, page);
  }

  async getLead(scope: MarketingScope, id: string) {
    const lead = await this.prisma.marketingLead.findFirst({
      where: { AND: [{ id }, scope.isAdmin ? scope.leads() : { merchantId: null }] },
      include: {
        marketingUser: { select: { firstName: true, lastName: true } },
        head: { select: { firstName: true, lastName: true } },
        interestedPlan: { select: { name: true } },
        visits: { orderBy: { visitedAt: 'desc' } },
        appointments: { orderBy: { scheduledAt: 'desc' } },
        activities: { orderBy: { createdAt: 'desc' }, include: { author: { select: { firstName: true, lastName: true } } } },
      },
    });
    if (!lead) throw notFound('Lead not found');
    return {
      ...this.presentLead(lead),
      headName: fullName(lead.head),
      visits: lead.visits.map((visit) => ({ id: visit.id, visitedAt: visit.visitedAt.toISOString(), outcome: visit.outcome, notes: visit.notes })),
      appointments: lead.appointments.map((row) => this.presentAppointment({ ...row, lead: { businessName: lead.businessName } })),
      history: lead.activities.map((activity) => ({
        id: activity.id,
        at: activity.createdAt.toISOString(),
        kind: activity.kind,
        body: activity.body,
        fromStatus: activity.fromStatus,
        toStatus: activity.toStatus,
        authorName: fullName(activity.author),
      })),
    };
  }

  async createLead(actor: RequestUser, scope: MarketingScope, input: LeadInput) {
    const profile = await this.staffContext(scope);
    const phone = normalizePhone(input.phone);
    if (phone.length < 8) throw badRequest('Enter a valid mobile number');
    await this.assertNoDuplicate(scope.userId, phone);
    if (input.interestedPlanId) await this.assertPlan(input.interestedPlanId);
    const nextAppointment = this.futureDate(input.nextAppointmentAt, 'The appointment time must be in the future');
    const nextFollowUp = this.futureDate(input.nextFollowUpAt, 'The follow-up date must be in the future');
    const status: LeadStatus = input.status ?? (nextAppointment ? 'APPOINTMENT_SCHEDULED' : nextFollowUp ? 'FOLLOW_UP_REQUIRED' : input.firstVisitAt ? 'VISITED' : 'NEW');
    if (status === 'REGISTERED') throw badRequest('Convert the lead to a store to mark it registered');
    const firstVisitAt = input.firstVisitAt ? new Date(input.firstVisitAt) : null;
    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.marketingLead.create({
        data: {
          marketingUserId: scope.userId,
          headUserId: profile.parentUserId,
          businessName: input.businessName.trim(),
          contactName: input.contactName.trim(),
          phone: input.phone.trim(),
          whatsapp: input.whatsapp?.trim() || null,
          email: input.email?.trim().toLowerCase() || null,
          category: input.category?.trim() || null,
          city: input.city?.trim() || null,
          area: input.area?.trim() || null,
          address: input.address?.trim() || null,
          mapsUrl: input.mapsUrl?.trim() || null,
          firstVisitAt,
          interestedPlanId: input.interestedPlanId || null,
          expectedRegistrationAt: input.expectedRegistrationAt ? new Date(input.expectedRegistrationAt) : null,
          notes: input.notes?.trim() || null,
          status,
        },
      });
      await recordActivity(tx, { authorId: actor.id, staffUserId: scope.userId, headUserId: profile.parentUserId, leadId: lead.id, kind: 'LEAD_CREATED', body: `Lead created for ${lead.businessName}`, toStatus: status });
      if (firstVisitAt) {
        await tx.marketingVisit.create({ data: { leadId: lead.id, staffUserId: scope.userId, headUserId: profile.parentUserId, visitedAt: firstVisitAt, notes: input.notes?.trim() || null, outcome: 'First visit' } });
        await recordActivity(tx, { authorId: actor.id, staffUserId: scope.userId, headUserId: profile.parentUserId, leadId: lead.id, kind: 'VISIT', body: `Visited ${lead.businessName}`, metadata: { visitedAt: firstVisitAt.toISOString() } });
      }
      if (nextAppointment) await this.insertAppointment(tx, actor, profile, { leadId: lead.id, kind: 'APPOINTMENT', title: `Meeting: ${lead.businessName}`, scheduledAt: nextAppointment, notes: null });
      if (nextFollowUp) await this.insertAppointment(tx, actor, profile, { leadId: lead.id, kind: 'FOLLOW_UP', title: `Follow-up: ${lead.businessName}`, scheduledAt: nextFollowUp, notes: null });
      await this.syncLead(tx, lead.id, true);
      return this.getLeadIn(tx, lead.id);
    });
  }

  async updateLead(actor: RequestUser, scope: MarketingScope, id: string, patch: Partial<LeadInput>) {
    const lead = await this.ownLead(scope, id);
    if (lead.status === 'REGISTERED' && lead.merchantId) {
      // Converted leads stay editable for notes but their identity fields are frozen.
      if (patch.businessName || patch.phone || patch.email) throw badRequest('A converted lead keeps its original business details');
    }
    const data: Prisma.MarketingLeadUpdateInput = {};
    if (patch.phone !== undefined) {
      const phone = normalizePhone(patch.phone);
      if (phone.length < 8) throw badRequest('Enter a valid mobile number');
      if (phone !== normalizePhone(lead.phone)) await this.assertNoDuplicate(scope.userId, phone, id);
      data.phone = patch.phone.trim();
    }
    const strings = ['businessName', 'contactName', 'whatsapp', 'category', 'city', 'area', 'address', 'mapsUrl', 'notes'] as const;
    for (const key of strings) if (patch[key] !== undefined) (data as Record<string, unknown>)[key] = patch[key]?.toString().trim() || (key === 'businessName' || key === 'contactName' ? undefined : null);
    if (patch.email !== undefined) data.email = patch.email?.trim().toLowerCase() || null;
    if (patch.firstVisitAt !== undefined) data.firstVisitAt = patch.firstVisitAt ? new Date(patch.firstVisitAt) : null;
    if (patch.expectedRegistrationAt !== undefined) data.expectedRegistrationAt = patch.expectedRegistrationAt ? new Date(patch.expectedRegistrationAt) : null;
    if (patch.interestedPlanId !== undefined) {
      if (patch.interestedPlanId) await this.assertPlan(patch.interestedPlanId);
      data.interestedPlan = patch.interestedPlanId ? { connect: { id: patch.interestedPlanId } } : { disconnect: true };
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.marketingLead.update({ where: { id }, data });
      await recordActivity(tx, { authorId: actor.id, staffUserId: lead.marketingUserId, headUserId: lead.headUserId, leadId: id, kind: 'NOTE', body: 'Lead details updated', metadata: { fields: Object.keys(patch) } });
    });
    return this.getLead(scope, id);
  }

  async setStatus(actor: RequestUser, scope: MarketingScope, id: string, status: LeadStatus, note?: string) {
    const lead = await this.ownLead(scope, id);
    if (!(LEAD_STATUSES as readonly string[]).includes(status)) throw badRequest('Unknown status');
    if (status === 'REGISTERED' && !lead.merchantId) throw badRequest('Convert the lead to a store to mark it registered');
    if (lead.status === status) return this.getLead(scope, id);
    if (lead.merchantId && lead.status === 'REGISTERED') throw badRequest('A registered lead cannot change status');
    await this.prisma.$transaction(async (tx) => {
      await tx.marketingLead.update({ where: { id }, data: { status } });
      if (CLOSED_LEAD_STATUSES.includes(status)) {
        await tx.marketingAppointment.updateMany({ where: { leadId: id, status: 'SCHEDULED' }, data: { status: 'CANCELLED', outcome: 'Lead closed' } });
        await this.syncLead(tx, id);
      }
      await recordActivity(tx, { authorId: actor.id, staffUserId: lead.marketingUserId, headUserId: lead.headUserId, leadId: id, kind: 'STATUS', body: note?.trim() || `Status changed to ${status}`, fromStatus: lead.status, toStatus: status });
    });
    return this.getLead(scope, id);
  }

  async addNote(actor: RequestUser, scope: MarketingScope, id: string, body: string) {
    const lead = await this.ownLead(scope, id);
    await recordActivity(this.prisma, { authorId: actor.id, staffUserId: lead.marketingUserId, headUserId: lead.headUserId, leadId: id, kind: 'NOTE', body: body.trim() });
    await this.prisma.marketingLead.update({ where: { id }, data: { updatedAt: new Date() } });
    return { ok: true };
  }

  async reassignLead(actor: RequestUser, scope: MarketingScope, id: string, toStaffUserId: string) {
    const settings = await this.settings.get();
    if (!scope.isAdmin && !(scope.isHead && settings.headsCanReassignLeads)) throw forbidden('You cannot reassign leads');
    const lead = await this.prisma.marketingLead.findFirst({ where: { AND: [{ id }, scope.leads()] } });
    if (!lead) throw notFound('Lead not found');
    if (lead.merchantId) throw badRequest('A converted lead cannot be reassigned');
    const target = await this.prisma.marketingProfile.findUnique({ where: { userId: toStaffUserId } });
    if (!target || target.kind !== 'STAFF' || target.status !== 'ACTIVE') throw badRequest('Choose an active staff member');
    if (scope.isHead && target.parentUserId !== scope.userId) throw notFound('Staff not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.marketingLead.update({ where: { id }, data: { marketingUserId: toStaffUserId, headUserId: target.parentUserId } });
      await tx.marketingAppointment.updateMany({ where: { leadId: id, status: 'SCHEDULED' }, data: { staffUserId: toStaffUserId, headUserId: target.parentUserId } });
      await recordActivity(tx, { authorId: actor.id, staffUserId: toStaffUserId, headUserId: target.parentUserId, leadId: id, kind: 'NOTE', body: 'Lead reassigned', metadata: { fromStaffUserId: lead.marketingUserId, toStaffUserId } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'marketing.lead.reassign', entityType: 'MarketingLead', entityId: id, metadata: { from: lead.marketingUserId, to: toStaffUserId } as never } });
      await notify(tx, { userId: toStaffUserId, title: { en: 'Lead assigned to you', ar: 'تم تعيين عميل لك' }, body: { en: `${lead.businessName} was assigned to you`, ar: `تم تعيين ${lead.businessName} لك` }, link: `/leads?lead=${id}`, entityType: 'MarketingLead', entityId: id, dedupeKey: `lead-assign:${id}:${Date.now()}` });
    });
    return { ok: true };
  }

  // ====================================================================== visits

  async recordVisit(actor: RequestUser, scope: MarketingScope, leadId: string, input: { visitedAt: string; outcome?: string | null; notes?: string | null; status?: LeadStatus }) {
    const lead = await this.ownLead(scope, leadId);
    const visitedAt = new Date(input.visitedAt);
    if (Number.isNaN(visitedAt.getTime()) || visitedAt.getTime() > Date.now() + 5 * 60_000) throw badRequest('A visit cannot be in the future');
    if (input.status === 'REGISTERED') throw badRequest('Convert the lead to a store to mark it registered');
    await this.prisma.$transaction(async (tx) => {
      await tx.marketingVisit.create({ data: { leadId, staffUserId: lead.marketingUserId, headUserId: lead.headUserId, visitedAt, outcome: input.outcome?.trim() || null, notes: input.notes?.trim() || null } });
      const nextStatus = input.status ?? (['NEW', 'CONTACTED'].includes(lead.status) ? 'VISITED' : lead.status);
      await tx.marketingLead.update({ where: { id: leadId }, data: { firstVisitAt: lead.firstVisitAt ?? visitedAt, status: nextStatus } });
      await recordActivity(tx, { authorId: actor.id, staffUserId: lead.marketingUserId, headUserId: lead.headUserId, leadId, kind: 'VISIT', body: input.notes?.trim() || `Visited ${lead.businessName}`, fromStatus: lead.status, toStatus: nextStatus, metadata: { visitedAt: visitedAt.toISOString(), outcome: input.outcome ?? null } });
    });
    return this.getLead(scope, leadId);
  }

  async listVisits(scope: MarketingScope, query: Record<string, unknown>) {
    const page = pageQuery(query);
    const raw = readQuery(query);
    const range = dateRange(raw);
    const and: Prisma.MarketingVisitWhereInput[] = [scope.visits()];
    if (raw.staffId) {
      scope.assertStaff(raw.staffId);
      and.push({ staffUserId: raw.staffId });
    }
    if (range) and.push({ visitedAt: range });
    if (page.q) and.push({ OR: [{ notes: { contains: page.q, mode: 'insensitive' } }, { lead: { businessName: { contains: page.q, mode: 'insensitive' } } }] });
    const where: Prisma.MarketingVisitWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.marketingVisit.findMany({ where, include: { lead: { select: { id: true, businessName: true, area: true, status: true } }, staff: { select: { firstName: true, lastName: true } } }, orderBy: { visitedAt: 'desc' }, skip: page.skip, take: page.pageSize }),
      this.prisma.marketingVisit.count({ where }),
    ]);
    return paged(
      rows.map((row) => ({
        id: row.id,
        leadId: row.leadId,
        businessName: row.lead.businessName,
        area: row.lead.area,
        leadStatus: row.lead.status,
        staffId: row.staffUserId,
        staffName: fullName(row.staff),
        visitedAt: row.visitedAt.toISOString(),
        outcome: row.outcome,
        notes: row.notes,
      })),
      total,
      page,
    );
  }

  // ====================================================================== appointments & follow-ups

  async createAppointment(actor: RequestUser, scope: MarketingScope, input: { leadId?: string | null; merchantId?: string | null; kind: 'APPOINTMENT' | 'FOLLOW_UP'; title?: string | null; scheduledAt: string; notes?: string | null }) {
    const profile = await this.staffContext(scope);
    if (!input.leadId === !input.merchantId) throw badRequest('Choose either a lead or a store');
    const scheduledAt = this.futureDate(input.scheduledAt, 'The time must be in the future');
    if (!scheduledAt) throw badRequest('Choose a date and time');
    let subject = '';
    if (input.leadId) {
      const lead = await this.ownLead(scope, input.leadId);
      if (CLOSED_LEAD_STATUSES.includes(lead.status as LeadStatus)) throw badRequest('This lead is closed');
      subject = lead.businessName;
    } else {
      const referral = await this.prisma.merchantReferral.findFirst({ where: { merchantId: input.merchantId!, marketingUserId: scope.userId }, include: { merchant: true } });
      if (!referral) throw notFound('Store not found');
      subject = loc(referral.merchant.name).en;
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await this.insertAppointment(tx, actor, profile, {
        leadId: input.leadId ?? null,
        merchantId: input.merchantId ?? null,
        kind: input.kind,
        title: input.title?.trim() || `${input.kind === 'APPOINTMENT' ? 'Meeting' : 'Follow-up'}: ${subject}`,
        scheduledAt,
        notes: input.notes?.trim() || null,
      });
      if (input.leadId) await this.syncLead(tx, input.leadId, true);
      return this.presentAppointment({ ...row, lead: input.leadId ? { businessName: subject } : null });
    });
  }

  private async insertAppointment(
    tx: Db,
    actor: RequestUser,
    profile: { userId: string; parentUserId: string | null },
    input: { leadId?: string | null; merchantId?: string | null; kind: 'APPOINTMENT' | 'FOLLOW_UP'; title: string; scheduledAt: Date; notes: string | null; rescheduledFromId?: string },
  ) {
    const row = await tx.marketingAppointment.create({
      data: {
        kind: input.kind,
        leadId: input.leadId ?? null,
        merchantId: input.merchantId ?? null,
        staffUserId: profile.userId,
        headUserId: profile.parentUserId,
        title: input.title,
        scheduledAt: input.scheduledAt,
        notes: input.notes,
        rescheduledFromId: input.rescheduledFromId ?? null,
      },
    });
    await recordActivity(tx, {
      authorId: actor.id,
      staffUserId: profile.userId,
      headUserId: profile.parentUserId,
      leadId: input.leadId ?? null,
      merchantId: input.merchantId ?? null,
      kind: 'APPOINTMENT',
      body: `${input.kind === 'APPOINTMENT' ? 'Appointment' : 'Follow-up'} scheduled`,
      toStatus: input.scheduledAt.toISOString(),
      metadata: { appointmentId: row.id },
    });
    return row;
  }

  private async ownAppointment(scope: MarketingScope, id: string, db: Db = this.prisma) {
    this.requireStaff(scope);
    const row = await db.marketingAppointment.findFirst({ where: { id, staffUserId: scope.userId }, include: { lead: { select: { businessName: true } } } });
    if (!row) throw notFound('Appointment not found');
    return row;
  }

  async updateAppointment(actor: RequestUser, scope: MarketingScope, id: string, patch: { title?: string; notes?: string | null }) {
    const row = await this.ownAppointment(scope, id);
    if (row.status !== 'SCHEDULED') throw badRequest('Only a scheduled item can be edited');
    const updated = await this.prisma.marketingAppointment.update({ where: { id }, data: { ...(patch.title ? { title: patch.title.trim() } : {}), ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}) } });
    return this.presentAppointment({ ...updated, lead: row.lead });
  }

  /** Marks the old entry RESCHEDULED and creates the new one. An appointment can be rescheduled once; reschedule the new one again. */
  async reschedule(actor: RequestUser, scope: MarketingScope, id: string, scheduledAtRaw: string, reason?: string) {
    const profile = await this.staffContext(scope);
    const row = await this.ownAppointment(scope, id);
    if (!['SCHEDULED', 'MISSED'].includes(row.status)) throw badRequest('This item can no longer be rescheduled');
    const scheduledAt = this.futureDate(scheduledAtRaw, 'The new time must be in the future');
    if (!scheduledAt) throw badRequest('Choose a date and time');
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.marketingAppointment.updateMany({ where: { id, status: { in: ['SCHEDULED', 'MISSED'] } }, data: { status: 'RESCHEDULED', outcome: reason?.trim() || 'Rescheduled' } });
      if (claimed.count === 0) throw badRequest('This item was just updated');
      const created = await this.insertAppointment(tx, actor, profile, { leadId: row.leadId, merchantId: row.merchantId, kind: row.kind, title: row.title, scheduledAt, notes: row.notes, rescheduledFromId: id });
      if (row.leadId) await this.syncLead(tx, row.leadId);
      return this.presentAppointment({ ...created, lead: row.lead });
    }).catch((error: unknown) => {
      if (isUniqueViolation(error, 'rescheduledFromId')) throw badRequest('This item was already rescheduled');
      throw error;
    });
  }

  async cancelAppointment(actor: RequestUser, scope: MarketingScope, id: string, reason?: string) {
    const row = await this.ownAppointment(scope, id);
    if (!['SCHEDULED', 'MISSED'].includes(row.status)) throw badRequest('This item can no longer be cancelled');
    await this.prisma.$transaction(async (tx) => {
      await tx.marketingAppointment.update({ where: { id }, data: { status: 'CANCELLED', outcome: reason?.trim() || null } });
      await recordActivity(tx, { authorId: actor.id, staffUserId: row.staffUserId, headUserId: row.headUserId, leadId: row.leadId, merchantId: row.merchantId, kind: 'APPOINTMENT', body: `${row.kind === 'APPOINTMENT' ? 'Appointment' : 'Follow-up'} cancelled`, metadata: { appointmentId: id, reason: reason ?? null } });
      if (row.leadId) await this.syncLead(tx, row.leadId);
    });
    return { ok: true };
  }

  async completeAppointment(actor: RequestUser, scope: MarketingScope, id: string, input: { outcome: string; nextFollowUpAt?: string | null; status?: LeadStatus }) {
    const profile = await this.staffContext(scope);
    const row = await this.ownAppointment(scope, id);
    if (!['SCHEDULED', 'MISSED'].includes(row.status)) throw badRequest('This item is already closed');
    const next = this.futureDate(input.nextFollowUpAt, 'The next follow-up must be in the future');
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.marketingAppointment.updateMany({ where: { id, status: { in: ['SCHEDULED', 'MISSED'] } }, data: { status: 'COMPLETED', completedAt: new Date(), outcome: input.outcome.trim() } });
      if (claimed.count === 0) throw badRequest('This item was just updated');
      await recordActivity(tx, {
        authorId: actor.id,
        staffUserId: row.staffUserId,
        headUserId: row.headUserId,
        leadId: row.leadId,
        merchantId: row.merchantId,
        kind: row.kind === 'FOLLOW_UP' ? 'FOLLOW_UP_DONE' : 'APPOINTMENT',
        body: `${row.kind === 'FOLLOW_UP' ? 'Follow-up' : 'Meeting'} completed: ${input.outcome.trim()}`,
        metadata: { appointmentId: id },
      });
      if (row.leadId && input.status && input.status !== 'REGISTERED') {
        await tx.marketingLead.update({ where: { id: row.leadId }, data: { status: input.status } });
      }
      if (next) {
        await this.insertAppointment(tx, actor, profile, { leadId: row.leadId, merchantId: row.merchantId, kind: 'FOLLOW_UP', title: row.title.replace(/^(Meeting|Follow-up): /, 'Follow-up: '), scheduledAt: next, notes: null });
      }
      if (row.leadId) await this.syncLead(tx, row.leadId, Boolean(next));
    });
    return { ok: true };
  }

  async listAppointments(scope: MarketingScope, query: Record<string, unknown>) {
    const page = pageQuery(query);
    const raw = readQuery(query);
    const range = dateRange(raw);
    const now = new Date();
    const and: Prisma.MarketingAppointmentWhereInput[] = [scope.appointments()];
    if (raw.kind) and.push({ kind: raw.kind as never });
    if (raw.status) and.push({ status: raw.status as never });
    if (raw.staffId) {
      scope.assertStaff(raw.staffId);
      and.push({ staffUserId: raw.staffId });
    }
    if (raw.headId && scope.isAdmin) and.push({ headUserId: raw.headId });
    if (raw.bucket === 'overdue') and.push({ status: 'SCHEDULED', scheduledAt: { lt: now } });
    if (raw.bucket === 'upcoming') and.push({ status: 'SCHEDULED', scheduledAt: { gte: now } });
    if (raw.bucket === 'missed') and.push({ status: 'MISSED' });
    if (raw.bucket === 'today') {
      const start = new Date(new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bahrain' }).format(now)}T00:00:00+03:00`));
      and.push({ status: 'SCHEDULED', scheduledAt: { gte: start, lt: new Date(start.getTime() + 86_400_000) } });
    }
    if (range) and.push({ scheduledAt: range });
    if (page.q) and.push({ OR: [{ title: { contains: page.q, mode: 'insensitive' } }, { lead: { businessName: { contains: page.q, mode: 'insensitive' } } }] });
    const where: Prisma.MarketingAppointmentWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.marketingAppointment.findMany({
        where,
        include: { lead: { select: { businessName: true } }, merchant: { select: { name: true } }, staff: { select: { firstName: true, lastName: true } } },
        orderBy: raw.bucket === 'overdue' || raw.bucket === 'missed' ? { scheduledAt: 'desc' } : { scheduledAt: 'asc' },
        skip: page.skip,
        take: page.pageSize,
      }),
      this.prisma.marketingAppointment.count({ where }),
    ]);
    return paged(rows.map((row) => ({ ...this.presentAppointment(row), staffName: fullName(row.staff), staffId: row.staffUserId })), total, page);
  }

  // ====================================================================== referred stores

  async listStores(scope: MarketingScope, query: Record<string, unknown>) {
    const page = pageQuery(query);
    const raw = readQuery(query);
    const range = dateRange(raw);
    const and: Prisma.MerchantReferralWhereInput[] = [scope.referrals()];
    if (raw.staffId) {
      scope.assertStaff(raw.staffId);
      and.push({ marketingUserId: raw.staffId });
    }
    if (raw.headId && scope.isAdmin) and.push({ headUserId: raw.headId });
    if (raw.merchantStatus) and.push({ merchant: { status: raw.merchantStatus as never } });
    if (raw.planId) and.push({ merchant: { subscription: { planId: raw.planId } } });
    if (range) and.push({ createdAt: range });
    if (page.q) {
      and.push({
        OR: [
          { codeUsed: { contains: page.q, mode: 'insensitive' } },
          {
            merchant: {
              OR: [
                { phone: { contains: page.q } },
                { email: { contains: page.q, mode: 'insensitive' } },
                { slug: { contains: page.q, mode: 'insensitive' } },
                { name: { path: ['en'], string_contains: page.q, mode: 'insensitive' } },
                { name: { path: ['ar'], string_contains: page.q, mode: 'insensitive' } },
              ],
            },
          },
        ],
      });
    }
    const where: Prisma.MerchantReferralWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.merchantReferral.findMany({
        where,
        include: { merchant: { include: { branches: { take: 1 }, subscription: { include: { plan: true } } } }, marketingUser: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.pageSize,
      }),
      this.prisma.merchantReferral.count({ where }),
    ]);
    const merchantIds = rows.map((row) => row.merchantId);
    const [payments, commissions] = await Promise.all([
      this.prisma.subscriptionPayment.findMany({ where: { merchantId: { in: merchantIds }, verifiedAt: { not: null }, isRenewal: false }, orderBy: { createdAt: 'asc' } }),
      this.prisma.commissionEntry.findMany({ where: { merchantId: { in: merchantIds }, ...(scope.isStaff ? { beneficiaryUserId: scope.userId } : scope.isHead ? { headUserId: scope.userId } : {}) } }),
    ]);
    const first = new Map<string, (typeof payments)[number]>();
    for (const payment of payments) if (!first.has(payment.merchantId)) first.set(payment.merchantId, payment);
    return paged(
      rows.map((row) => {
        const payment = first.get(row.merchantId);
        const earned = commissions.filter((entry) => entry.merchantId === row.merchantId && entry.status !== 'REVERSED');
        return {
          id: row.merchantId,
          name: loc(row.merchant.name).en,
          phone: row.merchant.phone,
          email: row.merchant.email,
          city: row.merchant.branches[0]?.city ?? '',
          businessType: row.merchant.businessType,
          merchantStatus: row.merchant.status,
          subscriptionStatus: row.merchant.subscription?.status ?? null,
          planName: row.merchant.subscription ? loc(row.merchant.subscription.plan.name).en : null,
          staffId: row.marketingUserId,
          staffName: fullName(row.marketingUser),
          referralCode: row.codeUsed,
          source: row.source,
          registeredAt: row.createdAt.toISOString(),
          firstPayment: payment ? dec(payment.amount) : null,
          firstPaymentAt: payment?.verifiedAt?.toISOString() ?? null,
          commissionEarned: earned.length ? moneyString(earned.reduce((sum, entry) => sum.plus(entry.amount.toString()).minus(entry.reversedAmount.toString()), money(0))) : null,
        };
      }),
      total,
      page,
    );
  }

  async addStoreNote(actor: RequestUser, scope: MarketingScope, merchantId: string, body: string) {
    this.requireStaff(scope);
    const referral = await this.prisma.merchantReferral.findFirst({ where: { merchantId, marketingUserId: scope.userId } });
    if (!referral) throw notFound('Store not found');
    await recordActivity(this.prisma, { authorId: actor.id, staffUserId: scope.userId, headUserId: referral.headUserId, merchantId, kind: 'NOTE', body: body.trim() });
    return { ok: true };
  }

  /**
   * Staff registers a business they signed up in person. The merchant is attributed to the staff member's own current
   * referral code, so it flows through exactly the same attribution, commission and reporting path as a web signup.
   */
  async createStore(
    actor: RequestUser,
    scope: MarketingScope,
    input: { businessName: string; businessNameAr?: string; phone: string; email: string; city: string; businessType: string; categoryId: string; planId?: string; billingInterval?: 'MONTHLY' | 'ANNUAL'; promoCode?: string | null; leadId?: string | null; paymentMethods?: ('CARD' | 'BENEFIT' | 'BENEFIT_PAY' | 'CASH')[] },
  ) {
    const profile = await this.staffContext(scope);
    if (!profile.referralCode) throw badRequest('Your referral code is not set up yet');
    const resolved = await this.referrals.resolve(profile.referralCode);
    const email = input.email.trim().toLowerCase();
    const duplicate = await this.prisma.merchant.findFirst({ where: { deletedAt: null, OR: [{ email }, { phone: input.phone.trim() }] } });
    if (duplicate) throw badRequest('A store with this email or phone number is already registered');
    const lead = input.leadId ? await this.ownLead(scope, input.leadId) : null;
    if (lead?.merchantId) throw badRequest('This lead is already linked to a store');
    const interval = input.billingInterval ?? 'MONTHLY';
    const promo = input.promoCode?.trim() && input.planId ? await this.promos.quote({ code: input.promoCode, planId: input.planId, interval }) : null;
    if (promo && !promo.valid) throw badRequest(promo.reason);
    if (input.promoCode?.trim() && !input.planId) throw badRequest('Choose a plan to use a promo code');
    const paymentMethods = await paymentMethodsForRegistration(this.prisma, input.paymentMethods);
    const slugBase = input.businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'store';
    const slug = (await this.prisma.merchant.findUnique({ where: { slug: slugBase } })) ? `${slugBase}-${Date.now().toString(36)}` : slugBase;
    const merchant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.merchant.create({
        data: {
          slug,
          name: { en: input.businessName, ar: input.businessNameAr?.trim() || input.businessName },
          description: { en: input.businessName, ar: input.businessNameAr?.trim() || input.businessName },
          businessType: input.businessType,
          phone: input.phone.trim(),
          email,
          registrationPromo: promo?.valid ? promo.code : null,
          acceptedPaymentMethods: paymentMethods,
          status: 'PENDING_APPROVAL',
          createdById: actor.id,
          categories: { create: { categoryId: input.categoryId } },
          branches: { create: { name: { en: input.city, ar: input.city }, line1: input.city, city: input.city, latitude: '26.228500', longitude: '50.586000' } },
        },
      });
      await this.referrals.attribute(tx, { merchantId: created.id, resolved, source: 'STAFF_PORTAL', actorId: actor.id, contact: { phone: input.phone, email }, merchantName: input.businessName });
      if (promo?.valid) await this.promos.reserve(tx, { merchantId: created.id, promoCodeId: promo.promoCodeId });
      if (lead) {
        await tx.marketingLead.update({ where: { id: lead.id }, data: { merchantId: created.id, status: 'REGISTERED', followUpAt: null, appointmentAt: null } });
        await tx.marketingAppointment.updateMany({ where: { leadId: lead.id, status: 'SCHEDULED' }, data: { status: 'CANCELLED', outcome: 'Lead converted to a store' } });
        await recordActivity(tx, { authorId: actor.id, staffUserId: scope.userId, headUserId: profile.parentUserId, leadId: lead.id, merchantId: created.id, kind: 'STATUS', body: 'Lead converted to a store', fromStatus: lead.status, toStatus: 'REGISTERED' });
      }
      return created;
    });
    if (input.planId) await this.platform.assignSubscription(merchant.id, input.planId, interval, actor.id, false);
    await this.audit.log({ actorId: actor.id, action: 'marketing.store.create', entityType: 'Merchant', entityId: merchant.id });
    return { id: merchant.id, slug };
  }

  // ====================================================================== notifications

  async notifications(actor: RequestUser, query: Record<string, unknown>) {
    const page = pageQuery(query);
    const raw = readQuery(query);
    const where: Prisma.NotificationWhereInput = { userId: actor.id, channel: 'IN_APP', ...(raw.unread === 'true' ? { readAt: null } : {}) };
    const [rows, total, unread] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.pageSize }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId: actor.id, channel: 'IN_APP', readAt: null } }),
    ]);
    return {
      ...paged(rows.map((row) => ({ id: row.id, title: row.title, body: row.body, link: row.link, entityType: row.entityType, entityId: row.entityId, read: Boolean(row.readAt), at: row.createdAt.toISOString() })), total, page),
      unread,
    };
  }

  unreadCount(actor: RequestUser) {
    return this.prisma.notification.count({ where: { userId: actor.id, channel: 'IN_APP', readAt: null } }).then((unread) => ({ unread }));
  }

  /** Scoped to the caller's own notifications, so another user's notification id simply matches nothing. */
  async markRead(actor: RequestUser, id: string) {
    const result = await this.prisma.notification.updateMany({ where: { id, userId: actor.id, readAt: null }, data: { readAt: new Date() } });
    if (result.count === 0 && !(await this.prisma.notification.findFirst({ where: { id, userId: actor.id } }))) throw notFound('Notification not found');
    return { ok: true };
  }

  async markAllRead(actor: RequestUser) {
    const result = await this.prisma.notification.updateMany({ where: { userId: actor.id, channel: 'IN_APP', readAt: null }, data: { readAt: new Date() } });
    return { updated: result.count };
  }

  // ====================================================================== dashboard alerts

  /** Alert counters for the dashboard banner (today, upcoming, overdue, missed, stale leads). */
  async alerts(scope: MarketingScope) {
    const now = new Date();
    const start = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bahrain' }).format(now)}T00:00:00+03:00`);
    const end = new Date(start.getTime() + 86_400_000);
    const base = scope.appointments();
    const stale = new Date(now.getTime() - 7 * 86_400_000);
    const [today, upcoming, overdue, missed, attention, next] = await Promise.all([
      this.prisma.marketingAppointment.count({ where: { ...base, status: 'SCHEDULED', scheduledAt: { gte: start, lt: end } } }),
      this.prisma.marketingAppointment.count({ where: { ...base, status: 'SCHEDULED', scheduledAt: { gte: now } } }),
      this.prisma.marketingAppointment.count({ where: { ...base, status: 'SCHEDULED', scheduledAt: { lt: now } } }),
      this.prisma.marketingAppointment.count({ where: { ...base, status: 'MISSED' } }),
      this.prisma.marketingLead.count({ where: { AND: [scope.leads(), { status: { notIn: CLOSED_LEAD_STATUSES as never[] } }, { OR: [{ updatedAt: { lt: stale } }, { followUpAt: { lt: now } }] }] } }),
      this.prisma.marketingAppointment.findMany({ where: { ...base, status: 'SCHEDULED', scheduledAt: { gte: now } }, orderBy: { scheduledAt: 'asc' }, take: 5, include: { lead: { select: { businessName: true } }, merchant: { select: { name: true } } } }),
    ]);
    return { today, upcoming, overdue, missed, leadsNeedingAttention: attention, next: next.map((row) => this.presentAppointment(row)) };
  }

  // ====================================================================== helpers

  private futureDate(value: string | null | undefined, message: string): Date | null {
    if (!value) return null;
    const date = parseDate(value);
    if (!date) throw badRequest('Enter a valid date');
    if (date.getTime() < Date.now() - 60_000) throw badRequest(message);
    return date;
  }

  private async assertNoDuplicate(staffUserId: string, normalizedPhone: string, exceptId?: string) {
    const mine = await this.prisma.marketingLead.findMany({ where: { marketingUserId: staffUserId, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { phone: true, whatsapp: true } });
    if (mine.some((row) => normalizePhone(row.phone) === normalizedPhone)) throw badRequest('You already have a lead with this phone number');
  }

  private async assertPlan(planId: string) {
    if (!(await this.prisma.subscriptionPlan.findUnique({ where: { id: planId } }))) throw badRequest('Choose an available plan');
  }

  /** Keeps the denormalised "next appointment / next follow-up" columns and the status in step with the schedule. */
  private async syncLead(tx: Db, leadId: string, advanceStatus = false) {
    const now = new Date();
    const [appointment, followUp, lead] = await Promise.all([
      tx.marketingAppointment.findFirst({ where: { leadId, kind: 'APPOINTMENT', status: 'SCHEDULED', scheduledAt: { gte: now } }, orderBy: { scheduledAt: 'asc' } }),
      tx.marketingAppointment.findFirst({ where: { leadId, kind: 'FOLLOW_UP', status: 'SCHEDULED' }, orderBy: { scheduledAt: 'asc' } }),
      tx.marketingLead.findUniqueOrThrow({ where: { id: leadId } }),
    ]);
    let status = lead.status as LeadStatus;
    if (advanceStatus) {
      // Scheduling moves a lead forward, never backward: a lead already in negotiation stays in negotiation.
      if (appointment && EARLY_STATUSES.includes(status)) status = 'APPOINTMENT_SCHEDULED';
      else if (followUp && ['NEW', 'CONTACTED', 'VISITED'].includes(status)) status = 'FOLLOW_UP_REQUIRED';
    }
    await tx.marketingLead.update({ where: { id: leadId }, data: { appointmentAt: appointment?.scheduledAt ?? null, followUpAt: followUp?.scheduledAt ?? null, status } });
  }

  private getLeadIn(tx: Db, id: string) {
    return tx.marketingLead.findUniqueOrThrow({ where: { id }, include: { marketingUser: { select: { firstName: true, lastName: true } }, interestedPlan: { select: { name: true } } } }).then((lead) => this.presentLead(lead));
  }

  presentLead(lead: {
    id: string;
    marketingUserId: string;
    headUserId: string | null;
    businessName: string;
    contactName: string;
    phone: string;
    whatsapp: string | null;
    email: string | null;
    category: string | null;
    city: string | null;
    area: string | null;
    address: string | null;
    mapsUrl: string | null;
    firstVisitAt: Date | null;
    interestedPlanId: string | null;
    expectedRegistrationAt: Date | null;
    notes: string | null;
    status: string;
    followUpAt: Date | null;
    appointmentAt: Date | null;
    merchantId: string | null;
    createdAt: Date;
    updatedAt: Date;
    marketingUser?: { firstName: string; lastName: string };
    interestedPlan?: { name: unknown } | null;
  }) {
    return {
      id: lead.id,
      staffId: lead.marketingUserId,
      staffName: fullName(lead.marketingUser),
      headId: lead.headUserId,
      businessName: lead.businessName,
      contactName: lead.contactName,
      phone: lead.phone,
      whatsapp: lead.whatsapp,
      email: lead.email,
      category: lead.category,
      city: lead.city,
      area: lead.area,
      address: lead.address,
      mapsUrl: lead.mapsUrl,
      firstVisitAt: lead.firstVisitAt?.toISOString() ?? null,
      interestedPlanId: lead.interestedPlanId,
      interestedPlanName: lead.interestedPlan ? loc(lead.interestedPlan.name).en : null,
      expectedRegistrationAt: lead.expectedRegistrationAt?.toISOString() ?? null,
      notes: lead.notes,
      status: lead.status,
      nextFollowUpAt: lead.followUpAt?.toISOString() ?? null,
      nextAppointmentAt: lead.appointmentAt?.toISOString() ?? null,
      merchantId: lead.merchantId,
      createdAt: lead.createdAt.toISOString(),
      updatedAt: lead.updatedAt.toISOString(),
    };
  }

  presentAppointment(row: {
    id: string;
    kind: string;
    leadId: string | null;
    merchantId: string | null;
    title: string;
    scheduledAt: Date;
    status: string;
    outcome: string | null;
    notes: string | null;
    completedAt: Date | null;
    rescheduledFromId: string | null;
    lead?: { businessName: string } | null;
    merchant?: { name: unknown } | null;
  }) {
    return {
      id: row.id,
      kind: row.kind,
      leadId: row.leadId,
      merchantId: row.merchantId,
      subject: row.lead?.businessName ?? (row.merchant ? loc(row.merchant.name).en : ''),
      title: row.title,
      scheduledAt: row.scheduledAt.toISOString(),
      status: row.status,
      overdue: row.status === 'SCHEDULED' && row.scheduledAt.getTime() < Date.now(),
      outcome: row.outcome,
      notes: row.notes,
      completedAt: row.completedAt?.toISOString() ?? null,
      rescheduledFromId: row.rescheduledFromId,
    };
  }
}
