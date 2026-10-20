import { Loading } from '@/components/loading';
import { RequireAuth } from '@/components/require-auth';
import { PortalShell } from '@/components/shell';
import { LocaleLayout, LocaleRedirect } from '@/locale-layout';
import { lazy, Suspense } from 'react';
import { createBrowserRouter, Outlet } from 'react-router';

const Landing = lazy(() => import('@/pages/landing'));
const Login = lazy(() => import('@/pages/login'));
const Forgot = lazy(() => import('@/pages/forgot'));
const Register = lazy(() => import('@/pages/register'));
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

export const router = createBrowserRouter([
  { path: '/', element: <LocaleRedirect /> },
  {
    path: ':locale',
    element: <LocaleLayout />,
    children: [
      {
        element: <ShellLayout />,
        children: [
          { index: true, element: <Landing /> },
          { path: 'login', element: <Login /> },
          { path: 'forgot', element: <Forgot /> },
          { path: 'register', element: <Register /> },
          { element: <RequireAuth />, children: [{ path: '*', element: <Section /> }] },
        ],
      },
    ],
  },
]);
