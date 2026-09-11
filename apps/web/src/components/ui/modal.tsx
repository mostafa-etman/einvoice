'use client';

import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { Button } from './button';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const sizeClass: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  className?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
  initialFocusRef,
}: ModalProps) {
  const t = useTranslations('common.actions');
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = () =>
      panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
    const first = initialFocusRef?.current ?? focusables()[0] ?? panel;
    first?.focus();

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
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
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
  }, [open, onClose, initialFocusRef]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-token-md">
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
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'relative z-10 w-full rounded-lg border border-border bg-surface p-token-lg shadow-lg',
          'focus:outline-none',
          sizeClass[size],
          className,
        )}
      >
        <div className="mb-token-md flex items-start justify-between gap-token-sm">
          <div>
            <h2 id={titleId} className="text-token-lg font-semibold text-foreground">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-token-xs text-token-sm text-foreground-muted">
                {description}
              </p>
            ) : null}
          </div>
          <Button variant="ghost" size="sm" aria-label={t('close')} onClick={onClose}>
            ×
          </Button>
        </div>
        <div>{children}</div>
        {footer ? <div className="mt-token-lg flex flex-wrap justify-end gap-token-sm">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
