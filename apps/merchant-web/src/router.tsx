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
const RiderLayout = lazy(() => import('@/rider/layout'));
const RiderHome = lazy(() => import('@/rider/home'));
const RiderOrder = lazy(() => import('@/rider/order'));
const RiderCollection = lazy(() => import('@/rider/collection'));
const RiderProfile = lazy(() => import('@/rider/profile'));
const Kitchen = lazy(() => import('@/kitchen/kitchen'));
const FloorLayout = lazy(() => import('@/floor/layout'));
const FloorHome = lazy(() => import('@/floor/home'));
const FloorTables = lazy(() => import('@/floor/tables'));
const FloorMenu = lazy(() => import('@/floor/menu'));
const FloorOrders = lazy(() => import('@/floor/orders'));
const FloorProfile = lazy(() => import('@/floor/profile'));
const TillLayout = lazy(() => import('@/till/layout'));
const TillHome = lazy(() => import('@/till/home'));
const TillBills = lazy(() => import('@/till/bills'));
const TillCash = lazy(() => import('@/till/cash'));
const TillProfile = lazy(() => import('@/till/profile'));

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
        path: 'rider',
        element: <Suspense fallback={<Loading />}><RiderLayout /></Suspense>,
        children: [
          { index: true, element: <RiderHome /> },
          { path: 'orders/:id', element: <RiderOrder /> },
          { path: 'collection', element: <RiderCollection /> },
          { path: 'profile', element: <RiderProfile /> },
        ],
      },
      {
        path: 'floor',
        element: <Suspense fallback={<Loading />}><FloorLayout /></Suspense>,
        children: [
          { index: true, element: <FloorHome /> },
          { path: 'tables', element: <FloorTables /> },
          { path: 'menu', element: <FloorMenu /> },
          { path: 'orders', element: <FloorOrders /> },
          { path: 'profile', element: <FloorProfile /> },
        ],
      },
      {
        path: 'billing',
        element: <Suspense fallback={<Loading />}><TillLayout /></Suspense>,
        children: [
          { index: true, element: <TillHome /> },
          { path: 'bills', element: <TillBills /> },
          { path: 'cash', element: <TillCash /> },
          { path: 'profile', element: <TillProfile /> },
        ],
      },
      { path: 'kitchen', element: <Suspense fallback={<Loading />}><Kitchen /></Suspense> },
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
