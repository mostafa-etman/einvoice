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

export default function CompanySettingsPage() {
  const t = useTranslations('settingsCompany');
  const locale = useLocale();
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const logoUrlRef = useRef<string | null>(null);

  const reload = async () => {
    const p = await getCompanyProfile();
    setProfile(p);
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
    reload().catch((e: Error) => setError(e.message));
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
    } catch (e) {
      setError(e instanceof Error ? e.message : t('uploadFailed'));
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
    } catch (e) {
      setError(e instanceof Error ? e.message : t('removeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const addr = profile?.defaultBranchAddress;

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="font-display text-token-xl">{t('title')}</h1>
      <p className="mt-token-sm text-token-md text-foreground/70">{t('intro')}</p>

      {error ? (
        <p
          role="alert"
          className="mt-token-md rounded border border-danger/40 bg-danger/10 px-token-md py-token-sm text-token-sm text-danger"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-token-lg space-y-token-md rounded border border-border bg-surface p-token-lg">
        <div>
          <h2 className="font-display text-token-lg">{t('companySummary')}</h2>
          <dl className="mt-token-sm space-y-token-xs text-token-sm">
            <div>
              <dt className="text-foreground/60">{t('workspaceName')}</dt>
              <dd>{profile?.workspaceName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-foreground/60">{t('legalName')}</dt>
              <dd>{profile?.legalName ?? t('legalNameMissing')}</dd>
            </div>
            <div>
              <dt className="text-foreground/60">{t('issuerType')}</dt>
              <dd>{profile?.issuerType ?? '—'}</dd>
            </div>
            {addr ? (
              <div>
                <dt className="text-foreground/60">{t('defaultAddress')}</dt>
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
                  <span className="mt-token-xs block text-token-xs text-foreground/60">
                    {t('addressHint')}{' '}
                    <Link
                      className="underline"
                      href={`/${locale}/settings/branches`}
                    >
                      {t('branchesLink')}
                    </Link>
                    {' · '}
                    <Link
                      className="underline"
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
          <h2 className="font-display text-token-lg">{t('logo')}</h2>
          <p className="mt-token-xs text-token-sm text-foreground/70">{t('logoHelp')}</p>

          {logoUrl ? (
            <img
              src={logoUrl}
              alt={t('logoPreviewAlt')}
              className="mt-token-md max-h-24 max-w-xs object-contain"
            />
          ) : (
            <p className="mt-token-md text-token-sm text-foreground/60">{t('noLogo')}</p>
          )}

          <div className="mt-token-md flex flex-wrap gap-token-sm">
            <label className="inline-flex cursor-pointer rounded bg-brand px-token-md py-token-xs text-token-sm text-white aria-disabled:opacity-50">
              {logoUrl ? t('replace') : t('upload')}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="sr-only"
                disabled={busy}
                onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
              />
            </label>
            {logoUrl ? (
              <button
                type="button"
                disabled={busy}
                className="rounded border border-border px-token-md py-token-xs text-token-sm disabled:opacity-50"
                onClick={() => void onRemove()}
              >
                {t('remove')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
