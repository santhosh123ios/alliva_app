import * as argon2 from 'argon2';
import type { Prisma } from '@prisma/client';
import type { AuditService } from '../../common/audit';
import { badRequest, notFound } from '../../common/errors';
import { forgetAuthUser, type RequestUser } from '../../common/http';
import type { CryptoService } from '../../common/crypto';
import { dec } from '../../common/crypto';
import { dateRange, paged, pageQuery, readQuery, type Page } from '../../common/paging';
import { buildReferralCode, isValidReferralCode, normalizeReferralCode, referralNameStem, referralPrefix, resolveRates } from '../../domain/marketing';
import type { PrismaService } from '../../prisma/prisma.service';
import type { EmailProvider } from '../../providers/interfaces';
import { marketingInviteUrl, marketingSignInUrl, sendWelcomeEmail } from '../../providers/welcome-email';
import type { MarketingSettingsService } from './settings';
import type { MarketingScope } from './scope';
import { fullName, isUniqueViolation, recordActivity, splitName, type Db } from './shared';

export type MemberInput = {
  fullName: string;
  employeeId: string;
  email: string;
  phone?: string | null;
  password?: string | null;
  avatarUrl?: string | null;
  region?: string | null;
  commissionPercent?: string | null;
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  joinedAt?: string | null;
  notes?: string | null;
};

export type StaffInput = MemberInput & { headUserId: string; referralCode?: string | null };

type Kind = 'HEAD' | 'STAFF';

export class MarketingTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly settings: MarketingSettingsService,
    private readonly email: EmailProvider,
  ) {}

  // ------------------------------------------------------------------ create

  createHead(actor: RequestUser, input: MemberInput) {
    return this.createMember(actor, 'HEAD', input);
  }

  async createStaff(actor: RequestUser, input: StaffInput) {
    if (!input.headUserId) throw badRequest('Choose a marketing head');
    const head = await this.prisma.marketingProfile.findUnique({ where: { userId: input.headUserId } });
    if (!head || head.kind !== 'HEAD') throw badRequest('Choose a marketing head');
    if (head.status !== 'ACTIVE') throw badRequest('That marketing head is not active');
    return this.createMember(actor, 'STAFF', input, input.headUserId);
  }

  private async createMember(actor: RequestUser, kind: Kind, input: MemberInput & { referralCode?: string | null }, parentUserId?: string) {
    const settings = await this.settings.get();
    const role = await this.prisma.role.findUnique({ where: { key: kind === 'HEAD' ? 'MARKETING_HEAD' : 'MARKETING_STAFF' } });
    if (!role) throw badRequest(`${kind === 'HEAD' ? 'Marketing head' : 'Marketing staff'} role is not configured`);
    const email = input.email.trim().toLowerCase();
    const name = splitName(input.fullName);
    if (!name.firstName) throw badRequest('Enter a full name');
    const status = input.status ?? 'ACTIVE';
    const passwordHash = input.password ? await argon2.hash(input.password) : null;
    const percent = input.commissionPercent == null || input.commissionPercent === '' ? null : Number(input.commissionPercent).toFixed(3);
    if (percent != null && (Number(percent) < 0 || Number(percent) > 100)) throw badRequest('Commission must be between 0 and 100');

    let attempt = 0;
    for (;;) {
      attempt += 1;
      const manual = input.referralCode ? normalizeReferralCode(input.referralCode) : '';
      if (manual && !isValidReferralCode(manual)) throw badRequest('Referral code must be 3 to 32 letters, numbers or dashes');
      if (kind === 'STAFF' && !manual && !settings.autoGenerateReferral) throw badRequest('Enter a referral code');
      const code = kind === 'STAFF' ? manual || (await this.nextReferralCode(settings.referralPrefix, name.firstName)) : null;
      try {
        const created = await this.prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email,
              phone: input.phone || null,
              passwordHash,
              firstName: name.firstName,
              lastName: name.lastName,
              kind: 'STAFF',
              status: status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED',
              createdById: actor.id,
              userRoles: { create: { roleId: role.id } },
            },
          });
          const profile = await tx.marketingProfile.create({
            data: {
              userId: user.id,
              parentUserId: parentUserId ?? null,
              kind,
              status,
              employeeId: input.employeeId.trim(),
              region: input.region || null,
              joinedAt: input.joinedAt ? new Date(input.joinedAt) : new Date(),
              notes: input.notes || null,
              avatarUrl: input.avatarUrl || null,
              referralCode: code,
              staffCommissionPercent: kind === 'STAFF' ? percent : null,
              headOverridePercent: kind === 'HEAD' ? percent : null,
            },
          });
          if (code) await tx.marketingReferralCode.create({ data: { profileId: profile.id, userId: user.id, code, createdById: actor.id } });
          await tx.marketingWallet.create({ data: { userId: user.id } });
          await tx.auditLog.create({
            data: {
              actorId: actor.id,
              action: kind === 'HEAD' ? 'marketing.head.create' : 'marketing.staff.create',
              entityType: 'User',
              entityId: user.id,
              metadata: { employeeId: input.employeeId, referralCode: code, headUserId: parentUserId ?? null } as never,
            },
          });
          const invite = passwordHash ? null : await this.issueInvite(tx, user.id);
          return { id: user.id, referralCode: code, inviteToken: invite };
        });
        await sendWelcomeEmail(this.email, {
          to: email,
          firstName: name.firstName,
          role: kind === 'HEAD' ? 'Marketing Head' : 'Marketing Staff',
          signInUrl: marketingSignInUrl(),
          inviteUrl: created.inviteToken ? marketingInviteUrl(created.inviteToken) : null,
        });
        return created;
      } catch (error) {
        if (isUniqueViolation(error, 'referralCode') || isUniqueViolation(error, 'code')) {
          if (manual) throw badRequest('That referral code is already in use');
          if (attempt < 5) continue;
        }
        if (isUniqueViolation(error, 'email')) throw badRequest('A user with this email already exists');
        if (isUniqueViolation(error, 'phone')) throw badRequest('A user with this phone number already exists');
        if (isUniqueViolation(error, 'employeeId')) throw badRequest('That employee ID is already in use');
        throw error;
      }
    }
  }

  private async issueInvite(db: Db, userId: string) {
    const token = this.crypto.random();
    await db.passwordResetToken.create({
      data: { userId, tokenHash: this.crypto.hash(token), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });
    return token;
  }

  /** A fresh secure invitation for a member who has no password yet (or who lost the first link). */
  async reissueInvite(actor: RequestUser, userId: string) {
    const profile = await this.requireProfile(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, firstName: true } });
    const token = await this.issueInvite(this.prisma, userId);
    await this.audit.log({ actorId: actor.id, action: 'marketing.invite', entityType: 'User', entityId: profile.userId });
    if (user?.email) {
      await sendWelcomeEmail(this.email, {
        to: user.email,
        firstName: user.firstName,
        role: profile.kind === 'HEAD' ? 'Marketing Head' : 'Marketing Staff',
        signInUrl: marketingSignInUrl(),
        inviteUrl: marketingInviteUrl(token),
        subject: 'Your Alliva invitation',
      });
    }
    return { inviteToken: token };
  }

  // ------------------------------------------------------------------ codes

  /** ALV-AHMED001: next free sequence for the stem, checked against every code ever issued. */
  async nextReferralCode(prefix: string, firstName: string, db: Db = this.prisma) {
    const stem = `${referralPrefix(prefix)}-${referralNameStem(firstName)}`;
    const existing = await db.marketingReferralCode.findMany({ where: { code: { startsWith: stem } }, select: { code: true } });
    const taken = new Set(existing.map((row) => row.code));
    for (let n = 1; n < 10_000; n += 1) {
      const code = buildReferralCode(prefix, firstName, n);
      if (!taken.has(code)) return code;
    }
    throw badRequest('Could not generate a unique referral code');
  }

  /** The old code is retired (kept for history and for the attribution rows that used it) and a new active one is linked. */
  async changeReferralCode(actor: RequestUser, staffUserId: string, rawCode: string) {
    const code = normalizeReferralCode(rawCode);
    if (!isValidReferralCode(code)) throw badRequest('Referral code must be 3 to 32 letters, numbers or dashes');
    const profile = await this.requireProfile(staffUserId, 'STAFF');
    if (profile.referralCode === code) return { referralCode: code };
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.marketingReferralCode.updateMany({ where: { profileId: profile.id, active: true }, data: { active: false, retiredAt: new Date() } });
        await tx.marketingReferralCode.create({ data: { profileId: profile.id, userId: staffUserId, code, createdById: actor.id } });
        await tx.marketingProfile.update({ where: { id: profile.id }, data: { referralCode: code } });
        await tx.auditLog.create({
          data: { actorId: actor.id, action: 'marketing.referral.code', entityType: 'User', entityId: staffUserId, metadata: { from: profile.referralCode, to: code } as never },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw badRequest('That referral code is already in use');
      throw error;
    }
    return { referralCode: code };
  }

  /** Enables or disables the staff member's current code for new registrations. Existing attribution is unaffected. */
  async setReferralActive(actor: RequestUser, staffUserId: string, active: boolean) {
    const profile = await this.requireProfile(staffUserId, 'STAFF');
    if (!profile.referralCode) throw badRequest('This staff member has no referral code');
    await this.prisma.marketingReferralCode.updateMany({
      where: { profileId: profile.id, code: profile.referralCode },
      data: active ? { active: true, retiredAt: null } : { active: false },
    });
    await this.audit.log({ actorId: actor.id, action: active ? 'marketing.referral.enable' : 'marketing.referral.disable', entityType: 'User', entityId: staffUserId });
    return { ok: true };
  }

  // ------------------------------------------------------------------ edit / status / transfer

  async update(actor: RequestUser, userId: string, patch: Partial<Omit<MemberInput, 'password' | 'status'>> & { headUserId?: never }) {
    const profile = await this.requireProfile(userId);
    const data: Prisma.MarketingProfileUpdateInput = {};
    const userData: Prisma.UserUpdateInput = {};
    if (patch.fullName !== undefined) {
      const name = splitName(patch.fullName);
      if (!name.firstName) throw badRequest('Enter a full name');
      userData.firstName = name.firstName;
      userData.lastName = name.lastName;
    }
    if (patch.email !== undefined) userData.email = patch.email.trim().toLowerCase();
    if (patch.phone !== undefined) userData.phone = patch.phone || null;
    if (patch.employeeId !== undefined) data.employeeId = patch.employeeId.trim();
    if (patch.region !== undefined) data.region = patch.region || null;
    if (patch.notes !== undefined) data.notes = patch.notes || null;
    if (patch.avatarUrl !== undefined) data.avatarUrl = patch.avatarUrl || null;
    if (patch.joinedAt !== undefined && patch.joinedAt) data.joinedAt = new Date(patch.joinedAt);
    if (patch.commissionPercent !== undefined) {
      const percent = patch.commissionPercent === null || patch.commissionPercent === '' ? null : Number(patch.commissionPercent);
      if (percent != null && (!Number.isFinite(percent) || percent < 0 || percent > 100)) throw badRequest('Commission must be between 0 and 100');
      const value = percent == null ? null : percent.toFixed(3);
      if (profile.kind === 'STAFF') data.staffCommissionPercent = value;
      else data.headOverridePercent = value;
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        if (Object.keys(userData).length) await tx.user.update({ where: { id: userId }, data: { ...userData, updatedById: actor.id } });
        if (Object.keys(data).length) await tx.marketingProfile.update({ where: { id: profile.id }, data });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: patch.commissionPercent !== undefined ? 'marketing.member.commission' : 'marketing.member.update',
            entityType: 'User',
            entityId: userId,
            metadata: { fields: Object.keys(patch), commissionPercent: patch.commissionPercent ?? undefined } as never,
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error, 'email')) throw badRequest('A user with this email already exists');
      if (isUniqueViolation(error, 'phone')) throw badRequest('A user with this phone number already exists');
      if (isUniqueViolation(error, 'employeeId')) throw badRequest('That employee ID is already in use');
      throw error;
    }
    forgetAuthUser(userId);
    return { ok: true };
  }

  /** Deactivating never deletes referral, commission or wallet history; it only blocks sign-in and new attribution. */
  async setStatus(actor: RequestUser, userId: string, status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED', reason?: string) {
    const profile = await this.requireProfile(userId);
    if (profile.userId === actor.id) throw badRequest('You cannot change your own account status');
    await this.prisma.$transaction(async (tx) => {
      await tx.marketingProfile.update({ where: { id: profile.id }, data: { status } });
      await tx.user.update({ where: { id: userId }, data: { status: status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED', updatedById: actor.id } });
      if (status !== 'ACTIVE') await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'marketing.member.status', entityType: 'User', entityId: userId, metadata: { from: profile.status, to: status, reason: reason ?? null } as never },
      });
    });
    forgetAuthUser(userId);
    return { ok: true };
  }

  /**
   * Moves a staff member to another head. Open leads, appointments and future activity follow the staff member.
   * Already-recorded referral attribution and commissions keep the head that was current at the time, so money
   * history is never rewritten.
   */
  async transferStaff(actor: RequestUser, staffUserId: string, newHeadUserId: string, reason?: string) {
    const settings = await this.settings.get();
    if (!settings.allowStaffTransfer) throw badRequest('Staff transfers are turned off in marketing settings');
    const staff = await this.requireProfile(staffUserId, 'STAFF');
    const head = await this.prisma.marketingProfile.findUnique({ where: { userId: newHeadUserId } });
    if (!head || head.kind !== 'HEAD') throw badRequest('Choose a marketing head');
    if (head.status !== 'ACTIVE') throw badRequest('That marketing head is not active');
    if (staff.parentUserId === newHeadUserId) throw badRequest('Staff already belongs to this head');
    await this.prisma.$transaction(async (tx) => {
      await tx.marketingProfile.update({ where: { id: staff.id }, data: { parentUserId: newHeadUserId } });
      await tx.marketingLead.updateMany({ where: { marketingUserId: staffUserId }, data: { headUserId: newHeadUserId } });
      await tx.marketingAppointment.updateMany({ where: { staffUserId, status: 'SCHEDULED' }, data: { headUserId: newHeadUserId } });
      await tx.marketingVisit.updateMany({ where: { staffUserId }, data: { headUserId: newHeadUserId } });
      await recordActivity(tx, {
        authorId: actor.id,
        staffUserId,
        headUserId: newHeadUserId,
        kind: 'STAFF_TRANSFERRED',
        body: 'Staff transferred to a new marketing head',
        metadata: { fromHeadUserId: staff.parentUserId, toHeadUserId: newHeadUserId, reason: reason ?? null },
      });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'marketing.staff.transfer', entityType: 'User', entityId: staffUserId, metadata: { from: staff.parentUserId, to: newHeadUserId, reason: reason ?? null } as never },
      });
    });
    return { ok: true };
  }

  // ------------------------------------------------------------------ reads

  private async requireProfile(userId: string, kind?: Kind) {
    const profile = await this.prisma.marketingProfile.findUnique({ where: { userId } });
    if (!profile || (kind && profile.kind !== kind)) throw notFound('Marketing member not found');
    return profile;
  }

  async listHeads(query: Record<string, unknown>): Promise<Page<unknown>> {
    const page = pageQuery(query);
    const raw = readQuery(query);
    const where: Prisma.MarketingProfileWhereInput = {
      kind: 'HEAD',
      ...(raw.status ? { status: raw.status as never } : {}),
      ...(page.q ? { OR: this.searchOr(page.q) } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.marketingProfile.findMany({ where, include: { user: true }, orderBy: { createdAt: 'asc' }, skip: page.skip, take: page.pageSize }),
      this.prisma.marketingProfile.count({ where }),
    ]);
    const ids = rows.map((row) => row.userId);
    const stats = await this.memberStats(ids, 'HEAD');
    return paged(rows.map((row) => this.present(row, stats.get(row.userId))), total, page);
  }

  async listStaff(scope: MarketingScope, query: Record<string, unknown>): Promise<Page<unknown>> {
    const page = pageQuery(query);
    const raw = readQuery(query);
    const and: Prisma.MarketingProfileWhereInput[] = [scope.staffProfiles()];
    if (raw.status) and.push({ status: raw.status as never });
    if (raw.headId && scope.isAdmin) and.push({ parentUserId: raw.headId });
    if (page.q) and.push({ OR: this.searchOr(page.q) });
    const where: Prisma.MarketingProfileWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.marketingProfile.findMany({ where, include: { user: true, parent: true }, orderBy: { createdAt: 'asc' }, skip: page.skip, take: page.pageSize }),
      this.prisma.marketingProfile.count({ where }),
    ]);
    const stats = await this.memberStats(rows.map((row) => row.userId), 'STAFF', scope.isAdmin);
    return paged(rows.map((row) => ({ ...this.present(row, stats.get(row.userId)), headName: fullName(row.parent), headUserId: row.parentUserId })), total, page);
  }

  async detail(scope: MarketingScope, userId: string) {
    const profile = await this.prisma.marketingProfile.findUnique({ where: { userId }, include: { user: true, parent: true, referralCodes: { orderBy: { createdAt: 'desc' } } } });
    if (!profile) throw notFound('Marketing member not found');
    if (profile.kind === 'HEAD') {
      if (!scope.isAdmin && scope.userId !== userId) throw notFound('Marketing member not found');
    } else {
      scope.assertStaff(userId);
    }
    const settings = await this.settings.get();
    const stats = await this.memberStats([userId], profile.kind, scope.isAdmin || scope.userId === userId);
    const team =
      profile.kind === 'HEAD'
        ? await this.prisma.marketingProfile.findMany({ where: { parentUserId: userId, kind: 'STAFF' }, include: { user: true }, orderBy: { createdAt: 'asc' } })
        : [];
    const teamStats = await this.memberStats(team.map((row) => row.userId), 'STAFF', scope.isAdmin || scope.userId === userId);
    return {
      ...this.present(profile, stats.get(userId)),
      ...this.commissionRate(profile, settings),
      headName: fullName(profile.parent),
      headUserId: profile.parentUserId,
      referralCodes: profile.referralCodes.map((code) => ({ code: code.code, active: code.active, createdAt: code.createdAt.toISOString(), retiredAt: code.retiredAt?.toISOString() ?? null })),
      team: team.map((row) => this.present(row, teamStats.get(row.userId))),
    };
  }

  /** Own profile for the portal. */
  async me(actor: RequestUser) {
    const profile = await this.prisma.marketingProfile.findUnique({ where: { userId: actor.id }, include: { user: true, parent: true } });
    if (!profile) throw notFound('No marketing account');
    const settings = await this.settings.get();
    return {
      ...this.present(profile, undefined),
      ...this.commissionRate(profile, settings),
      headName: fullName(profile.parent),
      headUserId: profile.parentUserId,
      referralCode: profile.referralCode,
      capabilities: { headsCanReassignLeads: settings.headsCanReassignLeads, headsSeeReports: settings.headsSeeReports, referralPrefix: settings.referralPrefix },
    };
  }

  async updateOwnProfile(actor: RequestUser, patch: { phone?: string | null; avatarUrl?: string | null; locale?: 'en' | 'ar' }) {
    await this.requireProfile(actor.id);
    await this.prisma.$transaction(async (tx) => {
      if (patch.phone !== undefined || patch.locale) {
        await tx.user.update({ where: { id: actor.id }, data: { ...(patch.phone !== undefined ? { phone: patch.phone || null } : {}), ...(patch.locale ? { locale: patch.locale } : {}) } });
      }
      if (patch.avatarUrl !== undefined) await tx.marketingProfile.update({ where: { userId: actor.id }, data: { avatarUrl: patch.avatarUrl || null } });
    }).catch((error: unknown) => {
      if (isUniqueViolation(error, 'phone')) throw badRequest('That phone number is already in use');
      throw error;
    });
    forgetAuthUser(actor.id);
    return { ok: true };
  }

  async timeline(scope: MarketingScope, query: Record<string, unknown>) {
    const page = pageQuery(query);
    const raw = readQuery(query);
    const range = dateRange(raw);
    const where: Prisma.MarketingActivityWhereInput = {
      AND: [
        scope.activities(),
        raw.kind ? { kind: raw.kind as never } : {},
        raw.staffId ? { staffUserId: raw.staffId } : {},
        range ? { createdAt: range } : {},
        page.q ? { body: { contains: page.q, mode: 'insensitive' } } : {},
      ],
    };
    if (raw.staffId) scope.assertStaff(raw.staffId);
    const [rows, total] = await Promise.all([
      this.prisma.marketingActivity.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.pageSize, include: { author: true, lead: { select: { businessName: true } }, merchant: { select: { name: true } } } }),
      this.prisma.marketingActivity.count({ where }),
    ]);
    const staffIds = [...new Set(rows.map((row) => row.staffUserId).filter(Boolean))] as string[];
    const staff = await this.prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, firstName: true, lastName: true } });
    const names = new Map(staff.map((user) => [user.id, fullName(user)]));
    return paged(
      rows.map((row) => ({
        id: row.id,
        at: row.createdAt.toISOString(),
        kind: row.kind,
        body: row.body,
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        authorName: fullName(row.author),
        staffId: row.staffUserId,
        staffName: row.staffUserId ? names.get(row.staffUserId) ?? '' : '',
        leadId: row.leadId,
        merchantId: row.merchantId,
        subject: row.lead?.businessName ?? (row.merchant ? ((row.merchant.name as { en?: string })?.en ?? '') : ''),
      })),
      total,
      page,
    );
  }

  // ------------------------------------------------------------------ helpers

  private searchOr(q: string): Prisma.MarketingProfileWhereInput[] {
    return [
      { employeeId: { contains: q, mode: 'insensitive' } },
      { referralCode: { contains: q, mode: 'insensitive' } },
      { region: { contains: q, mode: 'insensitive' } },
      { user: { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } },
    ];
  }

  private present(
    profile: {
      userId: string;
      kind: string;
      status: string;
      employeeId: string | null;
      region: string | null;
      joinedAt: Date;
      notes: string | null;
      avatarUrl: string | null;
      referralCode: string | null;
      staffCommissionPercent: { toFixed: (n: number) => string } | null;
      headOverridePercent: { toFixed: (n: number) => string } | null;
      user: { firstName: string; lastName: string; email: string | null; phone: string | null };
    },
    stats?: MemberStats,
  ) {
    const override = profile.kind === 'HEAD' ? profile.headOverridePercent : profile.staffCommissionPercent;
    return {
      id: profile.userId,
      kind: profile.kind,
      status: profile.status,
      fullName: fullName(profile.user),
      firstName: profile.user.firstName,
      lastName: profile.user.lastName,
      email: profile.user.email,
      phone: profile.user.phone,
      employeeId: profile.employeeId,
      region: profile.region,
      joinedAt: profile.joinedAt.toISOString(),
      notes: profile.notes,
      avatarUrl: profile.avatarUrl,
      referralCode: profile.referralCode,
      commissionPercent: override ? dec(override) : null,
      stats: stats ?? null,
    };
  }

  /**
   * The rate that will apply to the next payment. A blank personal rate follows the current platform default,
   * so a settings change shows up here without rewriting commission already earned.
   */
  private commissionRate(
    profile: { kind: string; staffCommissionPercent: { toString(): string } | null; headOverridePercent: { toString(): string } | null },
    settings: { staffPercent: string; headPercent: string },
  ) {
    const rates = resolveRates(
      { staffPercent: settings.staffPercent, headPercent: settings.headPercent },
      { staff: profile.staffCommissionPercent, head: profile.headOverridePercent },
    );
    const isHead = profile.kind === 'HEAD';
    return {
      effectiveCommissionPercent: isHead ? rates.headPercent : rates.staffPercent,
      commissionIsDefault: (isHead ? profile.headOverridePercent : profile.staffCommissionPercent) == null,
    };
  }

  private async memberStats(userIds: string[], kind: Kind, includeMoney = true): Promise<Map<string, MemberStats>> {
    const out = new Map<string, MemberStats>();
    if (!userIds.length) return out;
    const byStaff = kind === 'STAFF';
    const [leads, referrals, commissions, wallets, staffCounts] = await Promise.all([
      this.prisma.marketingLead.groupBy({ by: [byStaff ? 'marketingUserId' : 'headUserId'], where: { [byStaff ? 'marketingUserId' : 'headUserId']: { in: userIds } }, _count: { _all: true } }),
      this.prisma.merchantReferral.groupBy({ by: [byStaff ? 'marketingUserId' : 'headUserId'], where: { [byStaff ? 'marketingUserId' : 'headUserId']: { in: userIds } }, _count: { _all: true } }),
      includeMoney
        ? this.prisma.commissionEntry.groupBy({ by: ['beneficiaryUserId'], where: { beneficiaryUserId: { in: userIds }, status: { in: ['APPROVED', 'PAID'] } }, _sum: { amount: true } })
        : Promise.resolve([] as never[]),
      includeMoney ? this.prisma.marketingWallet.findMany({ where: { userId: { in: userIds } } }) : Promise.resolve([]),
      kind === 'HEAD' ? this.prisma.marketingProfile.groupBy({ by: ['parentUserId'], where: { parentUserId: { in: userIds }, kind: 'STAFF' }, _count: { _all: true } }) : Promise.resolve([] as never[]),
    ]);
    const key = byStaff ? 'marketingUserId' : 'headUserId';
    const counts = (rows: unknown[], field: string) => {
      const map = new Map<string, number>();
      for (const row of rows as Record<string, unknown>[]) map.set(String(row[field]), (row._count as { _all: number })._all);
      return map;
    };
    const leadCount = counts(leads, key);
    const referralCount = counts(referrals, key);
    const staffCount = counts(staffCounts, 'parentUserId');
    const earned = new Map<string, string>();
    for (const row of commissions as { beneficiaryUserId: string; _sum: { amount: { toFixed: (n: number) => string } | null } }[]) {
      earned.set(row.beneficiaryUserId, dec(row._sum.amount));
    }
    for (const id of userIds) {
      const wallet = wallets.find((row) => row.userId === id);
      out.set(id, {
        leads: leadCount.get(id) ?? 0,
        referredStores: referralCount.get(id) ?? 0,
        staffCount: staffCount.get(id) ?? 0,
        earned: includeMoney ? earned.get(id) ?? '0.000' : null,
        walletBalance: includeMoney ? dec(wallet?.balance) : null,
      });
    }
    return out;
  }
}

type MemberStats = { leads: number; referredStores: number; staffCount: number; earned: string | null; walletBalance: string | null };
