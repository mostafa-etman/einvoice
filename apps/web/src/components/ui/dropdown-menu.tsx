'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';

export type DropdownItem = {
  id: string;
  label: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
};

export type DropdownMenuProps = {
  label: string;
  items: DropdownItem[];
  className?: string;
};

export function DropdownMenu({ label, items, className }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const focusItem = (index: number) => {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]');
    buttons?.[index]?.focus();
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not([disabled])') ?? [],
    );
    const idx = buttons.findIndex((el) => el === document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(idx < 0 ? 0 : (idx + 1) % buttons.length);
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(idx < 0 ? buttons.length - 1 : (idx - 1 + buttons.length) % buttons.length);
    }
    if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    }
    if (e.key === 'End') {
      e.preventDefault();
      focusItem(buttons.length - 1);
    }
  };

  return (
    <div ref={wrapRef} className={cn('relative inline-block', className)}>
      <Button
        variant="secondary"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </Button>
      {open ? (
        <div
          ref={listRef}
          id={menuId}
          role="menu"
          className="absolute end-0 z-40 mt-token-xs min-w-token-2xl rounded-md border border-border bg-surface py-token-xs shadow-md"
          onKeyDown={onMenuKey}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={cn(
                'block w-full px-token-md py-token-xs text-start text-token-sm',
                'focus-visible:bg-surface-hover focus-visible:outline-none',
                'disabled:cursor-not-allowed disabled:opacity-50',
                item.danger ? 'text-danger' : 'text-foreground hover:bg-surface-hover',
              )}
              onClick={() => {
                item.onSelect();
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
