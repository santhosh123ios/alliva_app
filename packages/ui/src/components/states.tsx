import type * as React from 'react';
import { ImageIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { Mascot } from './logo';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('animate-pulse rounded-xl bg-[#E9E9E5]', className)} {...props} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn('h-3.5', index === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex items-center gap-2', className)}>
      <svg className="size-4 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label ? <span className="text-sm font-medium">{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

export function PageLoader({ label }: { label?: string }) {
  return (
    <div className="grid min-h-[40vh] place-items-center">
      <Spinner className="text-muted-foreground" label={label} />
    </div>
  );
}

export function Placeholder({ icon, className, children }: { icon?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn('grid place-items-center rounded-2xl bg-muted text-muted-foreground', className)}>
      <div className="flex flex-col items-center gap-2 p-4 text-center">
        {icon ?? <ImageIcon className="size-6" />}
        {children ? <span className="text-xs font-medium">{children}</span> : null}
      </div>
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed bg-card p-8 text-center">
      <Mascot className="mx-auto mb-4 h-24" />
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-[#f3c1bd] bg-[#fdecea] p-6 text-[#d9342b]">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm">{body}</p>
    </div>
  );
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-3" aria-busy>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-24" />
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} aria-busy>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 rounded-2xl border bg-card p-4">
          <Skeleton className="size-11 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 6, columns = 'sm:grid-cols-2 lg:grid-cols-3', className }: { count?: number; columns?: string; className?: string }) {
  return (
    <div className={cn('grid gap-3', columns, className)} aria-busy>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-2xl border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
          <Skeleton className="mt-3 h-3.5 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 5, header = true, className }: { rows?: number; columns?: number; header?: boolean; className?: string }) {
  return (
    <div className={cn('space-y-4', className)} aria-busy>
      {header ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-3.5 w-64" />
          </div>
          <Skeleton className="h-11 w-36" />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-10 w-28" />
      </div>
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="grid gap-4 border-b px-4 py-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }, (_, index) => (
            <Skeleton key={index} className="h-3 w-2/3" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="grid items-center gap-4 border-b px-4 py-4 last:border-b-0" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {Array.from({ length: columns }, (_, column) => (
              column === 0 ? (
                <div key={column} className="flex items-center gap-3">
                  <Skeleton className="size-9 shrink-0 rounded-lg" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ) : (
                <Skeleton key={column} className={cn('h-4', column === columns - 1 ? 'w-1/2 rounded-full' : 'w-3/4')} />
              )
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardSkeleton({ chart = true }: { chart?: boolean }) {
  return (
    <div aria-busy>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-3.5 w-40" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-11 w-32" />
          <Skeleton className="h-11 w-36" />
        </div>
      </div>
      <div className="mt-6 grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
        <section className="min-w-0 space-y-3">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-12 w-56" />
          <Skeleton className="h-3.5 w-48" />
          {chart ? <Skeleton className="mt-4 h-44 w-full rounded-3xl" /> : null}
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <div className="space-y-2"><Skeleton className="h-12 w-20" /><Skeleton className="h-3.5 w-28" /></div>
            <div className="space-y-2"><Skeleton className="h-12 w-20" /><Skeleton className="h-3.5 w-28" /></div>
          </div>
        </section>
        <section className="rounded-3xl bg-[#FFF6D4] p-5">
          <Skeleton className="h-3 w-24 bg-black/10" />
          <Skeleton className="mt-3 h-7 w-40 bg-black/10" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex items-center gap-3 px-1 py-1">
                <Skeleton className="size-10 rounded-full bg-white/80" />
                <Skeleton className="h-4 w-1/2 bg-black/10" />
                <Skeleton className="ms-auto h-4 w-14 bg-black/10" />
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
        <section className="rounded-3xl border bg-card p-5">
          <div className="flex items-center justify-between"><Skeleton className="h-7 w-44" /><Skeleton className="h-4 w-24" /></div>
          <div className="mt-4 flex gap-2">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-9 w-24 rounded-full" />)}
          </div>
          <div className="mt-4 space-y-3">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="grid grid-cols-[1fr_1.4fr_1fr_1fr_1fr] gap-4">
                {Array.from({ length: 5 }, (_, column) => <Skeleton key={column} className="h-4" />)}
              </div>
            ))}
          </div>
        </section>
        <section className="space-y-4">
          <div className="rounded-3xl border bg-card p-5 space-y-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-24 w-full" />
          </div>
          <div className="rounded-3xl border bg-card p-5 space-y-3">
            <Skeleton className="h-6 w-32" />
            <SkeletonText lines={3} />
          </div>
        </section>
      </div>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <div className="rounded-2xl border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1 space-y-3">
            <Skeleton className="h-9 w-1/2" />
            <SkeletonText lines={2} />
            <Skeleton className="h-3.5 w-1/3" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <div className="mt-4 flex gap-2">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <ListSkeleton rows={4} />
      </div>
    </div>
  );
}

export function ShellSkeleton({ variant = 'dark' }: { variant?: 'dark' | 'light' } = {}) {
  const light = variant === 'light';
  return (
    <div className="min-h-screen bg-[#F7F7F5] md:grid md:grid-cols-[260px_1fr]" aria-busy>
      <aside className={`hidden flex-col p-5 md:flex ${light ? 'border-e border-[#EEEEEC] bg-white' : 'bg-[#111111]'}`}>
        <Skeleton className={`h-7 w-28 ${light ? '' : 'bg-white/15'}`} />
        <Skeleton className={`mt-3 h-3 w-36 ${light ? '' : 'bg-white/10'}`} />
        <div className="mt-8 space-y-2">
          {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className={`h-10 w-full ${light ? '' : 'bg-white/10'}`} />)}
        </div>
        <div className="mt-auto flex items-center gap-3">
          <Skeleton className={`size-10 rounded-full ${light ? '' : 'bg-white/15'}`} />
          <Skeleton className={`h-4 w-28 ${light ? '' : 'bg-white/10'}`} />
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex h-16 items-center gap-4 border-b bg-white px-4 md:px-6">
          <Skeleton className="h-4 w-40" />
          <div className="ms-auto flex items-center gap-2">
            <Skeleton className="h-10 w-64 rounded-full" />
            <Skeleton className="size-10 rounded-full" />
            <Skeleton className="size-10 rounded-xl" />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] p-4 md:p-6">
          <DashboardSkeleton />
        </main>
      </div>
    </div>
  );
}
