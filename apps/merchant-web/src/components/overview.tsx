'use client';

import { Link } from '@/i18n/navigation';
import { formatMoney } from '@alliva/design-tokens';
import type { MerchantDashboard } from '@alliva/types';
import { BarChart3, ChevronRight, Clock, MessageSquare, ShoppingCart, Wallet } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

export function Overview({ dash }: { dash: MerchantDashboard }) {
  const t = useTranslations('workspace');
  const locale = useLocale() as 'en' | 'ar';
  const dateParts = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-BH' : 'en-GB', {
    timeZone: 'Asia/Bahrain',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).formatToParts(new Date());
  const part = (type: string) => dateParts.find((item) => item.type === type)?.value ?? '';
  const dateLabel = locale === 'ar' ? `${part('weekday')}، ${part('day')} ${part('month')}` : `${part('weekday')}, ${part('day')} ${part('month')}`;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-tight md:text-5xl">{t('today')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{dateLabel}</p>
        </div>
        <Link href="/orders" className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-[#ffcf33]">
          {t('viewAllOrders')}
        </Link>
      </div>

      <div className="mt-6 grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
        <section className="min-w-0">
          <p className="text-sm text-muted-foreground">{t('revenue')}</p>
          <p className="mt-1 font-display text-4xl tracking-tight md:text-5xl">{formatMoney(dash.revenueToday, locale)}</p>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="font-display text-5xl tracking-tight">{dash.ordersToday}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('ordersToday')}</p>
            </div>
            <div>
              <p className="font-display text-5xl tracking-tight">{dash.pendingOrders}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('pending')}</p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl bg-[#FFF6D4] p-5">
          <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground">{t('keepMoving').toUpperCase()}</p>
          <h2 className="mt-2 font-display text-2xl">{t('needsAttention')}</h2>
          <div className="mt-4 space-y-3">
            <AttentionRow href="/orders" icon={<ShoppingCart className="size-4" />} label={`${dash.pendingOrders} ${t('pending')}`} action={t('open')} />
            <AttentionRow href="/orders" icon={<Clock className="size-4" />} label={`${dash.preparingOrders} ${t('preparing')}`} action={t('open')} />
            <AttentionRow href="/orders" icon={<MessageSquare className="size-4" />} label={`${dash.feedbackAverage} ${t('feedback')}`} action={t('reviews', { count: dash.feedbackCount })} />
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="flex items-center gap-4 rounded-3xl border bg-card p-5">
          <span className="grid size-11 place-items-center rounded-2xl bg-muted"><Wallet className="size-5" /></span>
          <div>
            <p className="text-sm text-muted-foreground">{t('cash')}</p>
            <p className="font-display text-3xl tracking-tight">{formatMoney(dash.cashCollections, locale)}</p>
          </div>
        </section>
        <section className="flex items-center gap-4 rounded-3xl border bg-card p-5">
          <span className="grid size-11 place-items-center rounded-2xl bg-muted"><BarChart3 className="size-5" /></span>
          <div>
            <p className="text-sm text-muted-foreground">{t('settlementBalance')}</p>
            <p className="font-display text-3xl tracking-tight">{formatMoney(dash.settlementBalance, locale)}</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function AttentionRow({ href, icon, label, action }: { href: string; icon: React.ReactNode; label: string; action: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-2xl px-1 py-1 hover:bg-black/5">
      <span className="grid size-10 place-items-center rounded-full bg-white">{icon}</span>
      <span className="font-semibold">{label}</span>
      <span className="ms-auto inline-flex items-center gap-1 text-sm font-semibold">{action} <ChevronRight className="size-4 rtl:rotate-180" /></span>
    </Link>
  );
}
