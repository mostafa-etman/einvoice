'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: ReactNode;
  hint?: ReactNode;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, id, className, children, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const text = label ?? children;

  return (
    <div className="flex flex-col gap-token-2xs">
      <label htmlFor={inputId} className="inline-flex items-center gap-token-sm text-token-sm text-foreground">
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          className={cn(
            'h-token-sm w-token-sm shrink-0 rounded-sm border-border-strong text-brand',
            'focus-visible:outline-none focus-visible:shadow-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        />
        {text}
      </label>
      {hint ? <p className="ps-token-lg text-token-xs text-foreground-muted">{hint}</p> : null}
    </div>
  );
});
