import * as DialogPrimitive from '@radix-ui/react-dialog';
import type * as React from 'react';
import { cn } from '../lib/utils';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;

export function SheetContent({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-y-0 start-0 z-50 w-[min(100%,20rem)] overflow-y-auto bg-card p-4 shadow-xl',
          className,
        )}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}
