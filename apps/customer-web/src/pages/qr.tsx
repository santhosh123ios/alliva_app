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
      router.replace(payload.fulfillment === 'DINE_IN' ? `/table/${payload.merchantSlug}` : `/merchants/${payload.merchantSlug}`);
    });
  }, [code, router]);
  return <p>Opening storefront…</p>;
}
