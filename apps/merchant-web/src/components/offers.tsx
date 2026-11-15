import { api } from '@/components/providers';
import { Link } from '@/i18n/navigation';
import type { MerchantOffer } from '@alliva/api-client';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BadgePercent, CalendarClock, Megaphone, Pause, Pencil, Play, Plus, Ticket, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';

/** The parts of a catalogue product a deal needs. A deal is a product whose was-price (compareAtPrice) is above its price. */
export type DealProduct = {
  id: string;
  name: { en?: string; ar?: string };
  price: string;
  compareAtPrice: string | null;
  sizes?: number;
};

type OfferStatus = 'live' | 'scheduled' | 'paused' | 'ended';

const STATUS_TONE: Record<OfferStatus, string> = {
  live: 'bg-success-soft text-success',
  scheduled: 'bg-primary-soft text-warning',
  paused: 'bg-muted text-muted-foreground',
  ended: 'bg-muted text-subtle',
};

function offerStatus(offer: MerchantOffer, now = Date.now()): OfferStatus {
  if (new Date(offer.endsAt).getTime() <= now) return 'ended';
  if (!offer.active) return 'paused';
  return new Date(offer.startsAt).getTime() > now ? 'scheduled' : 'live';
}

const onDeal = (product: DealProduct) => Boolean(product.compareAtPrice && Number(product.compareAtPrice) > Number(product.price));

/** Everything a store runs as an offer: banner offers, dishes on sale, and a way into promo codes. */
export function OffersSection({ products }: { products: DealProduct[] }) {
  const t = useTranslations('merchantOffers');
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const offers = useQuery({ queryKey: ['merchant', 'offers'], queryFn: () => api.offers() });
  const promos = useQuery({ queryKey: ['merchant', 'promos'], queryFn: () => api.merchantPromos(), retry: false });
  const [editing, setEditing] = useState<MerchantOffer | 'new' | null>(null);
  const [dealFor, setDealFor] = useState<DealProduct | 'new' | null>(null);
  const [error, setError] = useState('');

  const refreshOffers = () => void client.invalidateQueries({ queryKey: ['merchant', 'offers'] });
  const toggle = useMutation({
    mutationFn: (offer: MerchantOffer) => api.updateOffer(offer.id, { active: !offer.active }),
    onSuccess: refreshOffers,
    onError: (reason: Error) => setError(reason.message),
  });
  const remove = useMutation({
    mutationFn: (offer: MerchantOffer) => api.deleteOffer(offer.id),
    onSuccess: refreshOffers,
    onError: (reason: Error) => setError(reason.message),
  });
  const endDeal = useMutation({
    mutationFn: (product: DealProduct) => api.updateProduct(product.id, { price: product.compareAtPrice, compareAtPrice: null }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['merchant', 'products'] }),
    onError: (reason: Error) => setError(reason.message),
  });

  const deals = products.filter(onDeal);
  const now = Date.now();
  const activePromos = (promos.data ?? []).filter((promo) => promo.active && new Date(promo.endsAt).getTime() > now).length;
  const dateText = (value: string) => new Date(value).toLocaleDateString(locale === 'ar' ? 'ar-BH' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const money = (value: string) => formatMoney(value, locale);

  return (
    <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="grid min-w-0 content-start gap-3">
        {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}

        <Panel icon={<Megaphone />} title={t('storeOffers')} hint={t('storeOffersHint')} action={<Button type="button" variant="yellow" className="h-9 rounded-lg px-3" onClick={() => setEditing('new')}><Plus className="size-4" /> {t('addOffer')}</Button>}>
          {offers.isLoading ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">…</p>
          ) : offers.data?.length ? (
            <ul className="divide-y divide-border">
              {offers.data.map((offer) => {
                const status = offerStatus(offer, now);
                return (
                  <li key={offer.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        <span className="truncate">{pickLocalized(offer.title, locale)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_TONE[status]}`}>{t(`status.${status}`)}</span>
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarClock className="size-3.5" />{dateText(offer.startsAt)} – {dateText(offer.endsAt)}</p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {status !== 'ended' ? (
                        <IconButton label={offer.active ? t('pause') : t('resume')} onClick={() => toggle.mutate(offer)} disabled={toggle.isPending}>
                          {offer.active ? <Pause /> : <Play />}
                        </IconButton>
                      ) : null}
                      <IconButton label={t('edit')} onClick={() => setEditing(offer)}><Pencil /></IconButton>
                      <IconButton
                        label={t('delete')}
                        danger
                        disabled={remove.isPending}
                        onClick={() => { if (window.confirm(t('confirmDelete'))) remove.mutate(offer); }}
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-4 py-6 text-sm text-muted-foreground">{t('noOffers')}</p>
          )}
        </Panel>

        <Panel icon={<BadgePercent />} title={t('deals')} hint={t('dealsHint')} action={<Button type="button" variant="yellow" className="h-9 rounded-lg px-3" onClick={() => setDealFor('new')}><Plus className="size-4" /> {t('addDeal')}</Button>}>
          {deals.length ? (
            <ul className="divide-y divide-border">
              {deals.map((product) => {
                const percent = Math.round((1 - Number(product.price) / Number(product.compareAtPrice)) * 100);
                return (
                  <li key={product.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{pickLocalized(product.name, locale)}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold">{money(product.price)}</span>
                        <span className="text-muted-foreground line-through">{money(product.compareAtPrice!)}</span>
                        <span className="rounded-full bg-success-soft px-2 py-0.5 font-bold text-success">{t('off', { percent })}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <IconButton label={t('editDeal')} onClick={() => setDealFor(product)}><Pencil /></IconButton>
                      <button type="button" disabled={endDeal.isPending} onClick={() => endDeal.mutate(product)} className="h-8 rounded-lg border border-border-strong bg-card px-2.5 text-xs font-semibold disabled:opacity-50">{t('endDeal')}</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-4 py-6 text-sm text-muted-foreground">{t('noDeals')}</p>
          )}
        </Panel>
      </div>

      <aside className="h-fit rounded-xl border border-border-strong bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-bold"><Ticket className="size-4" />{t('promos')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('promosHint')}</p>
        {promos.data ? <p className="mt-3 text-2xl font-bold">{t('promosCount', { count: activePromos })}</p> : null}
        <Link href="/promos" className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong px-3 text-xs font-semibold">
          {t('managePromos')}<ArrowRight className="size-3.5 rtl:rotate-180" />
        </Link>
      </aside>

      <OfferDialog offer={editing} onClose={() => setEditing(null)} />
      <DealDialog target={dealFor} products={products} onClose={() => setDealFor(null)} />
    </div>
  );
}

function Panel({ icon, title, hint, action, children }: { icon: React.ReactNode; title: string; hint: string; action: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border-strong bg-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-border p-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft [&>svg]:size-4">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold">{title}</h2>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function IconButton({ label, onClick, children, danger = false, disabled = false }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid size-8 place-items-center rounded-lg border bg-card disabled:opacity-50 [&>svg]:size-3.5 ${danger ? 'border-destructive/30 text-destructive' : 'border-border-strong'}`}
    >
      {children}
    </button>
  );
}

/** `yyyy-mm-dd` in local time, for date inputs. */
const dayInput = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

function OfferDialog({ offer, onClose }: { offer: MerchantOffer | 'new' | null; onClose: () => void }) {
  const t = useTranslations('merchantOffers');
  const client = useQueryClient();
  const [titleEn, setTitleEn] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!offer) return;
    const existing = offer === 'new' ? null : offer;
    setTitleEn(existing?.title.en ?? '');
    setTitleAr(existing?.title.ar ?? '');
    setStarts(dayInput(existing ? new Date(existing.startsAt) : new Date()));
    setEnds(dayInput(existing ? new Date(existing.endsAt) : new Date(Date.now() + 30 * 86400000)));
    setError('');
  }, [offer]);
  const save = useMutation({
    mutationFn: async () => {
      if (!titleEn.trim() || !titleAr.trim()) throw new Error(t('titleRequired'));
      // The offer runs from the start of its first day to the end of its last day, in the store's local time.
      const startsAt = new Date(`${starts}T00:00:00`);
      const endsAt = new Date(`${ends}T23:59:59`);
      if (!starts || !ends || endsAt <= startsAt) throw new Error(t('endAfterStart'));
      const body = { title: { en: titleEn.trim(), ar: titleAr.trim() }, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
      return offer === 'new' ? api.createOffer(body) : api.updateOffer((offer as MerchantOffer).id, body);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['merchant', 'offers'] });
      onClose();
    },
    onError: (reason: Error) => setError(reason.message),
  });
  return (
    <Dialog open={Boolean(offer)} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="w-[min(100%-2rem,28rem)]">
        <DialogTitle>{offer === 'new' ? t('addOffer') : t('editOffer')}</DialogTitle>
        <DialogDescription>{t('storeOffersHint')}</DialogDescription>
        <div className="mt-4 grid gap-3">
          <Input label={t('titleEn')} value={titleEn} onChange={setTitleEn} />
          <Input label={t('titleAr')} value={titleAr} onChange={setTitleAr} dir="rtl" />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('startsAt')} type="date" value={starts} onChange={setStarts} />
            <Input label={t('endsAt')} type="date" value={ends} onChange={setEnds} />
          </div>
        </div>
        {error ? <p className="mt-3 text-sm font-medium text-destructive">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" className="h-11 rounded-xl px-4" onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" loading={save.isPending} onClick={() => { setError(''); save.mutate(); }}>{t('save')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DealDialog({ target, products, onClose }: { target: DealProduct | 'new' | null; products: DealProduct[]; onClose: () => void }) {
  const t = useTranslations('merchantOffers');
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const [productId, setProductId] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');
  // Dishes priced by size keep their prices on the sizes, so a single deal price would not apply to them.
  const choices = products.filter((product) => !onDeal(product) && !product.sizes);
  useEffect(() => {
    if (!target) return;
    setProductId(target === 'new' ? '' : target.id);
    setPrice(target === 'new' ? '' : target.price);
    setError('');
  }, [target]);
  const product = target === 'new' ? choices.find((item) => item.id === productId) : target;
  // The regular price: what the dish costs now, or what it cost before an existing deal.
  const regular = product ? (target === 'new' ? product.price : product.compareAtPrice!) : null;
  const save = useMutation({
    mutationFn: async () => {
      if (!product || !regular) throw new Error(t('chooseProduct'));
      const value = Number(price);
      if (!/^\d+(\.\d{1,3})?$/.test(price.trim()) || value <= 0 || value >= Number(regular)) throw new Error(t('dealLower', { price: formatMoney(regular, locale) }));
      return api.updateProduct(product.id, { price: value.toFixed(3), compareAtPrice: Number(regular).toFixed(3) });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['merchant', 'products'] });
      onClose();
    },
    onError: (reason: Error) => setError(reason.message),
  });
  return (
    <Dialog open={Boolean(target)} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="w-[min(100%-2rem,28rem)]">
        <DialogTitle>{target === 'new' ? t('addDeal') : t('editDeal')}</DialogTitle>
        <DialogDescription>{t('dealsHint')}</DialogDescription>
        <div className="mt-4 grid gap-3">
          {target === 'new' ? (
            <label className="block text-sm font-semibold text-foreground">
              {t('product')}
              <select className="mt-1.5 h-11 w-full rounded-xl border border-border bg-muted px-3 text-sm font-medium outline-none" value={productId} onChange={(event) => setProductId(event.target.value)}>
                <option value="">{t('chooseProduct')}</option>
                {choices.map((item) => <option key={item.id} value={item.id}>{pickLocalized(item.name, locale)} · {formatMoney(item.price, locale)}</option>)}
              </select>
            </label>
          ) : (
            <p className="text-sm font-semibold">{product ? pickLocalized(product.name, locale) : ''}</p>
          )}
          {regular ? <p className="text-xs text-muted-foreground">{t('regularPrice', { price: formatMoney(regular, locale) })}</p> : null}
          <Input label={t('dealPrice')} value={price} onChange={setPrice} inputMode="decimal" />
        </div>
        {error ? <p className="mt-3 text-sm font-medium text-destructive">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" className="h-11 rounded-xl px-4" onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" loading={save.isPending} onClick={() => { setError(''); save.mutate(); }}>{t('saveDeal')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Input({ label, value, onChange, type = 'text', dir, inputMode }: { label: string; value: string; onChange: (value: string) => void; type?: string; dir?: 'rtl'; inputMode?: 'decimal' }) {
  return (
    <label className="block text-sm font-semibold text-foreground">
      {label}
      <input type={type} dir={dir} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-border bg-muted px-3 text-sm font-medium outline-none" />
    </label>
  );
}
