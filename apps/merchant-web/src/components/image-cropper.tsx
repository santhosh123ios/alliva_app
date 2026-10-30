import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@alliva/ui';
import { useEffect, useRef, useState } from 'react';

const BOX = 280;
const OUTPUT = 1024;

export function SquareCropper({
  source, title, hint, zoomLabel, useLabel, cancelLabel, onCancel, onUse,
}: {
  source: string | null;
  title: string;
  hint: string;
  zoomLabel: string;
  useLabel: string;
  cancelLabel: string;
  onCancel: () => void;
  onUse: (file: File) => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setNatural({ width: 0, height: 0 });
  }, [source]);

  function sizeFor(nextZoom: number, nextNatural = natural) {
    const cover = nextNatural.width && nextNatural.height ? Math.max(BOX / nextNatural.width, BOX / nextNatural.height) : 1;
    return { width: nextNatural.width * cover * nextZoom, height: nextNatural.height * cover * nextZoom };
  }

  function clamp(x: number, y: number, nextZoom = zoom) {
    const size = sizeFor(nextZoom);
    return {
      x: Math.min(0, Math.max(BOX - size.width, x)),
      y: Math.min(0, Math.max(BOX - size.height, y)),
    };
  }

  function confirm() {
    const image = imageRef.current;
    if (!image || !ready) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const context = canvas.getContext('2d');
    if (!context) return;
    const size = sizeFor(zoom);
    const ratio = OUTPUT / BOX;
    context.drawImage(image, offset.x * ratio, offset.y * ratio, size.width * ratio, size.height * ratio);
    canvas.toBlob((blob) => {
      if (!blob) return;
      onUse(new File([blob], 'product.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  }

  const drawn = sizeFor(zoom);
  return (
    <Dialog open={source !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="w-[min(100%-2rem,24rem)]">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{hint}</DialogDescription>
        <div
          className="relative mx-auto mt-4 size-[280px] cursor-grab touch-none overflow-hidden rounded-xl bg-[#111] active:cursor-grabbing"
          onPointerDown={(event) => {
            dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag) return;
            setOffset(clamp(drag.ox + event.clientX - drag.x, drag.oy + event.clientY - drag.y));
          }}
          onPointerUp={() => { dragRef.current = null; }}
        >
          {source ? (
            <img
              ref={imageRef}
              src={source}
              alt=""
              draggable={false}
              onLoad={(event) => {
                const next = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
                setNatural(next);
                const size = sizeFor(1, next);
                setOffset({ x: (BOX - size.width) / 2, y: (BOX - size.height) / 2 });
                setZoom(1);
                setReady(true);
              }}
              className="absolute max-w-none select-none"
              style={{ width: drawn.width, height: drawn.height, left: offset.x, top: offset.y }}
            />
          ) : null}
        </div>
        <label className="mt-4 block text-xs font-semibold text-[#161616]">
          {zoomLabel}
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(event) => {
              const nextZoom = Number(event.target.value);
              const current = sizeFor(zoom);
              if (!current.width) { setZoom(nextZoom); return; }
              const next = sizeFor(nextZoom);
              const centerX = offset.x - BOX / 2;
              const centerY = offset.y - BOX / 2;
              setZoom(nextZoom);
              setOffset(clamp(BOX / 2 + centerX * (next.width / current.width), BOX / 2 + centerY * (next.height / current.height), nextZoom));
            }}
            className="mt-2 w-full accent-[#FFC400]"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-10 rounded-xl border border-[#DDDCD7] px-3 text-sm font-semibold">{cancelLabel}</button>
          <Button type="button" variant="yellow" className="h-10 rounded-xl px-4" disabled={!ready} onClick={confirm}>{useLabel}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
