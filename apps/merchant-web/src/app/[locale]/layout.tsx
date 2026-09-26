import { Providers } from '@/components/providers';
import { PortalShell } from '@/components/shell';
import { routing } from '@/i18n/routing';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { Inter, Noto_Kufi_Arabic, Noto_Sans_Arabic, Poppins } from 'next/font/google';
import { notFound } from 'next/navigation';
import '../globals.css';

const sans = Inter({ subsets: ['latin'], variable: '--font-inter' });
const display = Poppins({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-display' });
const arabic = Noto_Sans_Arabic({ subsets: ['arabic'], variable: '--font-arabic' });
const kufi = Noto_Kufi_Arabic({ subsets: ['arabic'], weight: ['600', '700'], variable: '--font-kufi' });

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const messages = (await import(`../../../../../packages/ui/messages/${locale}.json`)).default;
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className={`${sans.variable} ${display.variable} ${arabic.variable} ${kufi.variable}`}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>
            <PortalShell>{children}</PortalShell>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

export const metadata = { title: 'Alliva Merchant' };

