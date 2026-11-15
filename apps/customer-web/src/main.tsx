import './fonts';
import './globals.css';
import { installImageFallback } from '@/lib/image-fallback';
import { router } from '@/router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';

installImageFallback();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
