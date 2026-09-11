'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

export type ToastKind = 'success' | 'error' | 'info' | 'warn';

export type ToastInput = {
  kind?: ToastKind;
  title: string;
  description?: string;
  timeoutMs?: number;
};

type ToastItem = ToastInput & { id: string; kind: ToastKind };

type ToastContextValue = {
  push: (toast: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const kindClass: Record<ToastKind, string> = {
  success: 'border-success bg-success-muted text-foreground',
  error: 'border-danger bg-danger-muted text-foreground',
  info: 'border-info bg-info-muted text-foreground',
  warn: 'border-warning bg-warning-muted text-foreground',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((toast: ToastInput) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const item: ToastItem = { kind: 'info', timeoutMs: 5000, ...toast, id };
    setToasts((prev) => [...prev, item]);
    const timeout = item.timeoutMs ?? 5000;
    if (timeout > 0) {
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, timeout);
    }
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-token-md z-[60] mx-auto flex w-full max-w-md flex-col gap-token-sm px-token-md"
        aria-live="polite"
        aria-relevant="additions"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              'pointer-events-auto rounded-md border px-token-md py-token-sm shadow-md',
              kindClass[toast.kind],
            )}
          >
            <p className="text-token-sm font-medium">{toast.title}</p>
            {toast.description ? (
              <p className="mt-token-2xs text-token-xs text-foreground-muted">{toast.description}</p>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}

const silentToast: ToastContextValue = { push: () => undefined };

/** Safe in page tests that do not mount ToastProvider. Production AppProviders still wraps the tree. */
export function useOptionalToast(): ToastContextValue {
  return useContext(ToastContext) ?? silentToast;
}
