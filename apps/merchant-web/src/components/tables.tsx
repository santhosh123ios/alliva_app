import { api } from '@/components/providers';
import { Link } from '@/i18n/navigation';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, EmptyState, toast } from '@alliva/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Calendar, Check, Grid3X3, List, Minus, Move, Pencil, Plus, Printer, QrCode, RotateCcw, Save, Search, Sparkles, Users, X } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

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

type TablePosition = { x: number; y: number };
type ZoneRect = { x: number; y: number; width: number; height: number };

/** `canManage` adds and edits tables; floor staff without it only change a table's status. */
export function TablesPage({ tables: rows, canManage = true }: { tables: DiningTable[]; canManage?: boolean }) {
  const t = useTranslations('merchantTables');
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const tables = useMemo(
    () => rows.slice().sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })),
    [rows],
  );
  const floors = useMemo(() => {
    const map = new Map<string, DiningTable['floor']>();
    tables.forEach((table) => map.set(table.floor.id, table.floor));
    return [...map.values()];
  }, [tables]);
  const [zoneId, setZoneId] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'floor' | 'list'>('floor');
  const [positions, setPositions] = useState<Record<string, TablePosition>>({});
  const [statusOverrides, setStatusOverrides] = useState<Record<string, TableStatus>>({});
  const [zoneOrder, setZoneOrder] = useState<string[]>([]);
  const [zoneWidths, setZoneWidths] = useState<Record<string, number>>({});
  const [zoneHeights, setZoneHeights] = useState<Record<string, number>>({});
  const [zoneRects, setZoneRects] = useState<Record<string, ZoneRect>>({});
  const dragging = useRef<string | null>(null);
  const positionsRef = useRef<Record<string, TablePosition>>({});
  const zoneRectsRef = useRef<Record<string, ZoneRect>>({});
  const opened = useRef(false);
  const [editing, setEditing] = useState<DiningTable | null | 'new'>(null);
  const [params] = useSearchParams();
  useEffect(() => {
    if (params.get('new') === '1' && canManage) setEditing('new');
  }, [params, canManage]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('alliva-table-layout-v2');
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, TablePosition>;
        positionsRef.current = parsed;
        setPositions(parsed);
      }
      const savedZones = localStorage.getItem('alliva-zone-layout-v1');
      if (savedZones) {
        const layout = JSON.parse(savedZones) as { order?: string[]; widths?: Record<string, number>; heights?: Record<string, number>; rects?: Record<string, ZoneRect> };
        setZoneOrder(layout.order ?? []);
        setZoneWidths(layout.widths ?? {});
        setZoneHeights(layout.heights ?? {});
        zoneRectsRef.current = layout.rects ?? {};
        setZoneRects(layout.rects ?? {});
      }
    } catch {
      positionsRef.current = {};
      setPositions({});
    }
  }, []);
  useEffect(() => {
    const ids = floors.map((floor) => floor.id);
    setZoneOrder((current) => [...current.filter((id) => ids.includes(id)), ...ids.filter((id) => !current.includes(id))]);
  }, [floors]);
  const orderedFloors = useMemo(
    () => [...floors].sort((a, b) => {
      const aIndex = zoneOrder.indexOf(a.id);
      const bIndex = zoneOrder.indexOf(b.id);
      return (aIndex < 0 ? floors.length : aIndex) - (bIndex < 0 ? floors.length : bIndex);
    }),
    [floors, zoneOrder],
  );
  const visible = tables.filter((table) => {
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
  const tableStatus = (table: DiningTable) => statusOverrides[table.id] ?? table.status;
  const counts = {
    total: tables.length,
    available: tables.filter((table) => tableStatus(table) === 'AVAILABLE').length,
    occupied: tables.filter((table) => tableStatus(table) === 'OCCUPIED').length,
    reserved: tables.filter((table) => tableStatus(table) === 'RESERVED').length,
    cleaning: tables.filter((table) => tableStatus(table) === 'INACTIVE').length,
  };
  function menuUrl(code: string | null) {
    if (!code || typeof window === 'undefined') return '';
    return `http://${window.location.hostname}:3000/${locale}/q/${code}`;
  }
  function positionFor(table: DiningTable, index: number) {
    const saved = positions[table.id];
    if (saved) return saved;
    const zoneIndex = Math.max(0, orderedFloors.findIndex((floor) => floor.id === table.floor.id));
    const zoneTables = tables.filter((item) => item.floor.id === table.floor.id);
    const localIndex = Math.max(0, zoneTables.findIndex((item) => item.id === table.id));
    const fallbackWidth = 100 / Math.max(1, orderedFloors.length);
    const rect = zoneRects[table.floor.id] ?? {
      x: orderedFloors.slice(0, zoneIndex).reduce((sum, floor) => sum + (zoneWidths[floor.id] ?? fallbackWidth), 0),
      y: 0,
      width: zoneWidths[table.floor.id] ?? fallbackWidth,
      height: zoneHeights[table.floor.id] ?? 100,
    };
    return {
      x: rect.x + rect.width * (zoneTables.length > 1 ? 0.3 + (localIndex % 2) * 0.4 : 0.5),
      y: rect.y + Math.min(rect.height - 10, 24 + Math.floor(localIndex / 2) * 29),
    };
  }
  function autoArrange() {
    const next: Record<string, TablePosition> = {};
    orderedFloors.forEach((floor, zoneIndex) => {
      const zoneTables = tables.filter((table) => table.floor.id === floor.id);
      const fallbackWidth = 100 / Math.max(1, orderedFloors.length);
      const rect = zoneRects[floor.id] ?? { x: zoneIndex * fallbackWidth, y: 0, width: fallbackWidth, height: 100 };
      zoneTables.forEach((table, localIndex) => {
        next[table.id] = {
          x: rect.x + rect.width * (zoneTables.length > 1 ? 0.3 + (localIndex % 2) * 0.4 : 0.5),
          y: rect.y + Math.min(rect.height - 10, 24 + Math.floor(localIndex / 2) * 29),
        };
      });
    });
    positionsRef.current = next;
    setPositions(next);
    saveLayout(next);
  }
  function saveZoneLayout(order: string[], widths: Record<string, number>, heights = zoneHeights, rects = zoneRects) {
    localStorage.setItem('alliva-zone-layout-v1', JSON.stringify({ order, widths, heights, rects }));
  }
  function moveZone(id: string, direction: -1 | 1) {
    const current = orderedFloors.map((floor) => floor.id);
    const index = current.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target]!, current[index]!];
    setZoneOrder(current);
    saveZoneLayout(current, zoneWidths);
  }
  function resizeZone(id: string, delta: number) {
    const ids = orderedFloors.map((floor) => floor.id);
    const index = ids.indexOf(id);
    const neighborId = ids[index + 1] ?? ids[index - 1];
    if (!neighborId) return;
    const fallback = 100 / ids.length;
    const currentSize = zoneWidths[id] ?? fallback;
    const neighborSize = zoneWidths[neighborId] ?? fallback;
    const applied = Math.max(15 - currentSize, Math.min(delta, neighborSize - 15));
    const next = { ...zoneWidths, [id]: currentSize + applied, [neighborId]: neighborSize - applied };
    setZoneWidths(next);
    saveZoneLayout(ids, next);
  }
  function resizeZoneHeight(id: string, delta: number) {
    const next = { ...zoneHeights, [id]: Math.max(35, Math.min(100, (zoneHeights[id] ?? 100) + delta)) };
    setZoneHeights(next);
    saveZoneLayout(orderedFloors.map((floor) => floor.id), zoneWidths, next);
  }
  function updateZoneRect(id: string, rect: ZoneRect) {
    const zoneIndex = Math.max(0, orderedFloors.findIndex((floor) => floor.id === id));
    const fallbackWidth = 100 / Math.max(1, orderedFloors.length);
    const oldRect = zoneRectsRef.current[id] ?? { x: zoneIndex * fallbackWidth, y: 0, width: fallbackWidth, height: 100 };
    const zoneTables = tables.filter((table) => table.floor.id === id);
    const nextPositions = { ...positionsRef.current };
    zoneTables.forEach((table, index) => {
      const base = nextPositions[table.id] ?? {
        x: oldRect.x + oldRect.width * (zoneTables.length > 1 ? 0.3 + (index % 2) * 0.4 : 0.5),
        y: oldRect.y + Math.min(oldRect.height - 10, 24 + Math.floor(index / 2) * 29),
      };
      const relativeX = oldRect.width ? (base.x - oldRect.x) / oldRect.width : 0.5;
      const relativeY = oldRect.height ? (base.y - oldRect.y) / oldRect.height : 0.5;
      nextPositions[table.id] = { x: rect.x + relativeX * rect.width, y: rect.y + relativeY * rect.height };
    });
    positionsRef.current = nextPositions;
    setPositions(nextPositions);
    localStorage.setItem('alliva-table-layout-v2', JSON.stringify(nextPositions));
    const nextRects = { ...zoneRectsRef.current, [id]: rect };
    zoneRectsRef.current = nextRects;
    setZoneRects(nextRects);
    saveZoneLayout(orderedFloors.map((floor) => floor.id), zoneWidths, zoneHeights, nextRects);
  }
  function moveTable(event: React.PointerEvent<HTMLButtonElement>, table: DiningTable) {
    if (dragging.current !== table.id) return;
    const canvas = event.currentTarget.parentElement;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const x = Math.max(7, Math.min(93, ((event.clientX - bounds.left) / bounds.width) * 100));
    const y = Math.max(10, Math.min(90, ((event.clientY - bounds.top) / bounds.height) * 100));
    setPositions((current) => {
      const next = { ...current, [table.id]: { x, y } };
      positionsRef.current = next;
      localStorage.setItem('alliva-table-layout-v2', JSON.stringify(next));
      return next;
    });
  }
  function saveLayout(next = positions) {
    localStorage.setItem('alliva-table-layout-v2', JSON.stringify(next));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 xl:h-full xl:overflow-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><h1 className="text-2xl font-bold tracking-[-0.03em]">{t('seatingTitle')}</h1><p className="mt-0.5 text-sm text-[#74746D]">{t('seatingSubtitle')}</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => window.print()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#DDDCD7] bg-white px-3 text-xs font-semibold"><Printer className="size-4" />{t('printAll')}</button>
          {canManage ? (
            <>
              <button type="button" onClick={() => setEditing('new')} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#DDDCD7] bg-white px-3 text-xs font-semibold"><Plus className="size-4" />{t('addZone')}</button>
              <Button type="button" variant="yellow" className="h-10 rounded-lg px-4" onClick={() => setEditing('new')}><Plus className="size-4" /> {t('add')}</Button>
            </>
          ) : null}
        </div>
      </div>

      {tables.length === 0 ? <EmptyState title={t('none')} body={t('noneBody')} /> : null}
      {tables.length > 0 && visible.length === 0 ? <p className="text-sm font-medium text-[#8A8A86]">{t('noMatch')}</p> : null}

      <div className="grid min-h-0 flex-1 items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3 xl:min-h-0 xl:overflow-y-auto">
          <section className="flex w-full flex-col gap-2 rounded-xl border border-[#E3E2DD] bg-white p-2 lg:flex-row lg:items-center">
            <div className="flex min-w-0 gap-1 overflow-x-auto">
              <ZoneChip active={zoneId === 'all'} onClick={() => setZoneId('all')}>{t('allZones')} <small>{tables.length}</small></ZoneChip>
              {floors.map((floor) => <ZoneChip key={floor.id} active={zoneId === floor.id} onClick={() => setZoneId(floor.id)}>{pickLocalized(floor.name, locale)} <small>{tables.filter((table) => table.floor.id === floor.id).length}</small></ZoneChip>)}
            </div>
            <label className="relative ms-auto flex h-9 w-full items-center lg:w-52">
              <Search className="pointer-events-none absolute start-3 size-4 text-[#8A8A86]" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('findOrder')} className="h-9 w-full rounded-lg border border-[#E3E2DD] ps-9 pe-3 text-xs outline-none" />
            </label>
            <div className="flex h-9 overflow-hidden rounded-lg border border-[#E4E3DE] bg-white">
              <button type="button" onClick={() => setView('floor')} className={`inline-flex items-center gap-1.5 px-3 text-xs font-semibold ${view === 'floor' ? 'bg-[#FFC400]' : ''}`}><Grid3X3 className="size-3.5" />{t('arrange')}</button>
              <button type="button" onClick={() => setView('list')} className={`inline-flex items-center gap-1.5 border-s border-[#E4E3DE] px-3 text-xs font-semibold ${view === 'list' ? 'bg-[#FFC400]' : ''}`}><List className="size-3.5" />{t('list')}</button>
            </div>
          </section>
          <section className="overflow-hidden rounded-xl border border-[#E3E2DD] bg-white">
            <div className="flex flex-wrap items-center gap-2 border-b border-[#E6E5DD] px-3 py-2">
              <h2 className="shrink-0 text-sm font-bold">{zoneId === 'all' ? t('allTables') : pickLocalized(floors.find((floor) => floor.id === zoneId)?.name ?? {}, locale)}</h2>
              <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
                <div className="flex overflow-hidden rounded-lg border border-[#E6E5DD] bg-[#FAFAF8]">
                  <TableMetric icon={<ChairIcon />} label={t('total')} value={counts.total} />
                  <TableMetric dot="#14A05A" label={t('available')} value={counts.available} />
                  <TableMetric dot="#EF3C3C" label={t('occupied')} value={counts.occupied} />
                  <TableMetric dot="#2477E8" label={t('reserved')} value={counts.reserved} />
                  <TableMetric dot="#8C8C86" label={t('cleaning')} value={counts.cleaning} />
                </div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={autoArrange} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#E2C64B] bg-[#FFF7CF] px-2.5 text-[11px] font-semibold"><Sparkles className="size-3.5" />{t('autoArrange')}</button>
                  <button type="button" onClick={() => { positionsRef.current = {}; setPositions({}); localStorage.removeItem('alliva-table-layout-v2'); }} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#DDDCD7] px-2.5 text-[11px] font-semibold"><RotateCcw className="size-3.5" />{t('reset')}</button>
                  <button type="button" onClick={() => saveLayout()} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#171712] px-2.5 text-[11px] font-semibold text-white"><Save className="size-3.5" />{t('saveLayout')}</button>
                </div>
              </div>
            </div>
            {view === 'floor' ? (
              <div className="relative h-[430px] overflow-hidden bg-[#FBFAF6] [background-image:linear-gradient(#E9E7DF_1px,transparent_1px),linear-gradient(90deg,#E9E7DF_1px,transparent_1px),linear-gradient(#F2F0E9_1px,transparent_1px),linear-gradient(90deg,#F2F0E9_1px,transparent_1px)] [background-size:80px_80px,80px_80px,20px_20px,20px_20px]">
                <ZoneLayout
                  floors={orderedFloors}
                  tables={tables}
                  locale={locale}
                  rects={zoneRects}
                  onRectChange={updateZoneRect}
                />
                {visible.map((table, index) => {
                  const position = positionFor(table, index);
                  const status = tableStatus(table);
                  return <FloorTable key={table.id} table={table} status={status} selected={selected?.id === table.id} position={position} locale={locale} onSelect={() => setSelectedId(table.id)} onPointerDown={(event) => { dragging.current = table.id; event.currentTarget.setPointerCapture(event.pointerId); setSelectedId(table.id); }} onPointerMove={(event) => moveTable(event, table)} onPointerUp={() => { dragging.current = null; }} />;
                })}
                <span className="absolute bottom-3 start-3 text-[10px] text-[#99978E]">{t('gridHint')}</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[650px]">
                  <div className="grid grid-cols-[1fr_1fr_80px_110px_1fr_70px] border-b bg-[#FAFAF8] px-3 py-2 text-[10px] font-semibold uppercase text-[#777772]"><span>{t('table')}</span><span>{t('zone')}</span><span>{t('capacity')}</span><span>{t('status')}</span><span>{t('currentOrder')}</span><span /></div>
                  {visible.map((table) => <button key={table.id} type="button" onClick={() => setSelectedId(table.id)} className="grid w-full grid-cols-[1fr_1fr_80px_110px_1fr_70px] items-center border-b px-3 py-2.5 text-start text-xs last:border-b-0"><strong>{table.number}</strong><span>{pickLocalized(table.floor.name, locale)}</span><span>{table.capacity}</span><span className={`w-fit rounded-full px-2 py-1 font-semibold ${statusTone[tableStatus(table)]}`}>{t(statusKey(tableStatus(table)))}</span><span>{table.order ? `#${table.order.number}` : '—'}</span><span className="font-semibold text-[#185BC9]">{t('view')}</span></button>)}
                </div>
              </div>
            )}
            <div className="flex h-10 items-center border-t px-3 text-[10px]"><span className="font-semibold text-[#149050]">{t('changesSaved')}</span><span className="ms-auto text-[#777772]">{selected ? t('positionSelected', { number: selected.number }) : t('selectPosition')}</span></div>
          </section>
          <div className="grid gap-3 lg:grid-cols-[1.1fr_.9fr]">
            <MiniPanel title={t('upcoming')} action={t('viewAll')}><div className="grid gap-2 sm:grid-cols-3"><MiniItem title="7:30 PM · Sara Ahmed" detail="T03 · 2 guests" /><MiniItem title="8:00 PM · Mohammed Ali" detail="T07 · 6 guests" /><MiniItem title="8:30 PM · Fatima Khan" detail="T13 · 4 guests" /></div></MiniPanel>
            <MiniPanel title={t('serviceRequests')} action={t('viewAll')}><div className="grid gap-2 sm:grid-cols-2"><MiniItem title="T06 · Wants bill" detail="12 minutes ago" danger /><MiniItem title="T11 · Needs assistance" detail="8 minutes ago" /></div></MiniPanel>
          </div>
        </div>
        {selected ? <TablePanel table={selected} status={tableStatus(selected)} locale={locale} menuUrl={menuUrl(selected.qrCode)} position={positionFor(selected, visible.findIndex((table) => table.id === selected.id))} onClose={() => setSelectedId(null)} onEdit={canManage ? () => setEditing(selected) : undefined} onStatus={(status) => {
          const id = selected.id;
          const before = statusOverrides[id];
          setStatusOverrides((current) => ({ ...current, [id]: status }));
          api.setTableStatus(id, status).then(
            () => void client.invalidateQueries({ queryKey: ['merchant', 'tables'] }),
            (error: Error) => {
              setStatusOverrides((current) => ({ ...current, [id]: before ?? selected.status }));
              toast.error(error.message);
            },
          );
        }} labels={{ table: t('tableLabel', { number: selected.number }), close: t('close'), seats: t('seats', { count: selected.capacity }), status: t(statusKey(tableStatus(selected))), qrTitle: t('qrTitle'), qrHint: t('qrHint'), print: t('print'), edit: t('edit'), currentOrder: t('currentOrder'), items: selected.order ? t('items', { count: selected.order.itemCount }) : '', inProgress: t('inProgress'), viewOrder: t('viewOrder'), noOrder: t('noOrder') }} /> : null}
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

function TableMetric({ label, value, icon, dot }: { label: string; value: number; icon?: React.ReactNode; dot?: string }) {
  return (
    <div className="flex items-center gap-1.5 border-e border-[#E6E5DD] px-2.5 py-1.5 last:border-e-0">
      <span className="grid size-5 shrink-0 place-items-center rounded bg-[#FAF3CB]">{dot ? <span className="size-1.5 rounded-full" style={{ backgroundColor: dot }} /> : icon}</span>
      <span className="whitespace-nowrap text-[10px] text-[#74746D]">{label}</span>
      <strong className="text-sm leading-none">{value}</strong>
    </div>
  );
}

function ZoneChip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`h-9 shrink-0 rounded-lg px-3 text-xs font-semibold ${active ? 'bg-[#F5C400] text-[#111111]' : 'bg-[#F3F3EF] text-[#5C5C58] hover:bg-[#EDEDE9]'} [&>small]:ms-1 [&>small]:rounded-full [&>small]:bg-black/5 [&>small]:px-1.5 [&>small]:py-0.5`}>
      {children}
    </button>
  );
}

function ZoneLayout({ floors, tables, locale, rects, onRectChange }: {
  floors: DiningTable['floor'][];
  tables: DiningTable[];
  locale: 'en' | 'ar';
  rects: Record<string, ZoneRect>;
  onRectChange: (id: string, rect: ZoneRect) => void;
}) {
  const t = useTranslations('merchantTables');
  const container = useRef<HTMLDivElement>(null);
  const interaction = useRef<{ id: string; mode: 'move' | 'width' | 'height' | 'both'; startX: number; startY: number; rect: ZoneRect } | null>(null);
  const colors = ['bg-[#FFF9DE]/55', 'bg-[#EEF6FF]/55', 'bg-[#EFF9F2]/55', 'bg-[#F7F0FF]/55'];
  function fallbackRect(index: number): ZoneRect {
    const width = 100 / Math.max(1, floors.length);
    return { x: index * width, y: 0, width, height: 100 };
  }
  function start(event: React.PointerEvent<HTMLElement>, id: string, mode: 'move' | 'width' | 'height' | 'both', rect: ZoneRect) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    interaction.current = { id, mode, startX: event.clientX, startY: event.clientY, rect };
  }
  function change(event: React.PointerEvent<HTMLElement>) {
    const active = interaction.current;
    const bounds = container.current?.getBoundingClientRect();
    if (!active || !bounds) return;
    const dx = ((event.clientX - active.startX) / bounds.width) * 100;
    const dy = ((event.clientY - active.startY) / bounds.height) * 100;
    const next = { ...active.rect };
    if (active.mode === 'move') {
      next.x = Math.max(0, Math.min(100 - next.width, active.rect.x + dx));
      next.y = Math.max(0, Math.min(100 - next.height, active.rect.y + dy));
    }
    if (active.mode === 'width' || active.mode === 'both') next.width = Math.max(15, Math.min(100 - next.x, active.rect.width + dx));
    if (active.mode === 'height' || active.mode === 'both') next.height = Math.max(30, Math.min(100 - next.y, active.rect.height + dy));
    onRectChange(active.id, next);
  }
  function end(event: React.PointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    interaction.current = null;
  }
  return (
    <div ref={container} className="pointer-events-none absolute inset-0">
      {floors.map((floor, index) => {
        const rect = rects[floor.id] ?? fallbackRect(index);
        return (
          <section key={floor.id} style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.width}%`, height: `${rect.height}%` }} className={`pointer-events-none absolute border-2 border-dashed border-[#BDBAAF] ${colors[index % colors.length]}`}>
            <button type="button" onPointerDown={(event) => start(event, floor.id, 'move', rect)} onPointerMove={change} onPointerUp={end} className="pointer-events-auto absolute start-2 top-2 flex max-w-[calc(100%-1rem)] cursor-move items-center gap-1.5 rounded-md border border-[#DEDCD2] bg-white/95 px-2 py-1 text-start shadow-sm backdrop-blur-sm">
              <Move className="size-3 shrink-0 text-[#777772]" />
              <span className="min-w-0"><strong className="block truncate text-[10px] text-[#34342F]">{pickLocalized(floor.name, locale)}</strong><span className="block text-[9px] text-[#85857E]">{t('tablesCount', { count: tables.filter((table) => table.floor.id === floor.id).length })}</span></span>
            </button>
            <span onPointerDown={(event) => start(event, floor.id, 'width', rect)} onPointerMove={change} onPointerUp={end} className="pointer-events-auto absolute inset-y-0 -end-1.5 w-3 cursor-ew-resize hover:bg-[#F6C915]/30" aria-label={t('resizeWidth')} />
            <span onPointerDown={(event) => start(event, floor.id, 'height', rect)} onPointerMove={change} onPointerUp={end} className="pointer-events-auto absolute inset-x-0 -bottom-1.5 h-3 cursor-ns-resize hover:bg-[#F6C915]/30" aria-label={t('resizeHeight')} />
            <span onPointerDown={(event) => start(event, floor.id, 'both', rect)} onPointerMove={change} onPointerUp={end} className="pointer-events-auto absolute -bottom-2 -end-2 z-10 size-4 cursor-nwse-resize rounded-sm border border-[#9E9B90] bg-[#F6C915]" aria-label={t('resizeBoth')} />
          </section>
        );
      })}
    </div>
  );
}

function FloorTable({ table, status, selected, position, locale, onSelect, onPointerDown, onPointerMove, onPointerUp }: {
  table: DiningTable; status: TableStatus; selected: boolean; position: TablePosition; locale: 'en' | 'ar';
  onSelect: () => void; onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void; onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void; onPointerUp: () => void;
}) {
  const t = useTranslations('merchantTables');
  const wide = table.capacity >= 6;
  const round = table.capacity <= 2;
  return (
    <button type="button" onClick={onSelect} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} style={{ left: `${position.x}%`, top: `${position.y}%`, touchAction: 'none' }} className={`absolute grid -translate-x-1/2 -translate-y-1/2 cursor-grab place-items-center border-2 bg-white shadow-[0_5px_16px_rgba(23,23,18,.09)] active:cursor-grabbing ${wide ? 'h-[72px] w-[140px]' : 'h-[72px] w-[108px]'} ${round ? 'rounded-full' : 'rounded-xl'} ${selected ? 'z-10 border-[#F6C915] ring-4 ring-[#F6C915]/25' : 'border-[#E6E5DD]'}`}>
      <span className={`absolute -end-1.5 -top-1.5 size-3.5 rounded-full border-[3px] border-white ${dotTone[status]}`} />
      <span><strong className="block text-sm">{table.number}</strong><span className="block whitespace-nowrap text-[9px] text-[#74746D]">{t('seats', { count: table.capacity })} · {pickLocalized(table.floor.name, locale)}</span>{table.order ? <span className="mt-0.5 block text-[9px] font-bold text-[#EF3C3C]">#{table.order.number}</span> : null}</span>
      <SeatMarkers count={table.capacity} />
    </button>
  );
}

function SeatMarkers({ count }: { count: number }) {
  const seats = Math.max(1, count);
  const sides: Array<'top' | 'right' | 'bottom' | 'left'> = seats === 1
    ? ['top']
    : seats === 2
      ? ['top', 'bottom']
      : seats === 3
        ? ['top', 'right', 'left']
        : ['left', 'right', ...Array.from({ length: Math.ceil((seats - 2) / 2) }, () => 'top' as const), ...Array.from({ length: Math.floor((seats - 2) / 2) }, () => 'bottom' as const)];
  const totals = sides.reduce<Record<string, number>>((result, side) => ({ ...result, [side]: (result[side] ?? 0) + 1 }), {});
  const seen: Record<string, number> = {};
  return (
    <>
      {sides.map((side, index) => {
        const position = seen[side] = (seen[side] ?? 0) + 1;
        const offset = `${(position / ((totals[side] ?? 0) + 1)) * 100}%`;
        const horizontal = side === 'top' || side === 'bottom';
        return (
          <i
            key={`${side}-${index}`}
            className="absolute rounded-md border border-[#AAA79D] bg-[#C7C4B8]"
            style={horizontal
              ? { width: 20, height: 8, left: offset, transform: 'translateX(-50%)', [side]: -10 }
              : { width: 8, height: 20, top: offset, transform: 'translateY(-50%)', [side]: -10 }}
          />
        );
      })}
    </>
  );
}

function MiniPanel({ title, action, children }: { title: string; action: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-[#E3E2DD] bg-white p-3"><div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-bold">{title}</h3><button type="button" className="text-[10px] font-semibold text-[#185BC9]">{action}</button></div>{children}</section>;
}

function MiniItem({ title, detail, danger = false }: { title: string; detail: string; danger?: boolean }) {
  return <div className="rounded-lg border border-[#E6E5DD] p-2 text-[10px]"><strong className={`block text-[11px] ${danger ? 'text-[#C93131]' : ''}`}>{title}</strong><span className="text-[#74746D]">{detail}</span></div>;
}

function TablePanel({
  table, status, locale, menuUrl, position, onClose, onEdit, onStatus, labels,
}: {
  table: DiningTable;
  status: TableStatus;
  locale: 'en' | 'ar';
  menuUrl: string;
  position: TablePosition;
  onClose: () => void;
  onEdit?: () => void;
  onStatus: (status: TableStatus) => void;
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
    <div className="min-h-0 self-stretch xl:h-full">
      <aside className="flex h-full min-h-[36rem] w-full flex-col overflow-y-auto overscroll-contain rounded-xl border border-[#EEEEEC] bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="text-base font-bold tracking-tight text-[#161616]">{labels.table}</h2><p className="text-[11px] text-[#74746D]">{pickLocalized(table.floor.name, locale)} · {labels.seats}</p></div>
          <button type="button" className="grid size-8 place-items-center rounded-full hover:bg-[#F7F7F5]" aria-label={labels.close} onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-[#F7F7F3] p-2"><span className="block text-[9px] text-[#74746D]">Status</span><strong className="mt-0.5 flex items-center gap-1.5 text-[11px]"><i className={`size-1.5 rounded-full ${dotTone[status]}`} />{labels.status}</strong></div>
          <div className="rounded-lg bg-[#F7F7F3] p-2"><span className="block text-[9px] text-[#74746D]">Position</span><strong className="text-[11px]">{Math.round(position.x)}%, {Math.round(position.y)}%</strong></div>
        </div>
        <div className="mt-3 flex border-b border-[#E6E5DD] text-[10px] font-semibold"><button className="border-b-2 border-[#F6C915] px-2 py-2">Order</button><button className="px-2 py-2 text-[#74746D]">QR code</button><button className="px-2 py-2 text-[#74746D]">History</button></div>
        <div className="mt-3">
          <h3 className="font-semibold text-[#161616]">{labels.currentOrder}</h3>
          {table.order ? (
            <div className="mt-2 rounded-xl border border-[#EEEEEC] p-3">
              <div className="flex items-start justify-between gap-2"><strong className="text-xs">#{table.order.number}</strong><span className="rounded-full bg-[#FFF4D6] px-2 py-1 text-[9px] font-semibold text-[#C47D00]">{labels.inProgress}</span></div>
              <div className="mt-2 flex justify-between text-[10px] text-[#74746D]"><span>{labels.items}</span><strong className="text-[#161616]">{formatMoney(table.order.total, locale)}</strong></div>
              <Link href="/orders" className="mt-2 flex h-8 items-center justify-center rounded-lg bg-[#111111] text-[10px] font-semibold text-white">{labels.viewOrder}</Link>
            </div>
          ) : <p className="mt-2 text-xs text-[#8A8A86]">{labels.noOrder}</p>}
        </div>
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-bold">Table status</h3>
          <div className="grid grid-cols-3 gap-1.5">
            <StatusAction active={status === 'AVAILABLE'} color="#14A05A" icon={<Check />} label="Available" onClick={() => onStatus('AVAILABLE')} />
            <StatusAction active={status === 'RESERVED'} color="#2477E8" icon={<Calendar />} label="Reserve" onClick={() => onStatus('RESERVED')} />
            <StatusAction active={status === 'INACTIVE'} color="#AA7A00" icon={<Sparkles />} label="Cleaning" onClick={() => onStatus('INACTIVE')} />
          </div>
        </div>
        <div className="mt-4 border-t border-[#EEEEEC] pt-4">
          <h3 className="font-semibold text-[#161616]">{labels.qrTitle}</h3>
          <p className="mt-1 text-[10px] leading-relaxed text-[#8A8A86]">{labels.qrHint}</p>
          <div className="mt-3 grid place-items-center rounded-xl border border-[#EEEEEC] bg-white p-3">
            {menuUrl ? <QrMark value={menuUrl} /> : <QrCode className="size-14 text-[#C8C8C4]" />}
          </div>
          <div className={`mt-3 grid gap-2 ${onEdit ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <button type="button" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#E4E4E0] bg-white text-xs font-semibold text-[#161616]" onClick={printQr}>
              <Printer className="size-4" /> {labels.print}
            </button>
            {onEdit ? (
              <button type="button" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#E4E4E0] bg-white text-xs font-semibold text-[#161616]" onClick={onEdit}>
                <Pencil className="size-4" /> {labels.edit}
              </button>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}

function StatusAction({ active, color, icon, label, onClick }: { active: boolean; color: string; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`rounded-lg border p-2 text-[9px] font-semibold ${active ? 'border-[#F6C915] bg-[#FFF9DD]' : 'border-[#E3E2DD]'}`}><span className="mx-auto mb-1 grid size-4 place-items-center [&>svg]:size-4" style={{ color }}>{icon}</span>{label}</button>;
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
