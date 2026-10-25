import { useLocale } from 'use-intl';
import { ar } from './messages-ar';
import { en, type MessageKey } from './messages-en';

export type { MessageKey };
export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const dictionaries = { en, ar } as const;

export function useT(): Translate {
  const locale = useLocale();
  const dictionary = dictionaries[locale === 'ar' ? 'ar' : 'en'];
  return (key, vars) => {
    const text: string = dictionary[key] ?? en[key] ?? key;
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (_match, name: string) => String(vars[name] ?? ''));
  };
}

export function useLang(): 'en' | 'ar' {
  return useLocale() === 'ar' ? 'ar' : 'en';
}

/** Localized text of a `{ en, ar }` pair coming from the API. */
export function pick(value: { en?: string; ar?: string } | null | undefined, lang: 'en' | 'ar'): string {
  if (!value) return '';
  return (lang === 'ar' ? value.ar || value.en : value.en || value.ar) ?? '';
}
