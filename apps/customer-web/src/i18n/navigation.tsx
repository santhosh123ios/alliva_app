import { useMemo, type ComponentProps } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router';
import { useLocale } from 'use-intl';
import { localizeHref, stripLocale } from './routing';

type LinkProps = Omit<ComponentProps<typeof RouterLink>, 'to'> & { href: string; locale?: string };

export function Link({ href, locale, ...props }: LinkProps) {
  const current = useLocale();
  return <RouterLink to={localizeHref(href, locale ?? current)} {...props} />;
}

type NavigateOptions = { locale?: string };

export function useRouter() {
  const navigate = useNavigate();
  const current = useLocale();
  return useMemo(
    () => ({
      push: (href: string, options?: NavigateOptions) => void navigate(localizeHref(href, options?.locale ?? current)),
      replace: (href: string, options?: NavigateOptions) => void navigate(localizeHref(href, options?.locale ?? current), { replace: true }),
      back: () => void navigate(-1),
    }),
    [navigate, current],
  );
}

export function usePathname() {
  return stripLocale(useLocation().pathname);
}
