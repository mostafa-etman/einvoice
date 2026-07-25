'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { deleteDocument, listDocuments } from '@/lib/api/documents';

export default function DocumentsPage() {
  const t = useTranslations('documents');
  const locale = useLocale();
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    listDocuments()
      .then((res: { items: Array<Record<string, unknown>> }) => setItems(res.items))
      .catch((e: Error) => setError(e.message));
  };

  useEffect(() => {
    reload();
  }, []);

  return (
    <div className="space-y-token-lg">
      <div className="flex items-center justify-between gap-token-md">
        <h1 className="font-display text-token-2xl text-brand">{t('title')}</h1>
        <Link
          href={`/${locale}/documents/new`}
          className="rounded bg-brand px-token-md py-token-sm text-token-sm text-white"
        >
          {t('new')}
        </Link>
      </div>
      {error ? <p className="text-token-sm text-danger">{error}</p> : null}
      {items.length === 0 ? (
        <p className="text-foreground/70">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border border border-border">
          {items.map((doc) => (
            <li
              key={String(doc.id)}
              className="flex flex-wrap items-center gap-token-md px-token-md py-token-sm"
            >
              <Link
                href={`/${locale}/documents/${String(doc.id)}`}
                className="font-medium text-brand hover:underline"
              >
                {String(doc.internalId)}
              </Link>
              <span className="text-token-sm text-foreground/70">{String(doc.kind)}</span>
              <span className="text-token-sm">{String(doc.status)}</span>
              <span className="ms-auto text-token-sm">{String(doc.totalAmount)}</span>
              <button
                type="button"
                className="text-token-sm text-danger"
                onClick={async () => {
                  await deleteDocument(String(doc.id));
                  reload();
                }}
              >
                {t('delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
