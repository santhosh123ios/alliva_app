import type { Prisma } from '@prisma/client';
import { dec, loc } from '../../common/crypto';
import { badRequest, forbidden } from '../../common/errors';
import { dateRange, readQuery } from '../../common/paging';
import { CLOSED_LEAD_STATUSES } from '../../domain/marketing';
import { money, moneyString } from '../../domain/money';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MarketingScope } from './scope';
import type { MarketingSettingsService } from './settings';
import { fullName } from './shared';

export const REPORT_IDS = [
  'head-performance',
  'staff-performance',
  'merchant-referrals',
  'lead-conversion',
  'store-visits',
  'appointments',
  'commissions',
  'wallet-transactions',
  'withdrawals',
  'promo-usage',
  'revenue',
] as const;
export type ReportId = (typeof REPORT_IDS)[number];

type Cell = string | number | null;
export type ReportColumn = { key: string; label: string; type?: 'text' | 'number' | 'money' | 'date' | 'percent' };
export type ReportTable = {
  id: ReportId;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, Cell>[];
  totals: Record<string, Cell> | null;
  truncated: boolean;
  generatedAt: string;
};

const ADMIN_ONLY: ReportId[] = ['head-performance', 'promo-usage', 'revenue'];
const HEAD_ALLOWED: ReportId[] = ['staff-performance', 'merchant-referrals', 'lead-conversion', 'store-visits', 'appointments', 'commissions', 'wallet-transactions', 'withdrawals'];
const ROW_LIMIT = 20_000;

const TITLES: Record<ReportId, string> = {
  'head-performance': 'Marketing Head Performance',
  'staff-performance': 'Marketing Staff Performance',
  'merchant-referrals': 'Merchant Referrals',
  'lead-conversion': 'Lead Conversion',
  'store-visits': 'Store Visits',
  appointments: 'Appointments and Follow-ups',
  commissions: 'Commissions',
  'wallet-transactions': 'Wallet Transactions',
  withdrawals: 'Withdrawals',
  'promo-usage': 'Promo Code Usage',
  revenue: 'Marketing Revenue',
};

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);
const sum = (values: Array<{ toString(): string }>) => moneyString(values.reduce<ReturnType<typeof money>>((total, value) => total.plus(value.toString()), money(0)));

export class MarketingReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: MarketingSettingsService,
  ) {}

  async available(scope: MarketingScope) {
    const ids = await this.allowed(scope);
    return ids.map((id) => ({ id, title: TITLES[id] }));
  }

  private async allowed(scope: MarketingScope): Promise<ReportId[]> {
    if (scope.isAdmin) return [...REPORT_IDS];
    if (scope.isStaff) return [];
    const settings = await this.settings.get();
    return settings.headsSeeReports ? HEAD_ALLOWED : [];
  }

  async run(scope: MarketingScope, id: string, query: Record<string, unknown>, limit = 500): Promise<ReportTable> {
    if (!(REPORT_IDS as readonly string[]).includes(id)) throw badRequest('Unknown report');
    const reportId = id as ReportId;
    const allowed = await this.allowed(scope);
    if (!allowed.includes(reportId)) {
      throw ADMIN_ONLY.includes(reportId) || scope.isStaff ? forbidden('You cannot view this report') : forbidden('Reports are not enabled for marketing heads');
    }
    const raw = readQuery(query);
    // A head can only ever narrow the report inside their own team.
    if (raw.staffId) scope.assertStaff(raw.staffId);
    if (scope.isHead && raw.headId && raw.headId !== scope.userId) throw forbidden('You cannot view this report');
    const filters = { range: dateRange(raw), staffId: raw.staffId, headId: scope.isHead ? scope.userId : raw.headId, merchantId: raw.merchantId, planId: raw.planId, campaign: raw.campaign, status: raw.status };
    const take = Math.min(limit, ROW_LIMIT);
    const build = {
      'head-performance': () => this.headPerformance(filters),
      'staff-performance': () => this.staffPerformance(scope, filters),
      'merchant-referrals': () => this.merchantReferrals(scope, filters, take),
      'lead-conversion': () => this.leadConversion(scope, filters),
      'store-visits': () => this.storeVisits(scope, filters, take),
      appointments: () => this.appointments(scope, filters, take),
      commissions: () => this.commissions(scope, filters, take),
      'wallet-transactions': () => this.walletTransactions(scope, filters, take),
      withdrawals: () => this.withdrawals(scope, filters, take),
      'promo-usage': () => this.promoUsage(filters, take),
      revenue: () => this.revenue(filters, take),
    }[reportId];
    const result = await build();
    return { id: reportId, title: TITLES[reportId], truncated: result.rows.length >= take && ['merchant-referrals', 'store-visits', 'appointments', 'commissions', 'wallet-transactions', 'withdrawals', 'promo-usage', 'revenue'].includes(reportId), generatedAt: new Date().toISOString(), ...result };
  }

  // ------------------------------------------------------------------ exports

  async exportCsv(scope: MarketingScope, id: string, query: Record<string, unknown>) {
    const table = await this.run(scope, id, query, ROW_LIMIT);
    const lines = [table.columns.map((column) => csv(column.label)).join(',')];
    for (const row of table.rows) lines.push(table.columns.map((column) => csv(row[column.key])).join(','));
    if (table.totals) lines.push(table.columns.map((column, index) => csv(index === 0 ? 'Total' : (table.totals?.[column.key] ?? ''))).join(','));
    return { filename: `${id}-${stamp()}.csv`, contentType: 'text/csv; charset=utf-8', body: `\uFEFF${lines.join('\r\n')}\r\n` };
  }

  async exportXlsx(scope: MarketingScope, id: string, query: Record<string, unknown>) {
    const table = await this.run(scope, id, query, ROW_LIMIT);
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ALLIVA';
    const sheet = workbook.addWorksheet(table.title.slice(0, 31));
    sheet.columns = table.columns.map((column) => ({ header: column.label, key: column.key, width: Math.max(14, column.label.length + 4) }));
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD60A' } };
    for (const row of table.rows) sheet.addRow(Object.fromEntries(table.columns.map((column) => [column.key, cellValue(column, row[column.key])])));
    if (table.totals) {
      const total = sheet.addRow(Object.fromEntries(table.columns.map((column, index) => [column.key, index === 0 ? 'Total' : cellValue(column, table.totals?.[column.key] ?? null)])));
      total.font = { bold: true };
    }
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { filename: `${id}-${stamp()}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: buffer };
  }

  // ------------------------------------------------------------------ dashboards

  /** KPI cards and chart series for the caller's scope. */
  async dashboard(scope: MarketingScope, query: Record<string, unknown>) {
    const raw = readQuery(query);
    const range = dateRange(raw);
    const created = range ? { createdAt: range } : {};
    const referralWhere: Prisma.MerchantReferralWhereInput = { AND: [scope.referrals(), created] };
    const leadWhere: Prisma.MarketingLeadWhereInput = { AND: [scope.leads(), created] };
    const commissionWhere: Prisma.CommissionEntryWhereInput = { AND: [scope.commissions(), created] };

    const referrals = await this.prisma.merchantReferral.findMany({ where: referralWhere, select: { merchantId: true, createdAt: true, marketingUserId: true } });
    const merchantIds = referrals.map((row) => row.merchantId);
    const [leadGroups, visitCount, appointmentGroups, payments, commissions, redemptions, profiles] = await Promise.all([
      this.prisma.marketingLead.groupBy({ by: ['status'], where: leadWhere, _count: { _all: true } }),
      this.prisma.marketingVisit.count({ where: { AND: [scope.visits(), range ? { visitedAt: range } : {}] } }),
      this.prisma.marketingAppointment.groupBy({ by: ['status'], where: { AND: [scope.appointments(), range ? { scheduledAt: range } : {}] }, _count: { _all: true } }),
      this.prisma.subscriptionPayment.findMany({ where: { merchantId: { in: merchantIds }, verifiedAt: { not: null, ...(range ?? {}) } }, select: { amount: true, refundedAmount: true, verifiedAt: true, merchantId: true } }),
      this.prisma.commissionEntry.findMany({ where: commissionWhere, select: { tier: true, amount: true, reversedAmount: true, status: true, createdAt: true, merchantId: true, beneficiaryUserId: true } }),
      scope.isAdmin ? this.prisma.marketingRedemption.groupBy({ by: ['status'], _count: { _all: true }, _sum: { amount: true } }) : Promise.resolve([]),
      scope.isStaff ? Promise.resolve([]) : this.prisma.marketingProfile.findMany({ where: scope.isAdmin ? {} : { OR: [{ parentUserId: scope.userId }, { userId: scope.userId }] }, select: { kind: true, status: true, userId: true, user: { select: { firstName: true, lastName: true } } } }),
    ]);

    const leadCount = (status: string) => leadGroups.find((row) => row.status === status)?._count._all ?? 0;
    const totalLeads = leadGroups.reduce((total, row) => total + row._count._all, 0);
    const registered = leadCount('REGISTERED');
    const net = (entry: { amount: { toString(): string }; reversedAmount: { toString(): string } }) => money(entry.amount.toString()).minus(entry.reversedAmount.toString());
    const live = commissions.filter((entry) => entry.status !== 'REVERSED');
    const byTier = (tier: string, statuses?: string[]) => live.filter((entry) => entry.tier === tier && (!statuses || statuses.includes(entry.status))).reduce((total, entry) => total.plus(net(entry)), money(0));
    const revenue = payments.reduce((total, payment) => total.plus(payment.amount.toString()).minus(payment.refundedAmount.toString()), money(0));
    const payingMerchants = new Set(commissions.filter((entry) => entry.status !== 'REVERSED').map((entry) => entry.merchantId));
    const withdrawalsPending = redemptions.filter((row) => ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING'].includes(row.status));

    const months = lastMonths(6);
    const bucket = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 7) : '');
    const registrations = months.map((month) => ({ month, value: referrals.filter((row) => bucket(row.createdAt) === month).length }));
    const revenueSeries = months.map((month) => ({ month, value: Number(payments.filter((payment) => bucket(payment.verifiedAt) === month).reduce((total, payment) => total.plus(payment.amount.toString()).minus(payment.refundedAmount.toString()), money(0)).toFixed(3)) }));
    const commissionSeries = months.map((month) => ({ month, value: Number(live.filter((entry) => bucket(entry.createdAt) === month).reduce((total, entry) => total.plus(net(entry)), money(0)).toFixed(3)) }));

    const kpis: Record<string, string | number> = {
      leads: totalLeads,
      leadsRegistered: registered,
      conversionRate: totalLeads ? Number(((registered / totalLeads) * 100).toFixed(1)) : 0,
      visits: visitCount,
      referredStores: referrals.length,
      payingStores: payingMerchants.size,
      revenue: moneyString(revenue),
      staffCommission: moneyString(byTier('STAFF')),
      headCommission: moneyString(byTier('HEAD')),
      pendingCommission: moneyString(live.filter((entry) => entry.status === 'PENDING').reduce((total, entry) => total.plus(net(entry)), money(0))),
      approvedCommission: moneyString(live.filter((entry) => ['APPROVED', 'PAID'].includes(entry.status)).reduce((total, entry) => total.plus(net(entry)), money(0))),
      appointmentsScheduled: appointmentGroups.find((row) => row.status === 'SCHEDULED')?._count._all ?? 0,
      appointmentsCompleted: appointmentGroups.find((row) => row.status === 'COMPLETED')?._count._all ?? 0,
      appointmentsMissed: appointmentGroups.find((row) => row.status === 'MISSED')?._count._all ?? 0,
    };
    if (scope.isAdmin) {
      kpis.heads = profiles.filter((row) => row.kind === 'HEAD').length;
      kpis.activeHeads = profiles.filter((row) => row.kind === 'HEAD' && row.status === 'ACTIVE').length;
      kpis.staff = profiles.filter((row) => row.kind === 'STAFF').length;
      kpis.activeStaff = profiles.filter((row) => row.kind === 'STAFF' && row.status === 'ACTIVE').length;
      kpis.pendingWithdrawals = withdrawalsPending.reduce((total, row) => total + row._count._all, 0);
      kpis.pendingWithdrawalAmount = sum(withdrawalsPending.map((row) => row._sum.amount ?? 0));
    }
    if (scope.isHead) {
      kpis.teamSize = profiles.filter((row) => row.kind === 'STAFF').length;
      kpis.activeStaff = profiles.filter((row) => row.kind === 'STAFF' && row.status === 'ACTIVE').length;
    }

    let top: Array<{ staffId: string; name: string; stores: number }> = [];
    if (!scope.isStaff) {
      const names = new Map(profiles.map((row) => [row.userId, fullName(row.user)]));
      const counts = new Map<string, number>();
      for (const row of referrals) counts.set(row.marketingUserId, (counts.get(row.marketingUserId) ?? 0) + 1);
      top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([staffId, stores]) => ({ staffId, name: names.get(staffId) ?? '', stores }));
      if (scope.isAdmin && top.some((row) => !row.name)) {
        const users = await this.prisma.user.findMany({ where: { id: { in: top.map((row) => row.staffId) } }, select: { id: true, firstName: true, lastName: true } });
        for (const row of top) row.name = fullName(users.find((user) => user.id === row.staffId));
      }
    }

    return {
      kpis,
      funnel: ['NEW', 'CONTACTED', 'VISITED', 'INTERESTED', 'FOLLOW_UP_REQUIRED', 'APPOINTMENT_SCHEDULED', 'NEGOTIATION', 'REGISTRATION_PENDING', 'REGISTERED', 'NOT_INTERESTED', 'CLOSED_LOST'].map((status) => ({ status, count: leadCount(status) })),
      charts: { registrations, revenue: revenueSeries, commission: commissionSeries },
      topStaff: top,
    };
  }

  // ------------------------------------------------------------------ reports

  private async headPerformance(f: Filters) {
    const heads = await this.prisma.marketingProfile.findMany({ where: { kind: 'HEAD', ...(f.headId ? { userId: f.headId } : {}), ...(f.status ? { status: f.status as never } : {}) }, include: { user: true }, orderBy: { createdAt: 'asc' } });
    const ids = heads.map((row) => row.userId);
    const created = f.range ? { createdAt: f.range } : {};
    const [staff, leads, referrals, commissions] = await Promise.all([
      this.prisma.marketingProfile.findMany({ where: { kind: 'STAFF', parentUserId: { in: ids } }, select: { parentUserId: true, status: true } }),
      this.prisma.marketingLead.groupBy({ by: ['headUserId', 'status'], where: { headUserId: { in: ids }, ...created }, _count: { _all: true } }),
      this.prisma.merchantReferral.findMany({ where: { headUserId: { in: ids }, ...created }, select: { headUserId: true, merchantId: true } }),
      this.prisma.commissionEntry.findMany({ where: { headUserId: { in: ids }, ...created, status: { not: 'REVERSED' } }, select: { headUserId: true, tier: true, amount: true, reversedAmount: true, merchantId: true, beneficiaryUserId: true } }),
    ]);
    const rows = heads.map((head) => {
      const myLeads = leads.filter((row) => row.headUserId === head.userId);
      const total = myLeads.reduce((n, row) => n + row._count._all, 0);
      const registered = myLeads.find((row) => row.status === 'REGISTERED')?._count._all ?? 0;
      const mine = commissions.filter((row) => row.headUserId === head.userId);
      const headEntries = mine.filter((row) => row.tier === 'HEAD' && row.beneficiaryUserId === head.userId);
      const netOf = (rows: typeof mine) => sum(rows.map((row) => money(row.amount.toString()).minus(row.reversedAmount.toString())));
      return {
        head: fullName(head.user),
        employeeId: head.employeeId,
        status: head.status,
        staff: staff.filter((row) => row.parentUserId === head.userId).length,
        activeStaff: staff.filter((row) => row.parentUserId === head.userId && row.status === 'ACTIVE').length,
        leads: total,
        stores: referrals.filter((row) => row.headUserId === head.userId).length,
        payingStores: new Set(mine.map((row) => row.merchantId)).size,
        conversion: total ? Number(((registered / total) * 100).toFixed(1)) : 0,
        staffCommission: netOf(mine.filter((row) => row.tier === 'STAFF')),
        headCommission: netOf(headEntries),
      };
    });
    return {
      columns: [
        col('head', 'Head'), col('employeeId', 'Employee ID'), col('status', 'Status'), col('staff', 'Staff', 'number'), col('activeStaff', 'Active staff', 'number'), col('leads', 'Leads', 'number'),
        col('stores', 'Stores', 'number'), col('payingStores', 'Paying stores', 'number'), col('conversion', 'Conversion %', 'percent'), col('staffCommission', 'Team staff commission', 'money'), col('headCommission', 'Head commission', 'money'),
      ],
      rows,
      totals: { head: 'Total', staff: sumNum(rows, 'staff'), leads: sumNum(rows, 'leads'), stores: sumNum(rows, 'stores'), payingStores: sumNum(rows, 'payingStores'), staffCommission: sum(rows.map((r) => r.staffCommission)), headCommission: sum(rows.map((r) => r.headCommission)) },
    };
  }

  private async staffPerformance(scope: MarketingScope, f: Filters) {
    const profiles = await this.prisma.marketingProfile.findMany({
      where: { AND: [scope.staffProfiles(), f.staffId ? { userId: f.staffId } : {}, f.headId ? { parentUserId: f.headId } : {}, f.status ? { status: f.status as never } : {}] },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    const ids = profiles.map((row) => row.userId);
    const created = f.range ? { createdAt: f.range } : {};
    const [leads, visits, appts, referrals, commissions] = await Promise.all([
      this.prisma.marketingLead.groupBy({ by: ['marketingUserId', 'status'], where: { marketingUserId: { in: ids }, ...created }, _count: { _all: true } }),
      this.prisma.marketingVisit.groupBy({ by: ['staffUserId'], where: { staffUserId: { in: ids }, ...(f.range ? { visitedAt: f.range } : {}) }, _count: { _all: true } }),
      this.prisma.marketingAppointment.groupBy({ by: ['staffUserId', 'status'], where: { staffUserId: { in: ids }, ...(f.range ? { scheduledAt: f.range } : {}) }, _count: { _all: true } }),
      this.prisma.merchantReferral.findMany({ where: { marketingUserId: { in: ids }, ...created }, select: { marketingUserId: true, merchantId: true } }),
      this.prisma.commissionEntry.findMany({ where: { staffUserId: { in: ids }, tier: 'STAFF', status: { not: 'REVERSED' }, ...created }, select: { staffUserId: true, merchantId: true, amount: true, reversedAmount: true } }),
    ]);
    const rows = profiles.map((profile) => {
      const id = profile.userId;
      const myLeads = leads.filter((row) => row.marketingUserId === id);
      const total = myLeads.reduce((n, row) => n + row._count._all, 0);
      const registered = myLeads.find((row) => row.status === 'REGISTERED')?._count._all ?? 0;
      const mine = commissions.filter((row) => row.staffUserId === id);
      const appt = (status: string) => appts.find((row) => row.staffUserId === id && row.status === status)?._count._all ?? 0;
      return {
        staff: fullName(profile.user),
        employeeId: profile.employeeId,
        status: profile.status,
        leads: total,
        visits: visits.find((row) => row.staffUserId === id)?._count._all ?? 0,
        appointments: appt('SCHEDULED') + appt('COMPLETED') + appt('MISSED') + appt('CANCELLED') + appt('RESCHEDULED'),
        completed: appt('COMPLETED'),
        missed: appt('MISSED'),
        stores: referrals.filter((row) => row.marketingUserId === id).length,
        payingStores: new Set(mine.map((row) => row.merchantId)).size,
        conversion: total ? Number(((registered / total) * 100).toFixed(1)) : 0,
        commission: sum(mine.map((row) => money(row.amount.toString()).minus(row.reversedAmount.toString()))),
      };
    });
    return {
      columns: [
        col('staff', 'Staff'), col('employeeId', 'Employee ID'), col('status', 'Status'), col('leads', 'Leads', 'number'), col('visits', 'Visits', 'number'), col('appointments', 'Appointments', 'number'), col('completed', 'Completed', 'number'),
        col('missed', 'Missed', 'number'), col('stores', 'Stores', 'number'), col('payingStores', 'Paying stores', 'number'), col('conversion', 'Conversion %', 'percent'), col('commission', 'Commission', 'money'),
      ],
      rows,
      totals: { staff: 'Total', leads: sumNum(rows, 'leads'), visits: sumNum(rows, 'visits'), appointments: sumNum(rows, 'appointments'), completed: sumNum(rows, 'completed'), missed: sumNum(rows, 'missed'), stores: sumNum(rows, 'stores'), payingStores: sumNum(rows, 'payingStores'), commission: sum(rows.map((r) => r.commission)) },
    };
  }

  private async merchantReferrals(scope: MarketingScope, f: Filters, take: number) {
    const where: Prisma.MerchantReferralWhereInput = {
      AND: [
        scope.referrals(),
        f.range ? { createdAt: f.range } : {},
        f.staffId ? { marketingUserId: f.staffId } : {},
        f.headId ? { headUserId: f.headId } : {},
        f.merchantId ? { merchantId: f.merchantId } : {},
        f.planId ? { merchant: { subscription: { planId: f.planId } } } : {},
        f.status ? { merchant: { status: f.status as never } } : {},
      ],
    };
    const referrals = await this.prisma.merchantReferral.findMany({
      where,
      include: { merchant: { include: { subscription: { include: { plan: true } } } }, marketingUser: true, headUser: true },
      orderBy: { createdAt: 'desc' },
      take,
    });
    const ids = referrals.map((row) => row.merchantId);
    const [payments, commissions] = await Promise.all([
      this.prisma.subscriptionPayment.findMany({ where: { merchantId: { in: ids }, verifiedAt: { not: null }, isRenewal: false } }),
      this.prisma.commissionEntry.findMany({ where: { merchantId: { in: ids }, status: { not: 'REVERSED' }, ...(scope.isAdmin ? {} : scope.commissions()) } }),
    ]);
    const rows = referrals.map((row) => {
      const payment = payments.find((p) => p.merchantId === row.merchantId);
      const mine = commissions.filter((c) => c.merchantId === row.merchantId);
      const netOf = (tier: string) => sum(mine.filter((c) => c.tier === tier).map((c) => money(c.amount.toString()).minus(c.reversedAmount.toString())));
      return {
        merchant: loc(row.merchant.name).en,
        merchantStatus: row.merchant.status,
        staff: fullName(row.marketingUser),
        head: fullName(row.headUser),
        code: row.codeUsed,
        source: row.source,
        registeredAt: iso(row.createdAt),
        plan: row.merchant.subscription ? loc(row.merchant.subscription.plan.name).en : null,
        subscription: row.merchant.subscription?.status ?? null,
        firstPayment: payment ? dec(payment.amount) : null,
        staffCommission: netOf('STAFF'),
        headCommission: netOf('HEAD'),
      };
    });
    return {
      columns: [
        col('merchant', 'Merchant'), col('merchantStatus', 'Merchant status'), col('staff', 'Staff'), col('head', 'Head'), col('code', 'Referral code'), col('source', 'Source'), col('registeredAt', 'Registered', 'date'),
        col('plan', 'Plan'), col('subscription', 'Subscription'), col('firstPayment', 'First payment', 'money'), col('staffCommission', 'Staff commission', 'money'), col('headCommission', 'Head commission', 'money'),
      ],
      rows,
      totals: null,
    };
  }

  private async leadConversion(scope: MarketingScope, f: Filters) {
    const groups = await this.prisma.marketingLead.groupBy({
      by: ['marketingUserId', 'status'],
      where: { AND: [scope.leads(), f.range ? { createdAt: f.range } : {}, f.staffId ? { marketingUserId: f.staffId } : {}, f.headId ? { headUserId: f.headId } : {}, f.planId ? { interestedPlanId: f.planId } : {}, f.status ? { status: f.status as never } : {}] },
      _count: { _all: true },
    });
    const staffIds = [...new Set(groups.map((row) => row.marketingUserId))];
    const users = await this.prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, firstName: true, lastName: true } });
    const statuses = ['NEW', 'CONTACTED', 'VISITED', 'INTERESTED', 'FOLLOW_UP_REQUIRED', 'APPOINTMENT_SCHEDULED', 'NEGOTIATION', 'REGISTRATION_PENDING', 'REGISTERED', 'NOT_INTERESTED', 'CLOSED_LOST'];
    const rows = staffIds.map((id) => {
      const mine = groups.filter((row) => row.marketingUserId === id);
      const n = (status: string) => mine.find((row) => row.status === status)?._count._all ?? 0;
      const total = mine.reduce((t, row) => t + row._count._all, 0);
      const open = mine.filter((row) => !CLOSED_LEAD_STATUSES.includes(row.status as never)).reduce((t, row) => t + row._count._all, 0);
      return { staff: fullName(users.find((user) => user.id === id)), total, open, ...Object.fromEntries(statuses.map((status) => [status, n(status)])), conversion: total ? Number(((n('REGISTERED') / total) * 100).toFixed(1)) : 0 };
    });
    return {
      columns: [col('staff', 'Staff'), col('total', 'Total leads', 'number'), col('open', 'Open', 'number'), ...statuses.map((status) => col(status, status.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()), 'number')), col('conversion', 'Conversion %', 'percent')],
      rows,
      totals: { staff: 'Total', total: sumNum(rows, 'total'), open: sumNum(rows, 'open'), ...Object.fromEntries(statuses.map((status) => [status, sumNum(rows, status)])) },
    };
  }

  private async storeVisits(scope: MarketingScope, f: Filters, take: number) {
    const visits = await this.prisma.marketingVisit.findMany({
      where: { AND: [scope.visits(), f.range ? { visitedAt: f.range } : {}, f.staffId ? { staffUserId: f.staffId } : {}, f.headId ? { headUserId: f.headId } : {}, f.status ? { lead: { status: f.status as never } } : {}, f.merchantId ? { lead: { merchantId: f.merchantId } } : {}] },
      include: { lead: true, staff: true },
      orderBy: { visitedAt: 'desc' },
      take,
    });
    return {
      columns: [col('visitedAt', 'Visited', 'date'), col('staff', 'Staff'), col('business', 'Business'), col('area', 'Area'), col('leadStatus', 'Lead status'), col('outcome', 'Outcome'), col('notes', 'Notes')],
      rows: visits.map((v) => ({ visitedAt: iso(v.visitedAt), staff: fullName(v.staff), business: v.lead.businessName, area: v.lead.area, leadStatus: v.lead.status, outcome: v.outcome, notes: v.notes })),
      totals: null,
    };
  }

  private async appointments(scope: MarketingScope, f: Filters, take: number) {
    const rows = await this.prisma.marketingAppointment.findMany({
      where: { AND: [scope.appointments(), f.range ? { scheduledAt: f.range } : {}, f.staffId ? { staffUserId: f.staffId } : {}, f.headId ? { headUserId: f.headId } : {}, f.status ? { status: f.status as never } : {}, f.merchantId ? { merchantId: f.merchantId } : {}] },
      include: { lead: true, merchant: true, staff: true },
      orderBy: { scheduledAt: 'desc' },
      take,
    });
    return {
      columns: [col('scheduledAt', 'Scheduled', 'date'), col('kind', 'Type'), col('status', 'Status'), col('staff', 'Staff'), col('subject', 'Lead / store'), col('title', 'Title'), col('outcome', 'Outcome'), col('completedAt', 'Completed', 'date')],
      rows: rows.map((r) => ({ scheduledAt: iso(r.scheduledAt), kind: r.kind, status: r.status, staff: fullName(r.staff), subject: r.lead?.businessName ?? (r.merchant ? loc(r.merchant.name).en : null), title: r.title, outcome: r.outcome, completedAt: iso(r.completedAt) })),
      totals: null,
    };
  }

  private async commissions(scope: MarketingScope, f: Filters, take: number) {
    const entries = await this.prisma.commissionEntry.findMany({
      where: {
        AND: [
          scope.commissions(),
          f.range ? { createdAt: f.range } : {},
          f.staffId ? { staffUserId: f.staffId } : {},
          f.headId ? { headUserId: f.headId } : {},
          f.merchantId ? { merchantId: f.merchantId } : {},
          f.status ? { status: f.status as never } : {},
          f.planId ? { subscriptionPayment: { subscription: { planId: f.planId } } } : {},
        ],
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
    const [users, merchants] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.beneficiaryUserId))] } }, select: { id: true, firstName: true, lastName: true } }),
      this.prisma.merchant.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.merchantId))] } }, select: { id: true, name: true } }),
    ]);
    const rows = entries.map((e) => ({
      createdAt: iso(e.createdAt),
      merchant: loc(merchants.find((m) => m.id === e.merchantId)?.name).en,
      beneficiary: fullName(users.find((u) => u.id === e.beneficiaryUserId)),
      tier: e.tier,
      eligible: dec(e.eligibleAmount),
      rate: Number(dec(e.ratePercent)),
      amount: dec(e.amount),
      reversed: dec(e.reversedAmount),
      net: moneyString(money(e.amount.toString()).minus(e.reversedAmount.toString())),
      status: e.status,
    }));
    return {
      columns: [col('createdAt', 'Created', 'date'), col('merchant', 'Merchant'), col('beneficiary', 'Beneficiary'), col('tier', 'Tier'), col('eligible', 'Eligible amount', 'money'), col('rate', 'Rate %', 'percent'), col('amount', 'Commission', 'money'), col('reversed', 'Reversed', 'money'), col('net', 'Net', 'money'), col('status', 'Status')],
      rows,
      totals: { createdAt: 'Total', amount: sum(rows.map((r) => r.amount)), reversed: sum(rows.map((r) => r.reversed)), net: sum(rows.map((r) => r.net)) },
    };
  }

  private async walletTransactions(scope: MarketingScope, f: Filters, take: number) {
    const where: Prisma.MarketingWalletTransactionWhereInput = {
      AND: [scope.isAdmin ? (f.staffId ? { userId: f.staffId } : {}) : { userId: scope.userId }, f.range ? { createdAt: f.range } : {}, f.status ? { type: f.status as never } : {}],
    };
    const rows = await this.prisma.marketingWalletTransaction.findMany({ where, include: { user: true }, orderBy: { createdAt: 'desc' }, take });
    const mapped = rows.map((r) => ({ createdAt: iso(r.createdAt), user: fullName(r.user), type: r.type, bucket: r.bucket, amount: dec(r.amount), reason: r.reason, reference: r.reference }));
    return {
      columns: [col('createdAt', 'Date', 'date'), col('user', 'Wallet owner'), col('type', 'Type'), col('bucket', 'Bucket'), col('amount', 'Amount', 'money'), col('reason', 'Reason'), col('reference', 'Reference')],
      rows: mapped,
      totals: null,
    };
  }

  private async withdrawals(scope: MarketingScope, f: Filters, take: number) {
    const where: Prisma.MarketingRedemptionWhereInput = {
      AND: [scope.isAdmin ? (f.staffId ? { userId: f.staffId } : f.headId ? { userId: f.headId } : {}) : { userId: scope.userId }, f.range ? { createdAt: f.range } : {}, f.status ? { status: f.status as never } : {}],
    };
    const rows = await this.prisma.marketingRedemption.findMany({ where, include: { user: true }, orderBy: { createdAt: 'desc' }, take });
    const mapped = rows.map((r) => ({ createdAt: iso(r.createdAt), user: fullName(r.user), amount: dec(r.amount), status: r.status, method: r.payoutMethod, reference: r.payoutReference, paidAt: iso(r.paidAt), rejection: r.rejectionReason }));
    return {
      columns: [col('createdAt', 'Requested', 'date'), col('user', 'Requested by'), col('amount', 'Amount', 'money'), col('status', 'Status'), col('method', 'Method'), col('reference', 'Payout reference'), col('paidAt', 'Paid', 'date'), col('rejection', 'Rejection reason')],
      rows: mapped,
      totals: { createdAt: 'Total', amount: sum(mapped.map((r) => r.amount)) },
    };
  }

  private async promoUsage(f: Filters, take: number) {
    const rows = await this.prisma.subscriptionPromoRedemption.findMany({
      where: { AND: [f.range ? { createdAt: f.range } : {}, f.merchantId ? { merchantId: f.merchantId } : {}, f.status ? { status: f.status as never } : {}, f.campaign ? { promoCode: { campaignName: { contains: f.campaign, mode: 'insensitive' } } } : {}] },
      include: { promoCode: true },
      orderBy: { createdAt: 'desc' },
      take,
    });
    const merchants = await this.prisma.merchant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.merchantId))] } }, select: { id: true, name: true, subscription: { select: { planId: true, plan: { select: { name: true } } } } } });
    const filtered = rows.filter((r) => !f.planId || merchants.find((m) => m.id === r.merchantId)?.subscription?.planId === f.planId);
    const mapped = filtered.map((r) => {
      const merchant = merchants.find((m) => m.id === r.merchantId);
      return { createdAt: iso(r.createdAt), code: r.promoCode.code, campaign: r.promoCode.campaignName, merchant: loc(merchant?.name).en, plan: merchant?.subscription ? loc(merchant.subscription.plan.name).en : null, discount: dec(r.discountAmount), status: r.status, appliedAt: iso(r.appliedAt) };
    });
    return {
      columns: [col('createdAt', 'Date', 'date'), col('code', 'Promo code'), col('campaign', 'Campaign'), col('merchant', 'Merchant'), col('plan', 'Plan'), col('discount', 'Discount', 'money'), col('status', 'Status'), col('appliedAt', 'Applied', 'date')],
      rows: mapped,
      totals: { createdAt: 'Total', discount: sum(mapped.filter((r) => r.status === 'APPLIED').map((r) => r.discount)) },
    };
  }

  private async revenue(f: Filters, take: number) {
    const referralWhere: Prisma.MerchantReferralWhereInput = { AND: [f.staffId ? { marketingUserId: f.staffId } : {}, f.headId ? { headUserId: f.headId } : {}, f.merchantId ? { merchantId: f.merchantId } : {}] };
    const referrals = await this.prisma.merchantReferral.findMany({ where: referralWhere, select: { merchantId: true, marketingUserId: true, headUserId: true } });
    const payments = await this.prisma.subscriptionPayment.findMany({
      where: { merchantId: { in: referrals.map((r) => r.merchantId) }, verifiedAt: { not: null, ...(f.range ?? {}) }, ...(f.status ? { status: f.status as never } : {}), ...(f.planId ? { subscription: { planId: f.planId } } : {}) },
      include: { subscription: { include: { plan: true } }, commissions: true },
      orderBy: { verifiedAt: 'desc' },
      take,
    });
    const [merchants, users] = await Promise.all([
      this.prisma.merchant.findMany({ where: { id: { in: [...new Set(payments.map((p) => p.merchantId))] } }, select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: [...new Set(referrals.map((r) => r.marketingUserId))] } }, select: { id: true, firstName: true, lastName: true } }),
    ]);
    const rows = payments.map((p) => {
      const referral = referrals.find((r) => r.merchantId === p.merchantId);
      const commission = p.commissions.reduce((total, c) => total.plus(c.amount.toString()).minus(c.reversedAmount.toString()), money(0));
      const gross = p.grossAmount ?? p.amount;
      return {
        verifiedAt: iso(p.verifiedAt),
        merchant: loc(merchants.find((m) => m.id === p.merchantId)?.name).en,
        plan: loc(p.subscription.plan.name).en,
        staff: fullName(users.find((u) => u.id === referral?.marketingUserId)),
        type: p.isRenewal ? 'Renewal' : 'First payment',
        gross: dec(gross),
        discount: dec(p.discountAmount),
        paid: dec(p.amount),
        refunded: dec(p.refundedAmount),
        netRevenue: moneyString(money(p.amount.toString()).minus(p.refundedAmount.toString())),
        commission: moneyString(commission),
        status: p.status,
      };
    });
    return {
      columns: [col('verifiedAt', 'Verified', 'date'), col('merchant', 'Merchant'), col('plan', 'Plan'), col('staff', 'Staff'), col('type', 'Payment'), col('gross', 'Gross', 'money'), col('discount', 'Discount', 'money'), col('paid', 'Paid', 'money'), col('refunded', 'Refunded', 'money'), col('netRevenue', 'Net revenue', 'money'), col('commission', 'Net commission', 'money'), col('status', 'Status')],
      rows,
      totals: { verifiedAt: 'Total', gross: sum(rows.map((r) => r.gross)), discount: sum(rows.map((r) => r.discount)), paid: sum(rows.map((r) => r.paid)), refunded: sum(rows.map((r) => r.refunded)), netRevenue: sum(rows.map((r) => r.netRevenue)), commission: sum(rows.map((r) => r.commission)) },
    };
  }
}

type Filters = { range?: { gte?: Date; lte?: Date }; staffId?: string; headId?: string; merchantId?: string; planId?: string; campaign?: string; status?: string };

function col(key: string, label: string, type: ReportColumn['type'] = 'text'): ReportColumn {
  return { key, label, type };
}

function sumNum(rows: Array<Record<string, unknown>>, key: string) {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function lastMonths(count: number): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

const stamp = () => new Date().toISOString().slice(0, 10);

/** Escapes a CSV cell and neutralises spreadsheet formulas (a cell starting with = + - @ is prefixed with a quote). */
export function csv(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text))) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function cellValue(column: ReportColumn, value: Cell): string | number | Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (column.type === 'date') return new Date(String(value));
  if (column.type === 'money' || column.type === 'number' || column.type === 'percent') return Number(value);
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}
