import { createApiClient } from '@alliva/api-client';
import { NavigationProgress, Toaster, useManualBusy } from '@alliva/ui';
import { useIsFetching, useIsMutating, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigation } from 'react-router';

export const api = createApiClient('', 'admin');

function AppProgress() {
  const navigation = useNavigation();
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const manual = useManualBusy();
  const active = navigation.state !== 'idle' || fetching > 0 || mutating > 0 || manual;
  return <NavigationProgress active={active} />;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 20_000, refetchOnWindowFocus: false, retry: 1 },
    },
  }));
  return (
    <QueryClientProvider client={client}>
      <AppProgress />
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
