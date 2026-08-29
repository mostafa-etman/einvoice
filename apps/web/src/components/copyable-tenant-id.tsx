'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

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
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      const input = document.createElement('textarea');
      input.value = id;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
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
