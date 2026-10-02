'use client';

import { api } from '@/components/providers';
import HomePage from '../page';
import { Link, useRouter } from '@/i18n/navigation';
import { cn, toast } from '@alliva/ui';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown, Eye, EyeOff, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

export default function LoginPage() {
  const t = useTranslations('auth');
  const c = useTranslations('auth.customerLogin');
  const router = useRouter();
  const [mode, setMode] = useState<'sign-in' | 'create'>('sign-in');
  const [step, setStep] = useState<'details' | 'code'>('details');
  const [localPhone, setLocalPhone] = useState('');
  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const phone = `+973${localPhone}`;

  const onTilt = (event: React.PointerEvent<HTMLFormElement>) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: py * -7, y: px * 9 });
  };

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const send = useMutation({
    mutationFn: () => api.requestOtp(phone),
    onSuccess: () => {
      setStep('code');
      toast.success(c('codeSent'));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const confirm = useMutation({
    mutationFn: () =>
      api.verifyOtp({
        phone,
        code,
        ...(mode === 'create' ? { firstName: firstName.trim(), lastName: lastName.trim() } : {}),
      }),
    onSuccess: () => router.push('/'),
    onError: (error: Error) => toast.error(error.message),
  });

  const requestCode = () => {
    if (!/^\d{8}$/.test(localPhone)) {
      toast.error(c('invalidPhone'));
      return;
    }
    if (mode === 'create' && (!firstName.trim() || !lastName.trim())) {
      toast.error(c('needName'));
      return;
    }
    send.mutate();
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (step === 'details') {
      requestCode();
      return;
    }
    if (code.trim().length < 4) return;
    confirm.mutate();
  };

  return (
    <>
      <HomePage />
      <div className="fixed inset-0 z-50 overflow-y-auto bg-black/30">
        <div className="flex min-h-full items-center justify-center px-4 py-6">
        <div className="relative w-full max-w-[340px]" style={{ perspective: '900px' }}>
          <form
            onSubmit={onSubmit}
            onPointerMove={onTilt}
            onPointerLeave={() => setTilt({ x: 0, y: 0 })}
            style={{
              backdropFilter: 'blur(24px) saturate(1.35)',
              transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
            }}
            className={cn(
              'relative overflow-hidden rounded-[26px] border border-white/20 bg-[#16130f]/45 text-white shadow-[0_24px_70px_rgba(0,0,0,0.28)] motion-reduce:transform-none',
              tilt.x === 0 && tilt.y === 0 && 'transition-transform duration-300 ease-out',
            )}
          >
            <div className="px-5 py-5">
            <button
              type="button"
              aria-label={c('close')}
              onClick={() => router.replace('/')}
              className="absolute end-3 top-3 grid size-8 place-items-center rounded-full text-white/80 transition hover:bg-white/10"
            >
              <X className="size-4" />
            </button>
            <img src="/logo-on-light.png" alt="Alliva" className="h-7 w-auto brightness-0 invert" />
            <h1 className="font-display mt-3 text-[1.65rem] leading-none">
              {mode === 'create' ? c('createTitle') : t('welcomeBack')}
            </h1>
            <p className="mt-1.5 text-sm text-white/70">
              {mode === 'create' ? c('createSubtitle') : c('continue')}
            </p>
            <div
              role="tablist"
              className="relative mt-4 grid grid-cols-2 overflow-hidden rounded-[18px] bg-black/30 p-1 shadow-[inset_0_2px_6px_rgba(0,0,0,0.45),inset_0_-1px_0_rgba(255,255,255,0.08)] ring-1 ring-white/10 [corner-shape:round]"
            >
              <span
                aria-hidden
                className={cn(
                  'absolute inset-y-1 start-1 w-[calc(50%-4px)] rounded-[14px] bg-[linear-gradient(180deg,#ffe566,#ffc400)] shadow-[0_4px_14px_rgba(255,196,0,0.28)] transition-transform duration-200 [corner-shape:round]',
                  mode === 'create' && 'translate-x-full rtl:-translate-x-full',
                )}
              />
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'sign-in'}
                onClick={() => { setMode('sign-in'); setStep('details'); }}
                className={cn('relative z-10 h-9 text-sm font-semibold', mode === 'sign-in' ? 'text-[#111]' : 'text-white/45')}
              >
                {t('signIn')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'create'}
                onClick={() => { setMode('create'); setStep('details'); }}
                className={cn('relative z-10 h-9 text-sm font-semibold', mode === 'create' ? 'text-[#111]' : 'text-white/45')}
              >
                {c('create')}
              </button>
            </div>

            {mode === 'create' && step === 'details' ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Field label={c('firstName')} htmlFor="firstName">
                  <input
                    id="firstName"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    placeholder={c('firstPlaceholder')}
                    autoComplete="given-name"
                    className="h-6 w-full bg-transparent text-sm outline-none placeholder:text-white/45"
                  />
                </Field>
                <Field label={c('lastName')} htmlFor="lastName">
                  <input
                    id="lastName"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    placeholder={c('lastPlaceholder')}
                    autoComplete="family-name"
                    className="h-6 w-full bg-transparent text-sm outline-none placeholder:text-white/45"
                  />
                </Field>
              </div>
            ) : null}

            <div className={cn('mt-4', mode === 'create' && step === 'details' && 'mt-3')}>
              <div className={cn(glassField, 'px-0 py-0')}>
                <div className="px-3 pt-2 text-[11px] leading-none text-white/60">{t('phone')}</div>
                <div className="flex items-center">
                  <button
                    type="button"
                    className="flex h-9 shrink-0 items-center gap-1 ps-3 pe-1.5 text-sm"
                    aria-expanded={countryOpen}
                    aria-haspopup="listbox"
                    onClick={() => setCountryOpen((open) => !open)}
                  >
                    <BahrainFlag />
                    <span>+973</span>
                    <ChevronDown className="size-3.5 opacity-80" />
                  </button>
                  <span className="h-5 w-px bg-white/25" />
                  <input
                    id="phone"
                    autoFocus
                    inputMode="numeric"
                    autoComplete="tel-national"
                    aria-label={t('phone')}
                    placeholder={c('phonePlaceholder')}
                    value={localPhone}
                    maxLength={8}
                    onChange={(event) => setLocalPhone(event.target.value.replace(/\D/g, '').slice(0, 8))}
                    className="h-9 min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none placeholder:text-white/45"
                  />
                </div>
              </div>
              {countryOpen ? (
                <ul role="listbox" className="mt-1 rounded-xl border border-white/15 bg-[#1a140c] p-1 text-sm shadow-lg">
                  <li>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg bg-white/10 px-3 py-2"
                      onClick={() => setCountryOpen(false)}
                    >
                      <BahrainFlag />
                      Bahrain
                      <span className="ms-auto text-white/70">+973</span>
                    </button>
                  </li>
                </ul>
              ) : null}
            </div>

            {step === 'details' ? (
              <div className="mt-3">
                <div className={cn(glassField, 'flex items-center px-3 py-2')}>
                  <span className="min-w-0 flex-1">
                    <label htmlFor="password" className="block text-[11px] leading-none text-white/60">{t('password')}</label>
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder={t('passwordPlaceholder')}
                      className="mt-1 h-6 w-full bg-transparent text-sm outline-none placeholder:text-white/45"
                    />
                  </span>
                  <button
                    type="button"
                    className="grid size-8 place-items-center text-white/70"
                    aria-label={showPassword ? c('hidePassword') : c('showPassword')}
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs text-white/75">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(event) => setRemember(event.target.checked)}
                      className="size-4 appearance-none rounded-[4px] border border-white/40 bg-white/10 checked:border-[#ffc400] checked:bg-[#ffc400]"
                    />
                    {t('rememberMe')}
                  </label>
                  <button type="button" className="text-white/80" onClick={requestCode}>
                    {t('forgotQuestion')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3">
                <div className={glassField}>
                  <label htmlFor="code" className="block text-[11px] leading-none text-white/60">{c('codeLabel')}</label>
                  <input
                    id="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder={c('codePlaceholder')}
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                    className="mt-1 h-6 w-full bg-transparent text-sm outline-none placeholder:text-white/45"
                  />
                </div>
                <p className="mt-2 text-xs text-white/70">{c('codeHint', { phone: `+973 ${localPhone}` })}</p>
                <button type="button" className="mt-1 text-xs font-semibold text-white" onClick={() => setStep('details')}>
                  {c('changeNumber')}
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={send.isPending || confirm.isPending}
              className="mt-4 flex h-11 w-full items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#ffe566,#ffc400)] text-sm font-semibold text-[#111] shadow-[0_8px_24px_rgba(255,196,0,0.28)] transition hover:brightness-105 disabled:opacity-60"
            >
              {send.isPending || confirm.isPending ? <span className="size-4 animate-spin rounded-full border-2 border-[#111]/30 border-t-[#111]" /> : step === 'details' ? t('signIn') : c('verifyContinue')}
            </button>

            <div className="my-3 flex items-center gap-3 text-xs text-white/60">
              <span className="h-px flex-1 bg-white/20" />
              {c('orContinue')}
              <span className="h-px flex-1 bg-white/20" />
            </div>
            <button type="button" className={cn(socialClass, 'w-full')} onClick={() => router.push('/')}>
              {c('guest')}
            </button>
            <p className="mt-2 text-center text-[11px] text-white/60">{c('guestHint')}</p>
            <p className="mt-2 text-center text-[10px] leading-relaxed text-white/50">
              {c('legalLead')}{' '}
              <Link href="/legal/terms" className="underline">{c('terms')}</Link>
              {` ${c('legalJoin')} `}
              <Link href="/legal/privacy" className="underline">{c('privacy')}</Link>.
            </p>
            </div>
          </form>
        </div>
        </div>
      </div>
    </>
  );
}

const glassField =
  'rounded-2xl border border-white/20 bg-white/10 text-white';

const socialClass =
  'inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 text-sm font-medium text-white transition hover:bg-white/15';

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className={glassField}>
      <label htmlFor={htmlFor} className="block px-3 pt-2 text-[11px] leading-none text-white/60">{label}</label>
      <div className="px-3 pb-2">{children}</div>
    </div>
  );
}

function BahrainFlag() {
  return (
    <svg viewBox="0 0 24 16" className="h-4 w-6 overflow-hidden rounded-[3px]" aria-hidden="true">
      <rect width="24" height="16" fill="#ce1126" />
      <path fill="#fff" d="M0 0h9l2.2 1.6L9 3.2l2.2 1.6L9 6.4l2.2 1.6L9 9.6l2.2 1.6L9 12.8 11.2 14.4 9 16H0z" />
    </svg>
  );
}

