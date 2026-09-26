'use client';

import { Link } from '@/i18n/navigation';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import type { AdminDashboard, OrderStatus } from '@alliva/types';
import { Button } from '@alliva/ui';
import { BarChart3, Calendar, ChevronRight, Clock, MessageSquare, RefreshCw, Store, Wallet } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function Overview({ dash }: { dash: AdminDashboard }) {
  const t = useTranslations('workspace');
  const locale = useLocale() as 'en' | 'ar';
  const [actionsOpen, setActionsOpen] = useState(false);
  const [lane, setLane] = useState<'all' | 'new' | 'preparing' | 'delivery'>('all');
  const dateParts = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-BH' : 'en-GB', {
    timeZone: 'Asia/Bahrain',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).formatToParts(new Date());
  const part = (type: string) => dateParts.find((item) => item.type === type)?.value ?? '';
  const dateLabel = locale === 'ar' ? `${part('weekday')}، ${part('day')} ${part('month')}` : `${part('weekday')}, ${part('day')} ${part('month')}`;
  const counts = {
    all: dash.ordersInMotion.length,
    new: dash.ordersInMotion.filter((order) => laneOf(order.status) === 'new').length,
    preparing: dash.ordersInMotion.filter((order) => laneOf(order.status) === 'preparing').length,
    delivery: dash.ordersInMotion.filter((order) => laneOf(order.status) === 'delivery').length,
  };
  const rows = dash.ordersInMotion.filter((order) => lane === 'all' || laneOf(order.status) === lane).slice(0, 5);
  const healthMax = Math.max(dash.merchantHealth.online, dash.merchantHealth.offline, dash.merchantHealth.paused, 1);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-tight md:text-5xl">{t('overview')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-11 items-center gap-2 rounded-xl border bg-card px-3 text-sm font-semibold">
            <Calendar className="size-4" />
            {t('thisMonth')}
          </span>
          <div className="relative">
            <Button variant="yellow" className="h-11 rounded-xl px-4" onClick={() => setActionsOpen((open) => !open)}>
              {t('quickActions')} <span className="text-lg leading-none">+</span>
            </Button>
            {actionsOpen ? (
              <div className="absolute end-0 z-20 mt-2 w-64 rounded-2xl border bg-card p-2 shadow-lg">
                <ActionLink href="/merchants" onClick={() => setActionsOpen(false)}>{t('reviewApprovals')}</ActionLink>
                <ActionLink href="/complaints" onClick={() => setActionsOpen(false)}>{t('openComplaints')}</ActionLink>
                <ActionLink href="/operations" onClick={() => setActionsOpen(false)}>{t('openLiveOrders')}</ActionLink>
                <ActionLink href="/finance" onClick={() => setActionsOpen(false)}>{t('openSettlements')}</ActionLink>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-6 grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
        <section className="min-w-0">
          <p className="text-sm text-muted-foreground">{t('platformRevenue')}</p>
          <div className="mt-1 flex flex-wrap items-end gap-3">
            <p className="font-display text-4xl tracking-tight md:text-5xl">{formatMoney(dash.monthRevenue, locale)}</p>
            <Delta value={dash.revenueChange} suffix={t('vsLastMonth')} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t('subscriptionsCommissions')}</p>
          <RevenueChart series={dash.revenueSeries} />
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="font-display text-5xl tracking-tight">{dash.ordersToday}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('ordersToday')} <Delta value={dash.ordersChange} />
              </p>
            </div>
            <div>
              <p className="font-display text-5xl tracking-tight">{dash.merchantHealth.online}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('merchantsOnline')}</p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl bg-[#FFF6D4] p-5">
          <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground">{t('keepMoving').toUpperCase()}</p>
          <h2 className="mt-2 font-display text-2xl">{t('needsAttention')}</h2>
          <div className="mt-4 space-y-3">
            <AttentionRow href="/merchants" icon={<Store className="size-4" />} count={dash.pendingApprovals} label={t('merchantApprovals')} action={t('review')} />
            <AttentionRow href="/finance" icon={<RefreshCw className="size-4" />} count={dash.refundSummary.pending} label={t('refundRequests')} action={t('review')} />
            <AttentionRow href="/complaints" icon={<MessageSquare className="size-4" />} count={dash.complaintsRequiringAction} label={t('openComplaints')} action={t('open')} />
          </div>
        </section>
      </div>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
        <section className="rounded-3xl border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-2xl">{t('ordersInMotion')}</h2>
            <Link href="/operations" className="inline-flex items-center gap-1 text-sm font-semibold">{t('viewAllOrders')} <Forward /></Link>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <LaneButton active={lane === 'all'} onClick={() => setLane('all')}>{t('all')} {counts.all}</LaneButton>
            <LaneButton active={lane === 'new'} onClick={() => setLane('new')}>{t('new')} {counts.new}</LaneButton>
            <LaneButton active={lane === 'preparing'} onClick={() => setLane('preparing')}>{t('preparing')} {counts.preparing}</LaneButton>
            <LaneButton active={lane === 'delivery'} onClick={() => setLane('delivery')}>{t('onTheWay')} {counts.delivery}</LaneButton>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-start text-sm">
              <thead>
                <tr className="text-xs tracking-[0.12em] text-muted-foreground">
                  <th className="pb-3 text-start font-semibold">{t('orderId')}</th>
                  <th className="pb-3 text-start font-semibold">{t('merchant')}</th>
                  <th className="pb-3 text-start font-semibold">{t('amount')}</th>
                  <th className="pb-3 text-start font-semibold">{t('status')}</th>
                  <th className="pb-3 text-start font-semibold">{t('time')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((order) => (
                  <tr key={order.id} className="border-t">
                    <td className="py-3 font-semibold"><span dir="ltr">#{order.number}</span></td>
                    <td className="py-3">
                      <span className="inline-flex items-center gap-2">
                        <span className="grid size-7 place-items-center rounded-full bg-muted"><Store className="size-3.5" /></span>
                        {pickLocalized(order.merchantName, locale)}
                      </span>
                    </td>
                    <td className="py-3 font-semibold">{formatMoney(order.amount, locale)}</td>
                    <td className="py-3"><StatusPill status={order.status} label={t(laneOf(order.status) === 'delivery' ? 'onTheWay' : laneOf(order.status) === 'preparing' ? 'preparing' : 'new')} /></td>
                    <td className="py-3 text-muted-foreground">{ago(order.createdAt, t)}</td>
                    <td className="py-3 text-end text-muted-foreground"><Forward /></td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">{t('noOrders')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border bg-card p-5">
          <h2 className="font-display text-2xl">{t('merchantHealth')}</h2>
          <div className="mt-5 space-y-4">
            <HealthBar label={t('online')} value={dash.merchantHealth.online} max={healthMax} bar="bg-primary" />
            <HealthBar label={t('offline')} value={dash.merchantHealth.offline} max={healthMax} bar="bg-[#111111]" />
            <HealthBar label={t('paused')} value={dash.merchantHealth.paused} max={healthMax} bar="bg-[#C8C8C2]" />
          </div>
          <div className="mt-6 flex items-start gap-3 border-t pt-4">
            <span className="grid size-9 place-items-center rounded-full bg-muted"><Clock className="size-4" /></span>
            <div>
              <p className="font-semibold">{t('subscriptionsExpiring', { count: dash.subscriptionsExpiringSoon })}</p>
              <Link href="/subscriptions" className="inline-flex items-center gap-1 text-sm font-semibold">{t('manageSubscriptions')} <Forward /></Link>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="flex items-center gap-4 rounded-3xl border bg-card p-5">
          <span className="grid size-11 place-items-center rounded-2xl bg-muted"><Wallet className="size-5" /></span>
          <div>
            <p className="text-sm text-muted-foreground">{t('pendingSettlements')}</p>
            <p className="font-display text-3xl tracking-tight">{formatMoney(dash.pendingSettlements, locale)}</p>
            <p className="text-sm text-muted-foreground">{t('toBeTransferred')}</p>
          </div>
        </section>
        <section className="flex items-center gap-4 rounded-3xl border bg-card p-5">
          <span className="grid size-11 place-items-center rounded-2xl bg-muted"><BarChart3 className="size-5" /></span>
          <div>
            <p className="text-sm text-muted-foreground">{t('marketingCommissions')}</p>
            <p className="font-display text-3xl tracking-tight">{formatMoney(dash.marketingCommissions, locale)}</p>
            <p className="text-sm text-muted-foreground">{t('thisMonth')}</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function RevenueChart({ series }: { series: AdminDashboard['revenueSeries'] }) {
  const values = series.map((point) => Number(point.amount));
  const max = Math.max(...values, 0);
  const ceiling = max > 0 ? max : 1;
  const width = 640;
  const height = 150;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - 16 - (value / ceiling) * (height - 32);
    return [x, y] as const;
  });
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const ticks = series.map((point, index) => ({ index, label: axisDate(point.date) })).filter((tick) => tick.index === 0 || tick.index === series.length - 1 || [4, 9, 14, 19].includes(tick.index));

  return (
    <div className="mt-4" dir="ltr">
      <div className="grid grid-cols-[40px_1fr] gap-2">
        <div className="flex h-36 flex-col justify-between text-[11px] text-muted-foreground">
          <span>{axisAmount(ceiling)}</span>
          <span>{axisAmount(ceiling / 2)}</span>
          <span>0</span>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className="h-36 w-full" role="img" aria-label="Platform revenue this month">
          {[16, height / 2, height - 16].map((y) => (
            <line key={y} x1="0" x2={width} y1={y} y2={y} stroke="#E2E2DC" strokeWidth="1" />
          ))}
          {path ? <path d={path} fill="none" stroke="#111111" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" /> : null}
          {points.map((point) => <circle key={point[0]} cx={point[0]} cy={point[1]} r="3.5" fill="#111111" />)}
          {last ? <circle cx={last[0]} cy={last[1]} r="6" fill="#FFC400" stroke="#111111" strokeWidth="2" /> : null}
        </svg>
      </div>
      <div className="ms-12 mt-2 flex justify-between text-[11px] text-muted-foreground">
        {ticks.map((tick) => <span key={tick.label + tick.index}>{tick.label}</span>)}
      </div>
    </div>
  );
}

function Forward() {
  return <ChevronRight className="size-4 rtl:rotate-180" />;
}

function Delta({ value, suffix }: { value: string | null; suffix?: string }) {
  if (!value) return null;
  const down = value.startsWith('-');
  return <span className={`text-sm font-semibold ${down ? 'text-[#D9342B]' : 'text-[#168A52]'}`}>{down ? '↓' : '↑'} {value}{suffix ? ` ${suffix}` : ''}</span>;
}

function AttentionRow({ href, icon, count, label, action }: { href: string; icon: React.ReactNode; count: number; label: string; action: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-2xl px-1 py-1 hover:bg-black/5">
      <span className="grid size-10 place-items-center rounded-full bg-white">{icon}</span>
      <span className="font-semibold">{count} {label}</span>
      <span className="ms-auto inline-flex items-center gap-1 text-sm font-semibold">{action} <Forward /></span>
    </Link>
  );
}

function LaneButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${active ? 'bg-[#111111] text-white' : 'bg-muted text-foreground'}`}>
      {children}
    </button>
  );
}

function StatusPill({ status, label }: { status: OrderStatus; label: string }) {
  const lane = laneOf(status);
  const tone = lane === 'preparing' ? 'bg-[#FFF4CC] text-[#8A6A00]' : lane === 'delivery' ? 'bg-[#E7F0FF] text-[#2563EB]' : 'bg-[#F1F1EE] text-[#3F3F3C]';
  const dot = lane === 'preparing' ? 'bg-[#FFC400]' : lane === 'delivery' ? 'bg-[#2563EB]' : 'bg-[#9A9A94]';
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}><span className={`size-1.5 rounded-full ${dot}`} />{label}</span>;
}

function HealthBar({ label, value, max, bar }: { label: string; value: number; max: number; bar: string }) {
  return (
    <div className="grid grid-cols-[72px_1fr_32px] items-center gap-3 text-sm">
      <span>{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-[#F1F1EE]">
        <span className={`block h-full rounded-full ${bar}`} style={{ width: `${value === 0 ? 0 : Math.max(8, (value / max) * 100)}%` }} />
      </span>
      <span className="text-end font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function ActionLink({ href, onClick, children }: { href: string; onClick: () => void; children: React.ReactNode }) {
  return <Link href={href} onClick={onClick} className="block rounded-xl px-3 py-2 text-sm font-semibold hover:bg-muted">{children}</Link>;
}

function laneOf(status: OrderStatus): 'new' | 'preparing' | 'delivery' {
  if (status === 'PREPARING' || status === 'READY_FOR_PICKUP') return 'preparing';
  if (status === 'ASSIGNED_TO_DRIVER' || status === 'OUT_FOR_DELIVERY') return 'delivery';
  return 'new';
}

function ago(iso: string, t: (key: 'justNow' | 'minutesAgo' | 'hoursAgo' | 'daysAgo', values?: { count: number }) => string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return t('justNow');
  if (minutes < 60) return t('minutesAgo', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('hoursAgo', { count: hours });
  return t('daysAgo', { count: Math.round(hours / 24) });
}

function axisDate(iso: string) {
  const [, month, day] = iso.split('-');
  return `${Number(day)} ${months[Number(month) - 1]}`;
}

function axisAmount(value: number) {
  if (value >= 1000) return `${Math.round(value / 100) / 10}K`;
  if (value >= 10) return String(Math.round(value));
  return value.toFixed(3);
}
