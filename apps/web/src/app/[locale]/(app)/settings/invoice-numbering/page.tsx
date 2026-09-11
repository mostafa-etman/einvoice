'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  getInvoiceNumbering,
  upsertInvoiceNumbering,
  type InvoiceNumbering,
} from '@/lib/api/invoice-numbering';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsPageHeader } from '../_components/settings-page-header';
import { QueryErrorCard } from '@/components/ui/query-error-card';
import { useMutationToast } from '@/components/ui/use-mutation-toast';

export default function InvoiceNumberingPage() {
  const t = useTranslations('settingsNumbering');
  const tRetry = useTranslations('common.actions');
  const toast = useMutationToast();
  const [form, setForm] = useState<Omit<InvoiceNumbering, 'previewNext'>>({
    prefix: 'INV-',
    padWidth: 6,
    startingNumber: 1,
    charset: 'NUMERIC',
    scope: 'TENANT',
  });
  const [preview, setPreview] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

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
        setLoadError(null);
      })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoaded(true));
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const v = await upsertInvoiceNumbering(form);
      setPreview(v.previewNext);
      setSaved(true);
      toast.saved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveFailed'));
      toast.error(e, t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-token-lg">
      <SettingsPageHeader title={t('title')} subtitle={t('intro')} />

      {loadError ? (
        <QueryErrorCard
          message={loadError}
          retryLabel={tRetry('retry')}
          onRetry={() => {
            setLoaded(false);
            setLoadError(null);
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
                setLoadError(null);
              })
              .catch((e: Error) => setLoadError(e.message))
              .finally(() => setLoaded(true));
          }}
        />
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger bg-danger-muted px-token-md py-token-sm text-token-sm text-danger"
        >
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="text-token-sm text-success" role="status">
          {t('saved')}
        </p>
      ) : null}

      {!loaded ? (
        <Card aria-busy="true">
          <Skeleton className="mb-token-md" />
          <Skeleton className="mb-token-sm w-2/3" />
          <Skeleton className="mb-token-sm" />
          <Skeleton variant="rect" className="h-token-xl" />
        </Card>
      ) : loadError ? null : (
        <Card className="space-y-token-md">
          <Input
            label={t('prefix')}
            hint={t('prefixHelp')}
            value={form.prefix}
            onChange={(e) => setForm({ ...form, prefix: e.target.value })}
          />
          <Input
            type="number"
            min={1}
            max={12}
            label={t('padWidth')}
            value={form.padWidth}
            onChange={(e) =>
              setForm({ ...form, padWidth: Number(e.target.value) || 1 })
            }
          />
          <Input
            type="number"
            min={0}
            label={t('startingNumber')}
            value={form.startingNumber}
            onChange={(e) =>
              setForm({
                ...form,
                startingNumber: Number(e.target.value) || 0,
              })
            }
          />
          <Select
            label={t('charset')}
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
          </Select>
          <Select
            label={t('scope')}
            hint={t('scopeHelp')}
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
          </Select>
          <p className="text-token-sm">
            {t('preview')}:{' '}
            <span className="font-en text-brand">{preview || '—'}</span>
          </p>
          <Button type="button" disabled={busy} onClick={() => void save()}>
            {t('save')}
          </Button>
        </Card>
      )}
    </div>
  );
}
