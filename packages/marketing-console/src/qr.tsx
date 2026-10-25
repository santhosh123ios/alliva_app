import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** QR code for a registration link, rendered locally (the link never leaves the browser). */
export function QrCode({ value, size = 128, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { margin: 1, width: size * 2, color: { dark: '#171712', light: '#ffffff' } })
      .then((url) => { if (alive) setSrc(url); })
      .catch(() => { if (alive) setSrc(''); });
    return () => { alive = false; };
  }, [value, size]);
  if (!src) return <div className="rounded-lg bg-muted" style={{ width: size, height: size }} />;
  return <img src={src} alt={label} width={size} height={size} className="rounded-lg border bg-white" />;
}
