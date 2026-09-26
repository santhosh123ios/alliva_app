'use client';

import { api } from '@/components/providers';
import { Button, Card, Input, Label } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@/i18n/navigation';
import { useState } from 'react';

export default function ProfilePage() {
  const router = useRouter();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const customer = useQuery({ queryKey: ['customer'], queryFn: () => api.customer(), enabled: Boolean(me.data), retry: false });
  const [line1, setLine1] = useState('Road 2406');
  if (!me.data) return <Card className="p-6">Sign in to manage your Alliva profile.</Card>;
  const profile = customer.data as { rewardBalance?: string; addresses?: { label: string; line1: string }[] } | undefined;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{me.data.firstName} {me.data.lastName}</h1>
      <Card className="space-y-2 p-5">
        <p>Phone {me.data.phone}</p>
        <p>Rewards {profile?.rewardBalance ?? '0.000'} BHD</p>
        <p>Addresses</p>
        {(profile?.addresses ?? []).map((address) => (
          <p key={address.line1}>{address.label}: {address.line1}</p>
        ))}
        <Label>New address</Label>
        <Input value={line1} onChange={(event) => setLine1(event.target.value)} />
        <Button
          onClick={() =>
            api.addAddress({ label: 'Home', line1, city: 'Manama', latitude: '26.223500', longitude: '50.587800' })
          }
        >
          Save address
        </Button>
      </Card>
      <Button variant="outline" onClick={() => api.logout().then(() => router.push('/'))}>Log out</Button>
      <Button
        variant="destructive"
        onClick={() => api.request('/api/customers/me/delete', { method: 'POST' }).then(() => router.push('/'))}
      >
        Delete account
      </Button>
    </div>
  );
}
