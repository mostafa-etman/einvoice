'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  getInvoiceNumbering,
  upsertInvoiceNumbering,
  type InvoiceNumbering,
} from '@/lib/api/invoice-numbering';

export default function InvoiceNumberingPage() {
  const t = useTranslations('settingsNumbering');
  const [form, setForm] = useState<Omit<InvoiceNumbering, 'previewNext'>>({
    prefix: 'INV-',
    padWidth: 6,
    startingNumber: 1,
    charset: 'NUMERIC',
    scope: 'TENANT',
  });
  const [preview, setPreview] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getInvoiceNumbering()
      .then((v) => {
        setForm({
          prefix: v.prefix,
          padWidth: v.padWidth,
          startingNumber: v.startingNumber,
          charset: v.charset,
          scope: v.scope,
        });
        setPreview(v.previewNext);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const v = await upsertInvoiceNumbering(form);
      setPreview(v.previewNext);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="font-display text-token-xl">{t('title')}</h1>
      <p className="mt-token-sm text-token-md text-foreground/70">{t('intro')}</p>

      {error ? (
        <p className="mt-token-md rounded border border-danger/40 bg-danger/10 px-token-md py-token-sm text-token-sm text-danger">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="mt-token-md text-token-sm text-brand">{t('saved')}</p>
      ) : null}

      <div className="mt-token-lg space-y-token-md rounded border border-border bg-surface p-token-lg">
        <label className="block text-token-sm">
          {t('prefix')}
          <input
            className="mt-token-xs w-full rounded border border-border bg-background px-token-sm py-token-xs"
            value={form.prefix}
            onChange={(e) => setForm({ ...form, prefix: e.target.value })}
          />
          <span className="mt-token-xs block text-token-xs text-foreground/60">
            {t('prefixHelp')}
          </span>
        </label>
        <label className="block text-token-sm">
          {t('padWidth')}
          <input
            type="number"
            min={1}
            max={12}
            className="mt-token-xs w-full rounded border border-border bg-background px-token-sm py-token-xs"
            value={form.padWidth}
            onChange={(e) =>
              setForm({ ...form, padWidth: Number(e.target.value) || 1 })
            }
          />
        </label>
        <label className="block text-token-sm">
          {t('startingNumber')}
          <input
            type="number"
            min={0}
            className="mt-token-xs w-full rounded border border-border bg-background px-token-sm py-token-xs"
            value={form.startingNumber}
            onChange={(e) =>
              setForm({
                ...form,
                startingNumber: Number(e.target.value) || 0,
              })
            }
          />
        </label>
        <label className="block text-token-sm">
          {t('charset')}
          <select
            className="mt-token-xs w-full rounded border border-border bg-background px-token-sm py-token-xs"
            value={form.charset}
            onChange={(e) =>
              setForm({
                ...form,
                charset: e.target.value as InvoiceNumbering['charset'],
              })
            }
          >
            <option value="NUMERIC">{t('charsetNumeric')}</option>
            <option value="ALPHANUMERIC">{t('charsetAlphanumeric')}</option>
          </select>
        </label>
        <label className="block text-token-sm">
          {t('scope')}
          <select
            className="mt-token-xs w-full rounded border border-border bg-background px-token-sm py-token-xs"
            value={form.scope}
            onChange={(e) =>
              setForm({
                ...form,
                scope: e.target.value as InvoiceNumbering['scope'],
              })
            }
          >
            <option value="TENANT">{t('scopeTenant')}</option>
            <option value="BRANCH">{t('scopeBranch')}</option>
            <option value="DOCUMENT_KIND">{t('scopeKind')}</option>
            <option value="BRANCH_AND_KIND">{t('scopeBranchKind')}</option>
          </select>
          <span className="mt-token-xs block text-token-xs text-foreground/60">
            {t('scopeHelp')}
          </span>
        </label>
        <p className="text-token-sm">
          {t('preview')}:{' '}
          <span className="font-mono text-brand">{preview || '—'}</span>
        </p>
        <button
          type="button"
          disabled={busy}
          className="rounded bg-brand px-token-md py-token-xs text-token-sm text-white disabled:opacity-50"
          onClick={() => void save()}
        >
          {t('save')}
        </button>
      </div>
    </section>
  );
}
