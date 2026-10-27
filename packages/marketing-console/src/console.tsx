import { EmptyState } from '@alliva/ui';
import {
  BarChart3, Bell, Building2, CalendarClock, ClipboardList, Footprints, LayoutGrid, Megaphone, Settings, Store, Ticket, UserCircle, UserRoundSearch, Users, Wallet, Percent, type LucideIcon,
} from 'lucide-react';
import { useConsole, type Role } from './context';
import { useT, type MessageKey } from './i18n';
import { AppointmentsScreen } from './screens/appointments';
import { DashboardScreen } from './screens/dashboard';
import { ActivityScreen, NotificationsScreen, ProfileScreen } from './screens/inbox';
import { LeadsScreen, VisitsScreen } from './screens/leads';
import { CommissionsScreen, WalletScreen, WalletsAdminScreen } from './screens/money';
import { PromosScreen } from './screens/promos';
import { ReportsScreen } from './screens/reports';
import { SettingsScreen } from './screens/settings';
import { StoresScreen } from './screens/stores';
import { MembersScreen } from './screens/team';

export type ScreenId =
  | 'dashboard' | 'heads' | 'staff' | 'leads' | 'visits' | 'appointments' | 'stores' | 'referral' | 'commissions'
  | 'wallet' | 'wallets' | 'reports' | 'settings' | 'notifications' | 'activity' | 'profile' | 'promos';

export type NavItem = { id: ScreenId; label: MessageKey; icon: LucideIcon };

/** Screens each role may open. The API enforces the same rules; this only decides what to show. */
export const NAV: Record<Role, NavItem[]> = {
  ADMIN: [
    { id: 'dashboard', label: 'navOverview', icon: LayoutGrid },
    { id: 'heads', label: 'navHeads', icon: Building2 },
    { id: 'staff', label: 'navStaff', icon: Users },
    { id: 'leads', label: 'navLeadsVisits', icon: UserRoundSearch },
    { id: 'appointments', label: 'navAppointments', icon: CalendarClock },
    { id: 'stores', label: 'navReferralTracking', icon: Store },
    { id: 'commissions', label: 'navCommissions', icon: Percent },
    { id: 'wallets', label: 'navReferralWallet', icon: Wallet },
    { id: 'promos', label: 'navPromos', icon: Ticket },
    { id: 'reports', label: 'navReports', icon: BarChart3 },
    { id: 'activity', label: 'navActivity', icon: ClipboardList },
    { id: 'settings', label: 'navSettings', icon: Settings },
  ],
  HEAD: [
    { id: 'dashboard', label: 'navDashboard', icon: LayoutGrid },
    { id: 'staff', label: 'navMyTeam', icon: Users },
    { id: 'leads', label: 'navTeamLeads', icon: UserRoundSearch },
    { id: 'visits', label: 'navTeamVisits', icon: Footprints },
    { id: 'stores', label: 'navTeamStores', icon: Store },
    { id: 'appointments', label: 'navAppointments', icon: CalendarClock },
    { id: 'activity', label: 'navTeamActivity', icon: Megaphone },
    { id: 'commissions', label: 'navMyCommission', icon: Percent },
    { id: 'wallet', label: 'navReferralWallet', icon: Wallet },
    { id: 'reports', label: 'navReports', icon: BarChart3 },
    { id: 'notifications', label: 'navNotifications', icon: Bell },
  ],
  STAFF: [
    { id: 'dashboard', label: 'navDashboard', icon: LayoutGrid },
    { id: 'leads', label: 'navMyLeads', icon: UserRoundSearch },
    { id: 'stores', label: 'navMyStores', icon: Store },
    { id: 'appointments', label: 'navAppointmentsFollowUps', icon: CalendarClock },
    { id: 'wallet', label: 'navReferralWallet', icon: Wallet },
    { id: 'notifications', label: 'navNotifications', icon: Bell },
    { id: 'profile', label: 'navProfile', icon: UserCircle },
  ],
};

export function allowedScreens(role: Role, headsSeeReports = true): ScreenId[] {
  return NAV[role].filter((item) => item.id !== 'reports' || role !== 'HEAD' || headsSeeReports).map((item) => item.id);
}

export function MarketingScreen({ id, params = {} }: { id: string; params?: Record<string, string> }) {
  const { role, me } = useConsole();
  const t = useT();
  let screen = id;
  if (role === 'STAFF' && screen === 'visits') screen = 'leads';
  if (role !== 'ADMIN' && screen === 'referral') screen = 'wallet';
  const allowed = allowedScreens(role, me?.capabilities.headsSeeReports ?? true);
  const extra: ScreenId[] = ['notifications', 'profile'];
  if (!(allowed.includes(screen as ScreenId) || (extra.includes(screen as ScreenId) && role !== 'ADMIN'))) {
    return <EmptyState title={t('notAvailableTitle')} body={t('notAvailableBody')} />;
  }
  switch (screen as ScreenId) {
    case 'dashboard': return <DashboardScreen />;
    case 'heads': return <MembersScreen kind="HEAD" />;
    case 'staff': return <MembersScreen kind="STAFF" />;
    case 'leads': return <LeadsScreen params={params} />;
    case 'visits': return <VisitsScreen />;
    case 'appointments': return <AppointmentsScreen params={params} />;
    case 'stores': return <StoresScreen params={params} />;
    case 'commissions': return <CommissionsScreen />;
    case 'wallet': return <WalletScreen />;
    case 'wallets': return <WalletsAdminScreen params={params} />;
    case 'reports': return <ReportsScreen />;
    case 'settings': return <SettingsScreen />;
    case 'notifications': return <NotificationsScreen />;
    case 'activity': return <ActivityScreen />;
    case 'profile': return <ProfileScreen />;
    case 'promos': return <PromosScreen />;
    default: return <EmptyState title={t('notAvailableTitle')} body={t('notAvailableBody')} />;
  }
}
