'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  fetchCompanyLogoObjectUrl,
  getCompanyProfile,
  removeCompanyLogo,
  uploadCompanyLogo,
  type CompanyProfile,
} from '@/lib/api/company';
import { CopyableTenantId } from '@/components/copyable-tenant-id';
import { useTenant } from '@/lib/tenant-provider';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsPageHeader } from '../_components/settings-page-header';
import { QueryErrorCard } from '@/components/ui/query-error-card';
import { useMutationToast } from '@/components/ui/use-mutation-toast';

export default function CompanySettingsPage() {
  const t = useTranslations('settingsCompany');
  const tRetry = useTranslations('common.actions');
  const locale = useLocale();
  const { tenantId } = useTenant();
  const toast = useMutationToast();
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const logoUrlRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    const p = await getCompanyProfile();
    setProfile(p);
    setLoadError(null);
    if (logoUrlRef.current) {
      URL.revokeObjectURL(logoUrlRef.current);
      logoUrlRef.current = null;
    }
    if (p.logo) {
      const url = await fetchCompanyLogoObjectUrl();
      logoUrlRef.current = url;
      setLogoUrl(url);
    } else {
      setLogoUrl(null);
    }
  };

  useEffect(() => {
    reload().catch((e: Error) => setLoadError(e.message));
    return () => {
      if (logoUrlRef.current) URL.revokeObjectURL(logoUrlRef.current);
    };
  }, []);

  const onUpload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadCompanyLogo(file);
      await reload();
      toast.saved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('uploadFailed'));
      toast.error(e, t('uploadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    setBusy(true);
    setError(null);
    try {
      await removeCompanyLogo();
      await reload();
      toast.deleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('removeFailed'));
      toast.error(e, t('removeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const addr = profile?.defaultBranchAddress;
  const loading = !profile && !loadError;

  return (
    <div className="space-y-token-lg">
      <SettingsPageHeader title={t('title')} subtitle={t('intro')} />
      <CopyableTenantId id={tenantId} />

      {loadError ? (
        <QueryErrorCard
          message={loadError}
          retryLabel={tRetry('retry')}
          onRetry={() => {
            setLoadError(null);
            void reload().catch((e: Error) => setLoadError(e.message));
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

      {loading ? (
        <Card aria-busy="true">
          <Skeleton className="mb-token-md w-1/3" />
          <Skeleton className="mb-token-sm" />
          <Skeleton className="mb-token-sm w-2/3" />
          <Skeleton variant="rect" className="mt-token-md h-token-xl" />
        </Card>
      ) : profile ? (
        <Card className="space-y-token-md">
          <div>
            <h2 className="m-0 text-token-md font-semibold text-foreground">
              {t('companySummary')}
            </h2>
            <dl className="mt-token-sm space-y-token-xs text-token-sm">
              <div>
                <dt className="text-foreground-muted">{t('workspaceName')}</dt>
                <dd>{profile?.workspaceName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-foreground-muted">{t('legalName')}</dt>
                <dd>{profile?.legalName ?? t('legalNameMissing')}</dd>
              </div>
              <div>
                <dt className="text-foreground-muted">{t('issuerType')}</dt>
                <dd className="font-en" dir="ltr">
                  {profile?.issuerType ?? '—'}
                </dd>
              </div>
              {addr ? (
                <div>
                  <dt className="text-foreground-muted">{t('defaultAddress')}</dt>
                  <dd>
                    {[
                      addr.buildingNumber,
                      addr.street,
                      addr.regionCity,
                      addr.governate,
                      addr.country,
                    ]
                      .filter(Boolean)
                      .join(', ') || '—'}
                    <span className="mt-token-xs block text-token-xs text-foreground-muted">
                      {t('addressHint')}{' '}
                      <Link
                        className="text-brand underline-offset-2 hover:underline"
                        href={`/${locale}/settings/branches`}
                      >
                        {t('branchesLink')}
                      </Link>
                      {' · '}
                      <Link
                        className="text-brand underline-offset-2 hover:underline"
                        href={`/${locale}/settings/eta-credentials`}
                      >
                        {t('etaLink')}
                      </Link>
                    </span>
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>

          <div className="border-t border-border pt-token-md">
            <h2 className="m-0 text-token-md font-semibold text-foreground">{t('logo')}</h2>
            <p className="mt-token-xs text-token-sm text-foreground-muted">{t('logoHelp')}</p>

            {logoUrl ? (
              <img
                src={logoUrl}
                alt={t('logoPreviewAlt')}
                className="mt-token-md max-h-24 max-w-xs object-contain"
              />
            ) : (
              <p className="mt-token-md text-token-sm text-foreground-muted">{t('noLogo')}</p>
            )}

            <div className="mt-token-md flex flex-wrap gap-token-sm">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="sr-only"
                disabled={busy}
                onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                {logoUrl ? t('replace') : t('upload')}
              </Button>
              {logoUrl ? (
                <Button type="button" variant="secondary" disabled={busy} onClick={() => void onRemove()}>
                  {t('remove')}
                </Button>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
