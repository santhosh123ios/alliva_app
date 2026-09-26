'use client';

import { Merchants, type MerchantRow } from '@/components/merchants';
import { Overview } from '@/components/overview';
import { api } from '@/components/providers';
import { StaffDirectory, type StaffRow } from '@/components/staff';
import { Subscriptions } from '@/components/subscriptions';
import { Card, CardGridSkeleton, DashboardSkeleton, EmptyState, ErrorState, ListSkeleton, PageHeader, Skeleton, TableSkeleton } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { use } from 'react';

export default function SectionPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = use(params);
  const key = section?.[0] ?? 'dashboard';
  const data = useQuery({ queryKey: ['admin', key], queryFn: () => load(key) });
  if (data.isLoading) return <SectionSkeleton section={key} />;
  if (data.error) return <ErrorState title="Could not load" body={(data.error as Error).message} />;
  if (key === 'dashboard' && data.data) {
    return <Overview dash={data.data as Awaited<ReturnType<typeof api.adminDashboard>>} />;
  }
  if (key === 'merchants') return <Merchants rows={(data.data ?? []) as MerchantRow[]} />;
  if (key === 'subscriptions' && data.data) return <Subscriptions board={data.data as Awaited<ReturnType<typeof api.subscriptionBoard>>} />;
  if (key === 'staff') return <StaffDirectory rows={(data.data ?? []) as StaffRow[]} />;
  if (key === 'operations') return <Live payload={data.data} />;
  return (
    <div>
      <PageHeader title={key} subtitle="Connected to the Alliva API" />
      <Card className="overflow-auto p-4"><pre className="text-xs">{JSON.stringify(data.data, null, 2)}</pre></Card>
    </div>
  );
}

function SectionSkeleton({ section }: { section: string }) {
  if (section === 'dashboard') return <DashboardSkeleton />;
  if (section === 'merchants') return <TableSkeleton rows={6} columns={6} />;
  if (section === 'staff') return <TableSkeleton rows={6} columns={4} />;
  if (section === 'subscriptions') {
    return (
      <div className="space-y-6" aria-busy>
        <div className="space-y-2"><Skeleton className="h-9 w-56" /><Skeleton className="h-3.5 w-72" /></div>
        <CardGridSkeleton count={3} columns="md:grid-cols-3" />
        <TableSkeleton rows={5} columns={5} header={false} />
      </div>
    );
  }
  return (
    <div className="space-y-6" aria-busy>
      <div className="space-y-2"><Skeleton className="h-9 w-48" /><Skeleton className="h-3.5 w-64" /></div>
      <ListSkeleton rows={5} />
    </div>
  );
}

function Live({ payload }: { payload: unknown }) {
  const orders = (payload ?? []) as { id: string; number: string; status: string }[];
  return (
    <div>
      <PageHeader title="Live orders" subtitle="Operations control centre" />
      {orders.length ? orders.map((order) => (
        <Card key={order.id} className="mb-3 p-4">{order.number} · {order.status}</Card>
      )) : <EmptyState title="Quiet shift" body="No active orders." />}
    </div>
  );
}

async function load(key: string) {
  if (key === 'dashboard') return api.adminDashboard();
  if (key === 'merchants') return api.merchants();
  if (key === 'subscriptions') return api.subscriptionBoard();
  if (key === 'staff') return api.staff();
  if (key === 'complaints') return api.complaints();
  if (key === 'finance') return { payments: await api.payments(), ledger: await api.ledger(), settlements: await api.settlements() };
  if (key === 'promos') return api.promos();
  if (key === 'marketing') return api.marketing();
  if (key === 'analytics') return api.report();
  if (key === 'settings') return api.settings();
  if (key === 'audit') return api.audit();
  if (key === 'operations') return api.live();
  return api.adminDashboard();
}
