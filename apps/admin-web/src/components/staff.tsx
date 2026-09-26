'use client';

import { api } from '@/components/providers';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Label } from '@alliva/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Crown, Headset, Mail, Megaphone, MoreHorizontal, Plus, Search, Settings, ShieldCheck, UserRound, Users, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

export type StaffRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  roles: string[];
};

type Tab = 'all' | 'active' | 'invited' | 'suspended';

const pageSize = 6;
const systemRoles = ['SUPER_ADMIN', 'ADMIN', 'OPERATIONS_MANAGER', 'OPERATIONS_STAFF', 'MARKETING_HEAD', 'MARKETING_STAFF', 'FINANCE_MANAGER', 'FINANCE_STAFF', 'CUSTOMER_SUPPORT'];

const accessRoles: { key: string; icon: LucideIcon; bg: string; fg: string; tags: string[]; fallback?: boolean }[] = [
  { key: 'ADMIN', icon: Crown, bg: 'bg-[#FFF6D4]', fg: 'text-[#111111]', tags: ['allAccess', 'userManagement', 'settings'], fallback: true },
  { key: 'OPERATIONS_MANAGER', icon: Settings, bg: 'bg-[#E7F0FF]', fg: 'text-[#2F6BFF]', tags: ['orders', 'merchants', 'complaints', 'reports'] },
  { key: 'MARKETING_HEAD', icon: Megaphone, bg: 'bg-[#FDE8F2]', fg: 'text-[#D23B84]', tags: ['campaigns', 'promotions', 'analytics'] },
  { key: 'MARKETING_STAFF', icon: Megaphone, bg: 'bg-[#F3E8FF]', fg: 'text-[#7C3AED]', tags: ['promotions', 'merchants'] },
  { key: 'CUSTOMER_SUPPORT', icon: Headset, bg: 'bg-[#E8F6EE]', fg: 'text-[#1B8A4A]', tags: ['tickets', 'orders', 'accounts'] },
];

const avatarTones = ['bg-[#F3E8FF] text-[#7C3AED]', 'bg-[#E7F0FF] text-[#2F6BFF]', 'bg-[#FFF1D6] text-[#C47B00]', 'bg-[#E8F6EE] text-[#1B8A4A]', 'bg-[#FDE8F2] text-[#D23B84]', 'bg-[#F1F1EE] text-[#5C5C57]'];

export function StaffDirectory({ rows }: { rows: StaffRow[] }) {
  const t = useTranslations('staff');
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [showAllRoles, setShowAllRoles] = useState(false);
  const [error, setError] = useState('');

  const counts = {
    all: rows.length,
    active: rows.filter((row) => row.status === 'ACTIVE').length,
    invited: rows.filter((row) => row.status === 'PENDING_ACTIVATION').length,
    suspended: rows.filter((row) => row.status === 'SUSPENDED').length,
  };
  const customRoles = new Set(rows.flatMap((row) => row.roles).filter((role) => !systemRoles.includes(role))).size;
  const filtered = useMemo(() => rows.filter((row) => {
    if (tab === 'active' && row.status !== 'ACTIVE') return false;
    if (tab === 'invited' && row.status !== 'PENDING_ACTIVATION') return false;
    if (tab === 'suspended' && row.status !== 'SUSPENDED') return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${row.firstName} ${row.lastName} ${row.email} ${row.roles.join(' ')}`.toLowerCase().includes(needle);
  }), [query, rows, tab]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const from = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, filtered.length);
  const visibleRoles = showAllRoles
    ? [...accessRoles, ...systemRoles.filter((key) => !accessRoles.some((role) => role.key === key)).map((key) => ({ key, icon: ShieldCheck, bg: 'bg-[#F1F1EE]', fg: 'text-[#5C5C57]', tags: [] as string[] }))]
    : accessRoles;

  async function setStatus(id: string, action: 'suspend' | 'activate') {
    setMenuId(null);
    setError('');
    try {
      if (action === 'suspend') await api.suspendStaff(id);
      else await api.activateStaff(id);
      await client.invalidateQueries({ queryKey: ['admin', 'staff'] });
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="yellow" className="h-11 rounded-xl px-4" onClick={() => setInviteOpen(true)}>
            <Users className="size-4" /> {t('invite')}
          </Button>
          <Button variant="outline" className="h-11 rounded-xl bg-card px-4" onClick={() => document.getElementById('access-roles')?.scrollIntoView({ behavior: 'smooth' })}>
            <Settings className="size-4" /> {t('manageRoles')}
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Users} iconBg="bg-[#FFF6D4]" label={t('total')} value={counts.all} />
        <Stat icon={UserRound} iconBg="bg-[#E8F6EE]" label={t('activeMembers')} value={counts.active} />
        <Stat icon={Mail} iconBg="bg-[#E7F0FF]" label={t('pendingInvites')} value={counts.invited} />
        <Stat icon={Settings} iconBg="bg-[#F3E8FF]" label={t('customRoles')} value={customRoles} />
      </div>
      {error ? <p className="mt-3 text-sm text-[#D9342B]">{error}</p> : null}

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-2xl border bg-card">
          <div className="flex flex-wrap items-center gap-3 px-4 pt-4">
            <h2 className="text-sm font-semibold">{t('members')}</h2>
            <div className="relative ms-auto min-w-[14rem] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={t('search')} className="h-10 w-full rounded-xl border bg-white ps-9 pe-3 text-sm outline-none focus:ring-2 focus:ring-primary" />
            </div>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto px-4">
            <FilterChip active={tab === 'all'} onClick={() => { setTab('all'); setPage(1); }}>{t('all')} ({counts.all})</FilterChip>
            <FilterChip active={tab === 'active'} onClick={() => { setTab('active'); setPage(1); }}>{t('active')} ({counts.active})</FilterChip>
            <FilterChip active={tab === 'invited'} onClick={() => { setTab('invited'); setPage(1); }}>{t('invited')} ({counts.invited})</FilterChip>
            <FilterChip active={tab === 'suspended'} onClick={() => { setTab('suspended'); setPage(1); }}>{t('suspended')} ({counts.suspended})</FilterChip>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-y text-start text-xs text-muted-foreground">
                  <th className="px-4 py-3 text-start font-medium">{t('name')}</th>
                  <th className="px-3 py-3 text-start font-medium">{t('role')}</th>
                  <th className="px-3 py-3 text-start font-medium">{t('team')}</th>
                  <th className="px-3 py-3 text-start font-medium">{t('status')}</th>
                  <th className="px-4 py-3 text-end font-medium">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length ? pageRows.map((row, index) => {
                  const name = `${row.firstName} ${row.lastName}`;
                  const role = row.roles[0] ?? '';
                  return (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className={`grid size-9 place-items-center rounded-full text-xs font-semibold ${avatarTones[index % avatarTones.length]}`}>{initials(row)}</span>
                          <span>
                            <span className="block font-semibold">{name}</span>
                            <span className="block text-xs text-muted-foreground">{row.email}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">{labelFor(t, role)}</td>
                      <td className="px-3 py-3">{t(teamOf(role))}</td>
                      <td className="px-3 py-3"><StatusBadge status={row.status} /></td>
                      <td className="px-4 py-3 text-end">
                        <div className="relative inline-block">
                          <button type="button" className="grid size-8 place-items-center rounded-lg hover:bg-muted" aria-label={t('more', { name })} onClick={() => setMenuId(menuId === row.id ? null : row.id)}>
                            <MoreHorizontal className="size-4" />
                          </button>
                          {menuId === row.id ? (
                            <div className="absolute end-0 z-20 mt-1 w-36 rounded-xl border bg-card p-1 text-start shadow-lg">
                              {row.status === 'SUSPENDED' ? (
                                <button type="button" className="block w-full rounded-lg px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => setStatus(row.id, 'activate')}>{t('activate')}</button>
                              ) : (
                                <button type="button" className="block w-full rounded-lg px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => setStatus(row.id, 'suspend')}>{t('suspend')}</button>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">{t('empty')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm text-muted-foreground">
            <p>{t('showing', { from, to, total: filtered.length })}</p>
            <div className="ms-auto flex items-center gap-1">
              <button type="button" className="grid size-8 place-items-center rounded-lg border disabled:opacity-40" aria-label={t('previous')} disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
                <ChevronLeft className="size-4 rtl:-scale-x-100" />
              </button>
              {Array.from({ length: pageCount }, (_, index) => index + 1).slice(0, 5).map((value) => (
                <button key={value} type="button" onClick={() => setPage(value)} className={`grid size-8 place-items-center rounded-lg text-sm font-semibold ${value === safePage ? 'bg-primary text-[#111111]' : 'hover:bg-muted'}`}>{value}</button>
              ))}
              <button type="button" className="grid size-8 place-items-center rounded-lg border disabled:opacity-40" aria-label={t('next')} disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>
                <ChevronRight className="size-4 rtl:-scale-x-100" />
              </button>
            </div>
          </div>
        </section>

        <aside id="access-roles" className="rounded-2xl border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">{t('access')}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t('accessHint')}</p>
            </div>
            <button type="button" className="shrink-0 text-xs font-semibold" onClick={() => setShowAllRoles((open) => !open)}>{t('viewAll')} →</button>
          </div>
          <div className="mt-4 space-y-3">
            {visibleRoles.map((role) => {
              const Icon = role.icon;
              const members = rows.filter((row) => row.roles.includes(role.key)).length;
              return (
                <article key={role.key} className="rounded-2xl border p-3">
                  <div className="flex items-start gap-3">
                    <span className={`grid size-10 place-items-center rounded-xl ${role.bg} ${role.fg}`}><Icon className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{labelFor(t, role.key)}</p>
                        {role.fallback ? <span className="rounded-full bg-[#F1F1EE] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{t('default')}</span> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">{t('membersCount', { count: members })}</p>
                    </div>
                  </div>
                  {role.tags.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {role.tags.map((tag) => <span key={tag} className="rounded-full bg-[#F7F7F5] px-2 py-1 text-[11px] font-medium text-muted-foreground">{t(tag as 'orders')}</span>)}
                    </div>
                  ) : null}
                </article>
              );
            })}
            <button type="button" className="flex w-full items-center gap-3 rounded-2xl border border-dashed p-3 text-start" onClick={() => setInviteOpen(true)}>
              <span className="grid size-10 place-items-center rounded-full bg-primary text-[#111111]"><Plus className="size-4" /></span>
              <span>
                <span className="block text-sm font-semibold">{t('createRole')}</span>
                <span className="block text-xs text-muted-foreground">{t('createRoleHint')}</span>
              </span>
            </button>
          </div>
        </aside>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 rounded-2xl bg-[#111111] px-5 py-4 text-white">
        <ShieldCheck className="size-8 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t('bannerTitle')}</p>
          <p className="text-sm text-white/70">{t('bannerBody')}</p>
        </div>
        <Button variant="yellow" className="h-11 rounded-xl px-4" onClick={() => document.getElementById('access-roles')?.scrollIntoView({ behavior: 'smooth' })}>
          {t('learnMore')} →
        </Button>
      </div>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('staff');
  const client = useQueryClient();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: 'Alliva123!', roleKey: 'MARKETING_STAFF' });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    setError('');
    try {
      await api.createStaff(form);
      await client.invalidateQueries({ queryKey: ['admin', 'staff'] });
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
          <Field label={t('email')} value={form.email} onChange={(email) => setForm({ ...form, email })} />
          <Field label={t('password')} value={form.password} onChange={(password) => setForm({ ...form, password })} />
          <div className="sm:col-span-2">
            <Label>{t('role')}</Label>
            <select value={form.roleKey} onChange={(event) => setForm({ ...form, roleKey: event.target.value })} className="mt-2 h-12 w-full rounded-xl border bg-card px-3 text-sm">
              {systemRoles.map((key) => <option key={key} value={key}>{labelFor(t, key)}</option>)}
            </select>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-[#D9342B]">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button variant="yellow" disabled={pending} onClick={save}>{t('save')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ icon: Icon, iconBg, label, value }: { icon: LucideIcon; iconBg: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-card p-4">
      <span className={`grid size-11 place-items-center rounded-xl ${iconBg}`}><Icon className="size-5" /></span>
      <span>
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="block text-2xl font-semibold tracking-tight">{value}</span>
      </span>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`h-8 shrink-0 rounded-full px-3 text-xs font-semibold ${active ? 'bg-primary text-[#111111]' : 'bg-[#F1F1EE] text-muted-foreground'}`}>
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('staff');
  const style = status === 'ACTIVE'
    ? { dot: 'bg-[#1B8A4A]', text: 'text-[#1B8A4A]', label: t('active') }
    : status === 'PENDING_ACTIVATION'
      ? { dot: 'bg-[#2F6BFF]', text: 'text-[#2F6BFF]', label: t('invited') }
      : { dot: 'bg-[#D9342B]', text: 'text-[#D9342B]', label: t('suspended') };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${style.text}`}>
      <span className={`size-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input className="mt-2 h-12" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function labelFor(t: ReturnType<typeof useTranslations<'staff'>>, key: string) {
  if (systemRoles.includes(key)) return t(key as 'ADMIN');
  return key.replaceAll('_', ' ');
}

function teamOf(role: string): 'management' | 'operations' | 'marketing' | 'finance' | 'support' | 'partnerships' {
  if (role.includes('ADMIN')) return 'management';
  if (role.startsWith('OPERATION')) return 'operations';
  if (role.startsWith('MARKET')) return 'marketing';
  if (role.startsWith('FINANCE')) return 'finance';
  if (role === 'CUSTOMER_SUPPORT') return 'support';
  return 'partnerships';
}

function initials(row: StaffRow) {
  return `${row.firstName[0] ?? ''}${row.lastName[0] ?? ''}`.toUpperCase();
}
