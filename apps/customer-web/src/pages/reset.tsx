import { api } from '@/components/providers';
import { Link } from '@/i18n/navigation';
import { Button, Input, Label, toast } from '@alliva/ui';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';

export default function ResetPage() {
  const t = useTranslations('auth');
  const c = useTranslations('auth.customerLogin');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState('');
  const save = useMutation({
    mutationFn: () => api.reset(token, password),
    onSuccess: () => toast.success(c('resetDone')),
    onError: () => setProblem(c('resetFailed')),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setProblem('');
    if (password.length < 8) {
      setProblem(c('shortPassword'));
      return;
    }
    if (password !== confirm) {
      setProblem(c('resetMismatch'));
      return;
    }
    save.mutate();
  };

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-6 py-16">
      <img src="/logo-on-light.png" alt="Alliva" className="h-10 w-auto" />
      <h1 className="font-display mt-6 text-3xl">{c('resetTitle')}</h1>
      <p className="mt-2 text-sm text-[#6f6f6a]">{c('resetBody')}</p>
      {!token ? <p className="mt-6 rounded-xl bg-[#FDECEC] px-3 py-2 text-sm text-[#C13F35]" role="alert">{c('resetMissing')}</p> : null}
      {save.isSuccess ? (
        <p className="mt-6 rounded-xl bg-[#E5F6EC] px-3 py-2 text-sm text-[#147D54]" role="status">{c('resetDone')}</p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="password">{t('password')}</Label>
            <Input id="password" type="password" autoComplete="new-password" className="mt-2" value={password} onChange={(event) => setPassword(event.target.value)} disabled={!token} />
          </div>
          <div>
            <Label htmlFor="confirm">{c('resetConfirm')}</Label>
            <Input id="confirm" type="password" autoComplete="new-password" className="mt-2" value={confirm} onChange={(event) => setConfirm(event.target.value)} disabled={!token} />
          </div>
          {problem ? <p className="text-sm text-[#C13F35]" role="alert">{problem}</p> : null}
          <Button type="submit" variant="yellow" className="w-full" loading={save.isPending} disabled={!token}>{c('resetSubmit')}</Button>
        </form>
      )}
      <Link href="/login" className="mt-6 text-sm font-semibold underline">{t('back')}</Link>
    </main>
  );
}
