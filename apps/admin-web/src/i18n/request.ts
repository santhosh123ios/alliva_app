import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ locale }) => {
  const resolved = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  return {
    locale: resolved,
    messages: (await import(`../../../../packages/ui/messages/${resolved}.json`)).default,
  };
});
