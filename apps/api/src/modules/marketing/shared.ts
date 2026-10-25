import type { Prisma } from '@prisma/client';
import { notFound } from '../../common/errors';
import type { PrismaService } from '../../prisma/prisma.service';

/** Either the shared client or an interactive transaction client. */
export type Db = PrismaService | Prisma.TransactionClient;

export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) || (error as { code?: string }).code !== 'P2002') return false;
  if (!field) return true;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(target) ? target.includes(field) : String(target ?? '').includes(field);
}

export function fullName(user?: { firstName: string; lastName: string } | null): string {
  return user ? `${user.firstName} ${user.lastName}`.trim() : '';
}

export function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

export type ActivityInput = {
  authorId: string;
  staffUserId?: string | null;
  headUserId?: string | null;
  leadId?: string | null;
  merchantId?: string | null;
  kind: Prisma.MarketingActivityUncheckedCreateInput['kind'];
  body: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export async function recordActivity(db: Db, input: ActivityInput) {
  await db.marketingActivity.create({
    data: {
      authorId: input.authorId,
      staffUserId: input.staffUserId ?? null,
      headUserId: input.headUserId ?? null,
      leadId: input.leadId ?? null,
      merchantId: input.merchantId ?? null,
      kind: input.kind,
      body: input.body,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      metadata: input.metadata,
    },
  });
}

export type Localized = { en: string; ar: string };

export type NotifyInput = {
  userId: string;
  title: Localized;
  body: Localized;
  link?: string;
  entityType?: string;
  entityId?: string;
  dedupeKey?: string;
};

/**
 * Creates an in-app notification in the recipient's language. With a dedupeKey the insert is
 * ON CONFLICT DO NOTHING, so repeated scheduler runs or retried events never raise a second alert
 * (and a duplicate never aborts a surrounding transaction).
 */
export async function notify(db: Db, input: NotifyInput) {
  const user = await db.user.findUnique({ where: { id: input.userId }, select: { locale: true } });
  const arabic = user?.locale === 'ar';
  await db.notification.createMany({
    data: [
      {
        userId: input.userId,
        channel: 'IN_APP',
        title: arabic ? input.title.ar : input.title.en,
        body: arabic ? input.body.ar : input.body.en,
        link: input.link ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        dedupeKey: input.dedupeKey ?? null,
      },
    ],
    skipDuplicates: true,
  });
}

export function same<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

export function requireFound<T>(value: T | null | undefined, message = 'Not found'): T {
  if (!value) throw notFound(message);
  return value;
}
