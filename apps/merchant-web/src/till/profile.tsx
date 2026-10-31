import { api } from '@/components/providers';
import { Link, useRouter } from '@/i18n/navigation';
import { canOpen, portalRole } from '@/lib/roles';
import { pickLocalized } from '@alliva/design-tokens';
import { cn, ErrorState, Skeleton } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Bell, Building2, Languages, LayoutDashboard, LogOut, Mail, Phone, Store } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { money, useTillBoard, useTillLocale, useTillSettings } from './shared';

type Branch = { id: string; name: { en?: string; ar?: string }; active?: boolean };

export default function TillProfile() {
  const t = useTranslations('till.profile');
  const locale = useTillLocale();
  const router = useRouter();
  const client = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const store = useQuery({ queryKey: ['merchant', 'business'], queryFn: () => api.profile(), retry: false, staleTime: 300_000 });
  const board = useTillBoard();
  const { branchId, setBranchId, sound, setSound } = useTillSettings();
  const logout = useMutation({
    mutationFn: () => api.logout(),
    onSettled: () => { client.clear(); router.replace('/login'); },
  });

  if (me.isLoading) return <div className="space-y-3"><Skeleton className="h-28 rounded-3xl" /><Skeleton className="h-40 rounded-3xl" /></div>;
  if (me.error || !me.data) return <ErrorState title={t('loadFailed')} body={(me.error as Error | null)?.message ?? ''} />;
  const user = me.data;
  const profile = store.data as { name?: { en?: string; ar?: string }; branches?: Branch[] } | undefined;
  const branches = (profile?.branches ?? []).filter((branch) => branch.active !== false);
  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();

  return (
    <div className="space-y-4">
      <section className="flex items-center gap-4 rounded-3xl bg-card p-5">
        <span className="grid size-16 shrink-0 place-items-center rounded-full bg-primary text-xl font-bold text-primary-foreground">{initials}</span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{user.firstName} {user.lastName}</h1>
          <p className="text-sm text-muted-foreground">{t(`roles.${portalRole(user)}`)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('today', { bills: board.data?.today.bills ?? 0, amount: money(board.data?.today.collected ?? 0, locale) })}</p>
        </div>
      </section>

      <section className="divide-y divide-border rounded-3xl bg-card">
        <Row icon={Store} label={t('store')} value={profile?.name ? pickLocalized(profile.name, locale) : '—'} />
        <Row icon={Phone} label={t('phone')} value={user.phone ?? '—'} ltr />
        <Row icon={Mail} label={t('email')} value={user.email ?? '—'} ltr />
      </section>

      {branches.length > 1 ? (
        <section className="rounded-3xl bg-card p-5">
          <label className="flex items-center gap-3" htmlFor="till-branch">
            <Building2 className="size-5 text-muted-foreground" />
            <span className="flex-1 font-semibold">{t('branch')}</span>
          </label>
          <select id="till-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)} className="mt-3 h-11 w-full rounded-xl border border-border bg-card px-3 text-sm font-semibold">
            <option value="">{t('allBranches')}</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{pickLocalized(branch.name, locale)}</option>)}
          </select>
        </section>
      ) : null}

      <section className="rounded-3xl bg-card p-5">
        <div className="flex items-center gap-4">
          <span className={cn('grid size-12 shrink-0 place-items-center rounded-2xl', sound ? 'bg-success-soft text-success' : 'bg-surface-2 text-subtle')}><Bell className="size-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('sound')}</p>
            <p className="text-xs text-muted-foreground">{t('soundHint')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={sound}
            aria-label={t('sound')}
            onClick={() => setSound(!sound)}
            className={cn('relative h-8 w-14 shrink-0 rounded-full transition-colors', sound ? 'bg-success' : 'bg-border-strong')}
          >
            <span className={cn('absolute top-1 size-6 rounded-full bg-card shadow transition-all', sound ? 'start-7' : 'start-1')} />
          </button>
        </div>
      </section>

      <section className="rounded-3xl bg-card p-5">
        <div className="flex items-center gap-3">
          <Languages className="size-5 text-muted-foreground" />
          <p className="flex-1 font-semibold">{t('language')}</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
          {(['en', 'ar'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={locale === value} onClick={() => router.replace('/billing/profile', { locale: value })} className={cn('h-10 rounded-lg text-sm font-semibold', locale === value ? 'bg-card shadow-sm' : 'text-muted-foreground')}>
              {value === 'en' ? 'English' : 'العربية'}
            </button>
          ))}
        </div>
      </section>

      {canOpen(user, 'dashboard') && portalRole(user) !== 'BILLING_STAFF' ? (
        <Link href="/dashboard" className="flex h-12 items-center gap-3 rounded-2xl bg-card px-5 text-sm font-semibold">
          <LayoutDashboard className="size-4" /><span className="flex-1">{t('workspace')}</span><ArrowRight className="size-4 rtl:-scale-x-100" />
        </Link>
      ) : null}

      <button type="button" disabled={logout.isPending} onClick={() => logout.mutate()} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-card text-sm font-semibold text-destructive disabled:opacity-50">
        <LogOut className="size-4 rtl:rotate-180" />{t('logout')}
      </button>
    </div>
  );
}

function Row({ icon: Icon, label, value, ltr }: { icon: typeof Store; label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <Icon className="size-5 shrink-0 text-subtle" />
      <span className="flex-1 text-sm text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium" dir={ltr ? 'ltr' : undefined}>{value}</span>
    </div>
  );
}
