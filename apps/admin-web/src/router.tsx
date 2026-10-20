import { Loading } from '@/components/loading';
import { RequireAuth } from '@/components/require-auth';
import { PortalShell } from '@/components/shell';
import { localizeHref } from '@/i18n/routing';
import { LocaleLayout, LocaleRedirect } from '@/locale-layout';
import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet, useParams } from 'react-router';

const Login = lazy(() => import('@/pages/login'));
const Forgot = lazy(() => import('@/pages/forgot'));
const Section = lazy(() => import('@/pages/section'));

function ShellLayout() {
  return (
    <PortalShell>
      <Suspense fallback={<Loading />}>
        <Outlet />
      </Suspense>
    </PortalShell>
  );
}

function LoginRedirect() {
  const { locale = 'en' } = useParams();
  return <Navigate replace to={localizeHref('/login', locale)} />;
}

export const router = createBrowserRouter([
  { path: '/', element: <LocaleRedirect /> },
  {
    path: ':locale',
    element: <LocaleLayout />,
    children: [
      { index: true, element: <LoginRedirect /> },
      {
        element: <ShellLayout />,
        children: [
          { path: 'login', element: <Login /> },
          { path: 'forgot', element: <Forgot /> },
          { element: <RequireAuth />, children: [{ path: '*', element: <Section /> }] },
        ],
      },
    ],
  },
]);
