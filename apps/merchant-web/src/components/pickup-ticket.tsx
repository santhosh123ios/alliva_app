import { api } from '@/components/providers';
import { Dialog, DialogContent, DialogDescription, DialogTitle, Spinner } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { Printer, QrCode } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';

/** The QR and short code a rider scans or types at the counter to prove they collected the order. */
export function PickupTicketButton({ orderId, number }: { orderId: string; number: string }) {
  const t = useTranslations('merchantOrders.pickup');
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#E2E2DC] bg-white text-sm font-semibold hover:bg-[#F7F7F5]">
        <QrCode className="size-4" />{t('show')}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(100%-2rem,24rem)] text-center">
          <DialogTitle>{t('title', { number })}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
          {open ? <Ticket orderId={orderId} number={number} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Ticket({ orderId, number }: { orderId: string; number: string }) {
  const t = useTranslations('merchantOrders.pickup');
  const handoff = useQuery({ queryKey: ['merchant', 'handoff', orderId], queryFn: () => api.orderHandoff(orderId), staleTime: Infinity });
  const [image, setImage] = useState('');
  useEffect(() => {
    if (!handoff.data) return;
    let live = true;
    void import('qrcode').then(({ toDataURL }) => toDataURL(handoff.data.qr, { margin: 1, width: 480, errorCorrectionLevel: 'M' })).then((url) => { if (live) setImage(url); });
    return () => { live = false; };
  }, [handoff.data]);

  if (handoff.error) return <p className="mt-4 text-sm text-[#B42318]">{(handoff.error as Error).message}</p>;
  if (!handoff.data || !image) return <div className="grid h-72 place-items-center"><Spinner /></div>;

  const print = () => {
    const win = window.open('', '_blank', 'width=360,height=520');
    if (!win) return;
    win.document.write(`<!doctype html><html><head><title>${number}</title><style>body{font-family:system-ui;text-align:center;margin:16px}img{width:240px;height:240px}h1{font-size:20px;margin:4px 0}.code{font:700 28px/1 ui-monospace,monospace;letter-spacing:6px;margin-top:8px}</style></head><body><h1>#${number}</h1><img src="${image}" alt=""/><div class="code">${handoff.data.code}</div><p>${t('printHint')}</p><script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script></body></html>`);
    win.document.close();
  };

  return (
    <div className="mt-4">
      <img src={image} alt={t('qrAlt', { number })} className="mx-auto size-56 rounded-xl border border-[#ECECE8] p-2" />
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-[#8A8A86]">{t('codeLabel')}</p>
      <p className="font-mono text-3xl font-bold tracking-[0.35em]" dir="ltr">{handoff.data.code}</p>
      <button type="button" onClick={print} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#111111] text-sm font-semibold text-white">
        <Printer className="size-4" />{t('print')}
      </button>
    </div>
  );
}
