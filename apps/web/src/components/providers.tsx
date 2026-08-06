'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth-provider';
import { TenantProvider } from '@/lib/tenant-provider';
import { ServiceWorkerRegister } from '@/components/pwa/service-worker-register';

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TenantProvider>
          <ServiceWorkerRegister />
          {children}
        </TenantProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
