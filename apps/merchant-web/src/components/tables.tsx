'use client';

import { api } from '@/components/providers';
import { Link } from '@/i18n/navigation';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, EmptyState } from '@alliva/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, ChevronDown, Pencil, Plus, Printer, QrCode, Search, Users, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';

type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'INACTIVE';
type DiningTable = {
  id: string;
  name: string;
  number: string;
  capacity: number;
  status: TableStatus;
  branchId: string | null;
  floor: { id: string; name: { en?: string; ar?: string } };
  qrCode: string | null;
  order: { id: string; number: string; status: string; total: string; itemCount: number } | null;
};

const statusTone: Record<TableStatus, string> = {
  AVAILABLE: 'bg-[#E7F8EE] text-[#16924A]',
  OCCUPIED: 'bg-[#FFF4D6] text-[#C47D00]',
  RESERVED: 'bg-[#E7F0FF] text-[#2F6FED]',
  INACTIVE: 'bg-[#F1F1EE] text-[#696965]',
};

const dotTone: Record<TableStatus, string> = {
  AVAILABLE: 'bg-[#22A85A]',
  OCCUPIED: 'bg-[#F5B400]',
  RESERVED: 'bg-[#3B82F6]',
  INACTIVE: 'bg-[#8A8A86]',
};

type Branch = { id: string; name: { en?: string; ar?: string } };

export function TablesPage({ tables: rows }: { tables: DiningTable[] }) {
  const t = useTranslations('merchantTables');
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const tables = useMemo(
    () => rows.slice().sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })),
    [rows],
  );
  const [branches, setBranches] = useState<Branch[]>([]);
  const [slug, setSlug] = useState('');
  useEffect(() => {
    let active = true;
    void api.profile().then((profile) => {
      if (!active) return;
      const row = profile as { slug?: string; branches?: Branch[] };
      setBranches(row.branches ?? []);
      setSlug(row.slug ?? '');
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const floors = useMemo(() => {
    const map = new Map<string, DiningTable['floor']>();
    tables.forEach((table) => map.set(table.floor.id, table.floor));
    return [...map.values()];
  }, [tables]);
  const [branchId, setBranchId] = useState('all');
  const [zoneId, setZoneId] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const opened = useRef(false);
  const [editing, setEditing] = useState<DiningTable | null | 'new'>(null);
  const visible = tables.filter((table) => {
    if (branchId !== 'all' && table.branchId && table.branchId !== branchId) return false;
    if (zoneId !== 'all' && table.floor.id !== zoneId) return false;
    const haystack = `${table.number} ${table.name} ${pickLocalized(table.floor.name, locale)}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  useEffect(() => {
    if (opened.current || selectedId || !visible[0]) return;
    opened.current = true;
    setSelectedId(visible[0].id);
  }, [selectedId, visible]);
  const selected = visible.find((table) => table.id === selectedId) ?? null;
  const counts = {
    total: tables.length,
    available: tables.filter((table) => table.status === 'AVAILABLE').length,
    occupied: tables.filter((table) => table.status === 'OCCUPIED').length,
    reserved: tables.filter((table) => table.status === 'RESERVED').length,
  };
  function menuUrl(code: string | null) {
    if (!code || typeof window === 'undefined') return '';
    return `http://${window.location.hostname}:3000/${locale}/q/${code}`;
  }
  function previewMenu() {
    const code = selected?.qrCode ?? tables.find((table) => table.qrCode)?.qrCode;
    const url = menuUrl(code ?? null);
    if (url) window.open(url, '_blank');
    else if (slug) window.open(`http://${window.location.hostname}:3000/${locale}/merchants/${slug}`, '_blank');
  }

  return (
    <div className="flex flex-col gap-4 md:h-[calc(100dvh-4rem-3rem)] md:overflow-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <section className="inline-grid w-fit grid-cols-2 overflow-hidden rounded-xl border border-[#EEEEEC] bg-white shadow-[0_4px_16px_rgba(17,17,17,0.04)] sm:grid-cols-4">
          <Stat label={t('total')} value={counts.total} icon={<ChairIcon className="text-[#8A8A86]" />} />
          <Stat label={t('available')} value={counts.available} icon={<span className="size-2 rounded-full bg-[#22A85A]" />} />
          <Stat label={t('occupied')} value={counts.occupied} icon={<Users className="size-3.5 text-[#F5B400]" />} />
          <Stat label={t('reserved')} value={counts.reserved} icon={<Calendar className="size-3.5 text-[#3B82F6]" />} />
        </section>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#111111] px-4 text-sm font-semibold text-white" onClick={previewMenu}>
            <QrCode className="size-4" /> {t('preview')}
          </button>
          <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" onClick={() => setEditing('new')}>
            <Plus className="size-4" /> {t('add')}
          </Button>
        </div>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-[#EEEEEC] bg-white p-2.5 shadow-[0_8px_24px_rgba(17,17,17,0.04)] lg:flex-row lg:items-center">
        {branches.length ? (
          <label className="relative inline-flex h-11 min-w-44 items-center gap-2 rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm font-semibold text-[#161616]">
            <ChairIcon className="text-[#8A8A86]" />
            <select className="w-full appearance-none bg-transparent pe-6 outline-none" value={branchId} aria-label={t('allBranches')} onChange={(event) => setBranchId(event.target.value)}>
              <option value="all">{branches.length === 1 ? pickLocalized(branches[0]?.name, locale) : t('allBranches')}</option>
              {branches.length > 1 ? branches.map((branch) => <option key={branch.id} value={branch.id}>{pickLocalized(branch.name, locale)}</option>) : null}
            </select>
            <ChevronDown className="pointer-events-none absolute end-3 size-4 text-[#8A8A86]" />
          </label>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          <ZoneChip active={zoneId === 'all'} onClick={() => setZoneId('all')}>{t('allZones')}</ZoneChip>
          {floors.map((floor) => (
            <ZoneChip key={floor.id} active={zoneId === floor.id} onClick={() => setZoneId(floor.id)}>{pickLocalized(floor.name, locale)}</ZoneChip>
          ))}
        </div>
        <label className="relative ms-auto flex h-11 w-full items-center lg:w-56">
          <Search className="pointer-events-none absolute start-3 size-4 text-[#8A8A86]" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('find')} className="h-11 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] ps-9 pe-3 text-sm outline-none" />
        </label>
      </section>

      {tables.length === 0 ? <EmptyState title={t('none')} body={t('noneBody')} /> : null}
      {tables.length > 0 && visible.length === 0 ? <p className="text-sm font-medium text-[#8A8A86]">{t('noMatch')}</p> : null}

      <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${selected ? 'xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:grid-rows-[minmax(0,1fr)] xl:gap-4' : ''}`}>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {visible.map((table) => {
            const active = table.id === selected?.id;
            return (
              <button
                key={table.id}
                type="button"
                onClick={() => setSelectedId(table.id)}
                className={`rounded-2xl border bg-white p-4 text-start shadow-[0_8px_24px_rgba(17,17,17,0.04)] ${active ? 'border-[#F5C400] ring-2 ring-[#F5C400]' : 'border-[#EEEEEC]'}`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="text-lg font-semibold tracking-tight text-[#161616]">{table.number}</span>
                  <QrCode className="size-4 text-[#161616]" />
                </span>
                <span className="mt-1 block text-sm text-[#8A8A86]">{pickLocalized(table.floor.name, locale)} · {t('seats', { count: table.capacity })}</span>
                <span className="mt-4 flex items-center justify-between">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone[table.status]}`}>
                    <span className={`size-1.5 rounded-full ${dotTone[table.status]}`} />
                    {t(statusKey(table.status))}
                  </span>
                  <ChairIcon className="text-[#C8C8C4]" />
                </span>
              </button>
            );
          })}
        </div>
        </div>
        {selected ? (
          <TablePanel
            table={selected}
            locale={locale}
            menuUrl={menuUrl(selected.qrCode)}
            onClose={() => setSelectedId(null)}
            onEdit={() => setEditing(selected)}
            labels={{
              table: t('tableLabel', { number: selected.number }),
              close: t('close'),
              seats: t('seats', { count: selected.capacity }),
              status: t(statusKey(selected.status)),
              qrTitle: t('qrTitle'),
              qrHint: t('qrHint'),
              print: t('print'),
              edit: t('edit'),
              currentOrder: t('currentOrder'),
              items: selected.order ? t('items', { count: selected.order.itemCount }) : '',
              inProgress: t('inProgress'),
              viewOrder: t('viewOrder'),
              noOrder: t('noOrder'),
            }}
          />
        ) : null}
      </div>

      <TableDialog
        open={editing !== null}
        table={editing === 'new' ? null : editing}
        floors={floors}
        onClose={() => setEditing(null)}
        onSaved={(id) => {
          setEditing(null);
          if (id) setSelectedId(id);
          void client.invalidateQueries({ queryKey: ['merchant', 'tables'] });
        }}
      />
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-[#EEEEEC] px-2.5 py-1.5 odd:border-e even:border-b sm:border-b-0 sm:border-e sm:last:border-e-0">
      <span className="grid size-6 place-items-center rounded-full bg-[#F7F7F5]">{icon}</span>
      <div className="leading-tight">
        <p className="text-[10px] text-[#8A8A86]">{label}</p>
        <p className="text-sm font-semibold text-[#161616]">{value}</p>
      </div>
    </div>
  );
}

function ZoneChip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`h-10 rounded-xl px-4 text-sm font-semibold ${active ? 'bg-[#F5C400] text-[#111111]' : 'text-[#5C5C58] hover:bg-[#F7F7F5]'}`}>
      {children}
    </button>
  );
}

function TablePanel({
  table, locale, menuUrl, onClose, onEdit, labels,
}: {
  table: DiningTable;
  locale: 'en' | 'ar';
  menuUrl: string;
  onClose: () => void;
  onEdit: () => void;
  labels: {
    table: string; close: string; seats: string; status: string; qrTitle: string; qrHint: string; print: string; edit: string;
    currentOrder: string; items: string; inProgress: string; viewOrder: string; noOrder: string;
  };
}) {
  function printQr() {
    const popup = window.open('', '_blank', 'noopener,noreferrer,width=420,height=640');
    if (!popup) return;
    const markup = qrSvg(menuUrl || table.number, 220);
    popup.document.write(`<!doctype html><title>${labels.table}</title><body style="font-family:sans-serif;text-align:center;padding:32px"><h1>${labels.table}</h1>${markup}<p>${labels.qrHint}</p><script>onload=()=>print()</script></body>`);
    popup.document.close();
  }
  return (
    <div className="min-h-0 xl:h-full xl:overflow-hidden">
      <button type="button" className="fixed inset-0 z-30 bg-black/30 xl:hidden" aria-label={labels.close} onClick={onClose} />
      <aside className="fixed inset-y-0 end-0 z-40 w-[min(100%,22rem)] overflow-y-auto overscroll-contain border-s border-[#EEEEEC] bg-white p-5 shadow-xl xl:static xl:z-0 xl:h-full xl:w-auto xl:rounded-2xl xl:border xl:shadow-[0_8px_24px_rgba(17,17,17,0.04)]">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-[#161616]">{labels.table}</h2>
          <button type="button" className="grid size-8 place-items-center rounded-full hover:bg-[#F7F7F5]" aria-label={labels.close} onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        <ul className="mt-4 space-y-2.5 text-sm text-[#5C5C58]">
          <li className="flex items-center gap-2"><ChairIcon /> {pickLocalized(table.floor.name, locale)}</li>
          <li className="flex items-center gap-2"><Users className="size-4 text-[#8A8A86]" /> {labels.seats}</li>
          <li className="flex items-center gap-2"><span className={`size-2 rounded-full ${dotTone[table.status]}`} /> {labels.status}</li>
        </ul>
        <div className="mt-6 border-t border-[#EEEEEC] pt-5">
          <h3 className="font-semibold text-[#161616]">{labels.qrTitle}</h3>
          <p className="mt-1 text-sm leading-relaxed text-[#8A8A86]">{labels.qrHint}</p>
          <div className="mt-4 grid place-items-center rounded-2xl border border-[#EEEEEC] bg-white p-4">
            {menuUrl ? <QrMark value={menuUrl} /> : <QrCode className="size-16 text-[#C8C8C4]" />}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#E4E4E0] bg-white text-sm font-semibold text-[#161616]" onClick={printQr}>
              <Printer className="size-4" /> {labels.print}
            </button>
            <button type="button" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#E4E4E0] bg-white text-sm font-semibold text-[#161616]" onClick={onEdit}>
              <Pencil className="size-4" /> {labels.edit}
            </button>
          </div>
        </div>
        <div className="mt-6 border-t border-[#EEEEEC] pt-5">
          <h3 className="font-semibold text-[#161616]">{labels.currentOrder}</h3>
          {table.order ? (
            <div className="mt-3 rounded-2xl border border-[#EEEEEC] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="grid size-9 place-items-center rounded-xl bg-[#F7F7F5] text-sm">#</span>
                  <div>
                    <p className="font-semibold text-[#161616]">#{table.order.number}</p>
                    <p className="text-xs text-[#8A8A86]">{labels.items}</p>
                  </div>
                </div>
                <span className="rounded-full bg-[#FFF4D6] px-2 py-1 text-[11px] font-semibold text-[#C47D00]">{labels.inProgress}</span>
              </div>
              <p className="mt-3 text-end text-sm font-semibold text-[#161616]">{formatMoney(table.order.total, locale)}</p>
              <Link href="/orders" className="mt-3 flex h-11 items-center justify-center gap-2 rounded-xl bg-[#111111] text-sm font-semibold text-white">
                {labels.viewOrder} <span aria-hidden>→</span>
              </Link>
            </div>
          ) : <p className="mt-3 text-sm text-[#8A8A86]">{labels.noOrder}</p>}
        </div>
      </aside>
    </div>
  );
}

function TableDialog({
  open, table, floors, onClose, onSaved,
}: {
  open: boolean;
  table: DiningTable | null;
  floors: DiningTable['floor'][];
  onClose: () => void;
  onSaved: (id?: string) => void;
}) {
  const t = useTranslations('merchantTables');
  const locale = useLocale() as 'en' | 'ar';
  const [number, setNumber] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [floorId, setFloorId] = useState('');
  const [zoneName, setZoneName] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setNumber(table?.number ?? '');
    setCapacity(String(table?.capacity ?? 4));
    setFloorId(table?.floor.id ?? floors[0]?.id ?? 'new');
    setZoneName('');
    setError('');
  }, [open, table, floors]);
  const save = useMutation({
    mutationFn: async () => {
      const seats = Number(capacity);
      const label = number.trim();
      if (!label || !Number.isInteger(seats) || seats < 1) throw new Error(t('required'));
      let nextFloorId = floorId;
      if (floorId === 'new') {
        const name = zoneName.trim();
        if (!name) throw new Error(t('required'));
        const floor = await api.createFloor({ name: { en: name, ar: name } }) as { id: string };
        nextFloorId = floor.id;
      }
      if (!nextFloorId || nextFloorId === 'new') throw new Error(t('required'));
      if (table) {
        await api.updateTable(table.id, { number: label, name: label, capacity: seats, floorId: nextFloorId });
        return table.id;
      }
      const created = await api.createTable({ floorId: nextFloorId, name: label, number: label, capacity: seats }) as { id?: string };
      return created.id;
    },
    onSuccess: (id) => onSaved(id),
    onError: (reason: Error) => setError(reason.message),
  });
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="w-[min(100%-2rem,28rem)]">
        <DialogTitle>{table ? t('edit') : t('add')}</DialogTitle>
        <DialogDescription>{t('subtitle')}</DialogDescription>
        <div className="mt-4 grid gap-3">
          <label className="block text-sm font-semibold text-[#161616]">
            {t('number')}
            <input className="mt-1.5 h-11 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm font-medium outline-none" value={number} onChange={(event) => setNumber(event.target.value)} />
          </label>
          <label className="block text-sm font-semibold text-[#161616]">
            {t('capacity')}
            <input type="number" min={1} className="mt-1.5 h-11 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm font-medium outline-none" value={capacity} onChange={(event) => setCapacity(event.target.value)} />
          </label>
          <label className="block text-sm font-semibold text-[#161616]">
            {t('zone')}
            <select className="mt-1.5 h-11 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm font-medium outline-none" value={floorId} onChange={(event) => setFloorId(event.target.value)}>
              {floors.map((floor) => <option key={floor.id} value={floor.id}>{pickLocalized(floor.name, locale)}</option>)}
              <option value="new">{t('newZone')}</option>
            </select>
          </label>
          {floorId === 'new' ? (
            <label className="block text-sm font-semibold text-[#161616]">
              {t('zoneName')}
              <input className="mt-1.5 h-11 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm font-medium outline-none" value={zoneName} onChange={(event) => setZoneName(event.target.value)} />
            </label>
          ) : null}
        </div>
        {error ? <p className="mt-3 text-sm font-medium text-[#B42318]">{error}</p> : null}
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" loading={save.isPending} onClick={() => { setError(''); save.mutate(); }}>{t('save')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function statusKey(status: TableStatus) {
  if (status === 'OCCUPIED') return 'occupied';
  if (status === 'RESERVED') return 'reserved';
  if (status === 'INACTIVE') return 'inactive';
  return 'available';
}

function ChairIcon({ className = 'text-[#8A8A86]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`size-4 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M7 10V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4" />
      <path d="M6 10h12v4H6z" />
      <path d="M8 14v5M16 14v5" />
    </svg>
  );
}

function QrMark({ value }: { value: string }) {
  return <span dangerouslySetInnerHTML={{ __html: qrSvg(value, 168) }} />;
}

function qrSvg(value: string, size: number) {
  const cells = qrModules(value);
  const rects = cells.map((on, index) => on ? `<rect x="${index % 25}" y="${Math.floor(index / 25)}" width="1" height="1" fill="#111"/>` : '').join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 25 25" shape-rendering="crispEdges" aria-hidden="true"><rect width="25" height="25" fill="#fff"/>${rects}</svg>`;
}

function qrModules(value: string) {
  const size = 25;
  const grid = Array.from({ length: size * size }, () => false);
  const paint = (x: number, y: number, on: boolean) => {
    if (x >= 0 && y >= 0 && x < size && y < size) grid[y * size + x] = on;
  };
  const finder = (ox: number, oy: number) => {
    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        const edge = x === 0 || y === 0 || x === 6 || y === 6;
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        paint(ox + x, oy + y, edge || core);
      }
    }
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  for (let i = 8; i < size - 8; i += 1) {
    paint(i, 6, i % 2 === 0);
    paint(6, i, i % 2 === 0);
  }
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inFinder = (x < 8 && y < 8) || (x > size - 9 && y < 8) || (x < 8 && y > size - 9);
      const center = x > 8 && x < 16 && y > 8 && y < 16;
      if (inFinder || center || grid[y * size + x]) continue;
      hash = Math.imul(hash ^ (x * 31 + y), 16777619);
      paint(x, y, (hash >>> 0) % 3 !== 0);
    }
  }
  return grid;
}
