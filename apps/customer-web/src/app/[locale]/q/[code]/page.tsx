'use client';

import { api } from '@/components/providers';
import { useRouter } from '@/i18n/navigation';
import { use } from 'react';
import { useEffect } from 'react';

export default function QrPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  useEffect(() => {
    void api.enterQr(code).then((result) => {
      const payload = result as { merchantSlug: string; fulfillment?: string | null; tableId?: string | null };
      const query = payload.fulfillment === 'DINE_IN' ? '?fulfillment=DINE_IN' : '';
      router.replace(`/merchants/${payload.merchantSlug}${query}`);
    });
  }, [code, router]);
  return <p>Opening storefront…</p>;
}
