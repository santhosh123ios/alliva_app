'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker } from 'leaflet';

type Point = { lat: number; lng: number };

export function LocationMap({ point, onMark, className }: { point: Point | null; onMark: (point: Point) => void; className?: string }) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const pointRef = useRef(point);
  const onMarkRef = useRef(onMark);
  const [ready, setReady] = useState(false);
  pointRef.current = point;
  onMarkRef.current = onMark;

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    let disposed = false;
    void import('leaflet').then((mod) => {
      if (disposed) return;
      const L = mod.default;
      const start = pointRef.current ?? { lat: 26.2235, lng: 50.5876 };
      const map = L.map(node, { scrollWheelZoom: true }).setView([start.lat, start.lng], pointRef.current ? 15 : 11);
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
