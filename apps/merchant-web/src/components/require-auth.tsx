import { api } from '@/components/providers';
import { localizeHref } from '@/i18n/routing';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet } from 'react-router';
import { useLocale } from 'use-intl';

export function RequireAuth() {
  const locale = useLocale();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  if (me.isError) return <Navigate replace to={localizeHref('/login', locale)} />;
  return <Outlet />;
}
