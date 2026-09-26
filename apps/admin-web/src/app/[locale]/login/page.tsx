'use client';

import { api } from '@/components/providers';
import { Link } from '@/i18n/navigation';
import { loginSchema } from '@alliva/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input, Label } from '@alliva/ui';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from '@/i18n/navigation';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { z } from 'zod';

export default function LoginPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('000000');
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: 'admin@alliva.bh', password: 'Alliva123!', rememberDevice: true },
  });
  const login = useMutation({
    mutationFn: (values: z.infer<typeof loginSchema>) => api.login(values),
    onSuccess: (result) => {
      if ('requiresTwoFactor' in result && result.requiresTwoFactor) {
        setChallengeId(result.challengeId);
        return;
      }
      router.push('/dashboard');
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const verify = useMutation({
    mutationFn: () => api.verifyTwoFactor({ challengeId: challengeId!, code }),
    onSuccess: () => router.push('/dashboard'),
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="grid min-h-screen bg-white lg:h-screen lg:grid-cols-2 lg:overflow-hidden">
      <main className="flex items-center justify-center px-6 py-10 sm:px-10">
        <form className="w-full max-w-[440px]" onSubmit={form.handleSubmit((values) => login.mutate(values))}>
          <div className="flex flex-col items-center">
            <img src="/logo-on-light.png" alt="Alliva" className="h-16 w-auto" />
            <span className="mt-3 rounded-full bg-[#111111] px-4 py-1 text-xs font-semibold tracking-[0.14em] text-white uppercase">{t('adminPortal')}</span>
          </div>
          <h1 className="font-display mt-6 text-3xl">{t('adminHeadline')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('adminSubhead')}</p>
          <div className="mt-6 space-y-4">
            <div>
              <Label htmlFor="email">{t('workEmail')}</Label>
              <div className="relative mt-2">
                <MailIcon />
                <Input id="email" type="email" autoComplete="email" placeholder={t('workEmailPlaceholder')} className="ps-11" {...form.register('email')} />
              </div>
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
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 rounded border-[#111111]" {...form.register('rememberDevice')} />
                {t('remember')}
              </label>
              <Link href="/forgot" className="font-semibold underline">{t('forgotQuestion')}</Link>
            </div>
            <Button type="submit" variant="yellow" className="w-full rounded-full text-base" loading={login.isPending}>
              {t('signInSecurely')}
            </Button>
            {challengeId ? (
              <div className="space-y-2">
                <Label htmlFor="code">{t('twoFactor')}</Label>
                <Input id="code" value={code} onChange={(event) => setCode(event.target.value)} />
                <Button type="button" className="w-full" loading={verify.isPending} onClick={() => verify.mutate()}>{t('verify')}</Button>
              </div>
            ) : null}
          </div>
          <p className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <ShieldIcon />
            {t('protectedEnv')}
          </p>
        </form>
      </main>
      <aside className="relative flex flex-col justify-between overflow-hidden bg-[#111111] px-6 py-8 text-white sm:px-10 lg:px-12 lg:py-10">
        <RouteMarks />
        <div className="relative z-10 max-w-lg">
          <h2 className="font-display whitespace-pre-line text-4xl leading-[1.05]">{t('controlHeadline')}</h2>
          <div className="mt-6 max-w-sm space-y-3">
            <StatCard icon={<BarsIcon />} label={t('totalOrders')} value="12,480" />
            <StatCard icon={<StoreIcon />} label={t('activeMerchants')} value="892" />
            <StatCard icon={<PinIcon />} label={t('deliveryRegions')} value="24" />
          </div>
        </div>
        <div className="relative z-10 mt-4">
          <img src="/admin-mascot.png" alt="" className="mx-auto h-52 w-auto -translate-x-20 sm:h-64" />
          <div className="absolute bottom-2 end-0 text-end text-xs font-semibold tracking-[0.18em] text-white/80">
            <p>PEOPLE</p>
            <p>MERCHANTS</p>
            <p>ORDERS</p>
            <p>GROWTH</p>
            <span className="ms-auto mt-3 block h-1 w-8 rounded-full bg-primary" />
          </div>
        </div>
      </aside>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
      <span className="text-primary">{icon}</span>
      <span>
        <span className="block text-xs text-white/70">{label}</span>
        <span className="font-display text-xl leading-none">{value}</span>
      </span>
      <BarsIcon className="ms-auto size-10 opacity-80" />
    </div>
  );
}

function RouteMarks() {
  return (
    <svg className="pointer-events-none absolute inset-y-6 end-0 h-[calc(100%-3rem)] w-72 text-primary" viewBox="0 0 280 640" fill="none" aria-hidden="true">
      <g transform="translate(110 0)">
        <path
          d="M118 36C118 96 42 108 48 188C54 268 128 276 122 360C116 444 46 456 54 560"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray="16 14"
        />
        <RoutePin x={118} y={36} label="My store" />
        <RoutePin x={122} y={360} label="Customer Hand" />
        <RoutePin x={54} y={548} label="Next customer" align="start" />
      </g>
    </svg>
  );
}

function RoutePin({ x, y, label, align = 'end' }: { x: number; y: number; label: string; align?: 'start' | 'end' }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <text x={align === 'end' ? -18 : 16} y={-18} fill="#ffffff" fontSize="13" fontWeight="600" textAnchor={align} fontFamily="Inter, sans-serif">
        {label}
      </text>
      <path fill="currentColor" d="M0 2C-11-16-10-32 0-32C10-32 11-16 0 2Z" />
      <circle cy={-20} r="5.5" fill="#111111" />
    </g>
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

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function BarsIcon({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="4" y="16" width="5" height="12" rx="1" fill="#ffc400" />
      <rect x="13" y="8" width="5" height="20" rx="1" fill="#ffc400" />
      <rect x="22" y="12" width="5" height="16" rx="1" fill="#fff" opacity="0.85" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg viewBox="0 0 32 32" className="size-8" fill="none" stroke="#ffc400" strokeWidth="2" aria-hidden="true">
      <path d="M6 14h20l-2 12H8L6 14z" />
      <path d="M8 14 10 6h12l2 8" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 32 32" className="size-8" aria-hidden="true">
      <path fill="#ffc400" d="M16 4a8 8 0 0 0-8 8c0 6 8 16 8 16s8-10 8-16a8 8 0 0 0-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" />
    </svg>
  );
}
