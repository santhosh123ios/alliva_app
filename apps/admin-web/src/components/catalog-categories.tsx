import { api } from '@/components/providers';
import { pickLocalized } from '@alliva/design-tokens';
import { Button, Card, EmptyState, ErrorState, PageHeader, TableSkeleton } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ImageIcon, Merge, Search, ShieldAlert, Upload, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLocale } from 'use-intl';

type CategoryStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
type CatalogCategoryRow = {
  id: string;
  name: { en?: string; ar?: string };
  icon: string | null;
  status: CategoryStatus;
  reviewNote: string | null;
  submittedByMerchantId: string | null;
  stores: number;
  mergedInto: { id: string; name: { en?: string; ar?: string } } | null;
  createdAt: string;
};

const copy = {
  en: {
    title: 'Product categories',
    subtitle: 'Review shared category names, spelling and icons used by every store.',
    pending: 'Pending review',
    all: 'All',
    approved: 'Approved',
    rejected: 'Rejected',
    search: 'Search categories',
    empty: 'No categories found',
    stores: 'stores',
    submitted: 'Merchant submission',
    nameEn: 'English name',
    nameAr: 'Arabic name',
    icon: 'Icon',
    upload: 'Upload icon',
    note: 'Admin note',
    save: 'Save changes',
    approve: 'Approve',
    reject: 'Reject',
    mergeInto: 'Swap / merge into…',
    merge: 'Merge',
    mergedInto: 'Merged into',
  },
  ar: {
    title: 'تصنيفات المنتجات',
    subtitle: 'راجع أسماء التصنيفات المشتركة والإملاء والأيقونات المستخدمة في جميع المتاجر.',
    pending: 'بانتظار المراجعة',
    all: 'الكل',
    approved: 'معتمد',
    rejected: 'مرفوض',
    search: 'ابحث في التصنيفات',
    empty: 'لا توجد تصنيفات',
    stores: 'متاجر',
    submitted: 'إضافة من تاجر',
    nameEn: 'الاسم بالإنجليزية',
    nameAr: 'الاسم بالعربية',
    icon: 'الأيقونة',
    upload: 'رفع الأيقونة',
    note: 'ملاحظة الإدارة',
    save: 'حفظ التغييرات',
    approve: 'اعتماد',
    reject: 'رفض',
    mergeInto: 'استبدال / دمج مع…',
    merge: 'دمج',
    mergedInto: 'مدمج مع',
  },
} as const;

export function CatalogCategories() {
  const locale = useLocale() === 'ar' ? 'ar' : 'en';
  const t = copy[locale];
  const [status, setStatus] = useState<'ALL' | CategoryStatus>('PENDING');
  const [query, setQuery] = useState('');
  const categories = useQuery({
    queryKey: ['admin', 'catalog-categories'],
    queryFn: () => api.adminCatalogCategories() as Promise<CatalogCategoryRow[]>,
  });
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (categories.data ?? []).filter((row) => {
      if (status !== 'ALL' && row.status !== status) return false;
      return !needle || `${row.name.en ?? ''} ${row.name.ar ?? ''}`.toLocaleLowerCase().includes(needle);
    });
  }, [categories.data, query, status]);
  if (categories.isLoading) return <TableSkeleton rows={6} columns={5} />;
  if (categories.error) return <ErrorState title="Could not load categories" body={(categories.error as Error).message} />;
  const pending = (categories.data ?? []).filter((row) => row.status === 'PENDING').length;
  const approved = (categories.data ?? []).filter((row) => row.status === 'APPROVED');
  return (
    <div className="space-y-5">
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric icon={<ShieldAlert />} label={t.pending} value={pending} tone="text-[#9A6700]" />
        <Metric icon={<CheckCircle2 />} label={t.approved} value={approved.length} tone="text-[#168A52]" />
        <Metric icon={<XCircle />} label={t.rejected} value={(categories.data ?? []).filter((row) => row.status === 'REJECTED').length} tone="text-[#B42318]" />
      </div>
      <Card className="p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search} className="h-10 w-full rounded-xl border ps-9 pe-3 text-sm outline-none" />
          </label>
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="h-10 rounded-xl border bg-white px-3 text-sm font-semibold">
            <option value="PENDING">{t.pending} ({pending})</option>
            <option value="APPROVED">{t.approved}</option>
            <option value="REJECTED">{t.rejected}</option>
            <option value="ALL">{t.all}</option>
          </select>
        </div>
      </Card>
      {!rows.length ? <EmptyState title={t.empty} body={t.subtitle} /> : (
        <div className="space-y-3">
          {rows.map((row) => <CategoryReviewCard key={row.id} row={row} approved={approved} labels={t} locale={locale} />)}
        </div>
      )}
    </div>
  );
}

function CategoryReviewCard({ row, approved, labels, locale }: {
  row: CatalogCategoryRow;
  approved: CatalogCategoryRow[];
  labels: (typeof copy)['en'] | (typeof copy)['ar'];
  locale: 'en' | 'ar';
}) {
  const client = useQueryClient();
  const [nameEn, setNameEn] = useState(row.name.en ?? '');
  const [nameAr, setNameAr] = useState(row.name.ar ?? '');
  const [icon, setIcon] = useState(row.icon ?? '');
  const [note, setNote] = useState(row.reviewNote ?? '');
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState('');
  const refresh = () => void client.invalidateQueries({ queryKey: ['admin', 'catalog-categories'] });
  const update = useMutation({
    mutationFn: (status?: CategoryStatus) => api.updateAdminCatalogCategory(row.id, {
      name: { en: nameEn, ar: nameAr },
      icon,
      reviewNote: note,
      ...(status ? { status } : {}),
    }),
    onSuccess: () => { setError(''); refresh(); },
    onError: (reason: Error) => setError(reason.message),
  });
  const merge = useMutation({
    mutationFn: () => api.mergeAdminCatalogCategory(row.id, { targetId, note }),
    onSuccess: () => { setError(''); refresh(); },
    onError: (reason: Error) => setError(reason.message),
  });
  const upload = useMutation({
    mutationFn: (file: File) => api.upload(file),
    onSuccess: (saved) => { setIcon(saved.url); setError(''); },
    onError: (reason: Error) => setError(reason.message),
  });
  return (
    <Card className={`p-4 ${row.status === 'PENDING' ? 'border-[#E7C84B] bg-[#FFFDF5]' : ''}`}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="flex min-w-52 items-center gap-3">
          <span className="grid size-12 place-items-center rounded-xl bg-[#FFF0B8] text-xl">{icon || '◫'}</span>
          <div>
            <p className="font-bold">{pickLocalized(row.name, locale)}</p>
            <p className="text-xs text-muted-foreground">{row.stores} {labels.stores} · {row.submittedByMerchantId ? labels.submitted : labels.approved}</p>
            <StatusBadge status={row.status} labels={labels} />
          </div>
        </div>
        <div className="grid flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Field label={labels.nameEn} value={nameEn} onChange={setNameEn} />
          <Field label={labels.nameAr} value={nameAr} onChange={setNameAr} />
          <ImageUploadField label={labels.icon} uploadLabel={labels.upload} value={icon} onChange={setIcon} uploading={upload.isPending} onFile={(file) => upload.mutate(file)} />
          <Field label={labels.note} value={note} onChange={setNote} />
        </div>
      </div>
      {row.mergedInto ? <p className="mt-3 text-xs font-semibold text-[#B42318]">{labels.mergedInto}: {pickLocalized(row.mergedInto.name, locale)}</p> : null}
      {error ? <p className="mt-3 text-sm font-medium text-[#B42318]">{error}</p> : null}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
        <Button variant="outline" className="h-9 rounded-lg" loading={update.isPending} onClick={() => update.mutate(undefined)}>{labels.save}</Button>
        <Button variant="yellow" className="h-9 rounded-lg" loading={update.isPending} onClick={() => update.mutate('APPROVED')}><CheckCircle2 className="size-4" /> {labels.approve}</Button>
        <Button variant="outline" className="h-9 rounded-lg text-[#B42318]" loading={update.isPending} onClick={() => update.mutate('REJECTED')}><XCircle className="size-4" /> {labels.reject}</Button>
        <div className="ms-auto flex min-w-64 flex-1 gap-2 sm:max-w-md">
          <select value={targetId} onChange={(event) => setTargetId(event.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border bg-white px-2 text-xs">
            <option value="">{labels.mergeInto}</option>
            {approved.filter((item) => item.id !== row.id).map((item) => <option key={item.id} value={item.id}>{pickLocalized(item.name, locale)}</option>)}
          </select>
          <Button variant="outline" className="h-9 rounded-lg" disabled={!targetId} loading={merge.isPending} onClick={() => merge.mutate()}><Merge className="size-4" /> {labels.merge}</Button>
        </div>
      </div>
    </Card>
  );
}

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return <Card className="flex items-center gap-3 p-4"><span className={tone}>{icon}</span><span><small className="block text-muted-foreground">{label}</small><strong className="text-xl">{value}</strong></span></Card>;
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="text-xs font-semibold text-muted-foreground">{label}<input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm text-foreground outline-none" /></label>;
}

function ImageUploadField({ label, uploadLabel, value, onChange, uploading, onFile }: { label: string; uploadLabel: string; value: string; onChange: (value: string) => void; uploading: boolean; onFile: (file: File) => void }) {
  return (
    <div className="text-xs font-semibold text-muted-foreground">
      {label}
      <div className="mt-1 flex h-10 gap-1">
        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg border bg-white">
          {value && (/^https?:\/\//.test(value) || value.startsWith('/')) ? <img src={value} alt="" className="size-full object-cover" /> : value ? <span className="text-lg">{value}</span> : <ImageIcon className="size-4" />}
        </span>
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="☕ or image URL" className="min-w-0 flex-1 rounded-lg border bg-white px-2 text-xs text-foreground outline-none" />
        <label className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg border bg-white" title={uploadLabel}>
          <Upload className="size-4" />
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onFile(file); }} />
        </label>
      </div>
    </div>
  );
}

function StatusBadge({ status, labels }: { status: CategoryStatus; labels: (typeof copy)['en'] | (typeof copy)['ar'] }) {
  const text = status === 'PENDING' ? labels.pending : status === 'APPROVED' ? labels.approved : labels.rejected;
  const tone = status === 'PENDING' ? 'bg-[#FFF0B8] text-[#7A5200]' : status === 'APPROVED' ? 'bg-[#E3F6EA] text-[#126B3B]' : 'bg-[#FDE8E7] text-[#B42318]';
  return <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${tone}`}>{text}</span>;
}
