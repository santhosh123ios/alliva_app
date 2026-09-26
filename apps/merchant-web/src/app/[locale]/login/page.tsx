'use client';

import { api } from '@/components/providers';
import { Link } from '@/i18n/navigation';
import { loginSchema } from '@alliva/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input, Label } from '@alliva/ui';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from '@/i18n/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { z } from 'zod';

export default function LoginPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: 'owner@saffronhouse.bh', password: 'Alliva123!', rememberDevice: true },
  });
  const login = useMutation({
    mutationFn: (values: z.infer<typeof loginSchema>) => api.login(values),
    onSuccess: () => router.push('/dashboard'),
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-2">
      <aside className="relative flex min-h-[28rem] flex-col justify-between overflow-hidden bg-primary px-6 py-10 text-[#111111] sm:px-10 lg:min-h-screen lg:px-14 lg:py-16">
        <img src="/route-map.png" alt="" className="pointer-events-none absolute inset-x-0 top-0 h-auto w-full opacity-25" />
        <div className="relative z-10 max-w-xl">
          <h1 className="font-display whitespace-pre-line text-4xl leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.4rem]">{t('merchantHeadline')}</h1>
          <p className="mt-5 max-w-md whitespace-pre-line text-base leading-relaxed sm:text-lg">{t('merchantSubhead')}</p>
        </div>
        <img src="/merchant-hero.png" alt="" className="relative z-10 mx-auto mt-8 h-auto max-h-80 w-auto max-w-md self-center object-contain" />
      </aside>
      <main className="flex min-h-screen items-center justify-center px-6 py-12 sm:px-10">
        <form
          className="w-full max-w-[420px]"
          onSubmit={form.handleSubmit((values) => login.mutate(values))}
        >
          <img src="/logo-on-light.png" alt="Alliva" className="h-14 w-auto" />
          <h2 className="font-display mt-8 text-3xl">{t('welcomeBack')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('merchantAccount')}</p>
          <div className="mt-8 space-y-5">
            <div>
              <Label htmlFor="email">{t('emailAddress')}</Label>
              <div className="relative mt-2">
                <MailIcon />
                <Input id="email" type="email" autoComplete="email" placeholder={t('emailPlaceholder')} className="ps-11" {...form.register('email')} />
              </div>
              {form.formState.errors.email ? <p className="mt-1 text-sm text-destructive">{form.formState.errors.email.message}</p> : null}
            </div>
            <div>
              <Label htmlFor="password">{t('password')}</Label>
              <div className="relative mt-2">
                <LockIcon />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder={t('passwordPlaceholder')}
                  className="ps-11 pe-11"
                  {...form.register('password')}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-[#696965]"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  <EyeIcon off={showPassword} />
                </button>
              </div>
              {form.formState.errors.password ? <p className="mt-1 text-sm text-destructive">{form.formState.errors.password.message}</p> : null}
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 rounded border-[#111111]" {...form.register('rememberDevice')} />
                {t('rememberMe')}
              </label>
              <Link href="/forgot" className="font-semibold underline">
                {t('forgotQuestion')}
              </Link>
            </div>
            <Button type="submit" className="w-full rounded-full text-base" loading={login.isPending}>
              {t('signIn')}
            </Button>
          </div>
          <p className="mt-8 text-center text-sm text-muted-foreground">
            {t('newBusiness')}{' '}
            <Link href="/register" className="font-semibold text-[#111111] underline">{t('createAccount')}</Link>
          </p>
          <p className="mt-3 text-center text-sm text-muted-foreground">
            {t('needHelp')}{' '}
            <a className="font-semibold text-[#111111] underline" href="mailto:support@alliva.bh">
              {t('merchantSupport')}
            </a>
          </p>
        </form>
      </main>
    </div>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-[#696965]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-[#696965]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}
