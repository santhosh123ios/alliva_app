import { api } from '@/components/providers';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { NAV, NotificationBell, allowedScreens, useConsole, useT } from '@alliva/marketing-console';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { useLocale } from 'use-intl';

export function PortalShell({ children }: { children: React.ReactNode }) {
  const { role, me } = useConsole();
  const t = useT();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const allowed = new Set(allowedScreens(role, me?.capabilities.headsSeeReports ?? true));
  const items = NAV[role].filter((item) => allowed.has(item.id));
  const initials = (me?.fullName ?? '').split(' ').map((part) => part[0] ?? '').join('').slice(0, 2).toUpperCase();
  const logout = () => api.logout().then(() => { client.clear(); router.replace('/login'); });

  return (
    <div className="min-h-screen bg-[#F6F5F0] text-[#171712] md:grid md:grid-cols-[248px_minmax(0,1fr)]">
      {open ? <button type="button" className="fixed inset-0 z-30 bg-black/40 md:hidden" aria-label={t('shellClose')} onClick={() => setOpen(false)} /> : null}
      <aside className={`${open ? 'flex' : 'hidden'} fixed inset-y-0 start-0 z-40 w-[248px] flex-col bg-[#171712] px-3 py-5 text-white md:sticky md:top-0 md:flex md:h-screen`}>
        <div className="flex items-center justify-between px-2">
          <Link href="/dashboard" aria-label="Alliva" onClick={() => setOpen(false)}>
            <span
              className="block h-7 w-28 bg-white"
              style={{
                WebkitMaskImage: 'url(/logo-on-light.png)',
                maskImage: 'url(/logo-on-light.png)',
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                WebkitMaskSize: 'contain',
                maskSize: 'contain',
                WebkitMaskPosition: 'left center',
                maskPosition: 'left center',
              }}
            />
          </Link>
          <button type="button" className="grid size-8 place-items-center rounded-lg text-white/70 md:hidden" onClick={() => setOpen(false)} aria-label={t('shellClose')}>
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-3 px-3 text-[11px] font-semibold tracking-[0.14em] text-white/45 uppercase">{role === 'HEAD' ? t('portalHead') : t('portalStaff')}</p>
        <nav className="mt-4 flex-1 space-y-1 overflow-y-auto" aria-label={t('shellMenu')}>
          {items.map((item) => {
            const href = `/${item.id}`;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.id}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${active ? 'bg-[#F5C518] text-[#171712]' : 'text-white/75 hover:bg-white/10'}`}
              >
                <Icon className="size-4" />
                {t(item.label)}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-[#E9E7DF] bg-white px-4 md:px-6">
          <button type="button" className="grid size-10 place-items-center rounded-xl border border-[#E9E7DF] md:hidden" onClick={() => setOpen(true)} aria-label={t('shellMenu')}>
            <Menu className="size-4" />
          </button>
          <div className="ms-auto flex items-center gap-2">
            <NotificationBell />
            <Link href={pathname} locale={locale === 'en' ? 'ar' : 'en'} className="grid h-10 min-w-10 place-items-center rounded-xl border border-[#E9E7DF] bg-white px-2 text-xs font-semibold">
              {locale === 'en' ? 'ع' : 'EN'}
            </Link>
            <span className="flex items-center gap-2 rounded-full py-1 pe-3 ps-1">
              <span className="grid size-9 place-items-center rounded-full bg-[#F5C518] text-xs font-bold">{initials}</span>
              <span className="hidden text-sm font-semibold sm:block">{me?.fullName}</span>
            </span>
            <button type="button" className="grid size-10 place-items-center rounded-xl border border-[#E9E7DF] bg-white" onClick={() => void logout()} aria-label={t('signOut')} title={t('signOut')}>
              <LogOut className="size-4" />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1280px] p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
