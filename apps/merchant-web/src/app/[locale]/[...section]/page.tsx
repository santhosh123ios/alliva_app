'use client';

import { BusinessPage } from '@/components/business';
import { OrdersPage, type MerchantOrder } from '@/components/orders';
import { Overview } from '@/components/overview';
import { ProductsPage } from '@/components/products';
import { SubscriptionPage } from '@/components/subscription';
import { StaffPage, type StaffRow } from '@/components/staff';
import { TablesPage } from '@/components/tables';
import { api } from '@/components/providers';
import { Card, DashboardSkeleton, EmptyState, ErrorState, ListSkeleton, PageHeader, Skeleton } from '@alliva/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { use, useEffect } from 'react';
import { io } from 'socket.io-client';

export default function SectionPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = use(params);
  const key = section?.[0] ?? 'dashboard';
  const client = useQueryClient();
  const data = useQuery({ queryKey: ['merchant', key], queryFn: () => load(key), enabled: key !== 'products' && key !== 'subscription' });
  useEffect(() => {
    if (key !== 'orders') return;
    let socket: ReturnType<typeof io> | undefined;
    void api.socketToken().then(({ token }) => {
      socket = io(process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000', { auth: { token } });
      socket.on('order.updated', () => void client.invalidateQueries({ queryKey: ['merchant', 'orders'] }));
    }).catch(() => undefined);
    return () => {
      socket?.close();
    };
  }, [client, key]);
  if (key === 'products') return <ProductsPage />;
  if (key === 'subscription') return <SubscriptionPage />;
  if (data.isLoading) return <SectionSkeleton section={key} />;
  if (data.error) return <ErrorState title="Could not load" body={(data.error as Error).message} />;
  if (key === 'dashboard' && data.data) {
    return <Overview dash={data.data as Awaited<ReturnType<typeof api.merchantDashboard>>} />;
  }
  if (key === 'business' && data.data) {
    return <BusinessPage profile={data.data as never} />;
  }
  if (key === 'tables' && data.data) {
    return <TablesPage tables={data.data as never} />;
  }
  if (key === 'staff' && data.data) {
    return <StaffPage rows={data.data as StaffRow[]} />;
  }
  if (key === 'orders') {
    return <OrdersPage orders={(data.data ?? []) as MerchantOrder[]} />;
  }
  return (
    <div>
      <PageHeader title={key} />
      <Card className="overflow-auto p-4"><pre className="text-xs">{JSON.stringify(data.data, null, 2)}</pre></Card>
    </div>
  );
}

function SectionSkeleton({ section }: { section: string }) {
  if (section === 'dashboard') return <DashboardSkeleton chart={false} />;
  if (section === 'business') return <BusinessSkeleton />;
  if (section === 'tables') return <TablesSkeleton />;
  if (section === 'staff') return <StaffSkeleton />;
  if (section === 'orders') return <OrdersSkeleton />;
  return (
    <div className="space-y-6" aria-busy>
      <div className="space-y-2"><Skeleton className="h-9 w-48" /><Skeleton className="h-3.5 w-64" /></div>
      <ListSkeleton rows={5} />
    </div>
  );
}

function OrdersSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-10 w-80 rounded-xl" />
        <div className="flex gap-2"><Skeleton className="h-11 w-36 rounded-xl" /><Skeleton className="h-11 w-32 rounded-xl" /></div>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-[520px] rounded-2xl" />
        <Skeleton className="hidden h-[520px] rounded-2xl xl:block" />
      </div>
    </div>
  );
}

function StaffSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-12 w-80 rounded-xl" />
        <div className="flex gap-2"><Skeleton className="h-11 w-36 rounded-xl" /><Skeleton className="h-11 w-32 rounded-xl" /></div>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Skeleton className="h-[520px] rounded-2xl" />
        <Skeleton className="h-[520px] rounded-2xl" />
      </div>
    </div>
  );
}

function TablesSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-10 w-72 rounded-xl" />
        <div className="flex gap-2"><Skeleton className="h-11 w-40 rounded-xl" /><Skeleton className="h-11 w-32 rounded-xl" /></div>
      </div>
      <Skeleton className="h-14 w-full rounded-2xl" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-28 rounded-2xl" />)}
      </div>
    </div>
  );
}

function BusinessSkeleton() {
  return (
    <div className="space-y-5" aria-busy>
      <section className="flex flex-col gap-4 rounded-[20px] border border-[#EEEEEC] bg-white p-3 md:flex-row md:items-center">
        <div className="flex flex-1 items-center gap-4 px-2 py-1">
          <Skeleton className="size-[72px] shrink-0 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2.5"><Skeleton className="h-7 w-44" /><Skeleton className="h-6 w-24 rounded-full" /></div>
            <Skeleton className="h-3.5 w-40" />
          </div>
        </div>
        <Skeleton className="h-[104px] rounded-2xl md:h-[112px] md:w-[54%]" />
      </section>
      <div className="flex gap-6 border-b pb-3">
        <Skeleton className="h-4 w-20" /><Skeleton className="h-4 w-28" /><Skeleton className="h-4 w-24" />
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-[20px] border border-[#ECECEA] bg-white p-5">
            <div className="flex items-center gap-3"><Skeleton className="size-11 rounded-full" /><div className="space-y-2"><Skeleton className="h-5 w-36" /><Skeleton className="h-3 w-48" /></div></div>
            <Skeleton className="mt-4 h-14 w-full" />
            <div className="mt-4 grid gap-4 sm:grid-cols-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
          </div>
          <div className="rounded-[20px] border border-[#ECECEA] bg-white p-5">
            <div className="flex items-center gap-3"><Skeleton className="size-11 rounded-full" /><div className="space-y-2"><Skeleton className="h-5 w-36" /><Skeleton className="h-3 w-48" /></div></div>
            <Skeleton className="mt-4 h-12 w-full" />
            <div className="mt-2 space-y-3">{Array.from({ length: 7 }, (_, index) => <div key={index} className="flex justify-between"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-32" /></div>)}</div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-[#ECECEA] bg-white p-3.5">
            <div className="flex items-center gap-2.5"><Skeleton className="size-8 rounded-full" /><div className="space-y-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-40" /></div></div>
            <div className="mt-3 grid gap-2.5 grid-cols-[minmax(0,1fr)_132px]"><Skeleton className="h-44" /><Skeleton className="h-44" /></div>
            <Skeleton className="mt-2.5 h-10 w-full" />
            <Skeleton className="mt-2.5 h-10 w-full" />
          </div>
          <div className="rounded-[20px] border border-[#ECECEA] bg-white p-5">
            <div className="flex items-center gap-3"><Skeleton className="size-11 rounded-full" /><div className="space-y-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-3 w-52" /></div></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
          </div>
        </div>
      </div>
    </div>
  );
}

async function load(key: string) {
  if (key === 'dashboard') return api.merchantDashboard();
  if (key === 'orders') return api.orders();
  if (key === 'products') return api.products();
  if (key === 'staff') return api.staff();
  if (key === 'tables') return api.tables();
  if (key === 'payments') return { payments: await api.payments(), subscription: await api.subscription() };
  if (key === 'business') return api.profile();
  return api.merchantDashboard();
}
