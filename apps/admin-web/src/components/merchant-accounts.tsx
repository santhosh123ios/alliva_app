import { api } from '@/components/providers';
import type { MerchantAccount } from '@alliva/api-client';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Label, toast } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Eye, EyeOff, KeyRound, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

const MIN_LENGTH = 8;
const MAX_LENGTH = 128;
// No look-alike characters (0/O, 1/l/I), so a password read out over the phone is typed right.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const SYMBOLS = '!@#$%*?';

/** The sign-in accounts of one merchant, each with a manual password reset. Platform admins only. */
export function MerchantAccounts({ merchantId }: { merchantId: string }) {
  const t = useTranslations('merchantAccounts');
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const canReset = Boolean(me.data && me.data.kind === 'STAFF' && (me.data.roles.includes('SUPER_ADMIN') || me.data.permissions.includes('staff.manage')));
  const accounts = useQuery({ queryKey: ['admin', 'merchant-users', merchantId], queryFn: () => api.merchantUsers(merchantId), enabled: canReset });
  const [target, setTarget] = useState<MerchantAccount | null>(null);

  if (!canReset) return null;

  return (
    <section className="mt-8">
      <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground">{t('title')}</p>
      {accounts.isLoading ? <p className="mt-3 text-sm text-muted-foreground">{t('loading')}</p> : null}
      {accounts.isError ? <p className="mt-3 text-sm text-[#D9342B]">{(accounts.error as Error).message}</p> : null}
      {accounts.data && accounts.data.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">{t('empty')}</p> : null}
      <ul className="mt-3 space-y-2">
        {(accounts.data ?? []).map((account) => (
          <li key={account.id} className="flex items-center justify-between gap-3 rounded-xl border p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{`${account.firstName} ${account.lastName}`.trim()}</p>
              <p className="truncate text-xs text-muted-foreground" dir="ltr">{account.email ?? account.phone ?? '—'}</p>
              <RoleLine roles={account.roles} status={account.status} />
            </div>
            <Button variant="outline" size="sm" className="shrink-0 rounded-lg" disabled={!account.email} onClick={() => setTarget(account)}>
              <KeyRound className="size-4" /> {t('reset')}
            </Button>
          </li>
        ))}
      </ul>
      <ResetPasswordDialog merchantId={merchantId} account={target} onClose={() => setTarget(null)} />
    </section>
  );
}

function RoleLine({ roles, status }: { roles: string[]; status: string }) {
  const t = useTranslations('merchantAccounts');
  const roleT = useTranslations('merchantStaff');
  const labels = roles.map((role) => (roleT.has(role) ? roleT(role) : role.replaceAll('_', ' ')));
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {labels.join(', ') || '—'}
      {status !== 'ACTIVE' ? <span className="ms-2 inline-block rounded-full bg-[#F1F1EE] px-2 py-0.5 font-semibold text-[#5C5C57]">{t('inactive')}</span> : null}
    </p>
  );
}

function ResetPasswordDialog({ merchantId, account, onClose }: { merchantId: string; account: MerchantAccount | null; onClose: () => void }) {
  const t = useTranslations('merchantAccounts');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ password: string; sessionsRevoked: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const strength = passwordStrength(password);
  const valid = password.length >= MIN_LENGTH && password.length <= MAX_LENGTH;
  const name = account ? `${account.firstName} ${account.lastName}`.trim() : '';

  function close() {
    setPassword('');
    setVisible(false);
    setError('');
    setDone(null);
    setCopied(false);
    onClose();
  }

  function generate() {
    setPassword(generatePassword());
    setVisible(true);
    setError('');
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  async function submit() {
    if (!account || !valid) return;
    setPending(true);
    setError('');
    try {
      const result = await api.resetMerchantUserPassword(merchantId, account.id, password);
      setDone({ password, sessionsRevoked: result.sessionsRevoked });
      setCopied(false);
      toast.success(t('success', { name }));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={Boolean(account)} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="w-[min(100%-2rem,28rem)]">
        <DialogTitle>{t('dialogTitle', { name })}</DialogTitle>
        {done ? (
          <>
            <DialogDescription>{t('doneBody', { count: done.sessionsRevoked })}</DialogDescription>
            <div className="mt-4 rounded-xl border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">{t('signInAs')}</p>
              <p className="mt-0.5 text-sm font-semibold" dir="ltr">{account?.email}</p>
              <p className="mt-3 text-xs text-muted-foreground">{t('newPassword')}</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-card px-3 py-2 font-mono text-sm" dir="ltr">{done.password}</code>
                <Button variant="outline" size="sm" className="shrink-0 rounded-lg" onClick={() => copy(done.password)}>
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? t('copiedShort') : t('copy')}
                </Button>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{t('shareHint')}</p>
            <div className="mt-5 flex justify-end">
              <Button variant="yellow" onClick={close}>{t('close')}</Button>
            </div>
          </>
        ) : (
          <>
            <DialogDescription>{t('dialogBody')}</DialogDescription>
            <div className="mt-4">
              <Label htmlFor="merchant-reset-password">{t('newPassword')}</Label>
              <div className="mt-2 flex gap-2">
                {/* Passwords are Latin text; keep the field and its toggle left-to-right in Arabic too. */}
                <div className="relative min-w-0 flex-1" dir="ltr">
                  <Input
                    id="merchant-reset-password"
                    type={visible ? 'text' : 'password'}
                    autoComplete="new-password"
                    maxLength={MAX_LENGTH}
                    className="h-11 pe-11 font-mono"
                    value={password}
                    onChange={(event) => { setPassword(event.target.value); setError(''); }}
                    aria-describedby="merchant-reset-rule"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 end-0 grid w-11 place-items-center text-muted-foreground hover:text-foreground"
                    aria-label={visible ? t('hide') : t('show')}
                    aria-pressed={visible}
                    onClick={() => setVisible((value) => !value)}
                  >
                    {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <Button type="button" variant="outline" className="h-11 shrink-0 rounded-xl" onClick={generate}>
                  <Wand2 className="size-4" /> {t('generate')}
                </Button>
                <Button type="button" variant="outline" className="h-11 shrink-0 rounded-xl px-3" disabled={!password} aria-label={t('copy')} onClick={() => copy(password)}>
                  <Copy className="size-4" />
                </Button>
              </div>
              <StrengthMeter level={strength} />
              <p id="merchant-reset-rule" className={`mt-1 text-xs ${password && !valid ? 'text-[#D9342B]' : 'text-muted-foreground'}`}>
                {t('rule', { min: MIN_LENGTH })}
              </p>
            </div>
            <p className="mt-4 rounded-xl bg-[#FFF4D6] p-3 text-xs text-[#A16207]">{t('warning')}</p>
            {error ? <p className="mt-3 text-sm text-[#D9342B]" role="alert">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>{t('cancel')}</Button>
              <Button variant="yellow" disabled={pending || !valid} onClick={submit}>{pending ? t('saving') : t('confirm')}</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StrengthMeter({ level }: { level: 0 | 1 | 2 | 3 }) {
  const t = useTranslations('merchantAccounts');
  const labels = [t('strengthNone'), t('strengthWeak'), t('strengthFair'), t('strengthStrong')];
  const colors = ['bg-muted', 'bg-[#D9342B]', 'bg-[#E0A100]', 'bg-[#1B8A4A]'];
  return (
    <div className="mt-2 flex items-center gap-2" aria-live="polite">
      <div className="flex flex-1 gap-1">
        {[1, 2, 3].map((step) => <span key={step} className={`h-1.5 flex-1 rounded-full ${level >= step ? colors[level] : 'bg-muted'}`} />)}
      </div>
      <span className="text-xs text-muted-foreground">{labels[level]}</span>
    </div>
  );
}

function passwordStrength(value: string): 0 | 1 | 2 | 3 {
  if (!value) return 0;
  if (value.length < MIN_LENGTH) return 1;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length;
  if (value.length >= 12 && classes >= 3) return 3;
  return classes >= 2 ? 2 : 1;
}

function generatePassword(length = 14) {
  const random = new Uint32Array(length);
  crypto.getRandomValues(random);
  const chars = Array.from(random, (value) => ALPHABET[value % ALPHABET.length]!);
  // Always mix in a digit and a symbol so it meets common password rules.
  const digitAt = random[0]! % length;
  const symbolAt = (digitAt + 1 + (random[1]! % (length - 1))) % length;
  chars[digitAt] = String(2 + (random[2]! % 8));
  chars[symbolAt] = SYMBOLS[random[3]! % SYMBOLS.length]!;
  return chars.join('');
}
