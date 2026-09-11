import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type StatDelta = {
  direction: 'up' | 'down' | 'flat';
  label: ReactNode;
};

export type StatCardProps = {
  label: ReactNode;
  value: ReactNode;
  delta?: StatDelta;
  tone?: 'brand' | 'teal' | 'warning' | 'danger';
  icon?: ReactNode;
  sparkline?: ReactNode;
  className?: string;
};

const toneBar: Record<NonNullable<StatCardProps['tone']>, string> = {
  brand: 'bg-brand',
  teal: 'bg-brand-teal',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

const toneIcon: Record<NonNullable<StatCardProps['tone']>, string> = {
  brand: 'bg-brand-muted text-brand',
  teal: 'bg-brand-teal-muted text-brand-teal',
  warning: 'bg-warning-muted text-warning',
  danger: 'bg-danger-muted text-danger',
};

const deltaClass: Record<StatDelta['direction'], string> = {
  up: 'text-success',
  down: 'text-danger',
  flat: 'text-foreground-muted',
};

export function StatCard({
  label,
  value,
  delta,
  tone = 'brand',
  icon,
  sparkline,
  className,
}: StatCardProps) {
  return (
    <article
      className={cn(
        'relative overflow-hidden rounded-lg border border-border bg-surface p-token-md',
        className,
      )}
    >
      <span
        className={cn('absolute inset-y-0 start-0 w-[var(--space-stat-accent)]', toneBar[tone])}
        aria-hidden
      />
      {icon ? (
        <div
          className={cn(
            'mb-token-sm flex size-token-xl items-center justify-center rounded-md',
            toneIcon[tone],
          )}
        >
          {icon}
        </div>
      ) : null}
      <p className="m-0 text-token-sm text-foreground-muted">{label}</p>
      <p className="m-0 font-en text-stat font-bold leading-tight text-foreground">{value}</p>
      {delta ? (
        <p className={cn('mt-token-xs inline-flex items-center gap-token-2xs text-token-xs font-medium', deltaClass[delta.direction])}>
          <span aria-hidden>
            {delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '—'}
          </span>
          {delta.label}
        </p>
      ) : null}
      {sparkline ? <div className="mt-token-sm">{sparkline}</div> : null}
    </article>
  );
}
