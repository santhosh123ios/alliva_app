import type { TableLayout } from '@alliva/types';

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Where each table and zone sits on the floor plan, in percent of the canvas. Uses the layout the owner
 * saved on the Tables page and, for anything they never placed, the same default spots that page shows.
 */
export function placeTables<T extends { id: string; number: string; floor: { id: string } }>(rows: T[], layout: TableLayout | null) {
  const tables = rows.slice().sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  const floorIds = [...new Set(tables.map((table) => table.floor.id))];
  const order = layout?.zones.order ?? [];
  const floors = floorIds.sort((a, b) => rank(order, a, floorIds.length) - rank(order, b, floorIds.length));
  const fallbackWidth = 100 / Math.max(1, floors.length);
  const rects: Record<string, Rect> = {};
  floors.forEach((id, index) => {
    rects[id] = layout?.zones.rects[id] ?? {
      x: floors.slice(0, index).reduce((sum, floor) => sum + (layout?.zones.widths[floor] ?? fallbackWidth), 0),
      y: 0,
      width: layout?.zones.widths[id] ?? fallbackWidth,
      height: layout?.zones.heights[id] ?? 100,
    };
  });
  const positions: Record<string, { x: number; y: number }> = {};
  for (const id of floors) {
    const zone = tables.filter((table) => table.floor.id === id);
    const rect = rects[id]!;
    zone.forEach((table, index) => {
      positions[table.id] = layout?.positions[table.id] ?? {
        x: rect.x + rect.width * (zone.length > 1 ? 0.3 + (index % 2) * 0.4 : 0.5),
        y: rect.y + Math.min(rect.height - 10, 24 + Math.floor(index / 2) * 29),
      };
    });
  }
  return { tables, floors, rects, positions };
}

function rank(order: string[], id: string, fallback: number) {
  const index = order.indexOf(id);
  return index < 0 ? fallback : index;
}
