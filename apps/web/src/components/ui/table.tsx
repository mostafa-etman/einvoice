'use client';

import { cn } from '@/lib/cn';
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';

export type TableAlign = 'start' | 'end' | 'center';

const alignClass: Record<TableAlign, string> = {
  start: 'text-start',
  end: 'text-end',
  center: 'text-center',
};

export type TableColumn<T> = {
  id: string;
  header: ReactNode;
  align?: TableAlign;
  sortable?: boolean;
  className?: string;
  /** Keep codes, IDs, and other technical values LTR in Arabic layouts. */
  ltr?: boolean;
  cell: (row: T) => ReactNode;
};

export const tableStickyFirstClass =
  '[&_th:first-child]:sticky [&_th:first-child]:start-0 [&_th:first-child]:z-[2] [&_th:first-child]:bg-surface-alt [&_td:first-child]:sticky [&_td:first-child]:start-0 [&_td:first-child]:z-[1] [&_td:first-child]:bg-surface [&_tr:hover>td:first-child]:bg-surface-alt';

export type TableSort = {
  columnId: string;
  direction: 'asc' | 'desc';
};

export type TableProps<T> = {
  caption: string;
  columns: TableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  dense?: boolean;
  loading?: boolean;
  loadingRowCount?: number;
  empty?: ReactNode;
  sort?: TableSort | null;
  onSortChange?: (sort: TableSort) => void;
  className?: string;
  onRowClick?: (row: T) => void;
  stickyFirstColumn?: boolean;
};

export function Table<T>({
  caption,
  columns,
  rows,
  getRowId,
  dense = false,
  loading = false,
  loadingRowCount = 5,
  empty,
  sort,
  onSortChange,
  className,
  onRowClick,
  stickyFirstColumn = true,
}: TableProps<T>) {
  const showEmpty = !loading && rows.length === 0;

  return (
    <div
      className={cn(
        'overflow-x-auto rounded-lg border border-border bg-surface shadow-sm',
        stickyFirstColumn && tableStickyFirstClass,
        className,
      )}
    >
      <table className={cn('w-full border-collapse', dense ? 'text-token-xs' : 'text-token-sm')}>
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-surface-alt">
          <tr>
            {columns.map((col) => {
              const aligned = col.align ?? 'start';
              const sorted = sort?.columnId === col.id ? sort.direction : undefined;
              return (
                <th
                  key={col.id}
                  scope="col"
                  aria-sort={
                    sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'
                  }
                  className={cn(
                    'border-b border-border px-token-md py-token-sm text-token-xs font-semibold uppercase tracking-wide text-foreground-muted',
                    alignClass[aligned],
                    col.className,
                  )}
                >
                  {col.sortable && onSortChange ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-token-2xs rounded-sm focus-visible:outline-none focus-visible:shadow-ring"
                      onClick={() =>
                        onSortChange({
                          columnId: col.id,
                          direction: sorted === 'asc' ? 'desc' : 'asc',
                        })
                      }
                    >
                      {col.header}
                      <SortMark direction={sorted} />
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: loadingRowCount }, (_, i) => (
                <tr key={`sk-${i}`} className="border-b border-border last:border-b-0">
                  {columns.map((col) => (
                    <td key={col.id} className="px-token-md py-token-sm">
                      <span className="block h-token-sm animate-pulse rounded-sm bg-gradient-skeleton" />
                    </td>
                  ))}
                </tr>
              ))
            : null}
          {showEmpty ? (
            <tr>
              <td colSpan={columns.length} className="px-token-md py-token-xl text-center">
                {empty}
              </td>
            </tr>
          ) : null}
          {!loading
            ? rows.map((row) => (
                <tr
                  key={getRowId(row)}
                  className={cn(
                    'border-b border-border last:border-b-0 transition-colors hover:bg-surface-alt',
                    onRowClick && 'cursor-pointer',
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      dir={col.ltr ? 'ltr' : undefined}
                      className={cn(
                        'px-token-md py-token-sm text-foreground',
                        alignClass[col.align ?? 'start'],
                        col.align === 'end' && 'font-en tabular-nums',
                        col.ltr && 'font-en',
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            : null}
        </tbody>
      </table>
    </div>
  );
}

function SortMark({ direction }: { direction?: 'asc' | 'desc' }) {
  return (
    <span aria-hidden className="text-token-xs text-foreground-subtle">
      {direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '↕'}
    </span>
  );
}

export function TableWrap({
  className,
  stickyFirstColumn = true,
  ...props
}: HTMLAttributes<HTMLDivElement> & { stickyFirstColumn?: boolean }) {
  return (
    <div
      className={cn(
        'overflow-x-auto rounded-lg border border-border bg-surface',
        stickyFirstColumn && tableStickyFirstClass,
        className,
      )}
      {...props}
    />
  );
}

export function Th({
  align = 'start',
  className,
  ...props
}: Omit<ThHTMLAttributes<HTMLTableCellElement>, 'align'> & { align?: TableAlign }) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-border bg-surface-alt px-token-md py-token-sm text-token-xs font-semibold uppercase tracking-wide text-foreground-muted',
        alignClass[align],
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  align = 'start',
  className,
  ...props
}: Omit<TdHTMLAttributes<HTMLTableCellElement>, 'align'> & { align?: TableAlign }) {
  return (
    <td
      className={cn('px-token-md py-token-sm', alignClass[align], className)}
      {...props}
    />
  );
}
