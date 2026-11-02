import { api } from '@/components/providers';
import { cn, DialogDescription, DialogTitle, Sheet, SheetContent } from '@alliva/ui';
import { useMutation } from '@tanstack/react-query';
import { Angry, Frown, Heart, Laugh, Loader2, Meh, Smile } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'use-intl';

const ANSWERED_KEY = 'alliva_feedback_at';
/** Someone who answered recently is not asked again after every round they order. */
const ASK_AGAIN_MS = 7 * 24 * 60 * 60_000;

const FACES = [
  { rating: 1, icon: Angry },
  { rating: 2, icon: Frown },
  { rating: 3, icon: Meh },
  { rating: 4, icon: Smile },
  { rating: 5, icon: Laugh },
] as const;

/** The badge shown once an order reaches the kitchen: it pops in, the ring and tick draw, and a few sparks fly out. */
export function OrderSentBadge() {
  return (
    <span className="relative mx-auto grid size-[72px] place-items-center" aria-hidden>
      <span className="order-ripple absolute inset-0 rounded-full bg-[#22a85a]/30" />
      {Array.from({ length: 8 }, (_, index) => (
        <span
          key={index}
          className={cn('order-spark absolute top-1/2 left-1/2 -mt-1 -ml-1 size-2 rounded-full', index % 2 ? 'bg-primary' : 'bg-[#22a85a]')}
          style={{ '--spark-angle': `${index * 45 + 22}deg` } as React.CSSProperties}
        />
      ))}
      <svg viewBox="0 0 52 52" className="order-pop relative size-[72px]">
        <circle cx="26" cy="26" r="26" fill="#e3f5ea" />
        <circle className="order-ring" cx="26" cy="26" r="24" fill="none" stroke="#22a85a" strokeWidth="3" strokeLinecap="round" transform="rotate(-90 26 26)" />
        <path className="order-tick" d="M16 27l7 7 13-14" fill="none" stroke="#168a52" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function answeredRecently() {
  try {
    const at = Number(window.localStorage.getItem(ANSWERED_KEY));
    return Boolean(at) && Date.now() - at < ASK_AGAIN_MS;
  } catch {
    return false;
  }
}

function rememberAnswer() {
  try {
    window.localStorage.setItem(ANSWERED_KEY, String(Date.now()));
  } catch {
    /* private mode: they may be asked again, which is fine */
  }
}

/**
 * Asks how ordering with the app went, in a bottom sheet that opens once the success animation has played.
 * Skipping or answering both count, so the diner is not asked again for a week.
 */
export function FeedbackSheet({ orderId, delayMs = 1800 }: { orderId: string | null; delayMs?: number }) {
  const t = useTranslations('customer.tablePage.feedback');
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [thanked, setThanked] = useState(false);
  const send = useMutation({
    mutationFn: () => api.sendFeedback({ rating: rating!, comment: comment.trim() || null, source: 'TABLE_ORDER', orderId }),
    onSuccess: () => {
      rememberAnswer();
      setThanked(true);
      window.setTimeout(() => setOpen(false), 1600);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  useEffect(() => {
    if (!orderId || answeredRecently()) return;
    setRating(null);
    setComment('');
    setThanked(false);
    const timer = window.setTimeout(() => setOpen(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, orderId]);

  const close = () => {
    if (!thanked) rememberAnswer();
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && close()}>
      <SheetContent
        className={cn(
          'inset-x-0 top-auto bottom-0 w-full rounded-t-[24px] bg-white px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]',
          'lg:inset-auto lg:top-1/2 lg:left-1/2 lg:w-[420px] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-[24px]',
        )}
      >
        <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-[#e3e3de] lg:hidden" />
        {thanked ? (
          <div className="rise-in py-6 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-full bg-[#ffe9ec] text-[#e5484d]">
              <Heart className="size-7 fill-current" />
            </span>
            <DialogTitle className="mt-3 text-[18px] font-extrabold text-[#111]">{t('thanksTitle')}</DialogTitle>
            <DialogDescription className="mt-1 text-[13.5px] text-[#6f6f6a]">{t('thanksBody')}</DialogDescription>
          </div>
        ) : (
          <>
            <DialogTitle className="text-center text-[19px] font-extrabold text-[#111]">{t('title')}</DialogTitle>
            <DialogDescription className="mt-1 text-center text-[13.5px] text-[#6f6f6a]">{t('subtitle')}</DialogDescription>
            <div role="radiogroup" aria-label={t('title')} className="mt-5 flex justify-between gap-1.5">
              {FACES.map(({ rating: value, icon: Icon }) => {
                const selected = rating === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setRating(value)}
                    className={cn(
                      'flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-2xl py-2.5 transition-[background-color,transform] duration-150 active:scale-95',
                      selected ? 'bg-primary' : 'bg-[#f6f6f3]',
                    )}
                  >
                    <Icon className={cn('size-8 transition-transform duration-200', selected ? 'scale-110 text-[#111]' : 'text-[#8d8d88]')} strokeWidth={1.8} />
                    <span className={cn('text-[11px] font-semibold', selected ? 'text-[#111]' : 'text-[#6f6f6a]')}>{t(`ratings.${value}`)}</span>
                  </button>
                );
              })}
            </div>
            {rating ? (
              <textarea
                value={comment}
                maxLength={1000}
                rows={3}
                onChange={(event) => setComment(event.target.value)}
                placeholder={rating >= 4 ? t('commentGood') : t('commentBad')}
                className="rise-in mt-4 w-full resize-none rounded-xl bg-[#f6f6f3] px-3 py-2.5 text-[16px] outline-none placeholder:text-[#9a9a95] focus:ring-2 focus:ring-primary sm:text-sm"
              />
            ) : null}
            <button
              type="button"
              disabled={!rating || send.isPending}
              onClick={() => send.mutate()}
              className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#141416] text-[15px] font-bold text-white disabled:opacity-40"
            >
              {send.isPending ? <Loader2 className="size-5 animate-spin" /> : null}
              {t('send')}
            </button>
            <button type="button" onClick={close} className="mt-1 h-11 w-full text-[14px] font-semibold text-[#6f6f6a]">
              {t('notNow')}
            </button>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
