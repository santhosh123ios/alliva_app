'use client';

import { createApiClient } from '@alliva/api-client';
import { Toaster } from '@alliva/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export const api = createApiClient();

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 20_000, refetchOnWindowFocus: false, retry: 1 },
    },
  }));
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
