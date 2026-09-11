'use client';

import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: ReactNode;
};

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, label, id, disabled, className, ...props },
  ref,
) {
  const autoId = useId();
  const labelId = id ?? autoId;

  return (
    <div className="inline-flex items-center gap-token-sm">
      <button
        ref={ref}
        type="button"
        role="switch"
        id={label ? undefined : labelId}
        aria-labelledby={label ? `${labelId}-label` : undefined}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange?.(!checked)}
        className={cn(
          'relative h-token-md w-token-xl shrink-0 rounded-pill transition',
          'focus-visible:outline-none focus-visible:shadow-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-brand' : 'bg-border-strong',
          className,
        )}
        {...props}
      >
        <span
          className="absolute top-token-2xs size-token-sm rounded-pill bg-surface shadow-xs transition-[inset-inline-start]"
          style={{
            insetInlineStart: checked
              ? 'calc(100% - var(--space-sm) - var(--space-2xs))'
              : 'var(--space-2xs)',
          }}
        />
      </button>
      {label ? (
        <label id={`${labelId}-label`} className="text-token-sm text-foreground">
          {label}
        </label>
      ) : null}
    </div>
  );
});
