'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { Input } from './input';

export type FilterChip = {
  id: string;
  label: ReactNode;
  count?: number;
  active?: boolean;
  onClick: () => void;
};

export type FilterBarProps = {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  chips?: FilterChip[];
  onReset?: () => void;
  children?: ReactNode;
  className?: string;
};

export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder,
  chips,
  onReset,
  children,
  className,
}: FilterBarProps) {
  const t = useTranslations('ui');

  return (
    <div className={cn('rounded-lg border border-border bg-surface p-token-md shadow-sm', className)}>
      <div className="mb-token-sm flex flex-wrap items-center gap-token-sm">
        {onSearchChange ? (
          <div className="min-w-[var(--size-search-min)] flex-1">
            <Input
              value={search ?? ''}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder ?? t('search')}
              aria-label={searchPlaceholder ?? t('search')}
            />
          </div>
        ) : null}
        {children}
        {onReset ? (
          <Button variant="ghost" size="sm" onClick={onReset}>
            {t('filterReset')}
          </Button>
        ) : null}
      </div>
      {chips && chips.length > 0 ? (
        <div className="flex flex-wrap gap-token-xs">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={chip.onClick}
              className={cn(
                'inline-flex items-center gap-token-xs rounded-pill border px-token-sm py-token-xs text-token-xs transition',
                'focus-visible:outline-none focus-visible:shadow-ring',
                chip.active
                  ? 'border-brand bg-brand text-on-dark'
                  : 'border-border bg-surface text-foreground-muted hover:border-brand hover:text-brand',
              )}
            >
              {chip.label}
              {chip.count != null ? (
                <span
                  className={cn(
                    'rounded-pill px-token-xs text-token-xs',
                    chip.active ? 'bg-on-dark/20' : 'bg-foreground/10',
                  )}
                >
                  {chip.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
