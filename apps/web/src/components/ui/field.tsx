'use client';

import { type HTMLAttributes, type LabelHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type FieldProps = {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
};

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className,
}: FieldProps) {
  return (
    <div className={cn('mb-token-md flex flex-col gap-token-xs', className)}>
      {label ? (
        <FieldLabel htmlFor={htmlFor} required={required}>
          {label}
        </FieldLabel>
      ) : null}
      {children}
      {error ? <FieldError>{error}</FieldError> : hint ? <FieldHint>{hint}</FieldHint> : null}
    </div>
  );
}

export function FieldLabel({
  required,
  className,
  children,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label
      className={cn('text-token-sm font-medium text-foreground', className)}
      {...props}
    >
      {children}
      {required ? (
        <span className="ms-token-2xs text-danger" aria-hidden>
          *
        </span>
      ) : null}
    </label>
  );
}

export function FieldHint({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-token-xs text-foreground-muted', className)} {...props} />
  );
}

export function FieldError({ className, id, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      id={id}
      role="alert"
      className={cn('text-token-xs text-danger', className)}
      {...props}
    />
  );
}
