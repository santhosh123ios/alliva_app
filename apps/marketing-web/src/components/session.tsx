import { api } from '@/components/providers';
import { Loading } from '@/components/loading';
import { useRouter } from '@/i18n/navigation';
import { localizeHref } from '@/i18n/routing';
import { ApiError } from '@alliva/api-client';
import { ConsoleProvider, useT, type ConsoleContextValue, type Me } from '@alliva/marketing-console';
import { ErrorState } from '@alliva/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Navigate, Outlet } from 'react-router';
import { useLocale } from 'use-intl';

/** Sibling portals live on their own origin; local dev uses fixed ports (see README). */
function portalUrl(override: string | undefined, port: number) {
  if (override) return override.replace(/\/$/, '');
  const { protocol, hostname, origin } = window.location;
  return hostname === 'localhost' || hostname === '127.0.0.1' ? `${protocol}//${hostname}:${port}` : origin;
}

export function isMarketingUser(roles: string[]) {
  return roles.includes('MARKETING_HEAD') || roles.includes('MARKETING_STAFF');
}

/**
 * Gate for every signed-in page. Resolves the visitor's marketing profile (which decides the Head or Staff console)
 * and shares it with the screens. Anyone without a marketing profile is signed out.
 */
export function RequireMarketing() {
  const locale = useLocale();
  const client = useQueryClient();
  const router = useRouter();
  const t = useT();
  const auth = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const profile = useQuery({
    queryKey: ['mk', 'me'],
    queryFn: () => api.mk.get<Me>('/me'),
    enabled: Boolean(auth.data),
    retry: false,
  });

  const value = useMemo<ConsoleContextValue | null>(() => {
    if (!profile.data) return null;
    return {
      api,
      role: profile.data.kind,
      me: profile.data,
      navigate: (screen, params) => {
        const qs = params && Object.keys(params).length ? `?${new URLSearchParams(params).toString()}` : '';
        router.push(`/${screen}${qs}`);
      },
      registerUrl: `${portalUrl(import.meta.env.VITE_MERCHANT_URL, 3002)}/${locale}/register`,
      inviteUrl: `${portalUrl(import.meta.env.VITE_MARKETING_URL, 3003)}/${locale}/reset`,
    };
  }, [profile.data, router, locale]);

  if (auth.isLoading || (auth.data && profile.isLoading)) return <div className="p-6"><Loading /></div>;
  if (auth.isError || !auth.data) return <Navigate replace to={localizeHref('/login', locale)} />;
  if (profile.error instanceof ApiError && (profile.error.status === 404 || profile.error.status === 403)) {
    void api.logout().then(() => client.clear());
    return <Navigate replace to={localizeHref('/login?denied=1', locale)} />;
  }
  if (profile.error || !value) {
    return <div className="p-6"><ErrorState title={t('loadFailed')} body={(profile.error as Error | null)?.message ?? ''} /></div>;
  }
  return (
    <ConsoleProvider value={value}>
      <Outlet />
    </ConsoleProvider>
  );
}
