'use client';

import { forwardRef, useId, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { Field } from './field';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, required, id, className, rows = 4, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = error ? `${inputId}-error` : undefined;

  const control = (
    <textarea
      ref={ref}
      id={inputId}
      required={required}
      rows={rows}
      aria-invalid={error ? true : undefined}
      aria-describedby={errorId}
      className={cn(
        'w-full rounded-control border border-border-strong bg-surface px-input-x py-input-y text-token-sm text-foreground',
        'transition-[border-color,box-shadow]',
        'placeholder:text-foreground-subtle',
        'focus:border-brand focus:shadow-ring-input focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        error && 'border-danger',
        className,
      )}
      {...props}
    />
  );

  if (!label && !hint && !error) return control;

  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId}>
      {control}
    </Field>
  );
});
