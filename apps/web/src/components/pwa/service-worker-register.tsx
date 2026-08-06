'use client';

import { useEffect } from 'react';

/** Optional PWA install — registers service worker when supported. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      /* install optional; ignore registration failures */
    });
  }, []);
  return null;
}
