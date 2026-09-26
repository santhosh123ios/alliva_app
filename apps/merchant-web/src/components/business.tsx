'use client';

import { LocationMap } from '@/components/location-map';
import { api } from '@/components/providers';
import { useSaveStatus } from '@/components/shell';
import { pickLocalized } from '@alliva/design-tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Placeholder } from '@alliva/ui';
import { Building, Check, ChevronDown, Clock, Copy, ExternalLink, Eye, Image as ImageIcon, Info, Leaf, Link2, LocateFixed, Mail, MapPin, Pencil, Phone, Plus, Share2, ShoppingBag, Store, Truck, UserRound, Utensils, UtensilsCrossed } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

type Hour = { dayOfWeek: number; opensAt: string; closesAt: string; closed: boolean };
type Branch = {
  id: string;
  line1: string;
  city: string;
  phone?: string | null;
  latitude?: string;
  longitude?: string;
  name: { en?: string; ar?: string };
  manager?: { id: string; firstName: string; lastName: string } | null;
};
type StaffMember = { id: string; firstName: string; lastName: string; status: string; roles: string[] };
type Profile = {
  slug: string;
  name: { en?: string; ar?: string };
  description: { en?: string; ar?: string };
  businessType: string;
  phone: string;
  email: string;
  logoUrl: string | null;
  coverUrl: string | null;
  availability?: 'OPEN' | 'CLOSED' | 'BUSY';
  status: string;
  temporaryClosedUntil: string | null;
  deliveryEnabled: boolean;
  takeawayEnabled: boolean;
  dineInEnabled: boolean;
  minimumOrder: string;
  freeDeliveryEnabled?: boolean;
  freeDeliveryKm?: string;
  beyondFreeDeliveryFee?: string;
  maxDeliveryKm?: string;
  preparationMinutes: number;
  branches: Branch[];
  hours: Hour[];
  categories: { category: { name: { en?: string; ar?: string }; slug: string } }[];
};

const tabs = ['overview', 'branches', 'details', 'operations'] as const;
const dayOrder = [1, 2, 3, 4, 5, 6, 0];

export function BusinessPage({ profile }: { profile: Profile }) {
  const t = useTranslations('merchantBusiness');
  const setSaveStatus = useSaveStatus();
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const [tab, setTab] = useState<(typeof tabs)[number]>('overview');
  const [editingHours, setEditingHours] = useState(false);
  const [addingBranch, setAddingBranch] = useState(false);
  const [branchForm, setBranchForm] = useState({ name: '', line1: '', city: '', phone: '', managerId: '' });
  const [branchPoint, setBranchPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [branchError, setBranchError] = useState('');
  const [notice, setNotice] = useState('');
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(() => mapPoint(profile.branches[0]));
  const [pointDirty, setPointDirty] = useState(false);
  const [branchId, setBranchId] = useState(profile.branches[0]?.id ?? '');
  const branchIdRef = useRef(branchId);
  branchIdRef.current = branchId;
  const branch = profile.branches.find((item) => item.id === branchId) ?? profile.branches[0];
  const [form, setForm] = useState(() => draft(profile, locale));
  const savedSnapshot = useRef<string | null>(null);
  useEffect(() => {
    const next = draft(profile, locale, branchIdRef.current);
    const serialized = JSON.stringify(next);
    setForm((current) => {
      const currentSerialized = JSON.stringify(current);
      if (savedSnapshot.current === null || currentSerialized === savedSnapshot.current) {
        savedSnapshot.current = serialized;
        return next;
      }
      return current;
    });
  }, [profile, locale]);
  const save = useMutation({
    mutationFn: async () => {
      await api.updateProfile({
        name: { ...profile.name, [locale]: form.name },
        description: { ...profile.description, [locale]: form.description },
        businessType: form.businessType,
        phone: form.phone,
        email: form.email,
        address: form.address,
        city: form.city,
        delivery: form.delivery,
        takeaway: form.takeaway,
        dineIn: form.dineIn,
        availability: form.availability,
        logoUrl: form.logoUrl,
        coverUrl: form.coverUrl,
        minimumOrder: form.minimumOrder,
        freeDeliveryEnabled: form.freeDeliveryEnabled,
        freeDeliveryKm: form.freeDeliveryKm,
        beyondFreeDeliveryFee: form.beyondFreeDeliveryFee,
        maxDeliveryKm: form.maxDeliveryKm,
        preparationMinutes: Number(form.preparationMinutes) || profile.preparationMinutes,
        branchId: branchIdRef.current || undefined,
      });
      const previous = savedSnapshot.current ? JSON.parse(savedSnapshot.current) as { hours?: Hour[] } : null;
      const hoursChanged = JSON.stringify(previous?.hours ?? null) !== JSON.stringify(form.hours);
      if (hoursChanged) {
        await api.setHours(form.hours.map((hour) => ({ dayOfWeek: hour.dayOfWeek, opensAt: hour.opensAt.slice(0, 5), closesAt: hour.closesAt.slice(0, 5), closed: hour.closed })));
      }
    },
    onSuccess: () => {
      setNotice(t('saved'));
      setEditingHours(false);
    },
    onError: (error: Error) => setNotice(error.message),
  });
  const addBranch = useMutation({
    mutationFn: async () => {
      const name = branchForm.name.trim();
      const line1 = branchForm.line1.trim();
      const city = branchForm.city.trim();
      if (!name || !line1 || !city || !branchPoint) throw new Error(t('branchRequired'));
      await api.createBranch({
        name: { en: name, ar: name },
        line1,
        city,
        phone: branchForm.phone.trim() || undefined,
        latitude: branchPoint.lat.toFixed(6),
        longitude: branchPoint.lng.toFixed(6),
        managerId: branchForm.managerId || undefined,
      });
    },
    onSuccess: () => {
      setNotice(t('saved'));
      setBranchError('');
      setAddingBranch(false);
      setBranchForm({ name: '', line1: '', city: '', phone: '', managerId: '' });
      setBranchPoint(null);
      void client.invalidateQueries({ queryKey: ['merchant', 'business'] });
    },
    onError: (error: Error) => setBranchError(error.message),
  });
  const saveLocation = useMutation({
    mutationFn: async () => {
      if (!point) throw new Error(t('locationRequired'));
      await api.updateProfile({ latitude: point.lat.toFixed(6), longitude: point.lng.toFixed(6), branchId: branchIdRef.current || undefined });
    },
    onSuccess: () => {
      setNotice(t('saved'));
      setPointDirty(false);
      void client.invalidateQueries({ queryKey: ['merchant', 'business'] });
    },
    onError: (error: Error) => setNotice(error.message),
  });
  useEffect(() => {
    if (pointDirty) return;
    setPoint(mapPoint(profile.branches.find((item) => item.id === branchIdRef.current) ?? profile.branches[0]));
  }, [profile.branches, pointDirty]);
  const days = t.raw('days') as string[];
  async function uploadImage(file: File | undefined, field: 'logoUrl' | 'coverUrl') {
    if (!file) return;
    setNotice('');
    try {
      const saved = await api.upload(file);
      setForm((current) => ({ ...current, [field]: saved.url }));
    } catch (error) {
      setNotice((error as Error).message);
    }
  }
  const category = profile.categories[0]?.category;
  const typeLabel = category ? pickLocalized(category.name, locale) || form.businessType : form.businessType;
  const tables = useQuery({ queryKey: ['merchant', 'tables'], queryFn: () => api.tables() });
  const tableNumber = (tables.data?.[0] as { number?: string } | undefined)?.number ?? '';
  const staff = useQuery({ queryKey: ['merchant', 'staff'], queryFn: () => api.staff() as Promise<StaffMember[]>, retry: false });
  const managers = (staff.data ?? []).filter((member) => member.status === 'ACTIVE' && member.roles.includes('MERCHANT_MANAGER'));
  const assignManager = useMutation({
    mutationFn: (input: { id: string; managerId: string | null }) => api.updateBranch(input.id, { managerId: input.managerId }),
    onSuccess: () => {
      setNotice(t('saved'));
      void client.invalidateQueries({ queryKey: ['merchant', 'business'] });
    },
    onError: (error: Error) => setNotice(error.message),
  });
  function selectBranch(id: string) {
    const next = profile.branches.find((item) => item.id === id);
    if (!next) return;
    setBranchId(id);
    setPointDirty(false);
    setPoint(mapPoint(next));
    setForm((current) => {
      const updated = { ...current, address: branchAddress(next), city: next.city };
      savedSnapshot.current = JSON.stringify(updated);
      return updated;
    });
  }
  const [storeUrl, setStoreUrl] = useState('');
  useEffect(() => {
    setStoreUrl(`http://${window.location.hostname}:3000/${locale}/merchants/${profile.slug}`);
  }, [locale, profile.slug]);
  function openStorefront() {
    window.open(storeUrl || `http://${window.location.hostname}:3000/${locale}/merchants/${profile.slug}`, '_blank');
  }
  useEffect(() => {
    setSaveStatus?.({ pending: save.isPending, notice });
  }, [notice, save.isPending, setSaveStatus]);
  useEffect(() => () => setSaveStatus?.({ pending: false, notice: '' }), [setSaveStatus]);
  useEffect(() => {
    const serialized = JSON.stringify(form);
    if (savedSnapshot.current === null || serialized === savedSnapshot.current) return;
    const timer = window.setTimeout(() => {
      setNotice('');
      save.mutate(undefined, { onSuccess: () => { savedSnapshot.current = serialized; } });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [form, save.mutate]);

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 rounded-[20px] border border-[#EEEEEC] bg-white p-3 shadow-[0_8px_24px_rgba(17,17,17,0.04)] md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4 px-2 py-1">
          <label className="grid size-[72px] shrink-0 cursor-pointer place-items-center overflow-hidden rounded-2xl bg-[#F6F7F4]" aria-label={t('changeLogo')}>
            {form.logoUrl ? <img src={form.logoUrl} alt="" className="h-full w-full object-contain p-1.5" /> : <Store className="h-7 w-7 text-[#8a8a86]" />}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => uploadImage(event.target.files?.[0], 'logoUrl')} />
          </label>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="truncate text-[22px] font-semibold tracking-tight text-[#161616]">{form.name}</h2>
              <label className={`relative inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${form.availability === 'OPEN' ? 'bg-[#E7F8EE] text-[#16924A]' : form.availability === 'BUSY' ? 'bg-[#FFF4CC] text-[#8A6A00]' : 'bg-[#F1F1EE] text-[#696965]'}`}>
                <span className={`size-1.5 rounded-full ${form.availability === 'OPEN' ? 'bg-[#22A85A]' : form.availability === 'BUSY' ? 'bg-[#C49200]' : 'bg-[#8a8a86]'}`} />
                {form.availability === 'OPEN' ? t('open') : form.availability === 'BUSY' ? t('busy') : t('closed')}
                <ChevronDown className="size-3.5" />
                <select className="absolute inset-0 cursor-pointer opacity-0" value={form.availability} aria-label={t('open')} onChange={(event) => setForm({ ...form, availability: event.target.value as 'OPEN' | 'CLOSED' | 'BUSY' })}>
                  <option value="OPEN">{t('open')}</option>
                  <option value="CLOSED">{t('closed')}</option>
                  <option value="BUSY">{t('busy')}</option>
                </select>
              </label>
              {profile.branches.length ? (
                <label className="relative inline-flex h-7 items-center gap-1.5 rounded-full border border-[#E8E8E4] bg-white ps-2.5 pe-7 text-xs font-semibold text-[#161616]">
                  <span className="sr-only">{t('switchBranch')}</span>
                  <select className="max-w-40 appearance-none bg-transparent outline-none" value={branch?.id ?? ''} aria-label={t('switchBranch')} onChange={(event) => selectBranch(event.target.value)}>
                    {profile.branches.map((item) => <option key={item.id} value={item.id}>{pickLocalized(item.name, locale) || item.line1}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute end-2 size-3.5 text-[#8A8A86]" />
                </label>
              ) : null}
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-[#8A8A86]"><MapPin className="size-3.5" /> {branch ? `${pickLocalized(branch.name, locale) || branch.line1} • ${branch.city}` : typeLabel}</p>
          </div>
        </div>
        <div className="relative h-[104px] overflow-hidden rounded-2xl bg-[#F3F3F0] md:h-[112px] md:w-[54%]">
          <label className="absolute inset-0 cursor-pointer">
            {form.coverUrl ? <img src={form.coverUrl} alt="" className="h-full w-full object-cover" /> : <Placeholder className="h-full w-full rounded-none bg-transparent" />}
            <span className="absolute bottom-3 end-3 inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[#161616] shadow-[0_4px_16px_rgba(17,17,17,0.12)]">
              <ImageIcon className="size-4" /> {t('editPhoto')}
            </span>
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => uploadImage(event.target.files?.[0], 'coverUrl')} />
          </label>
          <button
            type="button"
            className="absolute top-3 end-3 z-10 inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[#161616] shadow-[0_4px_16px_rgba(17,17,17,0.12)]"
            onClick={() => { setBranchError(''); setAddingBranch(true); }}
          >
            <Plus className="size-4" /> {t('addBranch')}
          </button>
        </div>
      </section>

      <Dialog open={addingBranch} onOpenChange={setAddingBranch}>
        <DialogContent className="max-h-[min(100%-2rem,42rem)] w-[min(100%-2rem,36rem)] overflow-y-auto">
          <DialogTitle>{t('addBranch')}</DialogTitle>
          <DialogDescription>{t('branchesHint')}</DialogDescription>
          {profile.branches.length ? (
            <ul className="mt-4 space-y-1.5">
              {profile.branches.map((item) => (
                <li key={item.id} className="flex items-center gap-2 rounded-xl bg-[#F7F7F5] px-3 py-2 text-sm text-[#161616]">
                  <MapPin className="size-3.5 shrink-0 text-[#8A8A86]" />
                  <span className="min-w-0 truncate">{pickLocalized(item.name, locale) || item.line1} · {item.city}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-[#161616] sm:col-span-2">
              {t('branchName')}
              <input className="mt-1.5 h-11 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm font-medium outline-none" value={branchForm.name} onChange={(event) => setBranchForm({ ...branchForm, name: event.target.value })} />
            </label>
            <label className="block text-sm font-semibold text-[#161616]">
              {t('address')}
              <input className="mt-1.5 h-11 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm font-medium outline-none" value={branchForm.line1} onChange={(event) => setBranchForm({ ...branchForm, line1: event.target.value })} />
            </label>
            <label className="block text-sm font-semibold text-[#161616]">
              {t('city')}
              <input className="mt-1.5 h-11 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm font-medium outline-none" value={branchForm.city} onChange={(event) => setBranchForm({ ...branchForm, city: event.target.value })} />
            </label>
            <label className="block text-sm font-semibold text-[#161616] sm:col-span-2">
              {t('branchPhone')}
              <input className="mt-1.5 h-11 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm font-medium outline-none" value={branchForm.phone} onChange={(event) => setBranchForm({ ...branchForm, phone: event.target.value })} />
            </label>
            <label className="block text-sm font-semibold text-[#161616] sm:col-span-2">
              {t('inCharge')}
              <span className="mt-0.5 block text-xs font-medium text-[#8A8A86]">{t('storeManager')}</span>
              <select className="mt-1.5 h-11 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm font-medium outline-none" value={branchForm.managerId} onChange={(event) => setBranchForm({ ...branchForm, managerId: event.target.value })}>
                <option value="">{t('chooseManager')}</option>
                {managers.map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-3 overflow-hidden rounded-2xl border border-[#ECECEA]">
            {addingBranch ? <LocationMap point={branchPoint} onMark={setBranchPoint} className="z-0 h-44 w-full" /> : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[#5C5C58]">{branchPoint ? `${branchPoint.lat.toFixed(6)}, ${branchPoint.lng.toFixed(6)}` : t('locationRequired')}</p>
            <button type="button" className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#E4E4E0] bg-white px-3 text-sm font-semibold text-[#161616]" onClick={() => {
              if (!navigator.geolocation) { setBranchError(t('locationDenied')); return; }
              navigator.geolocation.getCurrentPosition(
                (position) => setBranchPoint({ lat: position.coords.latitude, lng: position.coords.longitude }),
                () => setBranchError(t('locationDenied')),
              );
            }}>
              <LocateFixed className="size-4" /> {t('useLocation')}
            </button>
          </div>
          {branchError ? <p className="mt-3 text-sm font-medium text-[#B42318]">{branchError}</p> : null}
          <div className="mt-4 flex justify-end">
            <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" loading={addBranch.isPending} onClick={() => { setBranchError(''); addBranch.mutate(); }}>{t('saveBranch')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex gap-6 border-b text-sm font-semibold">
        {tabs.map((item) => (
          <button key={item} type="button" className={`pb-3 ${tab === item ? 'border-b-2 border-[#111111]' : 'text-[#8a8a86]'}`} onClick={() => setTab(item)}>{t(item)}</button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="grid items-start gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <DeliverySettingsCard
            form={form}
            setForm={setForm}
            saving={save.isPending}
            onSave={() => { setNotice(''); save.mutate(); }}
            labels={{
              title: t('deliverySettings'),
              hint: t('deliveryHint'),
              free: t('freeDelivery'),
              freeHint: t('freeDeliveryHint'),
              freeKm: t('freeDeliveryKm'),
              beyond: t('beyondFee'),
              area: t('maxArea'),
              minimum: t('minimumDelivery'),
              note: t('checkoutNote'),
              save: t('saveDelivery'),
              km: t('km'),
              bhd: t('bhd'),
              bhdPerKm: t('bhdPerKm'),
            }}
          />
        </div>
        <div className="space-y-4">
            <StoreVisibility
              name={form.name}
              typeLabel={typeLabel}
              city={form.city || branch?.city || ''}
              coverUrl={form.coverUrl}
              logoUrl={form.logoUrl}
              availability={form.availability}
              storeUrl={storeUrl || profile.slug}
              tableNumber={tableNumber}
              onAvailability={(availability) => setForm({ ...form, availability })}
              onPreview={openStorefront}
              labels={{
                title: t('visibility'),
                hint: t('visibilityHint'),
                qr: t('qrHint'),
                preview: t('preview'),
                copy: t('copy'),
                copied: t('copied'),
                share: t('share'),
                menu: t('menu'),
                about: t('about'),
                reviews: t('reviews'),
                open: t('open'),
                closed: t('closed'),
                busy: t('busy'),
              }}
            />
            <OrderTypes
              delivery={form.delivery}
              takeaway={form.takeaway}
              dineIn={form.dineIn}
              onDelivery={() => setForm({ ...form, delivery: !form.delivery })}
              onPickup={() => setForm({ ...form, takeaway: !form.takeaway })}
              onDineIn={() => setForm({ ...form, dineIn: !form.dineIn })}
              labels={{ title: t('orderTypesTitle'), hint: t('orderTypesHint'), delivery: t('deliveryType'), pickup: t('pickup'), dineIn: t('dineIn') }}
            />
          </div>
        </div>
      ) : null}

      {tab === 'branches' ? (
        <div className="space-y-3">
          {!staff.isLoading && managers.length === 0 ? <p className="text-sm text-[#8A8A86]">{t('noManagers')}</p> : null}
          {profile.branches.map((item) => (
            <article key={item.id} className={`rounded-[20px] border bg-white p-5 shadow-[0_8px_30px_rgba(17,17,17,0.04)] ${item.id === branch?.id ? 'border-[#F5C400]' : 'border-[#ECECEA]'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold tracking-tight text-[#161616]">{pickLocalized(item.name, locale) || item.line1}</h3>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-[#8A8A86]"><MapPin className="size-3.5" /> {item.line1}{item.city ? `, ${item.city}` : ''}</p>
                </div>
                {item.id === branch?.id ? <span className="rounded-full bg-[#FFF6D4] px-2.5 py-1 text-xs font-semibold text-[#8A6A00]">{t('currentBranch')}</span> : (
                  <button type="button" className="h-9 rounded-xl border border-[#E4E4E0] bg-white px-3 text-sm font-semibold text-[#161616]" onClick={() => selectBranch(item.id)}>{t('useBranch')}</button>
                )}
              </div>
              <label className="mt-4 block max-w-md text-sm font-semibold text-[#161616]">
                <span className="inline-flex items-center gap-2"><UserRound className="size-4 text-[#8A8A86]" /> {t('inCharge')}</span>
                <span className="mt-0.5 block text-xs font-medium text-[#8A8A86]">{t('storeManager')}</span>
                <select
                  className="mt-1.5 h-11 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 text-sm font-medium outline-none"
                  value={item.manager?.id ?? ''}
                  disabled={assignManager.isPending || managers.length === 0}
                  onChange={(event) => assignManager.mutate({ id: item.id, managerId: event.target.value || null })}
                >
                  <option value="">{t('chooseManager')}</option>
                  {item.manager && !managers.some((member) => member.id === item.manager?.id) ? <option value={item.manager.id}>{item.manager.firstName} {item.manager.lastName}</option> : null}
                  {managers.map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName}</option>)}
                </select>
              </label>
            </article>
          ))}
          <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" onClick={() => { setBranchError(''); setAddingBranch(true); }}>
            <Plus className="size-4" /> {t('addBranch')}
          </Button>
        </div>
      ) : null}

      {tab === 'details' ? (
        <section className="rounded-[20px] border border-[#ECECEA] bg-white p-5 shadow-[0_8px_30px_rgba(17,17,17,0.04)]">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#FFF3C4]">
              <Store className="size-5" />
            </span>
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-[#161616]">{t('details')}</h3>
              <p className="text-sm text-[#9A9A96]">{t('detailsHint')}</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <DetailField icon={Store} label={t('name')} value={form.name} onChange={(name) => setForm({ ...form, name })} />
            <DetailField icon={Building} label={t('type')} value={form.businessType} onChange={(businessType) => setForm({ ...form, businessType })} />
            <DetailField icon={Phone} label={t('phone')} value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
            <DetailField icon={Mail} label={t('email')} value={form.email} onChange={(email) => setForm({ ...form, email })} />
            <label className="block text-sm font-semibold text-[#161616]">
              {t('description')}
              <textarea className="mt-1.5 h-12 w-full rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3 py-3 text-sm font-medium outline-none" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </label>
            <DetailField icon={MapPin} label={t('address')} value={form.address} onChange={(address) => setForm({ ...form, address })} />
          </div>
          <div className="mt-5 flex justify-end">
            <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" loading={save.isPending} onClick={() => { setNotice(''); save.mutate(); }}>{t('saveDetails')}</Button>
          </div>
        </section>
      ) : null}

      {tab === 'operations' ? (
        <div className="grid items-stretch gap-4 xl:grid-cols-2">
          <section className="flex h-full flex-col rounded-[20px] border border-[#ECECEA] bg-white p-5 shadow-[0_8px_30px_rgba(17,17,17,0.04)]">
            <div className="flex items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#FFF3C4]">
                <MapPin className="size-5" />
              </span>
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-[#161616]">{t('location')}</h3>
                <p className="text-sm text-[#9A9A96]">{t('locationHint')}</p>
              </div>
            </div>
            <div className="relative mt-4 min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#ECECEA]">
              <LocationMap className="absolute inset-0 z-0 h-full w-full" point={point} onMark={(next) => { setPoint(next); setPointDirty(true); }} />
            </div>
            <p className="mt-3 text-sm text-[#5C5C58]">{point ? `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` : '—'}</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#E4E4E0] bg-white px-4 text-sm font-semibold text-[#161616]" onClick={() => {
                if (!navigator.geolocation) { setNotice(t('locationDenied')); return; }
                navigator.geolocation.getCurrentPosition(
                  (position) => { setPoint({ lat: position.coords.latitude, lng: position.coords.longitude }); setPointDirty(true); },
                  () => setNotice(t('locationDenied')),
                );
              }}>
                <LocateFixed className="size-4" /> {t('useLocation')}
              </button>
              <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" loading={saveLocation.isPending} onClick={() => { setNotice(''); saveLocation.mutate(); }}>{t('saveLocation')}</Button>
            </div>
          </section>
          <HoursCard hours={form.hours} days={days} editing={editingHours} onToggle={() => setEditingHours((value) => !value)} onChange={(day, value) => {
            const [opensAt, closesAt] = value.split('-');
            setForm({ ...form, hours: form.hours.map((item) => item.dayOfWeek === day ? { ...item, opensAt: (opensAt || item.opensAt).slice(0, 5), closesAt: (closesAt || item.closesAt).slice(0, 5), closed: !value } : item) });
          }} labels={{ title: t('hours'), hint: t('hoursHint'), edit: t('editHours'), allDay: t('allDay'), same: t('sameHours'), custom: t('customHours') }} />
        </div>
      ) : null}
    </div>
  );
}

function draft(profile: Profile, locale: 'en' | 'ar', branchId?: string) {
  const branch = profile.branches.find((item) => item.id === branchId) ?? profile.branches[0];
  const hours = dayOrder.map((day) => profile.hours.find((hour) => hour.dayOfWeek === day) ?? { dayOfWeek: day, opensAt: '08:00', closesAt: '23:00', closed: false });
  return {
    name: pickLocalized(profile.name, locale),
    description: pickLocalized(profile.description, locale),
    businessType: profile.businessType,
    phone: profile.phone ?? '',
    email: profile.email ?? '',
    address: branchAddress(branch),
    city: branch?.city ?? '',
    delivery: profile.deliveryEnabled,
    takeaway: profile.takeawayEnabled,
    dineIn: profile.dineInEnabled,
    availability: profile.availability ?? ((profile.temporaryClosedUntil && new Date(profile.temporaryClosedUntil) > new Date()) ? 'CLOSED' : 'OPEN'),
    logoUrl: profile.logoUrl ?? '',
    coverUrl: profile.coverUrl ?? '',
    minimumOrder: String(profile.minimumOrder ?? '0'),
    freeDeliveryEnabled: Boolean(profile.freeDeliveryEnabled),
    freeDeliveryKm: String(profile.freeDeliveryKm ?? '0'),
    beyondFreeDeliveryFee: String(profile.beyondFreeDeliveryFee ?? '0'),
    maxDeliveryKm: String(profile.maxDeliveryKm ?? '0'),
    preparationMinutes: profile.preparationMinutes ?? 20,
    hours,
  };
}

function branchAddress(branch?: Branch) {
  if (!branch) return '';
  return `${branch.line1}${branch.city ? `, ${branch.city}` : ''}`;
}

function mapPoint(branch?: Branch) {
  if (branch?.latitude == null || branch.longitude == null || branch.latitude === '' || branch.longitude === '') return null;
  const lat = Number(branch.latitude);
  const lng = Number(branch.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function trimTime(value?: string) {
  if (!value) return '';
  const [hour, minute] = value.split(':');
  const date = new Date();
  date.setHours(Number(hour), Number(minute || 0), 0, 0);
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
}

function StoreVisibility({
  name, typeLabel, city, coverUrl, logoUrl, availability, storeUrl, tableNumber, onAvailability, onPreview, labels,
}: {
  name: string;
  typeLabel: string;
  city: string;
  coverUrl: string;
  logoUrl: string;
  availability: 'OPEN' | 'CLOSED' | 'BUSY';
  storeUrl: string;
  tableNumber: string;
  onAvailability: (value: 'OPEN' | 'CLOSED' | 'BUSY') => void;
  onPreview: () => void;
  labels: { title: string; hint: string; qr: string; preview: string; copy: string; copied: string; share: string; menu: string; about: string; reviews: string; open: string; closed: string; busy: string };
}) {
  const [copied, setCopied] = useState(false);
  async function copyLink() {
    await navigator.clipboard.writeText(storeUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }
  async function shareLink() {
    if (navigator.share) {
      await navigator.share({ title: name, url: storeUrl });
      return;
    }
    await copyLink();
  }
  const tone = availability === 'OPEN'
    ? 'bg-[#E7F8EE] text-[#16924A]'
    : availability === 'BUSY'
      ? 'bg-[#FFF4CC] text-[#8A6A00]'
      : 'bg-[#F1F1EE] text-[#696965]';
  const dot = availability === 'OPEN' ? 'bg-[#22A85A]' : availability === 'BUSY' ? 'bg-[#C4A000]' : 'bg-[#8a8a86]';
  const statusLabel = availability === 'OPEN' ? labels.open : availability === 'BUSY' ? labels.busy : labels.closed;
  return (
    <section className="rounded-2xl border border-[#ECECEA] bg-white p-3.5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-[#E6E6E2]">
          <Eye className="size-3.5" />
        </span>
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-[#161616]">{labels.title}</h3>
          <p className="text-xs text-[#9A9A96]">{labels.hint}</p>
        </div>
      </div>
      <div className="mt-3 grid items-stretch gap-2.5 grid-cols-[minmax(0,1fr)_132px]">
        <div className="overflow-hidden rounded-xl border border-[#ECECEA] bg-white">
          <div className="relative">
            <div className="h-[72px] bg-[#eceae4]">
              {coverUrl ? <img src={coverUrl} alt="" className="h-full w-full object-cover" /> : <Placeholder className="h-full w-full rounded-none bg-transparent [&_svg]:size-5" />}
            </div>
            <div className="absolute bottom-0 start-2.5 translate-y-1/2">
              <div className="grid size-11 place-items-center overflow-hidden rounded-lg border border-[#F0F0EC] bg-white shadow-sm">
                {logoUrl ? <img src={logoUrl} alt="" className="h-full w-full object-contain p-1" /> : <Leaf className="size-5 text-[#168A52]" />}
              </div>
            </div>
          </div>
          <div className="px-2.5 pb-1 pt-7">
            <div className="flex items-center justify-between gap-1.5">
              <p className="truncate text-sm font-semibold tracking-tight text-[#161616]">{name}</p>
              <label className={`relative inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}>
                <span className={`size-1.5 rounded-full ${dot}`} />
                {statusLabel}
                <ChevronDown className="size-3" />
                <select className="absolute inset-0 cursor-pointer opacity-0" value={availability} aria-label={labels.open} onChange={(event) => onAvailability(event.target.value as 'OPEN' | 'CLOSED' | 'BUSY')}>
                  <option value="OPEN">{labels.open}</option>
                  <option value="CLOSED">{labels.closed}</option>
                  <option value="BUSY">{labels.busy}</option>
                </select>
              </label>
            </div>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[#8A8A86]">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{typeLabel}{city ? ` • ${city}` : ''}</span>
            </p>
          </div>
          <div className="mt-1.5 flex gap-4 px-2.5 text-xs font-semibold">
            <span className="border-b-2 border-primary pb-2">{labels.menu}</span>
            <span className="pb-2 text-[#9A9A96]">{labels.about}</span>
            <span className="pb-2 text-[#9A9A96]">{labels.reviews}</span>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border border-[#ECECEA] px-2 py-3">
          <div className="relative">
            <StoreQr value={storeUrl} />
            {tableNumber ? (
              <span className="absolute left-1/2 top-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black text-sm font-bold leading-none text-primary">
                {tableNumber}
              </span>
            ) : null}
          </div>
          <p className="mt-2 max-w-[7.5rem] text-center text-[11px] leading-snug text-[#9A9A96]">{labels.qr}</p>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5 rounded-xl border border-[#ECECEA] bg-[#F7F7F5] px-2.5 py-2">
        <Link2 className="size-3.5 shrink-0 text-[#8A8A86]" />
        <p className="min-w-0 flex-1 truncate text-[11px] text-[#6b6b66]">{storeUrl}</p>
        <button type="button" className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-white px-2 text-[11px] font-semibold text-[#161616]" onClick={() => void copyLink()}>
          <Copy className="size-3" /> {copied ? labels.copied : labels.copy}
        </button>
        <button type="button" className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-white px-2 text-[11px] font-semibold text-[#161616]" onClick={() => void shareLink()}>
          <Share2 className="size-3" /> {labels.share}
        </button>
      </div>
      <button type="button" className="mt-2.5 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#F3F3F0] text-[13px] font-semibold text-[#161616]" onClick={onPreview}>
        <ExternalLink className="size-3.5" />
        {labels.preview}
      </button>
    </section>
  );
}

function StoreQr({ value }: { value: string }) {
  const cells = qrModules(value);
  return (
    <svg width="96" height="96" viewBox="0 0 25 25" shapeRendering="crispEdges" aria-hidden>
      <rect width="25" height="25" fill="#fff" />
      {cells.map((on, index) => on ? <rect key={index} x={index % 25} y={Math.floor(index / 25)} width="1" height="1" fill="#111" /> : null)}
    </svg>
  );
}

function qrModules(value: string) {
  const size = 25;
  const grid = Array.from({ length: size * size }, () => false);
  const paint = (x: number, y: number, on: boolean) => {
    if (x >= 0 && y >= 0 && x < size && y < size) grid[y * size + x] = on;
  };
  const finder = (ox: number, oy: number) => {
    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        const edge = x === 0 || y === 0 || x === 6 || y === 6;
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        paint(ox + x, oy + y, edge || core);
      }
    }
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  for (let i = 8; i < size - 8; i += 1) {
    paint(i, 6, i % 2 === 0);
    paint(6, i, i % 2 === 0);
  }
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inFinder = (x < 8 && y < 8) || (x > size - 9 && y < 8) || (x < 8 && y > size - 9);
      const center = x > 8 && x < 16 && y > 8 && y < 16;
      if (inFinder || center || grid[y * size + x]) continue;
      hash = Math.imul(hash ^ (x * 31 + y), 16777619);
      paint(x, y, (hash >>> 0) % 3 !== 0);
    }
  }
  return grid;
}

function Card({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{title}</h3>
          {hint ? <p className="text-sm text-[#6b6b66]">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function HoursCard({ hours, days, editing, onToggle, onChange, labels }: {
  hours: Hour[];
  days: string[];
  editing: boolean;
  onToggle: () => void;
  onChange: (day: number, value: string) => void;
  labels: { title: string; hint: string; edit: string; allDay: string; same: string; custom: string };
}) {
  return (
    <section className="h-full rounded-[20px] border border-[#ECECEA] bg-white p-5 shadow-[0_8px_30px_rgba(17,17,17,0.04)]">
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#FFF3C4]">
          <Clock className="size-5" />
        </span>
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-[#161616]">{labels.title}</h3>
          <p className="text-sm text-[#9A9A96]">{labels.hint}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-[#FFF8D8] px-3 py-2.5">
        <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-[#161616]">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary"><Clock className="size-3.5" /></span>
          <span className="truncate">{hoursBanner(hours, labels.allDay, labels.same, labels.custom)}</span>
        </span>
        <button type="button" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-[#161616] px-3.5 text-sm font-semibold text-white" onClick={onToggle}>
          <Pencil className="size-3.5" /> {labels.edit}
        </button>
      </div>
      <ul className="mt-2">
        {dayOrder.map((day, index) => {
          const hour = hours.find((item) => item.dayOfWeek === day);
          return (
            <li key={day} className="flex items-center justify-between gap-3 border-b border-[#F1F1EE] py-3 last:border-b-0">
              <p className="text-sm font-semibold text-[#161616]">{days[index]}</p>
              {editing ? (
                <input className="h-9 w-40 rounded-lg border bg-white px-2 text-end text-sm" value={hour?.closed ? '' : `${hour?.opensAt?.slice(0, 5) ?? '08:00'}-${hour?.closesAt?.slice(0, 5) ?? '23:00'}`} onChange={(event) => onChange(day, event.target.value)} />
              ) : (
                <p className="text-sm text-[#5C5C58]">{hour?.closed ? '—' : `${trimTime(hour?.opensAt)} – ${trimTime(hour?.closesAt)}`}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function hoursBanner(hours: Hour[], allDay: string, sameHours: string, customHours: string) {
  const rows = dayOrder.map((day) => hours.find((hour) => hour.dayOfWeek === day));
  if (rows.some((hour) => !hour || hour.closed)) return customHours;
  if (rows.every((hour) => isAllDay(hour))) return allDay;
  const first = rows[0];
  if (first && rows.every((hour) => hour?.opensAt === first.opensAt && hour?.closesAt === first.closesAt)) {
    return `${sameHours} · ${trimTime(first.opensAt)} – ${trimTime(first.closesAt)}`;
  }
  return customHours;
}

function isAllDay(hour?: Hour) {
  const opens = hour?.opensAt?.slice(0, 5);
  const closes = hour?.closesAt?.slice(0, 5);
  return (opens === '00:00' || opens === '24:00') && (closes === '23:59' || closes === '24:00');
}

function DeliverySettingsCard<T extends { freeDeliveryEnabled: boolean; freeDeliveryKm: string; beyondFreeDeliveryFee: string; maxDeliveryKm: string; minimumOrder: string }>({
  form, setForm, saving, onSave, labels,
}: {
  form: T;
  setForm: (next: T) => void;
  saving: boolean;
  onSave: () => void;
  labels: { title: string; hint: string; free: string; freeHint: string; freeKm: string; beyond: string; area: string; minimum: string; note: string; save: string; km: string; bhd: string; bhdPerKm: string };
}) {
  return (
    <section className="rounded-[20px] border border-[#ECECEA] bg-white p-5 shadow-[0_8px_30px_rgba(17,17,17,0.04)]">
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#FFF3C4]">
          <Truck className="size-5" />
        </span>
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-[#161616]">{labels.title}</h3>
          <p className="text-sm text-[#9A9A96]">{labels.hint}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[#F1F1EE] px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-[#161616]">{labels.free}</p>
          <p className="text-xs text-[#9A9A96]">{labels.freeHint}</p>
        </div>
        <button type="button" role="switch" aria-checked={form.freeDeliveryEnabled} aria-label={labels.free} className={`relative h-7 w-12 shrink-0 rounded-full transition ${form.freeDeliveryEnabled ? 'bg-[#161616]' : 'bg-[#E4E4E0]'}`} onClick={() => setForm({ ...form, freeDeliveryEnabled: !form.freeDeliveryEnabled })}>
          <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow ${form.freeDeliveryEnabled ? 'start-5' : 'start-0.5'}`} />
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <SuffixField label={labels.freeKm} value={form.freeDeliveryKm} suffix={labels.km} onChange={(freeDeliveryKm) => setForm({ ...form, freeDeliveryKm })} />
        <SuffixField label={labels.beyond} value={form.beyondFreeDeliveryFee} suffix={labels.bhdPerKm} onChange={(beyondFreeDeliveryFee) => setForm({ ...form, beyondFreeDeliveryFee })} />
        <SuffixField label={labels.area} value={form.maxDeliveryKm} suffix={labels.km} onChange={(maxDeliveryKm) => setForm({ ...form, maxDeliveryKm })} />
        <SuffixField label={labels.minimum} value={form.minimumOrder} suffix={labels.bhd} onChange={(minimumOrder) => setForm({ ...form, minimumOrder })} />
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 text-xs text-[#8A8A86]"><Info className="size-3.5" /> {labels.note}</p>
        <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" loading={saving} onClick={onSave}>{labels.save}</Button>
      </div>
    </section>
  );
}

function DetailField({ icon: Icon, label, value, onChange }: { icon: typeof Store; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-semibold text-[#161616]">
      {label}
      <span className="mt-1.5 flex h-12 items-center gap-2 rounded-xl border border-[#E8E8E4] bg-[#F7F7F5] px-3">
        <Icon className="size-4 shrink-0 text-[#8A8A86]" />
        <input className="w-full bg-transparent text-sm font-medium outline-none" value={value} onChange={(event) => onChange(event.target.value)} />
      </span>
    </label>
  );
}

function SuffixField({ label, value, suffix, onChange }: { label: string; value: string; suffix: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-semibold text-[#161616]">
      {label}
      <span className="mt-1.5 flex h-12 overflow-hidden rounded-xl border border-[#E8E8E4] bg-[#F7F7F5]">
        <input className="w-full bg-transparent px-3 text-sm font-medium outline-none" value={value} onChange={(event) => onChange(event.target.value)} />
        <span className="grid shrink-0 place-items-center border-s border-[#E8E8E4] bg-white px-3 text-xs font-medium text-[#8A8A86]">{suffix}</span>
      </span>
    </label>
  );
}

function OrderTypes({
  delivery, takeaway, dineIn, onDelivery, onPickup, onDineIn, labels,
}: {
  delivery: boolean;
  takeaway: boolean;
  dineIn: boolean;
  onDelivery: () => void;
  onPickup: () => void;
  onDineIn: () => void;
  labels: { title: string; hint: string; delivery: string; pickup: string; dineIn: string };
}) {
  return (
    <section className="rounded-2xl border border-[#ECECEA] bg-white p-3.5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-[#E6E6E2]">
          <Utensils className="size-3.5" />
        </span>
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-[#161616]">{labels.title}</h3>
          <p className="text-xs text-[#9A9A96]">{labels.hint}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <OrderTypeButton icon={Truck} label={labels.delivery} on={delivery} filled={delivery} onClick={onDelivery} />
        <OrderTypeButton icon={ShoppingBag} label={labels.pickup} on={takeaway} onClick={onPickup} />
        <OrderTypeButton icon={UtensilsCrossed} label={labels.dineIn} on={dineIn} onClick={onDineIn} />
      </div>
    </section>
  );
}

function OrderTypeButton({ icon: Icon, label, on, filled = false, onClick }: { icon: typeof Truck; label: string; on: boolean; filled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex h-11 items-center justify-between gap-1 rounded-xl border px-2 text-[13px] font-semibold text-[#161616] ${filled ? 'border-[#E6C200] bg-[#FFF8D4]' : 'border-[#E6E6E2] bg-white'}`}
    >
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <Icon className="size-4 shrink-0" strokeWidth={1.75} />
        <span className="truncate">{label}</span>
      </span>
      {on ? (
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[#161616]">
          <Check className="size-3" strokeWidth={3} />
        </span>
      ) : (
        <span className="size-5 shrink-0 rounded-full border border-[#E0E0DC]" />
      )}
    </button>
  );
}
