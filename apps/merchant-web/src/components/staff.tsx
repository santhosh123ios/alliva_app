'use client';

import { api } from '@/components/providers';
import { pickLocalized } from '@alliva/design-tokens';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@alliva/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bike, ChefHat, ChevronDown, ChevronRight, CirclePause, ClipboardList, CreditCard, Crown, Lock, MoreHorizontal, Plus, Search, Send, Settings, Users, type LucideIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';

export type StaffRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  roles: string[];
};

type Branch = { id: string; name: { en?: string; ar?: string } };
type Tab = 'all' | 'active' | 'invited' | 'suspended';
type RoleKey = 'MERCHANT_OWNER' | 'MERCHANT_MANAGER' | 'ORDER_TAKING_STAFF' | 'KITCHEN_STAFF' | 'BILLING_STAFF' | 'DELIVERY_STAFF' | 'REPORT_VIEWER';
type AccessKey = 'accessFull' | 'accessOrders' | 'accessKitchen' | 'accessBilling' | 'accessDeliveries' | 'accessReports';

const jobRoles: { key: RoleKey; icon: LucideIcon; bg: string; fg: string; access: AccessKey }[] = [
  { key: 'MERCHANT_MANAGER', icon: Crown, bg: 'bg-[#FFF6D4]', fg: 'text-[#161616]', access: 'accessFull' },
  { key: 'ORDER_TAKING_STAFF', icon: ClipboardList, bg: 'bg-[#F3E8FF]', fg: 'text-[#7C3AED]', access: 'accessOrders' },
  { key: 'KITCHEN_STAFF', icon: ChefHat, bg: 'bg-[#FFF1E6]', fg: 'text-[#E07A2F]', access: 'accessKitchen' },
  { key: 'BILLING_STAFF', icon: CreditCard, bg: 'bg-[#E7F8EE]', fg: 'text-[#16924A]', access: 'accessBilling' },
  { key: 'DELIVERY_STAFF', icon: Bike, bg: 'bg-[#E8F0FE]', fg: 'text-[#3B6FE8]', access: 'accessDeliveries' },
];

const roleAccess: Record<string, AccessKey> = {
  MERCHANT_OWNER: 'accessFull',
  MERCHANT_MANAGER: 'accessFull',
  ORDER_TAKING_STAFF: 'accessOrders',
  KITCHEN_STAFF: 'accessKitchen',
  BILLING_STAFF: 'accessBilling',
  DELIVERY_STAFF: 'accessDeliveries',
  REPORT_VIEWER: 'accessReports',
};

const avatarTones = [
  'bg-[#FDE8EA] text-[#E11D48]',
  'bg-[#E8F0FE] text-[#3B6FE8]',
  'bg-[#F3E8FF] text-[#7C3AED]',
  'bg-[#E7F8EE] text-[#16924A]',
  'bg-[#FFF4D6] text-[#C47D00]',
  'bg-[#FDE8F2] text-[#DB2777]',
];

const inviteRoles: RoleKey[] = ['MERCHANT_MANAGER', 'ORDER_TAKING_STAFF', 'KITCHEN_STAFF', 'BILLING_STAFF', 'DELIVERY_STAFF', 'REPORT_VIEWER'];

export function StaffPage({ rows }: { rows: StaffRow[] }) {
  const t = useTranslations('merchantStaff');
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');
  const [branchId, setBranchId] = useState('all');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [menu, setMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    void api.profile().then((profile) => {
      if (!active) return;
      const next = ((profile as { branches?: Branch[] }).branches ?? []).filter((branch) => branch?.id);
      setBranches(next);
      setBranchId((current) => (current === 'all' && next[0] ? next[0].id : current));
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest('[data-staff-menu]')) return;
      setMenu(null);
    };
    const closeMenu = () => setMenu(null);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [menu]);

  const counts = useMemo(() => ({
    all: rows.length,
    active: rows.filter((row) => row.status === 'ACTIVE').length,
    invited: rows.filter((row) => row.status === 'PENDING_ACTIVATION').length,
    suspended: rows.filter((row) => row.status === 'SUSPENDED').length,
  }), [rows]);

  const visible = rows.filter((row) => {
    if (tab === 'active' && row.status !== 'ACTIVE') return false;
    if (tab === 'invited' && row.status !== 'PENDING_ACTIVATION') return false;
    if (tab === 'suspended' && row.status !== 'SUSPENDED') return false;
    if (role !== 'all' && !row.roles.includes(role)) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    const roleName = row.roles.map((key) => roleLabel(t, key)).join(' ');
    return `${row.firstName} ${row.lastName} ${row.email} ${roleName}`.toLowerCase().includes(needle);
  });

  const selectedBranch = branches.find((branch) => branch.id === branchId);
  const branchName = selectedBranch
    ? pickLocalized(selectedBranch.name, locale)
    : branches.length === 1
      ? pickLocalized(branches[0].name, locale)
      : branches.length > 1
        ? t('allBranches')
        : '—';

  const statusChange = useMutation({
    mutationFn: (input: { id: string; action: 'suspend' | 'activate' }) => (
      input.action === 'suspend' ? api.suspendStaff(input.id) : api.activateStaff(input.id)
    ),
    onSuccess: () => {
      setNotice('');
      setMenu(null);
      void client.invalidateQueries({ queryKey: ['merchant', 'staff'] });
    },
    onError: (error: Error) => setNotice(error.message),
  });

  function openMenu(event: MouseEvent<HTMLButtonElement>, id: string) {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 160;
    const left = locale === 'ar' ? rect.left : Math.max(8, rect.right - width);
    setMenu(menu?.id === id ? null : { id, top: rect.bottom + 6, left });
  }

  const menuRow = rows.find((row) => row.id === menu?.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <section className="inline-grid w-fit grid-cols-2 overflow-hidden rounded-xl border border-[#EEEEEC] bg-white shadow-[0_4px_16px_rgba(17,17,17,0.04)] sm:grid-cols-4">
          <Stat label={t('team')} value={counts.all} marker={<Users className="size-3.5 text-[#8A8A86]" />} />
          <Stat label={t('active')} value={counts.active} marker={<span className="size-2 rounded-full bg-[#22A85A]" />} />
          <Stat label={t('invited')} value={counts.invited} marker={<Send className="size-3.5 text-[#3B6FE8]" />} />
          <Stat label={t('suspended')} value={counts.suspended} marker={<CirclePause className="size-3.5 text-[#E5484D]" />} />
        </section>
        <div className="flex flex-wrap gap-2">
          <OutlineButton onClick={() => setRolesOpen(true)}><Settings className="size-4" /> {t('manageRoles')}</OutlineButton>
          <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" onClick={() => setInviteOpen(true)}>
            <Plus className="size-4" /> {t('invite')}
          </Button>
        </div>
      </div>

      {notice ? <p className="text-sm font-medium text-[#B42318]">{notice}</p> : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-[#EEEEEC] bg-white shadow-[0_8px_24px_rgba(17,17,17,0.04)]">
          <div className="flex gap-6 border-b border-[#EEEEEC] px-5 pt-4">
            <TabButton active={tab === 'all'} onClick={() => setTab('all')}>{t('all')}</TabButton>
            <TabButton active={tab === 'active'} onClick={() => setTab('active')}>{t('active')}</TabButton>
            <TabButton active={tab === 'invited'} onClick={() => setTab('invited')}>{t('invited')}</TabButton>
            <TabButton active={tab === 'suspended'} onClick={() => setTab('suspended')}>{t('suspended')}</TabButton>
          </div>
          <div className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[#8A8A86]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('search')}
                className="h-11 w-full rounded-xl border border-[#E6E6E2] bg-white ps-9 pe-3 text-sm outline-none focus:ring-2 focus:ring-[#FFC400]"
              />
            </label>
            <FilterSelect label={t('allRoles')} value={role} onChange={setRole}>
              <option value="all">{t('allRoles')}</option>
              {inviteRoles.map((key) => <option key={key} value={key}>{t(key)}</option>)}
              <option value="MERCHANT_OWNER">{t('MERCHANT_OWNER')}</option>
            </FilterSelect>
            {branches.length ? (
              <FilterSelect label={t('branch')} value={branchId} onChange={setBranchId}>
                <option value="all">{t('allBranches')}</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{pickLocalized(branch.name, locale)}</option>)}
              </FilterSelect>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-y border-[#F1F1EE] text-start text-xs font-medium text-[#8A8A86]">
                  <th className="px-5 py-3 text-start font-medium">{t('member')}</th>
                  <th className="px-3 py-3 text-start font-medium">{t('role')}</th>
                  <th className="px-3 py-3 text-start font-medium">{t('branch')}</th>
                  <th className="px-3 py-3 text-start font-medium">{t('access')}</th>
                  <th className="px-3 py-3 text-start font-medium">{t('status')}</th>
                  <th className="px-4 py-3 text-end font-medium">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.length ? visible.map((row, index) => {
                  const name = `${row.firstName} ${row.lastName}`.trim();
                  const roleKey = row.roles[0] ?? '';
                  return (
                    <tr key={row.id} className="border-b border-[#F4F4F2] last:border-0">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <span className={`grid size-9 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${avatarTones[index % avatarTones.length]}`}>{initials(row)}</span>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-[#161616]">{name}</span>
                            <span className="block truncate text-xs text-[#8A8A86]">{row.email}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3.5 text-[#161616]">{roleLabel(t, roleKey)}</td>
                      <td className="px-3 py-3.5 text-[#161616]">{branchName}</td>
                      <td className="px-3 py-3.5 text-[#5C5C57]">{t(roleAccess[roleKey] ?? 'accessReports')}</td>
                      <td className="px-3 py-3.5"><StatusBadge status={row.status} /></td>
                      <td className="px-4 py-3.5 text-end">
                        <button
                          type="button"
                          data-staff-menu
                          className="grid size-8 place-items-center rounded-lg text-[#8A8A86] hover:bg-[#F7F7F5]"
                          aria-label={t('more', { name })}
                          onClick={(event) => openMenu(event, row.id)}
                        >
                          <MoreHorizontal className="size-4" />
                        </button>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center">
                      <p className="font-semibold text-[#161616]">{rows.length ? t('noMatch') : t('empty')}</p>
                      {rows.length ? null : <p className="mt-1 text-sm text-[#8A8A86]">{t('emptyBody')}</p>}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="rounded-2xl border border-[#EEEEEC] bg-white p-4 shadow-[0_8px_24px_rgba(17,17,17,0.04)]">
          <h2 className="text-base font-semibold text-[#161616]">{t('rolesTitle')}</h2>
          <p className="mt-1 text-xs leading-5 text-[#8A8A86]">{t('rolesHint')}</p>
          <button type="button" onClick={() => setRolesOpen(true)} className="mt-4 flex w-full items-center gap-3 rounded-xl bg-[#FFF6D4] px-3 py-3 text-start">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#FFE58A] text-[#161616]"><Lock className="size-4" /></span>
            <span className="min-w-0 flex-1 text-[13px] font-semibold leading-5 text-[#161616]">{t('accessBanner')}</span>
            <ChevronRight className="size-4 shrink-0 text-[#161616] rtl:-scale-x-100" />
          </button>
          <div className="mt-3 divide-y divide-[#F4F4F2]">
            {jobRoles.map((job) => {
              const Icon = job.icon;
              const members = rows.filter((row) => row.roles.includes(job.key)).length;
              const selected = role === job.key;
              return (
                <button
                  key={job.key}
                  type="button"
                  onClick={() => setRole(selected ? 'all' : job.key)}
                  className={`flex w-full items-center gap-3 px-1 py-3 text-start ${selected ? 'bg-[#FFFBEA]' : 'hover:bg-[#FAFAF8]'}`}
                >
                  <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${job.bg} ${job.fg}`}><Icon className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[#161616]">{t(job.key)}</span>
                    <span className="block text-xs text-[#8A8A86]">{members === 1 ? t('oneMember') : t('manyMembers', { count: members })}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-[#C8C8C4] rtl:-scale-x-100" />
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => setRolesOpen(true)} className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#E6E6E2] bg-white text-sm font-semibold text-[#161616]">
            <Settings className="size-4" /> {t('editPermissions')}
          </button>
        </aside>
      </div>

      {menu && menuRow ? (
        <div data-staff-menu className="fixed z-30 w-40 rounded-xl border border-[#EEEEEC] bg-white p-1 shadow-lg" style={{ top: menu.top, left: menu.left }}>
          {menuRow.status === 'SUSPENDED' || menuRow.status === 'PENDING_ACTIVATION' ? (
            <MenuItem onClick={() => statusChange.mutate({ id: menuRow.id, action: 'activate' })}>{t('activate')}</MenuItem>
          ) : (
            <MenuItem onClick={() => statusChange.mutate({ id: menuRow.id, action: 'suspend' })}>{t('suspend')}</MenuItem>
          )}
        </div>
      ) : null}

      <RolesDialog open={rolesOpen} onOpenChange={setRolesOpen} onInvite={() => { setRolesOpen(false); setInviteOpen(true); }} />
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}

function RolesDialog({ open, onOpenChange, onInvite }: { open: boolean; onOpenChange: (open: boolean) => void; onInvite: () => void }) {
  const t = useTranslations('merchantStaff');
  const listed = [
    { key: 'MERCHANT_MANAGER' as const, access: 'accessFull' as const },
    ...jobRoles.filter((job) => job.key !== 'MERCHANT_MANAGER').map((job) => ({ key: job.key, access: job.access })),
    { key: 'REPORT_VIEWER' as const, access: 'accessReports' as const },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t('permissionsTitle')}</DialogTitle>
        <DialogDescription>{t('permissionsHint')}</DialogDescription>
        <ul className="mt-4 divide-y divide-[#F4F4F2] rounded-xl border border-[#EEEEEC]">
          {listed.map((job) => (
            <li key={job.key} className="flex items-center justify-between gap-3 px-3 py-3">
              <span className="text-sm font-semibold text-[#161616]">{t(job.key)}</span>
              <span className="text-xs font-medium text-[#8A8A86]">{t(job.access)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('close')}</Button>
          <Button variant="yellow" onClick={onInvite}>{t('invite')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('merchantStaff');
  const client = useQueryClient();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', roleKey: 'ORDER_TAKING_STAFF' });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function save() {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim() || form.password.length < 8) {
      setError(t('required'));
      return;
    }
    setPending(true);
    setError('');
    try {
      await api.createStaff(form);
      await client.invalidateQueries({ queryKey: ['merchant', 'staff'] });
      setForm({ firstName: '', lastName: '', email: '', password: '', roleKey: 'ORDER_TAKING_STAFF' });
      onOpenChange(false);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t('invite')}</DialogTitle>
        <DialogDescription>{t('subtitle')}</DialogDescription>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={t('firstName')} value={form.firstName} onChange={(firstName) => setForm({ ...form, firstName })} />
          <Field label={t('lastName')} value={form.lastName} onChange={(lastName) => setForm({ ...form, lastName })} />
          <Field label={t('email')} value={form.email} onChange={(email) => setForm({ ...form, email })} type="email" />
          <Field label={t('password')} value={form.password} onChange={(password) => setForm({ ...form, password })} type="password" />
          <label className="block text-sm font-semibold text-[#161616] sm:col-span-2">
            {t('role')}
            <select value={form.roleKey} onChange={(event) => setForm({ ...form, roleKey: event.target.value })} className="mt-1.5 h-11 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm font-medium outline-none">
              {inviteRoles.map((key) => <option key={key} value={key}>{t(key)}</option>)}
            </select>
          </label>
        </div>
        {error ? <p className="mt-3 text-sm font-medium text-[#B42318]">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button variant="yellow" disabled={pending} onClick={save}>{t('save')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, marker }: { label: string; value: number; marker: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-[#EEEEEC] px-2.5 py-1.5 odd:border-e even:border-b sm:border-b-0 sm:border-e sm:last:border-e-0">
      <span className="grid size-6 place-items-center rounded-full bg-[#F7F7F5]">{marker}</span>
      <div className="leading-tight">
        <p className="text-[10px] text-[#8A8A86]">{label}</p>
        <p className="text-sm font-semibold text-[#161616]">{value}</p>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`relative pb-3 text-sm font-semibold ${active ? 'text-[#161616]' : 'text-[#8A8A86]'}`}>
      {children}
      {active ? <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[#FFC400]" /> : null}
    </button>
  );
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <label className="relative inline-flex h-11 w-full items-center lg:w-40">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full appearance-none rounded-xl border border-[#E6E6E2] bg-white px-3 pe-8 text-sm font-medium text-[#161616] outline-none">
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute end-3 size-4 text-[#8A8A86]" />
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('merchantStaff');
  if (status === 'PENDING_ACTIVATION') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8F0FE] px-2.5 py-1 text-xs font-semibold text-[#2F6FED]">
        <Send className="size-3" /> {t('invited')}
      </span>
    );
  }
  if (status === 'SUSPENDED') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FDECEA] px-2.5 py-1 text-xs font-semibold text-[#D9342B]">
        <CirclePause className="size-3" /> {t('suspended')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E7F8EE] px-2.5 py-1 text-xs font-semibold text-[#16924A]">
      <span className="size-1.5 rounded-full bg-[#22A85A]" /> {t('active')}
    </span>
  );
}

function OutlineButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#E6E6E2] bg-white px-4 text-sm font-semibold text-[#161616]">
      {children}
    </button>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="block w-full rounded-lg px-3 py-2 text-start text-sm font-semibold text-[#161616] hover:bg-[#F7F7F5]">{children}</button>;
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block text-sm font-semibold text-[#161616]">
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm font-medium outline-none" />
    </label>
  );
}

function roleLabel(t: ReturnType<typeof useTranslations<'merchantStaff'>>, key: string) {
  if (key in roleAccess) return t(key as RoleKey);
  return key.replaceAll('_', ' ');
}

function initials(row: StaffRow) {
  return `${row.firstName[0] ?? ''}${row.lastName[0] ?? ''}`.toUpperCase();
}
