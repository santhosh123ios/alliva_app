import { api } from '@/components/providers';
import { useRouter } from '@/i18n/navigation';
import { ConsoleProvider, MarketingScreen, type ConsoleContextValue } from '@alliva/marketing-console';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useLocale } from 'use-intl';

/** Sibling portals live on their own origin; local dev uses fixed ports (see README). */
export function portalUrl(override: string | undefined, port: number) {
  if (override) return override.replace(/\/$/, '');
  const { protocol, hostname, origin } = window.location;
  return hostname === 'localhost' || hostname === '127.0.0.1' ? `${protocol}//${hostname}:${port}` : origin;
}

/** Mounts one screen of the shared marketing console with platform-admin rights. */
export function MarketingHost({ screen }: { screen: string }) {
  const router = useRouter();
  const locale = useLocale();
  const [search] = useSearchParams();
  const params = useMemo(() => Object.fromEntries(search.entries()), [search]);
  const value = useMemo<ConsoleContextValue>(() => ({
    api,
    role: 'ADMIN',
    me: null,
    navigate: (target, query) => {
      const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query).toString()}` : '';
      router.push(`/marketing/${target}${qs}`);
    },
    registerUrl: `${portalUrl(import.meta.env.VITE_MERCHANT_URL, 3002)}/${locale}/register`,
    inviteUrl: `${portalUrl(import.meta.env.VITE_MARKETING_URL, 3003)}/${locale}/reset`,
  }), [router, locale]);
  return (
    <ConsoleProvider value={value}>
      <MarketingScreen key={`${screen}?${search.toString()}`} id={screen} params={params} />
    </ConsoleProvider>
  );
}
