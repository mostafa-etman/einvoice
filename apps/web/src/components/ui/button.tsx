'use client';

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { Spinner } from './spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
  block?: boolean;
};

const variantClass: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-brand text-on-dark shadow-xs hover:bg-brand-strong hover:shadow-brand',
  secondary:
    'border-border-strong bg-surface text-foreground shadow-xs hover:border-brand hover:bg-surface-alt hover:text-brand',
  ghost: 'border-transparent bg-transparent text-foreground-muted hover:bg-surface-hover hover:text-foreground',
  danger: 'border-transparent bg-danger text-on-dark hover:bg-danger-strong',
  link: 'border-transparent bg-transparent px-0 py-0 text-brand underline-offset-2 hover:underline',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'px-button-x-sm py-button-y-sm text-button-sm',
  md: 'px-button-x py-button-y text-button',
  lg: 'px-button-x-lg py-button-y-lg text-button-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    iconStart,
    iconEnd,
    block,
    className,
    disabled,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  const t = useTranslations('common.states');
  const iconOnly = !children && Boolean(iconStart || iconEnd);

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-token-sm whitespace-nowrap rounded-button border font-medium leading-tight transition',
        'focus-visible:outline-none focus-visible:shadow-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variantClass[variant],
        variant === 'link' ? '' : sizeClass[size],
        block && 'w-full',
        iconOnly && 'px-token-sm py-token-sm',
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="h-token-sm w-token-sm" /> : iconStart}
      {loading && !children ? <span className="sr-only">{t('loading')}</span> : children}
      {loading ? null : iconEnd}
    </button>
  );
});
