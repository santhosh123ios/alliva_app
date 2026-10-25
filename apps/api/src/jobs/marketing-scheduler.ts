import { Logger } from '../common/logger';
import { dueOffsets, formatBahrain, reminderKey } from '../domain/marketing';
import type { MarketingFinanceService } from '../modules/marketing/finance.service';
import type { MarketingSettingsService } from '../modules/marketing/settings';
import { notify, recordActivity } from '../modules/marketing/shared';
import type { PrismaService } from '../prisma/prisma.service';

export type SchedulerResult = { reminders: number; overdue: number; missed: number; approved: number };

/**
 * Background worker for the marketing module. It runs on the API process every minute, independent of whether
 * anyone has a page open, and is safe to run on several instances at once: reminders are deduplicated by a unique
 * notification key, missed meetings are claimed with a conditional update, and commission approval is itself
 * idempotent, so a second instance only repeats cheap reads.
 */
export class MarketingScheduler {
  private readonly log = new Logger('MarketingScheduler');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: MarketingSettingsService,
    private readonly finance: MarketingFinanceService,
    private readonly intervalMs = 60_000,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
    void this.tick();
    this.log.log(`Started (every ${Math.round(this.intervalMs / 1000)}s)`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (error) {
      this.log.error(`Run failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  async runOnce(now = new Date()): Promise<SchedulerResult> {
    const settings = await this.settings.get();
    const result: SchedulerResult = { reminders: 0, overdue: 0, missed: 0, approved: 0 };
    if (settings.followUpAlerts) result.reminders = await this.sendReminders(now, settings.reminderOffsets);
    const late = await this.markLate(now, settings.overdueAlertHours, settings.notifyHead, settings.followUpAlerts);
    result.overdue = late.overdue;
    result.missed = late.missed;
    result.approved = await this.finance.approveDue(now);
    return result;
  }

  private async sendReminders(now: Date, offsets: number[]) {
    const horizon = new Date(now.getTime() + (Math.max(...offsets, 0) + 1) * 60_000);
    const grace = new Date(now.getTime() - 15 * 60_000);
    const rows = await this.prisma.marketingAppointment.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { gte: grace, lte: horizon } },
      include: { lead: { select: { businessName: true } }, merchant: { select: { name: true } } },
      take: 500,
    });
    let sent = 0;
    for (const row of rows) {
      for (const offset of dueOffsets(row.scheduledAt, offsets, now)) {
        const key = reminderKey(row.id, row.scheduledAt, offset);
        if (await this.prisma.notification.findUnique({ where: { dedupeKey: key }, select: { id: true } })) continue;
        const when = formatBahrain(row.scheduledAt);
        const kind = row.kind === 'APPOINTMENT' ? { en: 'Appointment', ar: 'موعد' } : { en: 'Follow-up', ar: 'متابعة' };
        const subject = row.lead?.businessName ?? (row.merchant && typeof row.merchant.name === 'object' && row.merchant.name ? String((row.merchant.name as { en?: string }).en ?? '') : '');
        const lead = offset >= 1440 ? { en: 'tomorrow', ar: 'غداً' } : offset > 0 ? { en: `in ${offset >= 60 ? `${Math.round(offset / 60)}h` : `${offset} min`}`, ar: `بعد ${offset >= 60 ? `${Math.round(offset / 60)} ساعة` : `${offset} دقيقة`}` } : { en: 'now', ar: 'الآن' };
        await notify(this.prisma, {
          userId: row.staffUserId,
          title: { en: `${kind.en} ${lead.en}`, ar: `${kind.ar} ${lead.ar}` },
          body: { en: `${row.title} - ${when}${subject ? ` (${subject})` : ''}`, ar: `${row.title} - ${when}${subject ? ` (${subject})` : ''}` },
          link: row.leadId ? `/leads?lead=${row.leadId}` : `/appointments`,
          entityType: 'MarketingAppointment',
          entityId: row.id,
          dedupeKey: key,
        });
        sent += 1;
      }
    }
    return sent;
  }

  /**
   * Meetings that were never completed become MISSED after the grace period; overdue follow-ups stay open but
   * raise one alert to the staff member (and their head). Both are one-time events per item.
   */
  private async markLate(now: Date, graceHours: number, notifyHead: boolean, alerts: boolean) {
    const cutoff = new Date(now.getTime() - graceHours * 3_600_000);
    const rows = await this.prisma.marketingAppointment.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lt: cutoff, gte: new Date(cutoff.getTime() - 30 * 86_400_000) } },
      include: { lead: { select: { businessName: true } } },
      take: 500,
    });
    let missed = 0;
    let overdue = 0;
    for (const row of rows) {
      const subject = row.lead?.businessName ?? row.title;
      if (row.kind === 'APPOINTMENT') {
        const claimed = await this.prisma.marketingAppointment.updateMany({ where: { id: row.id, status: 'SCHEDULED' }, data: { status: 'MISSED' } });
        if (claimed.count === 0) continue;
        missed += 1;
        await recordActivity(this.prisma, { authorId: row.staffUserId, staffUserId: row.staffUserId, headUserId: row.headUserId, leadId: row.leadId, merchantId: row.merchantId, kind: 'APPOINTMENT', body: 'Appointment missed', metadata: { appointmentId: row.id } });
        if (row.leadId) await this.prisma.marketingLead.update({ where: { id: row.leadId }, data: { appointmentAt: null } });
      }
      if (!alerts) continue;
      const missedMeeting = row.kind === 'APPOINTMENT';
      const title = missedMeeting ? { en: 'Missed appointment', ar: 'موعد فائت' } : { en: 'Overdue follow-up', ar: 'متابعة متأخرة' };
      const body = { en: `${subject} was due ${formatBahrain(row.scheduledAt)}`, ar: `${subject} كان مستحقاً ${formatBahrain(row.scheduledAt)}` };
      const recipients = [row.staffUserId, ...(notifyHead && row.headUserId ? [row.headUserId] : [])];
      for (const userId of recipients) {
        await notify(this.prisma, { userId, title, body, link: row.leadId ? `/leads?lead=${row.leadId}` : '/appointments', entityType: 'MarketingAppointment', entityId: row.id, dedupeKey: `late:${row.id}:${row.scheduledAt.getTime()}:${userId}` });
      }
      if (!missedMeeting) overdue += 1;
    }
    return { missed, overdue };
  }
}
