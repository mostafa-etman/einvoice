'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { Button } from './button';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  side?: 'start' | 'end';
  /** `on-dark` is for the navy mobile nav; default stays the P1 surface drawer. */
  tone?: 'surface' | 'on-dark';
};

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  className,
  side = 'end',
  tone = 'surface',
}: DrawerProps) {
  const t = useTranslations('common.actions');
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = () =>
      panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
    (focusables()[0] ?? panel)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        className="absolute inset-0 bg-navy/50"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'absolute inset-y-0 flex w-full max-w-md flex-col shadow-lg',
          'focus:outline-none',
          tone === 'on-dark' ? 'bg-navy text-on-dark' : 'bg-surface',
          side === 'start'
            ? cn('start-0', tone === 'on-dark' ? 'border-e border-border-dark' : 'border-e border-border')
            : cn('end-0', tone === 'on-dark' ? 'border-s border-border-dark' : 'border-s border-border'),
          className,
        )}
      >
        <div
          className={cn(
            'flex items-center justify-between gap-token-sm px-token-lg py-token-md',
            tone === 'on-dark' ? 'border-b border-border-dark' : 'border-b border-border',
          )}
        >
          <h2 id={titleId} className="text-token-lg font-semibold">
            {title}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('close')}
            onClick={onClose}
            className={
              tone === 'on-dark' ? 'text-on-dark-muted hover:bg-nav-hover hover:text-on-dark' : undefined
            }
          >
            ×
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-token-lg py-token-md">{children}</div>
        {footer ? (
          <div
            className={cn(
              'px-token-lg py-token-md',
              tone === 'on-dark' ? 'border-t border-border-dark' : 'border-t border-border',
            )}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
