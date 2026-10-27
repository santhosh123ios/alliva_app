import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** QR code for a registration link, rendered locally (the link never leaves the browser). */
export function QrCode({ value, size = 128, label, framed = true }: { value: string; size?: number; label: string; framed?: boolean }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { margin: framed ? 1 : 0, width: size * 2, color: { dark: '#171712', light: '#ffffff' } })
      .then((url) => { if (alive) setSrc(url); })
      .catch(() => { if (alive) setSrc(''); });
    return () => { alive = false; };
  }, [value, size, framed]);
  if (!src) return <div className={framed ? 'rounded-lg bg-muted' : 'bg-muted'} style={{ width: size, height: size }} />;
  return <img src={src} alt={label} width={size} height={size} className={framed ? 'rounded-lg border bg-white' : 'block'} />;
}
