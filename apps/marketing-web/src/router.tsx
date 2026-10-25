import { Loading } from '@/components/loading';
import { RequireMarketing } from '@/components/session';
import { PortalShell } from '@/components/shell';
import { LocaleLayout, LocaleRedirect } from '@/locale-layout';
import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router';

const Login = lazy(() => import('@/pages/login'));
const Forgot = lazy(() => import('@/pages/forgot'));
const Reset = lazy(() => import('@/pages/reset'));
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
        element: <Suspense fallback={null}><Outlet /></Suspense>,
        children: [
          { path: 'login', element: <Login /> },
          { path: 'forgot', element: <Forgot /> },
          { path: 'reset', element: <Reset /> },
        ],
      },
      {
        element: <RequireMarketing />,
        children: [
          {
            element: <ShellLayout />,
            children: [
              { index: true, element: <Navigate to="dashboard" replace /> },
              { path: '*', element: <Section /> },
            ],
          },
        ],
      },
    ],
  },
]);
