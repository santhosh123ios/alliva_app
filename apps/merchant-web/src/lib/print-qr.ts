import { qrSvg } from './qr';

/** One table poster: the table label shown on it, its branch, and the link its QR code opens. */
export type QrPoster = { table: string; branch?: string; url: string };

export type PosterOptions = {
  documentTitle: string;
  dir: 'ltr' | 'rtl';
  merchant: { name: string; logoUrl?: string | null; open?: boolean };
  labels: { headline: string; tagline: string; dineIn: string; poweredBy: string; open: string };
};

/** The mascot artwork sits on this yellow, so the poster uses the same one and the image blends in. */
const POSTER_YELLOW = '#FFC800';

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

const absolute = (url: string) => new URL(url, window.location.origin).href;

/**
 * Where table QR codes send diners. Set VITE_CUSTOMER_URL to the public customer app origin
 * (for example https://192.168.1.20:3443 when testing on phones); otherwise it is this host on port 3000.
 */
export function customerOrigin() {
  const override = import.meta.env.VITE_CUSTOMER_URL;
  if (override) return override.replace(/\/$/, '');
  return `http://${window.location.hostname}:3000`;
}

/** The @font-face rules this page already loaded (Poppins, Inter, the Arabic faces), so the poster prints in them. */
function fontFaces() {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue; // a cross-origin sheet we may not read
    }
    for (const rule of Array.from(list)) if (rule instanceof CSSFontFaceRule) rules.push(rule.cssText);
  }
  return rules.join('\n');
}

function posterHtml(poster: QrPoster, options: PosterOptions) {
  const { merchant, labels } = options;
  const initial = escapeHtml(Array.from(merchant.name.trim())[0]?.toUpperCase() ?? 'A');
  const logo = merchant.logoUrl
    ? `<img src="${escapeHtml(absolute(merchant.logoUrl))}" alt="">`
    : `<span class="initial">${initial}</span>`;
  const table = escapeHtml(poster.table);
  const branch = poster.branch;
  return `<section class="poster">
  <header class="bar">
    <div class="logo">${logo}</div>
    <div class="brand">
      <strong${merchant.name.length > 10 ? ' class="long"' : ''}>${escapeHtml(merchant.name)}</strong>
      ${branch ? `<span>${escapeHtml(branch)}</span>` : ''}
    </div>
    ${merchant.open ? `<div class="open"><i></i>${escapeHtml(labels.open)}</div>` : ''}
    <div class="table">${table}</div>
  </header>
  <h1>${escapeHtml(labels.headline)}</h1>
  <p class="tagline">${escapeHtml(labels.tagline)}</p>
  <div class="qr">${qrSvg(poster.url, 600)}</div>
  <div class="pill">${escapeHtml(labels.dineIn)}<b>•</b>${table}</div>
  <p class="url" dir="ltr">${escapeHtml(poster.url)}</p>
  <footer>
    <div class="powered"><img src="${absolute('/logo-on-light.png')}" alt="Alliva"><i></i><span>${escapeHtml(labels.poweredBy)}</span></div>
    <img class="mascot" src="${absolute('/mascot.png')}" alt="">
  </footer>
</section>`;
}

const styles = `
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: Poppins, 'Inter Variable', 'Noto Kufi Arabic', 'Noto Sans Arabic Variable', Arial, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
[dir=rtl] body { font-family: 'Noto Kufi Arabic', 'Noto Sans Arabic Variable', Poppins, Arial, sans-serif; }
.poster { position: relative; width: 210mm; height: 297mm; overflow: hidden; background: ${POSTER_YELLOW}; padding: 14mm 13mm 0; display: flex; flex-direction: column; align-items: center; break-after: page; page-break-after: always; }
.poster:last-child { break-after: auto; page-break-after: auto; }
.bar { width: 100%; display: flex; align-items: center; gap: 5mm; background: #171717; color: #fff; border-radius: 7mm; padding: 5mm; }
.logo { flex: none; width: 30mm; height: 26mm; border-radius: 4mm; background: #fff; display: grid; place-items: center; overflow: hidden; padding: 2mm; }
.logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
.logo .initial { font-size: 40pt; font-weight: 700; color: #171717; }
.brand { flex: 1; min-width: 0; padding-inline-start: 5mm; border-inline-start: 1px solid #555; display: flex; flex-direction: column; gap: 1mm; }
.brand strong { font-size: 30pt; line-height: 1.05; font-weight: 700; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }
.brand strong.long { font-size: 22pt; }
.brand span { font-size: 14pt; font-weight: 600; color: #eee; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.open { flex: none; display: flex; align-items: center; gap: 2mm; color: #22c55e; font-size: 15pt; font-weight: 600; }
.open i { width: 4.5mm; height: 4.5mm; border-radius: 50%; background: #22c55e; }
.table { flex: none; border: 2px solid #fff; border-radius: 99mm; padding: 2.5mm 6mm; font-size: 16pt; font-weight: 700; text-transform: uppercase; white-space: nowrap; }
h1 { margin: 11mm 0 0; font-size: 44pt; line-height: 1.05; font-weight: 700; letter-spacing: -0.03em; text-align: center; }
.tagline { margin: 3mm 0 0; font-size: 20pt; font-weight: 600; }
.qr { margin-top: 8mm; width: 128mm; height: 128mm; background: #fff; border-radius: 9mm; padding: 10mm; box-shadow: 0 2mm 6mm rgba(0, 0, 0, 0.12); }
.qr svg { width: 100%; height: 100%; display: block; }
.pill { margin-top: 6mm; background: #171717; color: #fff; border-radius: 99mm; padding: 3mm 12mm; font-size: 18pt; font-weight: 700; text-transform: uppercase; display: flex; gap: 4mm; align-items: center; white-space: nowrap; }
.pill b { font-size: 12pt; }
.url { margin: 2.5mm 0 0; font-family: 'Inter Variable', Arial, sans-serif; font-size: 7pt; color: rgba(0, 0, 0, 0.55); }
footer { position: absolute; inset-inline: 0; bottom: 0; height: 52mm; }
.powered { position: absolute; inset-inline-start: 8mm; bottom: 9mm; display: flex; align-items: center; gap: 5mm; background: #fff; border-radius: 99mm; padding: 5mm 10mm; }
.powered img { height: 13mm; width: auto; display: block; }
.powered i { width: 1px; height: 11mm; background: #ccc; }
.powered span { font-size: 14pt; font-weight: 600; white-space: nowrap; }
.mascot { position: absolute; inset-inline-end: 5mm; bottom: 2mm; height: 50mm; width: auto; }
[dir=rtl] .mascot { transform: scaleX(-1); }
`;

/**
 * Prints one A4 table poster per QR code through a hidden iframe, so popup blockers cannot stop it.
 * Waits for the fonts and images (merchant logo, Alliva logo, mascot) before opening the print dialog.
 * Returns false when there was nothing to print.
 */
export function printQrCards(posters: QrPoster[], options: PosterOptions) {
  if (posters.length === 0) return false;
  const html = `<!doctype html><html dir="${options.dir}" lang="${options.dir === 'rtl' ? 'ar' : 'en'}"><head><meta charset="utf-8"><title>${escapeHtml(options.documentTitle)}</title><style>${fontFaces()}\n${styles}</style></head><body>${posters.map((poster) => posterHtml(poster, options)).join('')}</body></html>`;

  // Safari does not always fire afterprint inside iframes, so clear any frame left from an earlier print.
  document.querySelectorAll('iframe[data-qr-print]').forEach((old) => old.remove());
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.dataset.qrPrint = '';
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const view = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!view || !doc) {
    frame.remove();
    return false;
  }
  doc.open();
  doc.write(html);
  doc.close();
  view.addEventListener('afterprint', () => setTimeout(() => frame.remove(), 500), { once: true });

  const images = Array.from(doc.images).map((image) =>
    image.complete ? Promise.resolve() : new Promise<void>((resolve) => { image.onload = image.onerror = () => resolve(); }),
  );
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 4000));
  // Give layout a frame to request the fonts before waiting on them.
  const ready = new Promise<void>((resolve) => setTimeout(resolve, 50)).then(() => Promise.all([doc.fonts.ready, ...images]));
  void Promise.race([ready, timeout]).then(() => {
    view.focus();
    view.print();
  });
  return true;
}
