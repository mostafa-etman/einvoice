'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Field } from './field';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  iconStart?: ReactNode;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, iconStart, required, id, className, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = error ? `${inputId}-error` : undefined;

  const control = (
    <div className={cn('relative', iconStart && 'block')}>
      {iconStart ? (
        <span className="pointer-events-none absolute start-token-sm top-1/2 -translate-y-1/2 text-foreground-subtle">
          {iconStart}
        </span>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={cn(
          'w-full rounded-control border border-border-strong bg-surface px-input-x py-input-y text-token-sm text-foreground',
          'transition-[border-color,box-shadow]',
          'placeholder:text-foreground-subtle',
          'focus:border-brand focus:shadow-ring-input focus:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
          iconStart && 'ps-token-xl',
          error && 'border-danger',
          className,
        )}
        {...props}
      />
    </div>
  );

  if (!label && !hint && !error) return control;

  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId}>
      {control}
    </Field>
  );
});
