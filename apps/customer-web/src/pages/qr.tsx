import { api } from '@/components/providers';
import { useRouter } from '@/i18n/navigation';
import { useEffect } from 'react';
import { useParams } from 'react-router';

export default function QrPage() {
  const { code } = useParams() as { code: string };
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
