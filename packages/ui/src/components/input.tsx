import * as React from 'react';
import { cn } from '../lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-12 w-full rounded-xl border border-input bg-card px-3 text-base outline-none ring-[var(--input-ring,var(--ring))] transition-shadow placeholder:text-[var(--placeholder,var(--muted-foreground))] focus:border-[var(--input-focus-border,var(--input))] focus:ring-[length:var(--input-ring-width,2px)] focus:ring-offset-[length:var(--input-ring-offset,2px)] focus:ring-offset-background disabled:opacity-60',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'min-h-24 w-full rounded-xl border border-input bg-card px-3 py-2 text-base outline-none ring-[var(--input-ring,var(--ring))] transition-shadow placeholder:text-[var(--placeholder,var(--muted-foreground))] focus:border-[var(--input-focus-border,var(--input))] focus:ring-[length:var(--input-ring-width,2px)]',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
