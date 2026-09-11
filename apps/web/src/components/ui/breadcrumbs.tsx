'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export type BreadcrumbsProps = {
  items: BreadcrumbItem[];
  className?: string;
};

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  const t = useTranslations('ui');
  return (
    <nav aria-label={t('breadcrumb')} className={cn('text-token-xs text-foreground-muted', className)}>
      <ol className="m-0 flex list-none flex-wrap items-center gap-token-xs p-0">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-token-xs">
              {index > 0 ? (
                <span aria-hidden className="text-foreground-subtle">
                  ›
                </span>
              ) : null}
              {item.href && !last ? (
                <Link href={item.href} className="hover:text-brand">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
