import type * as React from 'react';
import { cn } from '../lib/utils';

const tones: Record<string, string> = {
  default: 'bg-[var(--primary-soft,#fff4cc)] text-[var(--primary-soft-foreground,#111111)]',
  black: 'bg-secondary text-secondary-foreground',
  muted: 'bg-muted text-muted-foreground',
  danger: 'bg-[var(--destructive-soft,#fdecea)] text-[var(--destructive,#d9342b)]',
  ok: 'bg-[var(--success-soft,#e7f6ee)] text-[var(--success,#168a52)]',
  info: 'bg-[var(--info-soft,#e8efff)] text-[var(--info,#2563eb)]',
};

export function Badge({
  className,
  tone = 'default',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold', tones[tone], className)}
      {...props}
    />
  );
}
