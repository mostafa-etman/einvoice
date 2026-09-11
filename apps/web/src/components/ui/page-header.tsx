import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type PageHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  breadcrumbs?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ title, subtitle, breadcrumbs, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        'mb-token-lg flex flex-wrap items-end justify-between gap-token-md',
        className,
      )}
    >
      <div className="min-w-0">
        {breadcrumbs ? <div className="mb-token-xs">{breadcrumbs}</div> : null}
        <h1 className="m-0 text-page font-bold text-foreground">{title}</h1>
        {subtitle ? (
          <p className="mt-token-xs text-token-sm text-foreground-muted">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-token-sm">{actions}</div> : null}
    </header>
  );
}
