import { cn } from '@/lib/cn';
import type { HTMLAttributes } from 'react';

export type BadgeVariant =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'draft'
  | 'signed'
  | 'submitted'
  | 'valid'
  | 'invalid'
  | 'cancelled'
  | 'rejected';

const variantClass: Record<BadgeVariant, string> = {
  neutral: 'border border-border bg-surface-alt text-foreground-muted',
  success: 'bg-success-muted text-success',
  warning: 'bg-warning-muted text-warning',
  danger: 'bg-danger-muted text-danger',
  info: 'bg-info-muted text-info',
  draft: 'bg-status-draft-muted text-status-draft',
  signed: 'bg-status-signed-muted text-status-signed',
  submitted: 'bg-status-submitted-muted text-status-submitted',
  valid: 'bg-status-valid-muted text-status-valid',
  invalid: 'bg-status-invalid-muted text-status-invalid',
  cancelled: 'bg-status-cancelled-muted text-status-cancelled',
  rejected: 'bg-status-rejected-muted text-status-rejected',
};

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
  dot?: boolean;
};

export function Badge({
  variant = 'neutral',
  dot = variant !== 'neutral',
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-token-xs rounded-pill px-badge-x py-badge-y text-badge font-medium leading-normal',
        variantClass[variant],
        className,
      )}
      {...props}
    >
      {dot ? (
        <span
          className="inline-block size-[var(--size-badge-dot)] rounded-pill bg-current"
          aria-hidden
        />
      ) : null}
      {children}
    </span>
  );
}
