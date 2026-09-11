import { cn } from '@/lib/cn';

export type ProgressProps = {
  value?: number;
  max?: number;
  label?: string;
  className?: string;
};

export function Progress({ value, max = 100, label, className }: ProgressProps) {
  const indeterminate = value == null;
  const ratio = indeterminate ? 0 : Math.min(1, Math.max(0, value / max));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={indeterminate ? undefined : Math.round(ratio * max)}
      className={cn(
        'h-token-xs overflow-hidden rounded-pill bg-surface-alt',
        className,
      )}
    >
      <div
        className={cn(
          'h-full rounded-pill bg-gradient-brand',
          indeterminate && 'w-1/3 animate-pulse',
        )}
        style={indeterminate ? undefined : { width: `${ratio * 100}%` }}
      />
    </div>
  );
}
