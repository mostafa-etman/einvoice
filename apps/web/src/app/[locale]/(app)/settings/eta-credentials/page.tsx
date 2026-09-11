'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  dismissEtaSetupPrompt,
  getEtaCredentials,
  getEtaSetupStatus,
  rotateEtaSecret,
  upsertEtaCredentials,
  type EtaEnvironment,
} from '@/lib/api/eta-credentials';
import { trialAlreadyUsedMessage } from '@/lib/api/trial-already-used';
import { getEtaConnection, testEtaConnection } from '@/lib/api/eta';
import {
  clearSandboxData,
  getEtaEnvironment,
  goLive,
  switchEtaEnvironment,
} from '@/lib/api/eta-environment';
import { toTutorialEmbedUrl } from '@/lib/tutorial-embed';
import { useTenant } from '@/lib/tenant-provider';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsPageHeader } from '../_components/settings-page-header';

const schema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
  registrationNumber: z.string().min(1),
  taxpayerLegalName: z.string().min(1),
  issuerType: z.enum(['B', 'P', 'F']),
  activityCode: z.string().optional(),
  isIntermediary: z.boolean().optional(),
  onBehalfOfRegistrationNumber: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function EtaCredentialsPage() {
  const t = useTranslations('settingsEta');
  const locale = useLocale();
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const [credEnv, setCredEnv] = useState<EtaEnvironment>('SANDBOX');
  const [rotateOpen, setRotateOpen] = useState(false);
  const [newSecret, setNewSecret] = useState('');
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState('');
  const [goLiveClear, setGoLiveClear] = useState(false);
  const [goLiveConfirm, setGoLiveConfirm] = useState('');
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const envStatus = useQuery({
    queryKey: ['eta-environment', tenantId],
    queryFn: () => getEtaEnvironment(),
    enabled: !!tenantId,
  });

  const active = envStatus.data?.activeEnvironment ?? 'SANDBOX';

  const query = useQuery({
    queryKey: ['eta-credentials', tenantId, credEnv],
    queryFn: () => getEtaCredentials({ environment: credEnv }),
    enabled: !!tenantId,
  });

  const connection = useQuery({
    queryKey: ['eta-connection', tenantId],
    queryFn: () => getEtaConnection(),
    enabled: !!tenantId,
  });

  const setupQuery = useQuery({
    queryKey: ['eta-setup', tenantId],
    queryFn: getEtaSetupStatus,
    enabled: !!tenantId,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: {
      clientId: query.data?.clientId ?? '',
      registrationNumber: query.data?.registrationNumber ?? '',
      taxpayerLegalName: query.data?.taxpayerLegalName ?? '',
      issuerType: (query.data?.issuerType as 'B' | 'P' | 'F') ?? 'B',
      activityCode: query.data?.activityCode ?? '',
      isIntermediary: query.data?.isIntermediary ?? false,
      onBehalfOfRegistrationNumber:
        query.data?.onBehalfOfRegistrationNumber ?? '',
      clientSecret: '',
    },
  });

  const invalidateAll = async () => {
    await qc.invalidateQueries({ queryKey: ['eta-credentials', tenantId] });
    await qc.invalidateQueries({ queryKey: ['eta-connection', tenantId] });
    await qc.invalidateQueries({ queryKey: ['eta-environment', tenantId] });
    await qc.invalidateQueries({ queryKey: ['eta-setup', tenantId] });
  };

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      upsertEtaCredentials({ ...values, environment: credEnv }),
    onSuccess: async () => {
      reset({ clientSecret: '' });
      await invalidateAll();
    },
  });

  const rotate = useMutation({
    mutationFn: () =>
      rotateEtaSecret(newSecret, { environment: credEnv }),
    onSuccess: async () => {
      setRotateOpen(false);
      setNewSecret('');
      await invalidateAll();
    },
  });

  const test = useMutation({
    mutationFn: () => testEtaConnection({ environment: credEnv }),
    onSuccess: async (res) => {
      setTestMsg(res.connected ? t('testSuccess') : t('testFailure'));
      await invalidateAll();
    },
    onError: () => setTestMsg(t('testFailure')),
  });

  const switchEnv = useMutation({
    mutationFn: (environment: EtaEnvironment) =>
      switchEtaEnvironment(environment),
    onSuccess: async () => {
      setActionMsg(null);
      await invalidateAll();
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : t('testFailure');
      setActionMsg(msg);
    },
  });

  const clearSandbox = useMutation({
    mutationFn: () => clearSandboxData(clearConfirm),
    onSuccess: async (res) => {
      setClearConfirm('');
      setActionMsg(
        `${t('clearSandboxSuccess')}: ${res.deletedDocuments} docs`,
      );
      await invalidateAll();
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : t('testFailure');
      setActionMsg(msg);
    },
  });

  const live = useMutation({
    mutationFn: () =>
      goLive({
        clearSandboxData: goLiveClear,
        confirmation: goLiveClear ? goLiveConfirm : undefined,
      }),
    onSuccess: async () => {
      setGoLiveConfirm('');
      setGoLiveClear(false);
      setActionMsg(t('goLiveConfirm'));
      await invalidateAll();
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : t('testFailure');
      setActionMsg(msg);
    },
  });

  const dismissPrompt = useMutation({
    mutationFn: dismissEtaSetupPrompt,
    onSuccess: async (data) => {
      qc.setQueryData(['eta-setup', tenantId], data);
    },
  });

  const status = connection.data;
  const badge =
    active === 'PRODUCTION' ? t('badgeProduction') : t('badgeSandbox');
  const embedUrl = toTutorialEmbedUrl(setupQuery.data?.tutorialVideoUrl ?? null);
  const showFirstSetup = Boolean(setupQuery.data?.promptEtaSetup);

  return (
    <div className="space-y-token-lg">
      {showFirstSetup ? (
        <Card className="flex flex-col gap-token-sm border-brand bg-brand-muted sm:flex-row sm:items-center sm:justify-between">
          <p className="text-token-sm">{t('firstSetupHint')}</p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => dismissPrompt.mutate()}
            disabled={dismissPrompt.isPending}
          >
            {t('dontShowAgain')}
          </Button>
        </Card>
      ) : null}

      <div className="flex flex-col gap-token-xl lg:flex-row lg:items-start">
        {embedUrl ? (
          <aside className="w-full max-w-xl shrink-0 lg:max-w-md">
            <p className="mb-token-sm text-token-sm font-medium">{t('tutorialCaption')}</p>
            <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-surface">
              <iframe
                src={embedUrl}
                title={t('tutorialCaption')}
                className="absolute inset-0 h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          </aside>
        ) : null}

        <div className="min-w-0 flex-1 space-y-token-lg">
          <SettingsPageHeader
            title={t('title')}
            actions={
              <Badge
                variant={active === 'PRODUCTION' ? 'danger' : 'info'}
                data-testid="eta-env-badge"
              >
                {badge}
              </Badge>
            }
          />

          <Card>
            <h2 className="m-0 text-token-md font-semibold text-foreground">
              {t('activeEnvironment')}
            </h2>
            <p className="mt-token-xs text-token-sm text-foreground-muted">
              {active === 'PRODUCTION' ? t('production') : t('sandbox')}
            </p>
            {envStatus.isLoading ? (
              <div className="mt-token-sm" aria-busy="true">
                <Skeleton />
              </div>
            ) : envStatus.data ? (
              <dl className="mt-token-sm grid gap-token-xs text-token-sm">
                <div>
                  <dt className="inline text-foreground-muted">{t('sandboxDocCount')}: </dt>
                  <dd className="inline">{envStatus.data.sandboxDocumentCount}</dd>
                </div>
                <div>
                  <dt className="inline text-foreground-muted">
                    {t('productionDocCount')}:{' '}
                  </dt>
                  <dd className="inline">{envStatus.data.productionDocumentCount}</dd>
                </div>
                <div>
                  <dt className="inline text-foreground-muted">
                    {t('productionProtected')}:{' '}
                  </dt>
                  <dd className="inline">
                    {envStatus.data.productionProtectedCount}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-foreground-muted">
                    {envStatus.data.productionValidatedAt
                      ? t('productionValidated')
                      : t('productionNotValidated')}
                  </dt>
                </div>
              </dl>
            ) : null}
            <div className="mt-token-md flex flex-wrap gap-token-sm">
              {active !== 'SANDBOX' ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => switchEnv.mutate('SANDBOX')}
                  disabled={switchEnv.isPending}
                >
                  {t('switchToSandbox')}
                </Button>
              ) : null}
              {active !== 'PRODUCTION' ? (
                <Button
                  type="button"
                  onClick={() => switchEnv.mutate('PRODUCTION')}
                  disabled={
                    switchEnv.isPending || !envStatus.data?.canSwitchToProduction
                  }
                  title={
                    envStatus.data?.canSwitchToProduction
                      ? undefined
                      : t('productionGateHint')
                  }
                >
                  {t('switchToProduction')}
                </Button>
              ) : null}
            </div>
            {!envStatus.data?.canSwitchToProduction && active === 'SANDBOX' ? (
              <p className="mt-token-sm text-token-xs text-foreground-muted">
                {t('productionGateHint')}
              </p>
            ) : null}
          </Card>

          <Card>
            <h2 className="m-0 text-token-md font-semibold text-foreground">
              {t('connectionStatus')}
            </h2>
            {connection.isLoading ? (
              <div className="mt-token-sm" aria-busy="true">
                <Skeleton />
              </div>
            ) : status?.setupRequired ? (
              <p className="mt-token-sm text-token-sm">
                {t('setupRequired')}{' '}
                <Link
                  href={`/${locale}${status.settingsPath}`}
                  className="text-brand underline-offset-2 hover:underline"
                >
                  {t('setupLink')}
                </Link>
              </p>
            ) : (
              <dl className="mt-token-sm grid gap-token-xs text-token-sm">
                <div>
                  <dt className="inline text-foreground-muted">{t('connectionStatus')}: </dt>
                  <dd className="inline">
                    {status?.connected ? t('connected') : t('disconnected')}
                  </dd>
                </div>
                {status?.environment ? (
                  <div>
                    <dt className="inline text-foreground-muted">{t('environment')}: </dt>
                    <dd className="inline">{status.environment}</dd>
                  </div>
                ) : null}
                {status?.expiresAt ? (
                  <div>
                    <dt className="inline text-foreground-muted">{t('expiresAt')}: </dt>
                    <dd className="inline">{status.expiresAt}</dd>
                  </div>
                ) : null}
                {status?.lastTestMessage ? (
                  <div>
                    <dt className="inline text-foreground-muted">{t('lastTest')}: </dt>
                    <dd className="inline">{status.lastTestMessage}</dd>
                  </div>
                ) : null}
              </dl>
            )}
          </Card>

          <Card className="space-y-token-md">
            <Select
              label={t('editingCredentialsFor')}
              value={credEnv}
              onChange={(e) => setCredEnv(e.target.value as EtaEnvironment)}
              data-testid="eta-cred-env-select"
            >
              <option value="SANDBOX">{t('sandbox')}</option>
              <option value="PRODUCTION">{t('production')}</option>
            </Select>

            {query.isLoading && !query.data ? (
              <div aria-busy="true">
                <Skeleton className="mb-token-sm" />
                <Skeleton className="w-2/3" />
              </div>
            ) : null}

            {query.data && !query.data.issuerIdentityComplete ? (
              <p className="text-token-sm text-danger" role="status">
                {t('issuerIdentityIncomplete')}
              </p>
            ) : query.data?.issuerIdentityComplete ? (
              <p className="text-token-sm text-foreground-muted">
                {t('issuerIdentityComplete')}
              </p>
            ) : null}

            {query.data?.hasClientSecret ? (
              <p className="text-token-sm">
                {t('secretMasked')}: {query.data.clientSecretMasked}
                {query.data.lastValidatedAt
                  ? ` · ${t('lastTest')}: ${query.data.lastValidatedAt}`
                  : null}
              </p>
            ) : null}

            <form
              className="flex flex-col gap-token-md"
              onSubmit={handleSubmit((v) => save.mutateAsync(v))}
            >
              <fieldset className="rounded-lg border border-border p-token-md">
                <legend className="px-token-xs text-token-sm font-medium">
                  {t('companyIdentity')}
                </legend>
                <p className="mb-token-sm text-token-xs text-foreground-muted">
                  {t('taxpayerLegalNameHelp')}
                </p>
                <div className="space-y-token-sm">
                  <Input
                    label={`${t('taxpayerLegalName')} *`}
                    error={
                      errors.taxpayerLegalName
                        ? t('issuerIdentityIncomplete')
                        : undefined
                    }
                    {...register('taxpayerLegalName')}
                  />
                  <Input
                    label={`${t('registrationNumber')} *`}
                    error={
                      errors.registrationNumber ? t('fieldRequired') : undefined
                    }
                    {...register('registrationNumber')}
                  />
                  <Select label={t('issuerType')} {...register('issuerType')}>
                    <option value="B">{t('issuerTypeB')}</option>
                    <option value="P">{t('issuerTypeP')}</option>
                    <option value="F">{t('issuerTypeF')}</option>
                  </Select>
                </div>
              </fieldset>

              <Input label={t('clientId')} {...register('clientId')} />
              <Input
                type="password"
                autoComplete="new-password"
                label={t('clientSecret')}
                {...register('clientSecret')}
              />
              <Input label={t('activityCode')} {...register('activityCode')} />
              <Checkbox label={t('intermediary')} {...register('isIntermediary')} />
              <Input
                label={t('onBehalfOf')}
                {...register('onBehalfOfRegistrationNumber')}
              />
              <div className="flex flex-wrap gap-token-md">
                <Button type="submit" disabled={isSubmitting}>
                  {t('save')}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setRotateOpen(true)}>
                  {t('rotate')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => test.mutate()}
                  disabled={test.isPending}
                >
                  {t('testConnection')}
                </Button>
              </div>
              {save.isError ? (
                <p className="text-token-sm text-danger" role="alert">
                  {trialAlreadyUsedMessage(save.error, locale) ??
                    (save.error instanceof Error
                      ? save.error.message
                      : t('testFailure'))}
                </p>
              ) : null}
            </form>
          </Card>

          {testMsg ? <p className="text-token-sm" role="status">{testMsg}</p> : null}

          {rotateOpen ? (
            <Card>
              <h2 className="m-0 text-token-md font-semibold text-foreground">
                {t('rotateTitle')}
              </h2>
              <div className="mt-token-sm space-y-token-md">
                <Input
                  type="password"
                  label={t('newSecret')}
                  value={newSecret}
                  onChange={(e) => setNewSecret(e.target.value)}
                />
                <Button
                  type="button"
                  onClick={() => rotate.mutate()}
                  disabled={!newSecret}
                >
                  {t('rotate')}
                </Button>
              </div>
            </Card>
          ) : null}

          <Card className="border-warning">
            <h2 className="m-0 text-token-md font-semibold text-foreground">
              {t('goLiveTitle')}
            </h2>
            <p className="mt-token-sm text-token-sm text-foreground-muted">
              {t('goLiveIntro')}
            </p>
            <div className="mt-token-md">
              <Checkbox
                label={t('goLiveClear')}
                checked={goLiveClear}
                onChange={(e) => setGoLiveClear(e.target.checked)}
              />
            </div>
            {goLiveClear ? (
              <div className="mt-token-sm">
                <Input
                  label={t('clearSandboxConfirmLabel')}
                  value={goLiveConfirm}
                  onChange={(e) => setGoLiveConfirm(e.target.value)}
                  data-testid="go-live-confirm"
                />
              </div>
            ) : null}
            <div className="mt-token-md">
              <Button
                type="button"
                onClick={() => live.mutate()}
                disabled={
                  live.isPending ||
                  active === 'PRODUCTION' ||
                  !envStatus.data?.canSwitchToProduction ||
                  (goLiveClear && !goLiveConfirm.trim())
                }
              >
                {t('goLiveConfirm')}
              </Button>
            </div>
          </Card>

          <Card className="border-danger">
            <h2 className="m-0 text-token-md font-semibold text-danger">
              {t('clearSandboxTitle')}
            </h2>
            <p className="mt-token-sm text-token-sm text-foreground-muted">
              {t('clearSandboxIntro')}
            </p>
            <p className="mt-token-xs text-token-sm font-medium text-danger">
              {t('clearSandboxIrreversible')}
            </p>
            <div className="mt-token-md">
              <Input
                label={t('clearSandboxConfirmLabel')}
                value={clearConfirm}
                onChange={(e) => setClearConfirm(e.target.value)}
                data-testid="clear-sandbox-confirm"
              />
            </div>
            <div className="mt-token-md">
              <Button
                type="button"
                variant="danger"
                onClick={() => clearSandbox.mutate()}
                disabled={clearSandbox.isPending || !clearConfirm.trim()}
              >
                {t('clearSandboxButton')}
              </Button>
            </div>
          </Card>

          {actionMsg ? (
            <p className="text-token-sm" role="status">
              {actionMsg}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
