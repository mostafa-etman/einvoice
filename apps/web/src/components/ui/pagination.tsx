'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { Select } from './select';

export type PaginationProps = {
  page: number;
  pageCount: number;
  pageSize: number;
  pageSizeOptions?: number[];
  totalItems?: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  className?: string;
};

export function Pagination({
  page,
  pageCount,
  pageSize,
  pageSizeOptions = [10, 25, 50, 100],
  totalItems,
  onPageChange,
  onPageSizeChange,
  className,
}: PaginationProps) {
  const t = useTranslations('ui');
  const safeCount = Math.max(1, pageCount);
  const current = Math.min(Math.max(1, page), safeCount);

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-token-sm', className)}>
      <p className="text-token-sm text-foreground-muted">
        {t('paginationSummary', { page: current, total: safeCount })}
        {totalItems != null ? ` · ${totalItems}` : null}
      </p>
      <div className="flex flex-wrap items-center gap-token-sm">
        {onPageSizeChange ? (
          <label className="flex items-center gap-token-xs text-token-sm text-foreground-muted">
            {t('pageSize')}
            <Select
              aria-label={t('pageSize')}
              value={String(pageSize)}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="w-auto"
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
        >
          <span className="inline-block rtl:rotate-180" aria-hidden>
            →
          </span>
          {t('previous')}
        </Button>
        <label className="flex items-center gap-token-xs text-token-sm">
          <span className="sr-only">{t('jumpToPage')}</span>
          <input
            type="number"
            min={1}
            max={safeCount}
            value={current}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next)) onPageChange(next);
            }}
            className="w-token-2xl rounded-control border border-border-strong bg-surface px-token-sm py-token-xs text-center text-token-sm focus:border-brand focus:shadow-ring-input focus:outline-none"
            aria-label={t('jumpToPage')}
          />
        </label>
        <Button
          variant="secondary"
          size="sm"
          disabled={current >= safeCount}
          onClick={() => onPageChange(current + 1)}
        >
          {t('next')}
          <span className="inline-block rtl:rotate-180" aria-hidden>
            ←
          </span>
        </Button>
      </div>
    </div>
  );
}
