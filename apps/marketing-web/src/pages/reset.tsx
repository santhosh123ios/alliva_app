import { api } from '@/components/providers';
import { Link } from '@/i18n/navigation';
import { useT } from '@alliva/marketing-console';
import { Button, Input, Label } from '@alliva/ui';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';

/** Landing page for invitation links and password resets (`?token=`). */
export default function ResetPage() {
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState('');
  const save = useMutation({
    mutationFn: () => api.reset(token, password),
    onError: () => setProblem(t('resetFailed')),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setProblem('');
    if (password.length < 8) return setProblem(t('resetShort'));
    if (password !== confirm) return setProblem(t('resetMismatch'));
    save.mutate();
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <img src="/logo-on-light.png" alt="Alliva" className="h-12 w-auto self-start" />
      <h1 className="font-display mt-8 text-3xl">{t('resetTitle')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('resetBody')}</p>
      {!token ? <p className="mt-6 rounded-xl bg-[#FDECEC] px-3 py-2 text-sm text-[#C13F35]" role="alert">{t('resetMissing')}</p> : null}
      {save.isSuccess ? (
        <div className="mt-6 space-y-4">
          <p className="rounded-xl bg-[#E5F6EC] px-3 py-2 text-sm text-[#147D54]" role="status">{t('resetDone')}</p>
          <Button asChild variant="yellow"><Link href="/login">{t('backToSignIn')}</Link></Button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="password">{t('resetNew')}</Label>
            <Input id="password" type="password" autoComplete="new-password" className="mt-2" value={password} onChange={(event) => setPassword(event.target.value)} disabled={!token} />
          </div>
          <div>
            <Label htmlFor="confirm">{t('resetConfirm')}</Label>
            <Input id="confirm" type="password" autoComplete="new-password" className="mt-2" value={confirm} onChange={(event) => setConfirm(event.target.value)} disabled={!token} />
          </div>
          {problem ? <p className="text-sm text-[#C13F35]" role="alert">{problem}</p> : null}
          <Button type="submit" variant="yellow" loading={save.isPending} disabled={!token}>{t('resetSubmit')}</Button>
          <p><Link href="/login" className="text-sm font-semibold underline">{t('backToSignIn')}</Link></p>
        </form>
      )}
    </main>
  );
}
