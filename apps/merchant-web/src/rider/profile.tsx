import { api } from '@/components/providers';
import { useRouter } from '@/i18n/navigation';
import { pickLocalized } from '@alliva/design-tokens';
import { cn, ErrorState, Skeleton, toast } from '@alliva/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bike, Languages, LogOut, Mail, Phone, Power, Store } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { riderKeys, timeLabel, useRiderLocale, useRiderPoint, useRiderProfile } from './shared';

export default function RiderProfile() {
  const t = useTranslations('rider.profile');
  const ts = useTranslations('rider.shift');
  const locale = useRiderLocale();
  const router = useRouter();
  const client = useQueryClient();
  const profile = useRiderProfile();
  const { point } = useRiderPoint();
  const shift = useMutation({
    mutationFn: (onShift: boolean) => api.rider.setShift({ onShift, ...(point ?? {}) }),
    onSuccess: (next) => {
      client.setQueryData(riderKeys.me, next);
      toast.success(next.onShift ? ts('started') : ts('ended'));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const logout = useMutation({
    mutationFn: () => api.logout(),
    onSettled: () => { client.clear(); router.replace('/login'); },
  });

  if (profile.isLoading) return <div className="space-y-3"><Skeleton className="h-36 rounded-3xl" /><Skeleton className="h-20 rounded-3xl" /><Skeleton className="h-40 rounded-3xl" /></div>;
  if (profile.error || !profile.data) return <ErrorState title={t('loadFailed')} body={(profile.error as Error | null)?.message ?? ''} />;
  const me = profile.data;
  const initials = `${me.firstName[0] ?? ''}${me.lastName[0] ?? ''}`.toUpperCase();

  return (
    <div className="space-y-4">
      <section className="flex items-center gap-4 rounded-3xl bg-white p-5">
        <span className="grid size-16 shrink-0 place-items-center rounded-full bg-[#FFC400] text-xl font-bold text-[#111111]">{initials}</span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{me.firstName} {me.lastName}</h1>
          <p className="text-sm text-[#696965]">{t('role')}</p>
          <p className="mt-1 text-xs text-[#696965]">{t('today', { delivered: me.deliveredToday, active: me.activeOrders })}</p>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-5">
        <div className="flex items-center gap-4">
          <span className={cn('grid size-12 shrink-0 place-items-center rounded-2xl', me.onShift ? 'bg-[#E3F5EA] text-[#168A52]' : 'bg-[#F0F0EC] text-[#8A8A86]')}><Power className="size-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{me.onShift ? ts('on') : ts('off')}</p>
            <p className="text-xs text-[#696965]">{me.onShift && me.shiftStartedAt ? ts('since', { time: timeLabel(me.shiftStartedAt, locale) }) : ts('offHint')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={me.onShift}
            aria-label={ts('toggle')}
            disabled={shift.isPending}
            onClick={() => shift.mutate(!me.onShift)}
            className={cn('relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50', me.onShift ? 'bg-[#168A52]' : 'bg-[#D4D4CE]')}
          >
            <span className={cn('absolute top-1 size-6 rounded-full bg-white shadow transition-all', me.onShift ? 'start-7' : 'start-1')} />
          </button>
        </div>
      </section>

      <section className="divide-y divide-[#F0F0EC] rounded-3xl bg-white">
        <Row icon={Store} label={t('store')} value={me.store ? pickLocalized(me.store.name, locale) : '—'} />
        <Row icon={Phone} label={t('phone')} value={me.phone ?? '—'} ltr />
        <Row icon={Mail} label={t('email')} value={me.email ?? '—'} ltr />
        <Row icon={Bike} label={t('vehicle')} value={me.vehicle ?? '—'} />
      </section>

      <section className="rounded-3xl bg-white p-5">
        <div className="flex items-center gap-3">
          <Languages className="size-5 text-[#696965]" />
          <p className="flex-1 font-semibold">{t('language')}</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-[#F2F2EF] p-1">
          {(['en', 'ar'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={locale === value}
              onClick={() => router.replace('/rider/profile', { locale: value })}
              className={cn('h-10 rounded-lg text-sm font-semibold', locale === value ? 'bg-white shadow-sm' : 'text-[#696965]')}
            >
              {value === 'en' ? 'English' : 'العربية'}
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#F3C9C5] bg-white text-sm font-semibold text-[#B42318] disabled:opacity-50"
      >
        <LogOut className="size-4 rtl:rotate-180" />{t('logout')}
      </button>
    </div>
  );
}

function Row({ icon: Icon, label, value, ltr }: { icon: typeof Store; label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <Icon className="size-5 shrink-0 text-[#8A8A86]" />
      <span className="flex-1 text-sm text-[#696965]">{label}</span>
      <span className="truncate text-sm font-medium" dir={ltr ? 'ltr' : undefined}>{value}</span>
    </div>
  );
}
