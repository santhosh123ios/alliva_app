import { ApiError } from '@alliva/api-client';
import { Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogTitle, EmptyState, ErrorState, Input, Sheet, SheetContent, Skeleton, Textarea, cn, toast, trackBusy } from '@alliva/ui';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Copy, Search } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useConsole } from './context';
import { LEAD_STATUSES, STAFF_LEAD_STATUSES, type MemberRow } from './types';
import { useT, type MessageKey, type Translate } from './i18n';

export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
export type Params = Record<string, string | number | boolean | undefined | null>;

// ---------------------------------------------------------------------------------------------- data hooks

/** Paginated list. The previous page stays on screen while the next one loads. */
export function useList<T>(key: string, path: string, params: Params, enabled = true) {
  const { api } = useConsole();
  return useQuery({
    queryKey: ['mk', key, path, params],
    queryFn: () => api.mk.get<Paged<T>>(path, params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useData<T>(key: string, path: string, params?: Params, enabled = true) {
  const { api } = useConsole();
  return useQuery({ queryKey: ['mk', key, path, params ?? {}], queryFn: () => api.mk.get<T>(path, params), enabled });
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { message?: unknown } | undefined;
    if (Array.isArray(body?.message)) {
      const first = body.message[0] as { message?: string } | string | undefined;
      return typeof first === 'string' ? first : first?.message ?? error.message;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'Request failed';
}

/** Runs a mutation, shows its outcome, and refreshes every marketing query on success. */
export function useAction() {
  const client = useQueryClient();
  const t = useT();
  return async function act<T>(run: () => Promise<T>, success?: MessageKey): Promise<{ ok: true; data: T } | { ok: false }> {
    const release = trackBusy();
    try {
      const data = await run();
      if (success) toast.success(t(success));
      await client.invalidateQueries({ queryKey: ['mk'] });
      return { ok: true, data };
    } catch (error) {
      toast.error(errorMessage(error));
      return { ok: false };
    } finally {
      release();
    }
  };
}

/** Filter + page state; changing any filter returns to page 1. */
export function useFilters<T extends Record<string, string>>(initial: T, pageSize = 20) {
  const [state, setState] = useState<T & { page: number }>({ ...initial, page: 1 });
  return {
    values: state,
    params: { ...state, pageSize } as Params,
    set: (patch: Partial<T>) => setState((current) => ({ ...current, ...patch, page: 1 })),
    setPage: (page: number) => setState((current) => ({ ...current, page })),
  };
}

// ---------------------------------------------------------------------------------------------- layout

export function Section({ title, subtitle, actions, children, className }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('p-5', className)}>
      {title || actions ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title ? <h2 className="text-base font-semibold">{title}</h2> : null}
            {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </Card>
  );
}

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'warn' | 'bad' | 'good' }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-2 text-2xl font-semibold tabular-nums', tone === 'bad' && 'text-[#d9342b]', tone === 'good' && 'text-[#168a52]', tone === 'warn' && 'text-[#b26b00]')}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[1.75rem] leading-tight md:text-3xl">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          onClick={() => onChange(tab.id)}
          className={cn('rounded-lg px-3 py-1.5 text-sm font-semibold transition', tab.id === value ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}
        >
          {tab.label}
          {tab.count !== undefined ? <span className="ms-1.5 text-xs text-muted-foreground">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- status

const TONES: Record<string, 'ok' | 'danger' | 'info' | 'muted' | 'default'> = {
  ACTIVE: 'ok', REGISTERED: 'ok', COMPLETED: 'ok', PAID: 'ok', APPROVED: 'ok', CAPTURED: 'ok', APPLIED: 'ok', PROCESSED: 'ok',
  SUSPENDED: 'danger', REJECTED: 'danger', CLOSED_LOST: 'danger', NOT_INTERESTED: 'danger', REVERSED: 'danger', MISSED: 'danger', CANCELLED: 'danger', VOID: 'danger', FAILED: 'danger', REFUNDED: 'danger', EXPIRED: 'muted',
  INACTIVE: 'muted', DISABLED: 'muted',
  CONTACTED: 'info', VISITED: 'info', INTERESTED: 'info', NEGOTIATION: 'info', REGISTRATION_PENDING: 'info', APPOINTMENT_SCHEDULED: 'info', PROCESSING: 'info', UNDER_REVIEW: 'info',
};

const STAFF_STATUS_LABEL: Record<(typeof STAFF_LEAD_STATUSES)[number], MessageKey> = {
  NEW: 'leadStatus.NEW',
  CONTACTED: 'leadStatus.CONTACTED',
  INTERESTED: 'leadStatus.INTERESTED',
  NOT_INTERESTED: 'leadStatus.NOT_INTERESTED',
};

/** Status choices for a role. Staff only move a store through contact outcomes. */
export function leadStatusChoices(t: Translate, role: string, current?: string): { value: string; label: string }[] {
  const base: readonly string[] = role === 'STAFF' ? STAFF_LEAD_STATUSES : LEAD_STATUSES;
  const values = current && !base.includes(current) ? [current, ...base] : [...base];
  return values.map((value) => ({
    value,
    label: role === 'STAFF' && (STAFF_LEAD_STATUSES as readonly string[]).includes(value)
      ? t(STAFF_STATUS_LABEL[value as (typeof STAFF_LEAD_STATUSES)[number]])
      : t(`status.${value}` as MessageKey),
  }));
}

export function StatusPill({ value, overdue }: { value: string | null | undefined; overdue?: boolean }) {
  const { role } = useConsole();
  const t = useT();
  if (!value) return <span className="text-muted-foreground">—</span>;
  const staffLabel = role === 'STAFF' && (STAFF_LEAD_STATUSES as readonly string[]).includes(value)
    ? t(STAFF_STATUS_LABEL[value as (typeof STAFF_LEAD_STATUSES)[number]])
    : null;
  const label = staffLabel ?? t(`status.${value}` as MessageKey);
  const text = label.startsWith('status.') ? value.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : label;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={TONES[value] ?? 'default'}>{text}</Badge>
      {overdue ? <Badge tone="danger">{t('overdue')}</Badge> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------- table

export type Column<T> = { key: string; header: ReactNode; cell: (row: T) => ReactNode; className?: string };

export function DataTable<T>({
  columns,
  rows,
  loading,
  error,
  emptyTitle,
  emptyBody,
  onRowClick,
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  loading?: boolean;
  error?: unknown;
  emptyTitle?: string;
  emptyBody?: string;
  onRowClick?: (row: T) => void;
  rowKey: (row: T) => string;
}) {
  const t = useT();
  if (error) return <ErrorState title={t('loadFailed')} body={errorMessage(error)} />;
  if (loading && !rows) return <TableLoading columns={columns.length} />;
  if (!rows?.length) return <EmptyState title={emptyTitle ?? t('emptyTitle')} body={emptyBody ?? t('emptyBody')} />;
  return (
    <div className="w-full overflow-x-auto rounded-2xl border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted text-start text-xs uppercase tracking-wide">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={cn('whitespace-nowrap px-4 py-3 text-start font-semibold', column.className)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={cn('border-t', onRowClick && 'cursor-pointer hover:bg-muted/60')}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (event) => { if (event.key === 'Enter') onRowClick(row); } : undefined}
              tabIndex={onRowClick ? 0 : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} className={cn('px-4 py-3 align-middle', column.className)}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableLoading({ columns }: { columns: number }) {
  return (
    <div className="space-y-2 rounded-2xl border bg-card p-4" aria-busy>
      {Array.from({ length: 6 }, (_, row) => (
        <div key={row} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }, (_, cell) => <Skeleton key={cell} className="h-6" />)}
        </div>
      ))}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const t = useT();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <p className="text-xs text-muted-foreground">{t('showing', { count: total, total })}</p> : null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p className="text-muted-foreground">{t('range', { from, to, total })}</p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" aria-label={t('previous')} disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="size-4 rtl:rotate-180" /></Button>
        <span className="tabular-nums">{page} / {pages}</span>
        <Button variant="outline" size="sm" aria-label={t('next')} disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight className="size-4 rtl:rotate-180" /></Button>
      </div>
    </div>
  );
}

/** A list with its toolbar-less table and pager wired to a `useList` result. */
export function ListView<T>({
  query,
  columns,
  rowKey,
  onPage,
  onRowClick,
  emptyTitle,
  emptyBody,
}: {
  query: ReturnType<typeof useList<T>>;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onPage: (page: number) => void;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  const t = useT();
  const data = query.data;
  const refreshing = query.isFetching && !query.isLoading && Boolean(data);
  return (
    <div className={cn('relative space-y-3', refreshing && 'opacity-70 transition-opacity')}>
      {refreshing ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center" aria-live="polite">
          <span className="inline-flex items-center gap-2 rounded-full bg-[#111]/90 px-3 py-1 text-xs font-semibold text-white shadow-sm">
            <svg className="size-3.5 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            {t('loading')}
          </span>
        </div>
      ) : null}
      <DataTable columns={columns} rows={data?.items} loading={query.isLoading} error={query.error} onRowClick={onRowClick} rowKey={rowKey} emptyTitle={emptyTitle} emptyBody={emptyBody} />
      {data ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={onPage} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- filters

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  const t = useT();
  const [text, setText] = useState(value);
  const first = useRef(true);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => onChange(text.trim()), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <div className="relative min-w-52 flex-1 sm:max-w-xs">
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input className="h-10 ps-9 text-sm" value={text} onChange={(event) => setText(event.target.value)} placeholder={placeholder ?? t('search')} aria-label={t('search')} />
    </div>
  );
}

const selectClass = 'h-10 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none ring-ring focus:ring-2 disabled:opacity-60';

export function FilterSelect({ value, onChange, options, label, allLabel }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; label: string; allLabel?: string }) {
  const t = useT();
  return (
    <select className={cn(selectClass, 'w-auto min-w-36')} value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
      <option value="">{allLabel ?? `${label}: ${t('all')}`}</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (patch: { from?: string; to?: string }) => void }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 text-sm">
      <input type="date" aria-label={t('from')} className={cn(selectClass, 'w-40')} value={from} max={to || undefined} onChange={(event) => onChange({ from: event.target.value })} />
      <span className="text-muted-foreground">–</span>
      <input type="date" aria-label={t('to')} className={cn(selectClass, 'w-40')} value={to} min={from || undefined} onChange={(event) => onChange({ to: event.target.value })} />
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

// ---------------------------------------------------------------------------------------------- forms

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error ? <span className="block text-xs text-[#d9342b]">{error}</span> : hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

type TextFieldProps = { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string; hint?: string; error?: string; required?: boolean; disabled?: boolean; className?: string; inputMode?: 'decimal' | 'numeric' | 'tel' | 'email' | 'text'; dir?: 'ltr' | 'rtl'; maxLength?: number };

export function TextField({ label, value, onChange, type = 'text', placeholder, hint, error, required, disabled, className, inputMode, dir, maxLength }: TextFieldProps) {
  return (
    <Field label={required ? `${label} *` : label} hint={hint} error={error} className={className}>
      <Input className="h-11 text-sm" type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} disabled={disabled} inputMode={inputMode} dir={dir} maxLength={maxLength} />
    </Field>
  );
}

export function AreaField({ label, value, onChange, placeholder, hint, required, rows = 3, maxLength }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; hint?: string; required?: boolean; rows?: number; maxLength?: number }) {
  return (
    <Field label={required ? `${label} *` : label} hint={hint}>
      <Textarea className="min-h-20 text-sm" rows={rows} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} maxLength={maxLength} />
    </Field>
  );
}

export function SelectField({ label, value, onChange, options, placeholder, required, hint, disabled }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; placeholder?: string; required?: boolean; hint?: string; disabled?: boolean }) {
  return (
    <Field label={required ? `${label} *` : label} hint={hint}>
      <select className={cn(selectClass, 'h-11')} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required={required}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </Field>
  );
}

export function CheckField({ label, checked, onChange, hint, disabled }: { label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: string; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <input type="checkbox" className="mt-0.5 size-4 accent-[#111111]" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
      <span>
        <span className="font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------------------------- overlays

export function Modal({ open, onClose, title, description, children, wide }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; wide?: boolean }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className={cn('max-h-[90vh] overflow-y-auto', wide ? 'w-[min(100%-2rem,48rem)]' : '')}>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        <div className="mt-4">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

export function FormActions({ onCancel, submitLabel, pending, disabled }: { onCancel: () => void; submitLabel: string; pending?: boolean; disabled?: boolean }) {
  const t = useT();
  return (
    <div className="mt-5 flex justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onCancel}>{t('cancel')}</Button>
      <Button type="submit" variant="yellow" loading={pending} disabled={disabled}>{submitLabel}</Button>
    </div>
  );
}

export function Drawer({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent className="start-auto end-0 w-[min(100%,40rem)] p-0">
        <div className="sticky top-0 z-10 border-b bg-card px-5 py-4 pe-12">
          <DialogTitleText>{title}</DialogTitleText>
          {subtitle ? <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div> : null}
        </div>
        <div className="space-y-5 p-5">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

function DialogTitleText({ children }: { children: ReactNode }) {
  return (
    <DialogTitle>{children}</DialogTitle>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  onConfirm,
  destructive,
  reasonLabel,
  reasonRequired,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body?: string;
  confirmLabel: string;
  onConfirm: (reason: string) => Promise<boolean | void> | boolean | void;
  destructive?: boolean;
  reasonLabel?: string;
  reasonRequired?: boolean;
}) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => { if (open) setReason(''); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={title} description={body}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          try {
            const result = await onConfirm(reason.trim());
            if (result !== false) onClose();
          } finally {
            setPending(false);
          }
        }}
      >
        {reasonLabel ? <AreaField label={reasonLabel} value={reason} onChange={setReason} required={reasonRequired} maxLength={300} /> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant={destructive ? 'destructive' : 'yellow'} loading={pending} disabled={Boolean(reasonRequired && reason.trim().length < 3)}>{confirmLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------- misc

export function CopyButton({ text, label, variant = 'outline', className }: { text: string; label?: string; variant?: 'outline' | 'yellow'; className?: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          toast.success(t('copied'));
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error(t('copyFailed'));
        }
      }}
    >
      {done ? <Check className="size-4" /> : <Copy className="size-4" />}
      {label ?? t('copy')}
    </Button>
  );
}

/** Rate that applies to the next payment. A default rate follows the current platform setting. */
export function CommissionRate({ percent, isDefault }: { percent?: string | null; isDefault?: boolean }) {
  const t = useT();
  if (!percent) return t('fPercentDefault');
  return (
    <>
      {Number(percent)}%{isDefault ? <span className="font-normal text-muted-foreground"> ({t('fPercentDefault')})</span> : null}
    </>
  );
}

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{children ?? '—'}</dd>
    </div>
  );
}

export function Loading() {
  return (
    <div className="space-y-3" aria-busy>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-24" />
      <Skeleton className="h-64" />
    </div>
  );
}

export function QueryBoundary<T>({ query, children }: { query: { data: T | undefined; isLoading: boolean; error: unknown }; children: (data: T) => ReactNode }) {
  const t = useT();
  if (query.error) return <ErrorState title={t('loadFailed')} body={errorMessage(query.error)} />;
  if (query.isLoading || query.data === undefined) return <Loading />;
  return <>{children(query.data)}</>;
}

/** Subscription plans offered to merchants (public catalogue). */
export function usePlans() {
  const { api } = useConsole();
  return useQuery({ queryKey: ['mk', 'plans'], queryFn: () => api.publicPlans(), staleTime: 60_000 });
}

/** Staff the caller may filter or assign by: all staff for admins, own team for heads. */
export function useStaffOptions(enabled = true) {
  return useData<Paged<MemberRow>>('staff-options', '/staff', { pageSize: 100 }, enabled);
}
