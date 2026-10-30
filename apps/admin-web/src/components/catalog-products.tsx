import { api } from '@/components/providers';
import { pickLocalized } from '@alliva/design-tokens';
import { Button, Card, EmptyState, ErrorState, PageHeader, TableSkeleton } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ImageIcon, Merge, Search, Upload, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLocale } from 'use-intl';

type Status = 'PENDING' | 'APPROVED' | 'REJECTED';
type ProductRow = {
  id: string;
  name: { en?: string; ar?: string };
  description: { en?: string; ar?: string };
  imageUrl: string | null;
  status: Status;
  reviewNote: string | null;
  stores: number;
  mergedInto: { id: string; name: { en?: string; ar?: string } } | null;
};

const text = {
  en: { title: 'Shared products', subtitle: 'Review product names, spelling, descriptions and default images used across stores.', search: 'Search products', pending: 'Pending review', approved: 'Approved', rejected: 'Rejected', all: 'All', stores: 'stores', nameEn: 'English name', nameAr: 'Arabic name', descEn: 'English description', descAr: 'Arabic description', image: 'Default image', upload: 'Upload image', note: 'Admin note', save: 'Save', approve: 'Approve', reject: 'Reject', mergeInto: 'Swap / merge into…', merge: 'Merge', empty: 'No products found' },
  ar: { title: 'المنتجات المشتركة', subtitle: 'راجع أسماء المنتجات والإملاء والوصف والصور الافتراضية المستخدمة في المتاجر.', search: 'ابحث في المنتجات', pending: 'بانتظار المراجعة', approved: 'معتمد', rejected: 'مرفوض', all: 'الكل', stores: 'متاجر', nameEn: 'الاسم بالإنجليزية', nameAr: 'الاسم بالعربية', descEn: 'الوصف بالإنجليزية', descAr: 'الوصف بالعربية', image: 'الصورة الافتراضية', upload: 'رفع صورة', note: 'ملاحظة الإدارة', save: 'حفظ', approve: 'اعتماد', reject: 'رفض', mergeInto: 'استبدال / دمج مع…', merge: 'دمج', empty: 'لا توجد منتجات' },
} as const;

export function CatalogProducts() {
  const locale = useLocale() === 'ar' ? 'ar' : 'en';
  const t = text[locale];
  const [status, setStatus] = useState<'ALL' | Status>('PENDING');
  const [query, setQuery] = useState('');
  const products = useQuery({ queryKey: ['admin', 'catalog-products'], queryFn: () => api.adminCatalogProducts() as Promise<ProductRow[]> });
  const rows = useMemo(() => (products.data ?? []).filter((row) => {
    if (status !== 'ALL' && row.status !== status) return false;
    const needle = query.trim().toLocaleLowerCase();
    return !needle || `${row.name.en ?? ''} ${row.name.ar ?? ''}`.toLocaleLowerCase().includes(needle);
  }), [products.data, query, status]);
  if (products.isLoading) return <TableSkeleton rows={6} columns={5} />;
  if (products.error) return <ErrorState title="Could not load products" body={(products.error as Error).message} />;
  const approved = (products.data ?? []).filter((row) => row.status === 'APPROVED');
  const pending = (products.data ?? []).filter((row) => row.status === 'PENDING').length;
  return (
    <div className="space-y-5">
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <Card className="flex flex-col gap-2 p-3 sm:flex-row">
        <label className="relative flex-1"><Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search} className="h-10 w-full rounded-xl border ps-9 pe-3 text-sm outline-none" /></label>
        <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="h-10 rounded-xl border bg-white px-3 text-sm font-semibold">
          <option value="PENDING">{t.pending} ({pending})</option><option value="APPROVED">{t.approved}</option><option value="REJECTED">{t.rejected}</option><option value="ALL">{t.all}</option>
        </select>
      </Card>
      {!rows.length ? <EmptyState title={t.empty} body={t.subtitle} /> : rows.map((row) => <ReviewCard key={row.id} row={row} approved={approved} locale={locale} labels={t} />)}
    </div>
  );
}

function ReviewCard({ row, approved, locale, labels }: { row: ProductRow; approved: ProductRow[]; locale: 'en' | 'ar'; labels: (typeof text)['en'] | (typeof text)['ar'] }) {
  const client = useQueryClient();
  const [nameEn, setNameEn] = useState(row.name.en ?? '');
  const [nameAr, setNameAr] = useState(row.name.ar ?? '');
  const [descEn, setDescEn] = useState(row.description.en ?? '');
  const [descAr, setDescAr] = useState(row.description.ar ?? '');
  const [imageUrl, setImageUrl] = useState(row.imageUrl ?? '');
  const [note, setNote] = useState(row.reviewNote ?? '');
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState('');
  const refresh = () => void client.invalidateQueries({ queryKey: ['admin', 'catalog-products'] });
  const update = useMutation({
    mutationFn: (status?: Status) => api.updateAdminCatalogProduct(row.id, { name: { en: nameEn, ar: nameAr }, description: { en: descEn, ar: descAr }, imageUrl, reviewNote: note, ...(status ? { status } : {}) }),
    onSuccess: () => { setError(''); refresh(); },
    onError: (reason: Error) => setError(reason.message),
  });
  const merge = useMutation({
    mutationFn: () => api.mergeAdminCatalogProduct(row.id, { targetId, note }),
    onSuccess: () => { setError(''); refresh(); },
    onError: (reason: Error) => setError(reason.message),
  });
  const upload = useMutation({
    mutationFn: (file: File) => api.upload(file),
    onSuccess: (saved) => { setImageUrl(saved.url); setError(''); },
    onError: (reason: Error) => setError(reason.message),
  });
  return (
    <Card className={`p-4 ${row.status === 'PENDING' ? 'border-[#E7C84B] bg-[#FFFDF5]' : ''}`}>
      <div className="grid gap-4 xl:grid-cols-[180px_1fr]">
        <div>
          {imageUrl ? <img src={imageUrl} alt="" className="size-28 rounded-xl object-cover" /> : <span className="grid size-28 place-items-center rounded-xl bg-muted text-muted-foreground"><ImageIcon /></span>}
          <strong className="mt-2 block truncate">{pickLocalized(row.name, locale)}</strong>
          <small className="text-muted-foreground">{row.stores} {labels.stores} · {row.status}</small>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <Field label={labels.nameEn} value={nameEn} onChange={setNameEn} /><Field label={labels.nameAr} value={nameAr} onChange={setNameAr} />
          <ImageUploadField label={labels.image} uploadLabel={labels.upload} value={imageUrl} onChange={setImageUrl} uploading={upload.isPending} onFile={(file) => upload.mutate(file)} /><Field label={labels.descEn} value={descEn} onChange={setDescEn} />
          <Field label={labels.descAr} value={descAr} onChange={setDescAr} /><Field label={labels.note} value={note} onChange={setNote} />
        </div>
      </div>
      {error ? <p className="mt-3 text-sm font-medium text-[#B42318]">{error}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
        <Button variant="outline" className="h-9 rounded-lg" loading={update.isPending} onClick={() => update.mutate(undefined)}>{labels.save}</Button>
        <Button variant="yellow" className="h-9 rounded-lg" loading={update.isPending} onClick={() => update.mutate('APPROVED')}><CheckCircle2 className="size-4" /> {labels.approve}</Button>
        <Button variant="outline" className="h-9 rounded-lg text-[#B42318]" loading={update.isPending} onClick={() => update.mutate('REJECTED')}><XCircle className="size-4" /> {labels.reject}</Button>
        <div className="ms-auto flex min-w-64 flex-1 gap-2 sm:max-w-md">
          <select value={targetId} onChange={(event) => setTargetId(event.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border bg-white px-2 text-xs"><option value="">{labels.mergeInto}</option>{approved.filter((item) => item.id !== row.id).map((item) => <option key={item.id} value={item.id}>{pickLocalized(item.name, locale)}</option>)}</select>
          <Button variant="outline" className="h-9 rounded-lg" disabled={!targetId} loading={merge.isPending} onClick={() => merge.mutate()}><Merge className="size-4" /> {labels.merge}</Button>
        </div>
      </div>
    </Card>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-xs font-semibold text-muted-foreground">{label}<input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm text-foreground outline-none" /></label>;
}

function ImageUploadField({ label, uploadLabel, value, onChange, uploading, onFile }: { label: string; uploadLabel: string; value: string; onChange: (value: string) => void; uploading: boolean; onFile: (file: File) => void }) {
  return (
    <div className="text-xs font-semibold text-muted-foreground">
      {label}
      <div className="mt-1 flex h-10 gap-1">
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Image URL" className="min-w-0 flex-1 rounded-lg border bg-white px-3 text-xs text-foreground outline-none" />
        <label className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border bg-white px-3 text-foreground" title={uploadLabel}>
          <Upload className="size-4" /> {uploading ? '…' : uploadLabel}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onFile(file); }} />
        </label>
      </div>
    </div>
  );
}
