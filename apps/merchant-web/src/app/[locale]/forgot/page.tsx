'use client';

import { api } from '@/components/providers';
import { Link } from '@/i18n/navigation';
import { Button, Input, Label, Logo } from '@alliva/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

export default function ForgotPage() {
  const t = useTranslations('auth');
  const [email, setEmail] = useState('owner@saffronhouse.bh');
  const [token, setToken] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => api.forgot(email),
    onSuccess: (result) => setToken(result.devResetToken ?? 'sent'),
  });
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6">
      <form className="w-full max-w-md" onSubmit={(event) => { event.preventDefault(); send.mutate(); }}>
        <Logo className="h-14 w-auto" />
        <h1 className="font-display mt-8 text-3xl">{t('forgotQuestion')}</h1>
        <Label className="mt-6" htmlFor="email">{t('emailAddress')}</Label>
        <Input id="email" className="mt-2" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <Button type="submit" className="mt-6 w-full" loading={send.isPending}>{t('reset')}</Button>
        {token ? <p className="mt-4 text-sm">Development reset token: {token}</p> : null}
        <Link href="/login" className="mt-6 block text-sm font-semibold underline">{t('back')}</Link>
      </form>
    </main>
  );
}
