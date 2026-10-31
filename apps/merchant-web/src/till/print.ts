import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import type { BillOrder, LocalizedText, OpenBill, PaidBill } from '@alliva/types';
import { toast } from '@alliva/ui';
import { tableNo } from '@/lib/table-number';
import type { Locale } from './shared';

export type Store = { name: string; phone?: string | null; address?: string | null };
type T = (key: string, values?: Record<string, string | number>) => string;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

/** Same dish ordered in two rounds prints as one line. */
function mergedLines(orders: BillOrder[], locale: Locale) {
  const lines = new Map<string, { name: string; addons: string; quantity: number; total: number }>();
  for (const order of orders) {
    for (const item of order.items) {
      const name = pickLocalized(item.name, locale);
      const addons = item.addons.map((addon: LocalizedText) => pickLocalized(addon, locale)).join(', ');
      const key = `${name}|${addons}|${item.unitPrice}`;
      const line = lines.get(key) ?? { name, addons, quantity: 0, total: 0 };
      line.quantity += item.quantity;
      line.total += Number(item.total);
      lines.set(key, line);
    }
  }
  return [...lines.values()];
}

/**
 * Prints an 80 mm bill. Before payment it is the guest's check ("Bill"); after, the receipt with how it was paid.
 */
export function printBill(bill: OpenBill | PaidBill, store: Store, locale: Locale, t: T) {
  const win = window.open('', '_blank', 'width=380,height=680');
  if (!win) {
    toast.error(t('print.blocked'));
    return;
  }
  const paid = 'settledAt' in bill;
  const money = (value: string | number) => escapeHtml(formatMoney(value, locale));
  const when = new Date(paid ? bill.settledAt : Date.now()).toLocaleString(locale === 'ar' ? 'ar-BH' : 'en-GB', { timeZone: 'Asia/Bahrain', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const place = bill.table ? t('tableNumber', { table: tableNo(bill.table.number) }) : t('counter');
  const rows = mergedLines(bill.orders, locale)
    .map((line) => `<tr><td class="q">${line.quantity}×</td><td>${escapeHtml(line.name)}${line.addons ? `<div class="sub">+ ${escapeHtml(line.addons)}</div>` : ''}</td><td class="n">${money(line.total)}</td></tr>`)
    .join('');
  const total = (label: string, value: string, strong = false) => `<tr class="${strong ? 'big' : ''}"><td>${escapeHtml(label)}</td><td class="n">${money(value)}</td></tr>`;
  const prepaid = Number(bill.prepaid) > 0 ? total(t('print.paidOnline'), `-${bill.prepaid}`) : '';
  let footer = '';
  if (paid) {
    footer = [
      `<tr><td>${escapeHtml(t('print.paidBy', { method: t(`methods.${bill.method}`) }))}</td><td class="n">${money(bill.method === 'ONLINE' ? bill.prepaid : bill.collected)}</td></tr>`,
      bill.tendered ? total(t('print.tendered'), bill.tendered) : '',
      bill.change ? total(t('print.change'), bill.change) : '',
    ].join('');
  } else {
    footer = total(t('print.due'), bill.due, true);
  }
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  win.document.open();
  win.document.write(`<!doctype html><html dir="${dir}" lang="${locale}"><head><meta charset="utf-8"><title>${escapeHtml(paid ? bill.number : place)}</title><style>
    @page{size:80mm auto;margin:4mm}body{font-family:system-ui,sans-serif;margin:0;width:72mm;color:#000;font-size:13px}
    .c{text-align:center}h1{font-size:18px;margin:0}.muted{font-size:12px;color:#333;margin:2px 0}
    .kind{font:700 15px/1.2 system-ui;margin:10px 0 2px;letter-spacing:1px;text-transform:uppercase}
    table{width:100%;border-collapse:collapse}td{padding:3px 0;vertical-align:top}.q{width:9mm;font-weight:700}.n{text-align:end;white-space:nowrap;padding-inline-start:6px;direction:ltr}
    .items{border-top:1px dashed #000;border-bottom:1px dashed #000;margin:8px 0}.sub{font-size:11px;color:#333}
    .totals td{padding:2px 0}.big td{font-size:16px;font-weight:700;padding-top:6px}.sep{border-top:1px dashed #000;margin:6px 0}
    .thanks{margin-top:12px;font-size:12px}
  </style></head><body>
    <div class="c">
      <h1>${escapeHtml(store.name)}</h1>
      ${store.address ? `<div class="muted">${escapeHtml(store.address)}</div>` : ''}
      ${store.phone ? `<div class="muted" dir="ltr">${escapeHtml(store.phone)}</div>` : ''}
      <div class="kind">${escapeHtml(paid ? t('print.receipt') : t('print.bill'))}</div>
      <div class="muted"><b>${escapeHtml(place)}</b>${paid ? ` · <span dir="ltr">${escapeHtml(bill.number)}</span>` : ''}</div>
      <div class="muted">${escapeHtml(when)}</div>
      <div class="muted" dir="ltr">${bill.orders.map((order) => escapeHtml(order.number)).join(' · ')}</div>
    </div>
    <table class="items">${rows}</table>
    <table class="totals">
      ${total(t('subtotal'), bill.subtotal)}
      ${Number(bill.discount) > 0 ? total(t('discount'), `-${bill.discount}`) : ''}
      ${Number(bill.serviceFee) > 0 ? total(t('serviceFee'), bill.serviceFee) : ''}
      ${Number(bill.tax) > 0 ? total(t('tax'), bill.tax) : ''}
      ${total(t('total'), bill.total, true)}
      ${prepaid}
    </table>
    <div class="sep"></div>
    <table class="totals">${footer}</table>
    <div class="c thanks">${escapeHtml(paid ? t('print.thanks') : t('print.notReceipt'))}</div>
    <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script>
  </body></html>`);
  win.document.close();
}
