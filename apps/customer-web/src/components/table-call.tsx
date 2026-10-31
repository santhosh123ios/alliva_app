import { api } from '@/components/providers';
import { cn, Dialog, DialogContent, DialogDescription, DialogTitle, toast } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Check, HandHelping, Loader2, Receipt, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

type TableServiceView = Awaited<ReturnType<typeof api.tableService>>;
type ServiceRequestKind = TableServiceView['requests'][number]['kind'];

const KINDS: { kind: ServiceRequestKind; icon: typeof BellRing }[] = [
  { kind: 'WAITER', icon: UserRound },
  { kind: 'BILL', icon: Receipt },
  { kind: 'HELP', icon: HandHelping },
];

function scannedTable() {
  if (typeof document === 'undefined') return null;
  return document.cookie.split('; ').find((part) => part.startsWith('alliva_table='))?.slice('alliva_table='.length) || null;
}

/** For diners who scanned a table QR: call a waiter, ask for the bill or for help, and see when staff are on the way. */
export function TableCall() {
  const t = useTranslations('customer.tableCall');
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const tableId = scannedTable();
  const service = useQuery({
    queryKey: ['table-service', tableId],
    queryFn: () => api.tableService(),
    enabled: Boolean(tableId),
    retry: false,
    // Poll quickly only while a call is waiting, so diners see "on the way" without a socket.
    refetchInterval: (query) => ((query.state.data as TableServiceView | undefined)?.requests.length ? 10_000 : 60_000),
  });
  const call = useMutation({
    mutationFn: (kind: ServiceRequestKind) => api.callStaff(kind),
    onSuccess: (next, kind) => {
      client.setQueryData(['table-service', tableId], next);
      toast.success(t(`sent.${kind}`));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const data = service.data;
  if (!data) return null;
  const pending = data.requests.length > 0;
  const onTheWay = data.requests.some((request) => request.status === 'ACKNOWLEDGED');

  return (
    <>
      <div className="pointer-events-none mx-auto mb-2 flex max-w-[520px] justify-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            'pointer-events-auto flex h-11 items-center gap-2 rounded-full ps-3 pe-4 text-sm font-semibold shadow-[0_10px_28px_rgba(0,0,0,0.18)]',
            onTheWay ? 'bg-[#168A52] text-white' : pending ? 'bg-[#111111] text-white' : 'bg-white text-[#111111]',
          )}
        >
          <BellRing className={cn('size-4', pending && !onTheWay && 'animate-pulse')} />
          <span>{onTheWay ? t('onTheWayShort') : pending ? t('waitingShort') : t('button', { table: data.table.number })}</span>
        </button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle>{t('title', { table: data.table.number })}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
          <div className="mt-2 grid gap-2">
            {KINDS.map(({ kind, icon: Icon }) => {
              const request = data.requests.find((row) => row.kind === kind);
              const busy = call.isPending && call.variables === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  disabled={Boolean(request) || call.isPending}
                  onClick={() => call.mutate(kind)}
                  className={cn(
                    'flex min-h-14 items-center gap-3 rounded-2xl border px-4 text-start disabled:cursor-default',
                    request?.status === 'ACKNOWLEDGED' ? 'border-[#BFE5CF] bg-[#E3F5EA]' : request ? 'border-[#F0E2A8] bg-[#FFF8DC]' : 'border-[#E6E6E2] bg-white hover:bg-[#FAFAF8]',
                  )}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#FFC400] text-[#111111]">
                    {busy ? <Loader2 className="size-5 animate-spin" /> : request?.status === 'ACKNOWLEDGED' ? <Check className="size-5" /> : <Icon className="size-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-[#161616]">{t(`kinds.${kind}`)}</span>
                    {request ? (
                      <span className="block text-xs text-[#5C5C58]">
                        {request.status === 'ACKNOWLEDGED'
                          ? request.acknowledgedBy ? t('comingNamed', { name: request.acknowledgedBy }) : t('coming')
                          : t('waiting')}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
