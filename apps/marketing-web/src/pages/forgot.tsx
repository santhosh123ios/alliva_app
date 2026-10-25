import { api } from '@/components/providers';
import { Link } from '@/i18n/navigation';
import { useT } from '@alliva/marketing-console';
import { Button, Input, Label } from '@alliva/ui';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useLocale } from 'use-intl';

export default function ForgotPage() {
  const t = useT();
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const send = useMutation({ mutationFn: () => api.forgot(email.trim()) });
  const devLink = send.data?.devResetToken ? `/${locale}/reset?token=${encodeURIComponent(send.data.devResetToken)}` : null;
  const submit = (event: FormEvent) => { event.preventDefault(); send.mutate(); };
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <img src="/logo-on-light.png" alt="Alliva" className="h-12 w-auto self-start" />
      <h1 className="font-display mt-8 text-3xl">{t('forgotTitle')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('forgotBody')}</p>
      <form onSubmit={submit}>
        <Label className="mt-6 block" htmlFor="email">{t('authEmail')}</Label>
        <Input id="email" type="email" autoComplete="email" className="mt-2" value={email} onChange={(event) => setEmail(event.target.value)} required />
        <Button className="mt-4" type="submit" variant="yellow" loading={send.isPending}>{t('forgotSend')}</Button>
      </form>
      {send.isSuccess ? <p className="mt-3 text-sm text-[#147D54]" role="status">{t('forgotSent')}</p> : null}
      {devLink ? <p className="mt-2 break-all text-xs text-muted-foreground">{t('forgotDevToken')} <a className="underline" href={devLink}>{devLink}</a></p> : null}
      <Link href="/login" className="mt-6 text-sm font-semibold underline">{t('backToSignIn')}</Link>
    </main>
  );
}
