import { api } from '@/components/providers';
import { Link } from '@/i18n/navigation';
import { Card } from '@/floor/home';
import { cn, ErrorState, Skeleton } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Banknote, CircleCheck, Receipt, Wallet } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { useNavigate } from 'react-router';
import { OpenBillCard } from './bills';
import { methodIcon, money, useNow, useTillBoard, useTillLocale } from './shared';
import { localizeHref } from '@/i18n/routing';

export default function TillHome() {
  const t = useTranslations('till.home');
  const tm = useTranslations('till.methods');
  const locale = useTillLocale();
  const board = useTillBoard();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const navigate = useNavigate();
  const now = useNow();

  if (board.isLoading) return <div className="space-y-3"><Skeleton className="h-24 rounded-3xl" /><Skeleton className="h-40 rounded-3xl" /><Skeleton className="h-40 rounded-3xl" /></div>;
  if (board.error && !board.data) return <ErrorState title={t('loadFailed')} body={(board.error as Error).message} />;
  const data = board.data!;
  const asking = data.open.filter((bill) => bill.requested);
  const ready = data.open.filter((bill) => !bill.requested && bill.served && Number(bill.due) > 0);
  const hour = new Date(now).getHours();
  const open = (key: string) => navigate(`${localizeHref('/billing/bills', locale)}?open=${encodeURIComponent(key)}`);
  const top = Math.max(...data.today.byMethod.map((row) => Number(row.amount)), 0);

  return (
    <div className="space-y-4">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">{t(hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening', { name: me.data?.firstName ?? '' })}</h1>
        <p className="mt-0.5 text-sm text-[#696965]">{data.open.length ? t('summaryBusy', { open: data.open.length, due: money(data.today.due, locale) }) : t('summaryQuiet')}</p>
      </section>

      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label={t('stats.collected')} value={money(data.today.collected, locale)} detail={t('stats.bills', { count: data.today.bills })} tone="good" />
        <Stat label={t('stats.due')} value={money(data.today.due, locale)} detail={t('stats.open', { count: data.open.length })} />
        <Stat label={t('stats.asking')} value={String(asking.length)} tone={asking.length ? 'alert' : 'plain'} />
        <Link href="/billing/cash" className="block">
          <Stat label={t('stats.drawer')} value={data.drawer ? money(data.drawer.expected, locale) : t('stats.drawerClosed')} detail={data.drawer ? t('stats.drawerOpen') : t('stats.openDrawer')} tone={data.drawer ? 'plain' : 'warn'} />
        </Link>
      </section>

      {!data.drawer ? (
        <Link href="/billing/cash" className="flex items-center gap-3 rounded-3xl bg-[#FFF8DC] px-5 py-4">
          <Wallet className="size-5 shrink-0 text-[#8A5A00]" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('drawerTitle')}</p>
            <p className="text-xs text-[#6B4A00]">{t('drawerBody')}</p>
          </div>
          <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" />
        </Link>
      ) : null}

      <Card title={t('askingTitle')} icon={Receipt} count={asking.length}>
        {asking.length ? <div className="grid gap-2 px-3 pb-3 md:grid-cols-2">{asking.map((bill) => <OpenBillCard key={bill.key} bill={bill} inset onOpen={() => open(bill.key)} />)}</div> : <Empty text={t('noAsking')} />}
      </Card>

      <Card title={t('readyTitle')} icon={CircleCheck} count={ready.length} action={<Link href="/billing/bills" className="inline-flex items-center gap-1 text-xs font-semibold text-[#2F6FED]">{t('allBills')}<ArrowRight className="size-3.5 rtl:-scale-x-100" /></Link>}>
        {ready.length ? <div className="grid gap-2 px-3 pb-3 md:grid-cols-2">{ready.map((bill) => <OpenBillCard key={bill.key} bill={bill} inset onOpen={() => open(bill.key)} />)}</div> : <Empty text={t('noReady')} />}
      </Card>

      <Card title={t('methodsTitle')} icon={Banknote}>
        {data.today.byMethod.length ? (
          <ul className="space-y-3 px-5 pb-5 pt-1">
            {data.today.byMethod.map((row) => {
              const Icon = methodIcon[row.method];
              return (
                <li key={row.method}>
                  <div className="flex items-center gap-2 text-sm">
                    <Icon className="size-4 text-[#696965]" />
                    <span className="flex-1 font-medium">{tm(row.method)}</span>
                    <span className="text-xs text-[#696965]">{t('stats.bills', { count: row.bills })}</span>
                    <span className="w-24 text-end font-semibold tabular-nums">{money(row.amount, locale)}</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#F0F0EC]">
                    <div className="h-full rounded-full bg-[#111111]" style={{ width: `${top ? Math.max(4, (Number(row.amount) / top) * 100) : 0}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <Empty text={t('noPayments')} />}
      </Card>
    </div>
  );
}

function Stat({ label, value, detail, tone = 'plain' }: { label: string; value: string; detail?: string; tone?: 'plain' | 'alert' | 'good' | 'warn' }) {
  return (
    <div className={cn('h-full rounded-2xl p-3.5', tone === 'alert' ? 'bg-[#B42318] text-white' : tone === 'good' ? 'bg-[#E3F5EA]' : tone === 'warn' ? 'bg-[#FFF8DC]' : 'bg-white')}>
      <p className={cn('text-xs font-medium', tone === 'alert' ? 'text-white/80' : 'text-[#696965]')}>{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tabular-nums">{value}</p>
      {detail ? <p className={cn('text-xs', tone === 'alert' ? 'text-white/80' : 'text-[#696965]')}>{detail}</p> : null}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-5 pb-5 pt-1 text-sm text-[#8A8A86]">{text}</p>;
}
