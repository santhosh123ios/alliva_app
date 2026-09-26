'use client';

import { useState, type ReactNode } from 'react';
import { Button } from './button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

export function ConfirmButton({
  title,
  description,
  confirmLabel,
  onConfirm,
  children,
  tone = 'default',
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  children: ReactNode;
  tone?: 'default' | 'destructive';
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant={tone === 'destructive' ? 'destructive' : 'outline'} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                await onConfirm();
                setOpen(false);
              } finally {
                setPending(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
