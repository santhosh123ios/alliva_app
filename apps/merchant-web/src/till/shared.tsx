import { chime } from '@/components/order-alerts';
import { api } from '@/components/providers';
import { read, write } from '@/floor/shared';
import { tableNo } from '@/lib/table-number';
import { pickLocalized } from '@alliva/design-tokens';
import type { BillingBoard, BillMethod, BillOrder, LocalizedText, OpenBill, PaidBill } from '@alliva/types';
import { cn, toast } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { Banknote, CreditCard, Globe, QrCode } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';

import { useFloorLocale as useTillLocale } from '@/floor/shared';
import type { Store } from './print';

export { money, useAge, useNow, type Locale } from '@/floor/shared';
export { useTillLocale };
export { tableNo };

const SOUND_KEY = 'alliva.till.sound';
const BRANCH_KEY = 'alliva.till.branch';

type Settings = { branchId: string; setBranchId: (id: string) => void; sound: boolean; setSound: (on: boolean) => void };
const SettingsContext = createContext<Settings>({ branchId: '', setBranchId: () => undefined, sound: true, setSound: () => undefined });

export function useTillSettings() {
  return useContext(SettingsContext);
}

export function TillProvider({ children }: { children: React.ReactNode }) {
  const [branchId, setBranch] = useState(() => read(BRANCH_KEY) ?? '');
  const [sound, setSoundState] = useState(() => read(SOUND_KEY) !== 'off');
  const value = useMemo<Settings>(() => ({
    branchId,
    setBranchId: (id) => { setBranch(id); write(BRANCH_KEY, id); },
    sound,
    setSound: (on) => { setSoundState(on); write(SOUND_KEY, on ? 'on' : 'off'); },
  }), [branchId, sound]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export const tillKey = (branchId: string) => ['merchant', 'billing', 'board', branchId] as const;

export function useTillBoard() {
  const { branchId } = useTillSettings();
  return useQuery({
    queryKey: tillKey(branchId),
    queryFn: () => api.billing(branchId || undefined),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

/** Rings and buzzes when a table asks for the bill. Opening the app sets the baseline quietly. */
export function useTillAlerts(board: BillingBoard | undefined) {
  const t = useTranslations('till.alerts');
  const { sound } = useTillSettings();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!board) return;
    const ids = new Set(board.requests.map((row) => row.id));
    if (seen.current) {
      const fresh = board.requests.filter((row) => !seen.current!.has(row.id));
      for (const call of fresh) toast(t('billRequested', { table: tableNo(call.table.number) }));
      if (fresh.length) {
        if (sound) chime(0.7);
        if ('vibrate' in navigator) navigator.vibrate?.([200, 90, 200]);
      }
    }
    seen.current = ids;
  }, [board, sound, t]);
}

export const methodIcon: Record<BillMethod, typeof Banknote> = { CASH: Banknote, CARD: CreditCard, BENEFIT_PAY: QrCode, ONLINE: Globe };

export function MethodPill({ method, className }: { method: BillMethod; className?: string }) {
  const t = useTranslations('till.methods');
  const Icon = methodIcon[method];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[#F0F0EC] px-2.5 py-1 text-xs font-semibold text-[#4A4A46]', className)}>
      <Icon className="size-3.5" />{t(method)}
    </span>
  );
}

/** "Table 4", or the counter guest's name. */
export function useBillTitle() {
  const t = useTranslations('till');
  return (bill: Pick<OpenBill, 'table' | 'customerName' | 'orders'> | PaidBill) => {
    if (bill.table) return t('tableNumber', { table: tableNo(bill.table.number) });
    const name = 'customerName' in bill ? bill.customerName : null;
    return name ? t('counterNamed', { name }) : t('counter');
  };
}

export function itemCount(orders: BillOrder[]) {
  return orders.reduce((total, order) => total + order.items.reduce((sum, item) => sum + item.quantity, 0), 0);
}

/** Round amounts a guest is likely to hand over for a bill, smallest first. */
export function cashSuggestions(due: number) {
  const steps = [1, 5, 10, 20, 50];
  const values = new Set<number>([Math.round(due * 1000) / 1000]);
  for (const step of steps) {
    const next = Math.ceil(due / step) * step;
    if (next > due) values.add(next);
  }
  return [...values].sort((a, b) => a - b).slice(0, 4);
}

type Profile = { name?: LocalizedText; phone?: string | null; branches?: { id: string; name: LocalizedText; line1?: string; city?: string; phone?: string | null; active?: boolean }[] };

/** The store's name, address and phone as they go on a printed bill, for the branch the till is set to. */
export function useStoreHeader(): Store {
  const { branchId } = useTillSettings();
  const locale = useTillLocale();
  const profile = useQuery({ queryKey: ['merchant', 'business'], queryFn: () => api.profile(), retry: false, staleTime: 300_000 });
  const data = profile.data as Profile | undefined;
  const branches = (data?.branches ?? []).filter((row) => row.active !== false);
  const branch = branches.find((row) => row.id === branchId) ?? (branches.length === 1 ? branches[0] : undefined);
  return {
    name: data?.name ? pickLocalized(data.name, locale) : '',
    phone: branch?.phone || data?.phone || null,
    address: branch ? [branch.line1, branch.city].filter(Boolean).join(', ') : null,
  };
}
