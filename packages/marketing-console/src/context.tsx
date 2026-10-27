import type { ApiClient } from '@alliva/api-client';
import { createContext, useContext, type ReactNode } from 'react';

export type Role = 'ADMIN' | 'HEAD' | 'STAFF';

export type Me = {
  id: string;
  kind: 'HEAD' | 'STAFF';
  fullName: string;
  firstName: string;
  email: string | null;
  phone: string | null;
  employeeId: string | null;
  joinedAt: string;
  region: string | null;
  status: string;
  avatarUrl: string | null;
  referralCode: string | null;
  headName: string;
  headUserId: string | null;
  /** Personal override. Null means the platform default is in force. */
  commissionPercent: string | null;
  /** Rate that applies to the next payment, including the current platform default. */
  effectiveCommissionPercent: string;
  commissionIsDefault: boolean;
  capabilities: { headsCanReassignLeads: boolean; headsSeeReports: boolean; referralPrefix: string };
};

export type ConsoleContextValue = {
  api: ApiClient;
  role: Role;
  /** Marketing profile of the signed-in head/staff member. Platform admins have none. */
  me: Me | null;
  /** Moves to another console screen (the host app owns routing). */
  navigate: (screen: string, params?: Record<string, string>) => void;
  /** Public registration page that accepts `?ref=CODE` (merchant-web). */
  registerUrl: string;
  /** Page of the marketing portal where invited members set their password. */
  inviteUrl: string;
};

const Context = createContext<ConsoleContextValue | null>(null);

export function ConsoleProvider({ value, children }: { value: ConsoleContextValue; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useConsole() {
  const value = useContext(Context);
  if (!value) throw new Error('ConsoleProvider is missing');
  return value;
}
