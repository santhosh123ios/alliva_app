import 'leaflet/dist/leaflet.css';
import { Search } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ControlPosition, Map as LeafletMap, Marker } from 'leaflet';

type Point = { lat: number; lng: number };
type SearchResult = { lat: string; lon: string; display_name: string };

export function LocationMap({ point, onMark, className, zoomPosition = 'topleft' }: { point: Point | null; onMark: (point: Point) => void; className?: string; zoomPosition?: ControlPosition }) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const pointRef = useRef(point);
  const onMarkRef = useRef(onMark);
  const zoomPositionRef = useRef(zoomPosition);
  const [ready, setReady] = useState(false);
  pointRef.current = point;
  onMarkRef.current = onMark;
  zoomPositionRef.current = zoomPosition;

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    let disposed = false;
    void import('leaflet').then((mod) => {
      if (disposed) return;
      const L = mod.default;
      const start = pointRef.current ?? { lat: 26.2235, lng: 50.5876 };
      const map = L.map(node, { scrollWheelZoom: true, zoomControl: false }).setView([start.lat, start.lng], pointRef.current ? 15 : 11);
      L.control.zoom({ position: zoomPositionRef.current }).addTo(map);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);
      map.on('click', (event) => {
        const latlng = (event as { latlng?: { lat: number; lng: number } }).latlng;
        if (!latlng) return;
        onMarkRef.current({ lat: latlng.lat, lng: latlng.lng });
      });
      mapRef.current = map;
      map.invalidateSize();
      setReady(true);
    });
    return () => {
      disposed = true;
      setReady(false);
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const node = nodeRef.current;
    const map = mapRef.current;
    if (!ready || !node || !map) return;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(node);
    map.invalidateSize();
    return () => observer.disconnect();
  }, [ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !point) return;
    void import('leaflet').then((mod) => {
      if (mapRef.current !== map) return;
      const L = mod.default;
      if (!markerRef.current) {
        const icon = L.divIcon({
          className: '',
          html: '<span style="display:block;width:22px;height:22px;border-radius:999px;background:#F5C518;border:3px solid #161616;box-shadow:0 2px 8px rgba(0,0,0,.25)"></span>',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        const marker = L.marker([point.lat, point.lng], { icon, draggable: true }).addTo(map);
        marker.on('dragend', () => {
          const next = marker.getLatLng();
          onMarkRef.current({ lat: next.lat, lng: next.lng });
        });
        markerRef.current = marker;
      } else {
        markerRef.current.setLatLng([point.lat, point.lng]);
      }
      map.panTo([point.lat, point.lng]);
    });
  }, [point, ready]);

  return <div ref={nodeRef} className={className ?? 'z-0 h-80 w-full'} />;
}

export function LocationSearch({
  locale,
  onPick,
  labels,
  className,
}: {
  locale: string;
  onPick: (point: Point) => void;
  labels: { search: string; placeholder: string; noResults: string; failed: string };
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  async function search(event: FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (!text) return;
    setSearching(true);
    setError('');
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=bh&accept-language=${locale}&q=${encodeURIComponent(text)}`);
      if (!response.ok) throw new Error();
      const found = await response.json() as SearchResult[];
      setResults(found);
      if (!found.length) setError(labels.noResults);
    } catch {
      setResults([]);
      setError(labels.failed);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className={className} onPointerDown={(event) => event.stopPropagation()}>
      <form className="flex gap-1.5 rounded-xl bg-white p-1.5 shadow-[0_4px_16px_rgba(17,17,17,0.16)]" onSubmit={(event) => void search(event)}>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{labels.search}</span>
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[#8A8A86]" />
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setError(''); }}
            placeholder={labels.placeholder}
            className="h-10 w-full rounded-lg border border-[#E8E8E4] bg-[#F7F7F5] ps-9 pe-3 text-sm outline-none focus:border-[#111111]"
          />
        </label>
        <button type="submit" disabled={searching || !query.trim()} className="h-10 shrink-0 rounded-lg bg-[#161616] px-3 text-sm font-semibold text-white disabled:opacity-50">
          {labels.search}
        </button>
      </form>
      {error ? <p className="mt-1.5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-[#B42318] shadow" role="alert">{error}</p> : null}
      {results.length ? (
        <ul className="mt-1.5 max-h-48 overflow-y-auto rounded-xl border border-[#E4E4E0] bg-white p-1.5 shadow-xl">
          {results.map((result) => (
            <li key={`${result.lat}-${result.lon}`}>
              <button
                type="button"
                className="w-full rounded-lg px-3 py-2 text-start text-sm hover:bg-[#F7F7F5]"
                onClick={() => {
                  setQuery(result.display_name);
                  setResults([]);
                  setError('');
                  onPick({ lat: Number(result.lat), lng: Number(result.lon) });
                }}
              >
                <span className="line-clamp-2">{result.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
