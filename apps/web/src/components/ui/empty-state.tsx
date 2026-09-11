'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';

export type EmptyStateProps = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: { label: ReactNode; onClick: () => void };
  secondaryAction?: { label: ReactNode; onClick: () => void };
  className?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'rounded-lg border-2 border-dashed border-border bg-surface px-token-lg py-token-2xl text-center',
        className,
      )}
    >
      {icon ? (
        <div className="mx-auto mb-token-md flex size-[var(--size-empty-icon)] items-center justify-center rounded-xl bg-gradient-brand-soft text-brand">
          {icon}
        </div>
      ) : null}
      <h4 className="m-0 text-token-lg font-semibold text-foreground">{title}</h4>
      {description ? (
        <p className="mx-auto mt-token-xs max-w-md text-token-sm text-foreground-muted">{description}</p>
      ) : null}
      {action || secondaryAction ? (
        <div className="mt-token-md flex flex-wrap items-center justify-center gap-token-sm">
          {action ? (
            <Button onClick={action.onClick}>{action.label}</Button>
          ) : null}
          {secondaryAction ? (
            <Button variant="secondary" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
