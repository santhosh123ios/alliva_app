import { localizeHref } from '@/i18n/routing';
import { MarketingScreen, useConsole } from '@alliva/marketing-console';
import { useMemo } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router';
import { useLocale } from 'use-intl';

/** Old portal addresses keep working. */
const aliases: Record<string, string> = { commission: 'commissions', 'follow-ups': 'appointments' };

export default function SectionPage() {
  const { role } = useConsole();
  const locale = useLocale();
  const raw = useParams()['*']?.split('/').filter(Boolean)[0] || 'dashboard';
  const screen = aliases[raw] ?? raw;
  const [search] = useSearchParams();
  const params = useMemo(() => Object.fromEntries(search.entries()), [search]);
  if (role !== 'ADMIN' && screen === 'referral') {
    const qs = search.toString();
    return <Navigate to={localizeHref(`/wallet${qs ? `?${qs}` : ''}`, locale)} replace />;
  }
  return <MarketingScreen key={`${screen}?${search.toString()}`} id={screen} params={params} />;
}
