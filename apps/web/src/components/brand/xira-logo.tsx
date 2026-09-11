'use client';

import { cn } from '@/lib/cn';

type XiraLogoProps = {
  variant: 'on-dark' | 'on-light';
  size?: 'sm' | 'md';
  className?: string;
};

export function XiraLogo({ variant, size = 'md', className }: XiraLogoProps) {
  const onDark = variant === 'on-dark';
  const compact = size === 'sm';

  return (
    <div className={cn('flex items-center gap-token-sm', className)}>
      <div
        className={cn(
          'flex shrink-0 items-center justify-center bg-gradient-brand font-en text-logo-mark font-bold text-on-dark shadow-brand-mark',
          compact ? 'size-[var(--size-logo-tile-sm)] rounded-md' : 'size-[var(--size-logo-tile)] rounded-logo',
        )}
        aria-hidden
      >
        X
      </div>
      <div className="min-w-0">
        <div
          className={cn(
            'font-en font-bold uppercase tracking-brand',
            onDark ? 'text-on-dark' : 'text-navy',
            compact ? 'text-logo-name-sm' : 'text-logo-name',
          )}
        >
          XIRA
        </div>
        <div
          className={cn(
            'mt-token-2xs font-en uppercase tracking-tagline',
            onDark ? 'text-brand-teal' : 'text-foreground-muted',
            compact ? 'text-tagline-sm' : 'text-tagline',
          )}
        >
          SMART TAX & BUSINESS SUITE
        </div>
      </div>
    </div>
  );
}
