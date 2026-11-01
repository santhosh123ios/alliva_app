import { create } from 'qrcode';

/**
 * A real, scannable QR code as an SVG string, with a two-module quiet zone.
 * Medium error correction keeps the code small enough for table cards while surviving print wear.
 */
export function qrSvg(value: string, size: number) {
  const { modules } = create(value, { errorCorrectionLevel: 'M' });
  const quiet = 2;
  const span = modules.size + quiet * 2;
  let path = '';
  for (let y = 0; y < modules.size; y += 1) {
    for (let x = 0; x < modules.size; x += 1) {
      if (modules.get(y, x)) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${span} ${span}" shape-rendering="crispEdges" aria-hidden="true"><rect width="${span}" height="${span}" fill="#fff"/><path d="${path}" fill="#111"/></svg>`;
}
