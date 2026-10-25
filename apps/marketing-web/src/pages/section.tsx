import { MarketingScreen } from '@alliva/marketing-console';
import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router';

/** Old portal addresses keep working. */
const aliases: Record<string, string> = { commission: 'commissions', 'follow-ups': 'appointments' };

export default function SectionPage() {
  const raw = useParams()['*']?.split('/').filter(Boolean)[0] || 'dashboard';
  const screen = aliases[raw] ?? raw;
  const [search] = useSearchParams();
  const params = useMemo(() => Object.fromEntries(search.entries()), [search]);
  return <MarketingScreen key={`${screen}?${search.toString()}`} id={screen} params={params} />;
}
