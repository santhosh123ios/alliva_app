import { api } from '@/components/providers';
import { isMarketingUser } from '@/components/session';
import { Link, useRouter } from '@/i18n/navigation';
import { useT } from '@alliva/marketing-console';
import { Button, Input, Label } from '@alliva/ui';
import { loginSchema } from '@alliva/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useTranslations } from 'use-intl';
import type { z } from 'zod';

export default function LoginPage() {
  const t = useT();
  const auth = useTranslations('auth');
  const router = useRouter();
  const client = useQueryClient();
  const [params] = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberDevice: true },
  });

  function accept(user: { roles: string[] }) {
    if (!isMarketingUser(user.roles)) {
      void api.logout();
      toast.error(t('authDenied'));
      return;
    }
    client.clear();
    router.push('/dashboard');
  }

  const login = useMutation({
    mutationFn: (values: z.infer<typeof loginSchema>) => api.login(values),
    onSuccess: (result) => {
      if ('user' in result) accept(result.user);
      else setChallengeId(result.challengeId);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const verify = useMutation({
    mutationFn: () => api.verifyTwoFactor({ challengeId: challengeId!, code }),
    onSuccess: (result) => {
      if ('user' in result) accept(result.user);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-2">
      <main className="flex items-center justify-center px-6 py-10 sm:px-10">
        <form className="w-full max-w-[440px]" onSubmit={form.handleSubmit((values) => login.mutate(values))}>
          <div className="flex flex-col items-center">
            <img src="/logo-on-light.png" alt="Alliva" className="h-16 w-auto" />
            <span className="mt-3 rounded-full bg-[#111111] px-4 py-1 text-xs font-semibold tracking-[0.14em] text-white uppercase">{auth('marketingPortal')}</span>
          </div>
          <h1 className="font-display mt-6 text-3xl">{t('authWelcome')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('authSubtitle')}</p>
          {params.get('denied') ? <p className="mt-4 rounded-xl bg-[#FDECEC] px-3 py-2 text-sm text-[#C13F35]" role="alert">{t('noMarketingAccount')}</p> : null}
          <div className="mt-6 space-y-4">
            <div>
              <Label htmlFor="email">{t('authEmail')}</Label>
              <Input id="email" type="email" autoComplete="email" className="mt-2" {...form.register('email')} />
            </div>
            <div>
              <Label htmlFor="password">{t('authPassword')}</Label>
              <div className="relative mt-2">
                <Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" className="pe-16" {...form.register('password')} />
                <button type="button" className="absolute inset-y-0 end-3 text-xs font-semibold text-[#696965]" onClick={() => setShowPassword((value) => !value)}>
                  {showPassword ? t('authHide') : t('authShow')}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 rounded border-[#111111]" {...form.register('rememberDevice')} />
                {t('authRemember')}
              </label>
              <Link href="/forgot" className="font-semibold underline">{t('authForgot')}</Link>
            </div>
            <Button type="submit" variant="yellow" className="w-full rounded-full text-base" loading={login.isPending}>{t('authSignIn')}</Button>
            {challengeId ? (
              <div className="space-y-2">
                <Label htmlFor="code">{t('authTwoFactor')}</Label>
                <Input id="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} />
                <Button type="button" className="w-full" loading={verify.isPending} onClick={() => verify.mutate()}>{t('authVerify')}</Button>
              </div>
            ) : null}
          </div>
        </form>
      </main>
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#171712] px-10 py-12 text-white lg:flex">
        <img src="/logo.png" alt="" className="h-8 w-auto self-start brightness-0 invert" />
        <div>
          <h2 className="font-display whitespace-pre-line text-5xl leading-[1.05]">{auth('marketingHeadline')}</h2>
          <p className="mt-5 max-w-md text-lg text-white/70">{auth('marketingSubhead')}</p>
        </div>
        <p className="text-sm font-semibold tracking-[0.16em] text-[#F5C518]">ALLIVA MARKETING</p>
      </aside>
    </div>
  );
}
