import type * as React from 'react';
import { cn } from '../lib/utils';

const tones: Record<string, string> = {
  default: 'bg-[#fff4cc] text-[#111111]',
  black: 'bg-secondary text-secondary-foreground',
  muted: 'bg-muted text-muted-foreground',
  danger: 'bg-[#fdecea] text-[#d9342b]',
  ok: 'bg-[#e7f6ee] text-[#168a52]',
  info: 'bg-[#e8efff] text-[#2563eb]',
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
