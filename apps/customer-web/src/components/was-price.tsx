import { formatMoney } from '@alliva/design-tokens';
import { cn } from '@alliva/ui';

/** A dish on a deal: its regular price, crossed out, next to the deal price. Nothing when the dish is not on a deal. */
export function WasPrice({ price, compareAtPrice, locale, className }: { price: string; compareAtPrice?: string | null; locale: 'en' | 'ar'; className?: string }) {
  if (!compareAtPrice || Number(compareAtPrice) <= Number(price)) return null;
  return <s className={cn('ms-1.5 font-medium text-[#9a9a95]', className)}>{formatMoney(compareAtPrice, locale)}</s>;
}
