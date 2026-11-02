import { api } from '@/components/providers';
import { cn } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Star } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'use-intl';

type ProductReviews = Awaited<ReturnType<typeof api.productReviews>>;

export const dishReviewsKey = (productId: string) => ['product-reviews', productId] as const;

export function useDishReviews(productId: string) {
  return useQuery({ queryKey: dishReviewsKey(productId), queryFn: () => api.productReviews(productId), staleTime: 30_000 });
}

function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-hidden>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star key={star} className={cn('size-3.5', star <= Math.round(value) ? 'fill-primary text-primary' : 'fill-[#e6e6e1] text-[#e6e6e1]')} />
      ))}
    </span>
  );
}

/** "★ 4.6 · 12 ratings" under the dish's price, or nothing until someone rates it. */
export function DishRatingSummary({ reviews }: { reviews: ProductReviews | undefined }) {
  const t = useTranslations('customer.dishReviews');
  if (!reviews?.average) return null;
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-[#6f6f6a]">
      <Star className="size-4 fill-primary text-primary" aria-hidden />
      <span className="font-bold text-[#111] tabular-nums">{reviews.average.toFixed(1)}</span>
      <span>· {t('count', { count: reviews.count })}</span>
    </p>
  );
}

/**
 * The dish's ratings and reviews, always shown so diners know where feedback lives, and for someone who was
 * served this dish, a card asking what they thought (stars and an optional comment).
 */
export function DishReviews({ productId, reviews }: { productId: string; reviews: ProductReviews | undefined }) {
  const t = useTranslations('customer.dishReviews');
  return (
    <>
      {reviews?.mine ? <RateDish key={`${reviews.mine.orderNumber}-${reviews.mine.rating ?? 0}`} productId={productId} mine={reviews.mine} /> : null}
      <section className="mt-6">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[15px] font-bold text-[#111]">{t('title')}</h3>
          {reviews?.average ? (
            <span className="flex shrink-0 items-center gap-1 text-[13px] text-[#6f6f6a]">
              <Star className="size-3.5 fill-primary text-primary" aria-hidden />
              <span className="font-bold text-[#111] tabular-nums">{reviews.average.toFixed(1)}</span>· {t('count', { count: reviews.count })}
            </span>
          ) : null}
        </div>
        {!reviews ? (
          <div className="mt-2 h-16 animate-pulse rounded-2xl bg-[#f6f6f4]" />
        ) : reviews.recent.length ? (
          <ul className="mt-2 space-y-2">
            {reviews.recent.map((row) => (
              <li key={row.id} className="rounded-2xl bg-[#f6f6f4] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Stars value={row.rating} />
                  <span className="truncate text-[12px] font-semibold text-[#6f6f6a]">{row.author ?? t('guest')}</span>
                </div>
                {row.comment ? <p className="mt-1 text-[13.5px] leading-relaxed text-[#2a2a28]"><bdi>{row.comment}</bdi></p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 rounded-2xl bg-[#f6f6f4] px-4 py-3 text-[13px] text-[#6f6f6a]">{reviews.mine ? t('noneYetMine') : t('noneYet')}</p>
        )}
      </section>
    </>
  );
}

function RateDish({ productId, mine }: { productId: string; mine: NonNullable<ProductReviews['mine']> }) {
  const t = useTranslations('customer.dishReviews');
  const client = useQueryClient();
  const [rating, setRating] = useState(mine.rating ?? 0);
  const [comment, setComment] = useState(mine.comment ?? '');
  const [editing, setEditing] = useState(!mine.rating);
  const save = useMutation({
    mutationFn: () => api.rateProduct(productId, { rating, comment: comment.trim() || null }),
    onSuccess: (data) => {
      client.setQueryData(dishReviewsKey(productId), data);
      toast.success(t('thanks'));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!editing && mine.rating) {
    return (
      <section className="mt-6 flex items-center gap-3 rounded-2xl border border-[#ececE6] px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-[#111]">{t('yourRating')}</p>
          <Stars value={mine.rating} className="mt-1" />
        </div>
        <button type="button" onClick={() => setEditing(true)} className="h-9 shrink-0 rounded-full bg-[#f3f3ef] px-3.5 text-[13px] font-semibold text-[#111]">{t('edit')}</button>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-2xl border border-[#f0e2a8] bg-[#fffaf0] p-4">
      <p className="text-[15px] font-bold text-[#111]">{t('rateTitle')}</p>
      <p className="mt-0.5 text-[12.5px] text-[#6f6f6a]">{t('rateBody', { number: `⁦${mine.orderNumber}⁩` })}</p>
      <div role="radiogroup" aria-label={t('rateTitle')} className="mt-3 flex gap-1.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={rating === star}
            aria-label={t('stars', { count: star })}
            onClick={() => setRating(star)}
            className="grid size-10 place-items-center rounded-xl transition-transform active:scale-90"
          >
            <Star className={cn('size-8 transition-colors', star <= rating ? 'fill-primary text-primary' : 'fill-white text-[#d8d8d2]')} strokeWidth={1.6} />
          </button>
        ))}
      </div>
      {rating ? (
        <textarea
          value={comment}
          maxLength={500}
          rows={2}
          onChange={(event) => setComment(event.target.value)}
          placeholder={t('commentPlaceholder')}
          className="mt-3 w-full resize-none rounded-xl bg-white px-3 py-2.5 text-[16px] outline-none placeholder:text-[#9a9a95] focus:ring-2 focus:ring-primary sm:text-sm"
        />
      ) : null}
      <button
        type="button"
        disabled={!rating || save.isPending}
        onClick={() => save.mutate()}
        className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#141416] text-[14px] font-bold text-white disabled:opacity-40"
      >
        {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
        {t('send')}
      </button>
    </section>
  );
}
