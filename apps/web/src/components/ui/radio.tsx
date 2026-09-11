'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type RadioProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: ReactNode;
};

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { label, id, className, children, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const text = label ?? children;

  return (
    <label htmlFor={inputId} className="inline-flex items-center gap-token-sm text-token-sm text-foreground">
      <input
        ref={ref}
        id={inputId}
        type="radio"
        className={cn(
          'h-token-sm w-token-sm shrink-0 border-border-strong text-brand',
          'focus-visible:outline-none focus-visible:shadow-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
      {text}
    </label>
  );
});
