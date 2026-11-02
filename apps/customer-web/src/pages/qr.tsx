import { api } from '@/components/providers';
import { useRouter } from '@/i18n/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useParams } from 'react-router';

export default function QrPage() {
  const { code } = useParams() as { code: string };
  const router = useRouter();
  const client = useQueryClient();
  useEffect(() => {
    void api.enterQr(code).then((result) => {
      const payload = result as { merchantSlug: string; fulfillment?: string | null; tableId?: string | null };
      if (payload.fulfillment === 'DINE_IN') {
        // A new scan may start a new visit at this table; drop what the last one showed.
        client.removeQueries({ queryKey: ['table-service'] });
        void client.invalidateQueries({ queryKey: ['cart'] });
      }
      router.replace(payload.fulfillment === 'DINE_IN' ? `/table/${payload.merchantSlug}?qr=${encodeURIComponent(code)}` : `/merchants/${payload.merchantSlug}`);
    });
  }, [client, code, router]);
  return <p>Opening storefront…</p>;
}
