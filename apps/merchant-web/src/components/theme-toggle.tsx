import { useTheme } from '@/lib/theme';
import { cn } from '@alliva/ui';
import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'use-intl';

/** Switches the portal between the light and dark palettes. */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations('workspace');
  const { resolved, setChoice } = useTheme();
  const dark = resolved === 'dark';
  const label = dark ? t('lightMode') : t('darkMode');
  return (
    <button
      type="button"
      onClick={() => setChoice(dark ? 'light' : 'dark')}
      aria-label={label}
      title={label}
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-xl border bg-card text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
}
