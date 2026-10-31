import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type { LayerGroup, Map as LeafletMap } from 'leaflet';

export type MapPoint = { lat: number; lng: number };
export type MapStop = MapPoint & { label: string; title?: string };
/** `line: false` plots the stops without joining them, for orders not yet on a route. `muted` greys out stops a rider already has. */
export type MapRoute = { id: string; color: string; stops: (MapStop & { muted?: boolean })[]; line?: boolean };

/**
 * Read-only map of one or more rider routes: the store pin, numbered stops and a line between them.
 * Lines are straight between stops; the rider's maps app does the turn-by-turn.
 */
/** `startAtMe` draws route lines from the rider's position instead of the store, for a rider already on the road. */
export function RouteMap({ store, routes, me, className, focus, startAtMe }: { store: MapPoint | null; routes: MapRoute[]; me?: MapPoint | null; className?: string; focus?: string | null; startAtMe?: boolean }) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    let disposed = false;
    void import('leaflet').then((mod) => {
      if (disposed) return;
      const L = mod.default;
      const map = L.map(node, { zoomControl: false, attributionControl: true }).setView([26.2235, 50.5876], 11);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
    });
    return () => {
      disposed = true;
      setReady(false);
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const node = nodeRef.current;
    const map = mapRef.current;
    if (!ready || !node || !map) return;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(node);
    return () => observer.disconnect();
  }, [ready]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!ready || !map || !layer) return;
    void import('leaflet').then((mod) => {
      if (mapRef.current !== map) return;
      const L = mod.default;
      layer.clearLayers();
      const bounds: [number, number][] = [];
      if (store) {
        L.marker([store.lat, store.lng], { icon: pin('#111111', '#FFC400', '★', 30) }).addTo(layer);
        bounds.push([store.lat, store.lng]);
      }
      if (me) {
        L.marker([me.lat, me.lng], {
          icon: L.divIcon({ className: '', html: '<span style="display:block;width:16px;height:16px;border-radius:999px;background:#2563EB;border:3px solid #fff;box-shadow:0 0 0 4px rgba(37,99,235,.25)"></span>', iconSize: [16, 16], iconAnchor: [8, 8] }),
        }).addTo(layer);
        bounds.push([me.lat, me.lng]);
      }
      for (const route of routes) {
        const dimmed = Boolean(focus && focus !== route.id);
        const from = startAtMe && me ? me : store;
        const line: [number, number][] = from ? [[from.lat, from.lng]] : [];
        for (const stop of route.stops) {
          line.push([stop.lat, stop.lng]);
          bounds.push([stop.lat, stop.lng]);
          const marker = L.marker([stop.lat, stop.lng], { icon: pin(stop.muted ? '#8A8A86' : route.color, '#FFFFFF', stop.label, stop.muted ? 22 : 26), opacity: dimmed ? 0.35 : 1 }).addTo(layer);
          if (stop.title) marker.bindTooltip(stop.title, { direction: 'top', offset: [0, -14] });
        }
        if (route.line !== false && line.length > 1) L.polyline(line, { color: route.color, weight: 4, opacity: dimmed ? 0.2 : 0.85, dashArray: '8 6' }).addTo(layer);
      }
      if (bounds.length > 1) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
      else if (bounds.length === 1) map.setView(bounds[0]!, 15);
      map.invalidateSize();

      function pin(fill: string, text: string, label: string, size: number) {
        return L.divIcon({
          className: '',
          html: `<span style="display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:999px;background:${fill};color:${text};border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);font:700 12px/1 system-ui">${escapeHtml(label)}</span>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
      }
    });
  }, [ready, store, routes, me, focus, startAtMe]);

  return <div ref={nodeRef} className={className ?? 'z-0 h-64 w-full'} />;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
