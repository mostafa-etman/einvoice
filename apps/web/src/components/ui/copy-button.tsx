'use client';

import { useCallback, useState, type ButtonHTMLAttributes } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from './button';

async function writeClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
  }
}

export type CopyButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  value: string;
  copiedLabel?: string;
};

export function CopyButton({
  value,
  copiedLabel,
  children,
  disabled,
  ...props
}: CopyButtonProps) {
  const t = useTranslations('common');
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    if (!value) return;
    await writeClipboard(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [value]);

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={disabled || !value}
      onClick={() => void onCopy()}
      {...props}
    >
      {copied ? (copiedLabel ?? t('copied')) : (children ?? t('copy'))}
    </Button>
  );
}

export function CopyableTenantId({
  id,
  className,
  showLabel = true,
}: {
  id: string | null | undefined;
  className?: string;
  showLabel?: boolean;
}) {
  const t = useTranslations('common');
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    if (!id) return;
    await writeClipboard(id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [id]);

  if (!id) return null;

  return (
    <div className={`flex flex-wrap items-center gap-2 text-sm ${className ?? ''}`.trim()}>
      {showLabel ? <span>{t('tenantId')}:</span> : null}
      <code className="break-all font-mono text-xs" dir="ltr">
        {id}
      </code>
      <button
        type="button"
        className="rounded border border-border px-2 py-0.5 text-xs hover:bg-brand-muted"
        onClick={() => void onCopy()}
      >
        {copied ? t('copied') : t('copy')}
      </button>
    </div>
  );
}
