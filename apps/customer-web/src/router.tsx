import { Loading } from '@/components/loading';
import { CustomerShell } from '@/components/shell';
import { LocaleLayout, LocaleRedirect, NotFound } from '@/locale-layout';
import { lazy, Suspense } from 'react';
import { createBrowserRouter, Outlet } from 'react-router';

const Home = lazy(() => import('@/pages/home'));
const Cart = lazy(() => import('@/pages/cart'));
const Checkout = lazy(() => import('@/pages/checkout'));
const Favourites = lazy(() => import('@/pages/favourites'));
const Legal = lazy(() => import('@/pages/legal'));
const Login = lazy(() => import('@/pages/login'));
const Merchant = lazy(() => import('@/pages/merchant'));
const Product = lazy(() => import('@/pages/product'));
const Orders = lazy(() => import('@/pages/orders'));
const Order = lazy(() => import('@/pages/order'));
const Profile = lazy(() => import('@/pages/profile'));
const Qr = lazy(() => import('@/pages/qr'));

function ShellLayout() {
  return (
    <CustomerShell>
      <Suspense fallback={<Loading />}>
        <Outlet />
      </Suspense>
    </CustomerShell>
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
          { index: true, element: <Home /> },
          { path: 'cart', element: <Cart /> },
          { path: 'checkout', element: <Checkout /> },
          { path: 'favourites', element: <Favourites /> },
          { path: 'legal/:slug', element: <Legal /> },
          { path: 'login', element: <Login /> },
          { path: 'merchants/:slug', element: <Merchant /> },
          { path: 'merchants/:slug/products/:id', element: <Product /> },
          { path: 'orders', element: <Orders /> },
          { path: 'orders/:id', element: <Order /> },
          { path: 'profile', element: <Profile /> },
          { path: 'q/:code', element: <Qr /> },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
