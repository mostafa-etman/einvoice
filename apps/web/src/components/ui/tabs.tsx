'use client';

import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type TabItem = {
  id: string;
  label: ReactNode;
  panel: ReactNode;
  disabled?: boolean;
};

export type TabsProps = {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
};

export function Tabs({ items, value, onChange, className }: TabsProps) {
  const baseId = useId();
  const enabled = items.filter((item) => !item.disabled);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = enabled.findIndex((item) => item.id === value);
    if (idx < 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const dir =
        e.key === 'ArrowRight'
          ? document.documentElement.dir === 'rtl'
            ? -1
            : 1
          : document.documentElement.dir === 'rtl'
            ? 1
            : -1;
      const next = enabled[(idx + dir + enabled.length) % enabled.length];
      onChange(next.id);
    }
    if (e.key === 'Home') {
      e.preventDefault();
      onChange(enabled[0].id);
    }
    if (e.key === 'End') {
      e.preventDefault();
      onChange(enabled[enabled.length - 1].id);
    }
  };

  return (
    <div className={className}>
      <div
        role="tablist"
        className="flex flex-wrap gap-token-2xs border-b border-border"
        onKeyDown={onKeyDown}
      >
        {items.map((item) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-controls={`${baseId}-panel-${item.id}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              className={cn(
                'rounded-t-md px-token-md py-token-sm text-token-sm font-medium transition',
                'focus-visible:outline-none focus-visible:shadow-ring',
                'disabled:cursor-not-allowed disabled:opacity-50',
                selected
                  ? 'border border-b-0 border-border bg-surface text-brand'
                  : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
              )}
              onClick={() => onChange(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) =>
        item.id === value ? (
          <div
            key={item.id}
            role="tabpanel"
            id={`${baseId}-panel-${item.id}`}
            aria-labelledby={`${baseId}-tab-${item.id}`}
            className="pt-token-md"
          >
            {item.panel}
          </div>
        ) : null,
      )}
    </div>
  );
}
