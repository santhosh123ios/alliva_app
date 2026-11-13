import { api } from '@/components/providers';
import { useRouter } from '@/i18n/navigation';
import { ensureGuest } from '@/lib/location';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useTranslations } from 'use-intl';

export default function QrPage() {
  const { code } = useParams() as { code: string };
  const router = useRouter();
  const client = useQueryClient();
  const t = useTranslations('common');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void (async () => {
      // A phone scanning for the first time has no session or CSRF cookie yet, and entering the table is a POST.
      await ensureGuest().catch(() => undefined);
      const result = await api.enterQr(code);
      const payload = result as { merchantSlug: string; fulfillment?: string | null; tableId?: string | null };
      if (payload.fulfillment === 'DINE_IN') {
        // A new scan may start a new visit at this table; drop what the last one showed.
        client.removeQueries({ queryKey: ['table-service'] });
        void client.invalidateQueries({ queryKey: ['cart'] });
      }
      router.replace(payload.fulfillment === 'DINE_IN' ? `/table/${payload.merchantSlug}?qr=${encodeURIComponent(code)}` : `/merchants/${payload.merchantSlug}`);
    })().catch(() => setFailed(true));
  }, [client, code, router]);
  return <p className="p-6 text-center text-sm text-muted-foreground">{failed ? t('error') : t('loading')}</p>;
}
