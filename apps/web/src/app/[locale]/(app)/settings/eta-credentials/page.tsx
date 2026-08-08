'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  getEtaCredentials,
  rotateEtaSecret,
  upsertEtaCredentials,
  type EtaEnvironment,
} from '@/lib/api/eta-credentials';
import { getEtaConnection, testEtaConnection } from '@/lib/api/eta';
import {
  clearSandboxData,
  getEtaEnvironment,
  goLive,
  switchEtaEnvironment,
} from '@/lib/api/eta-environment';
import { useTenant } from '@/lib/tenant-provider';

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

  const status = connection.data;
  const badge =
    active === 'PRODUCTION' ? t('badgeProduction') : t('badgeSandbox');

  return (
    <section>
      <div className="flex flex-wrap items-center gap-token-md">
        <h1 className="font-display text-token-xl">{t('title')}</h1>
        <span
          className={`rounded px-token-sm py-token-xs text-token-xs font-semibold tracking-wide ${
            active === 'PRODUCTION'
              ? 'bg-danger/15 text-danger'
              : 'bg-brand-muted text-brand'
          }`}
          data-testid="eta-env-badge"
        >
          {badge}
        </span>
      </div>

      <div className="mt-token-lg max-w-2xl border-b border-border pb-token-lg">
        <h2 className="text-token-lg">{t('activeEnvironment')}</h2>
        <p className="mt-token-xs text-token-sm text-foreground/70">
          {active === 'PRODUCTION' ? t('production') : t('sandbox')}
        </p>
        {envStatus.data ? (
          <dl className="mt-token-sm grid gap-token-xs text-token-sm">
            <div>
              <dt className="inline text-foreground/60">{t('sandboxDocCount')}: </dt>
              <dd className="inline">{envStatus.data.sandboxDocumentCount}</dd>
            </div>
            <div>
              <dt className="inline text-foreground/60">
                {t('productionDocCount')}:{' '}
              </dt>
              <dd className="inline">{envStatus.data.productionDocumentCount}</dd>
            </div>
            <div>
              <dt className="inline text-foreground/60">
                {t('productionProtected')}:{' '}
              </dt>
              <dd className="inline">
                {envStatus.data.productionProtectedCount}
              </dd>
            </div>
            <div>
              <dt className="inline text-foreground/60">
                {envStatus.data.productionValidatedAt
                  ? t('productionValidated')
                  : t('productionNotValidated')}
              </dt>
            </div>
          </dl>
        ) : null}
        <div className="mt-token-md flex flex-wrap gap-token-sm">
          {active !== 'SANDBOX' ? (
            <button
              type="button"
              className="rounded border border-border px-token-md py-token-sm text-token-sm"
              onClick={() => switchEnv.mutate('SANDBOX')}
              disabled={switchEnv.isPending}
            >
              {t('switchToSandbox')}
            </button>
          ) : null}
          {active !== 'PRODUCTION' ? (
            <button
              type="button"
              className="rounded bg-brand px-token-md py-token-sm text-token-sm text-white disabled:opacity-50"
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
            </button>
          ) : null}
        </div>
        {!envStatus.data?.canSwitchToProduction && active === 'SANDBOX' ? (
          <p className="mt-token-sm text-token-xs text-foreground/70">
            {t('productionGateHint')}
          </p>
        ) : null}
      </div>

      <div className="mt-token-lg max-w-lg border-b border-border pb-token-lg">
        <h2 className="text-token-lg">{t('connectionStatus')}</h2>
        {status?.setupRequired ? (
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
              <dt className="inline text-foreground/60">{t('connectionStatus')}: </dt>
              <dd className="inline">
                {status?.connected ? t('connected') : t('disconnected')}
              </dd>
            </div>
            {status?.environment ? (
              <div>
                <dt className="inline text-foreground/60">{t('environment')}: </dt>
                <dd className="inline">{status.environment}</dd>
              </div>
            ) : null}
            {status?.expiresAt ? (
              <div>
                <dt className="inline text-foreground/60">{t('expiresAt')}: </dt>
                <dd className="inline">{status.expiresAt}</dd>
              </div>
            ) : null}
            {status?.lastTestMessage ? (
              <div>
                <dt className="inline text-foreground/60">{t('lastTest')}: </dt>
                <dd className="inline">{status.lastTestMessage}</dd>
              </div>
            ) : null}
          </dl>
        )}
      </div>

      <div className="mt-token-lg">
        <label className="text-token-sm font-medium">
          {t('editingCredentialsFor')}
          <select
            className="ms-token-sm rounded border border-border bg-surface px-token-sm py-token-xs"
            value={credEnv}
            onChange={(e) => setCredEnv(e.target.value as EtaEnvironment)}
            data-testid="eta-cred-env-select"
          >
            <option value="SANDBOX">{t('sandbox')}</option>
            <option value="PRODUCTION">{t('production')}</option>
          </select>
        </label>
      </div>

      {query.data && !query.data.issuerIdentityComplete ? (
        <p className="mt-token-md text-token-sm text-danger" role="status">
          {t('issuerIdentityIncomplete')}
        </p>
      ) : query.data?.issuerIdentityComplete ? (
        <p className="mt-token-md text-token-sm text-foreground/60">
          {t('issuerIdentityComplete')}
        </p>
      ) : null}

      {query.data?.hasClientSecret ? (
        <p className="mt-token-md text-token-sm">
          {t('secretMasked')}: {query.data.clientSecretMasked}
          {query.data.lastValidatedAt
            ? ` · ${t('lastTest')}: ${query.data.lastValidatedAt}`
            : null}
        </p>
      ) : null}

      <form
        className="mt-token-lg flex max-w-lg flex-col gap-token-md"
        onSubmit={handleSubmit((v) => save.mutateAsync(v))}
      >
        <fieldset className="rounded border border-border p-token-md">
          <legend className="px-token-xs text-token-sm font-medium">
            {t('companyIdentity')}
          </legend>
          <p className="mb-token-sm text-token-xs text-foreground/70">
            {t('taxpayerLegalNameHelp')}
          </p>
          <label className="block text-token-sm">
            {t('taxpayerLegalName')} *
            <input
              className="mt-token-xs block w-full rounded border border-border bg-surface px-token-sm py-token-sm"
              {...register('taxpayerLegalName')}
            />
            {errors.taxpayerLegalName ? (
              <span className="text-token-xs text-danger">
                {t('issuerIdentityIncomplete')}
              </span>
            ) : null}
          </label>
          <label className="mt-token-sm block text-token-sm">
            {t('registrationNumber')} *
            <input
              className="mt-token-xs block w-full rounded border border-border bg-surface px-token-sm py-token-sm"
              {...register('registrationNumber')}
            />
            {errors.registrationNumber ? (
              <span className="text-token-xs text-danger">{t('fieldRequired')}</span>
            ) : null}
          </label>
          <label className="mt-token-sm block text-token-sm">
            {t('issuerType')}
            <select
              className="mt-token-xs block w-full rounded border border-border bg-surface px-token-sm py-token-sm"
              {...register('issuerType')}
            >
              <option value="B">{t('issuerTypeB')}</option>
              <option value="P">{t('issuerTypeP')}</option>
              <option value="F">{t('issuerTypeF')}</option>
            </select>
          </label>
        </fieldset>

        <label className="text-token-sm">
          {t('clientId')}
          <input
            className="mt-token-xs block w-full rounded border border-border bg-surface px-token-sm py-token-sm"
            {...register('clientId')}
          />
        </label>
        <label className="text-token-sm">
          {t('clientSecret')}
          <input
            type="password"
            autoComplete="new-password"
            className="mt-token-xs block w-full rounded border border-border bg-surface px-token-sm py-token-sm"
            {...register('clientSecret')}
          />
        </label>
        <label className="text-token-sm">
          {t('activityCode')}
          <input
            className="mt-token-xs block w-full rounded border border-border bg-surface px-token-sm py-token-sm"
            {...register('activityCode')}
          />
        </label>
        <label className="flex items-center gap-token-xs text-token-sm">
          <input type="checkbox" {...register('isIntermediary')} />
          {t('intermediary')}
        </label>
        <label className="text-token-sm">
          {t('onBehalfOf')}
          <input
            className="mt-token-xs block w-full rounded border border-border bg-surface px-token-sm py-token-sm"
            {...register('onBehalfOfRegistrationNumber')}
          />
        </label>
        <div className="flex flex-wrap gap-token-md">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded bg-brand px-token-md py-token-sm text-token-sm text-white"
          >
            {t('save')}
          </button>
          <button
            type="button"
            className="rounded border border-border px-token-md py-token-sm text-token-sm"
            onClick={() => setRotateOpen(true)}
          >
            {t('rotate')}
          </button>
          <button
            type="button"
            className="rounded border border-border px-token-md py-token-sm text-token-sm"
            onClick={() => test.mutate()}
            disabled={test.isPending}
          >
            {t('testConnection')}
          </button>
        </div>
      </form>

      {testMsg ? <p className="mt-token-md text-token-sm">{testMsg}</p> : null}

      {rotateOpen ? (
        <div className="mt-token-lg max-w-md border border-border p-token-md">
          <h2 className="text-token-lg">{t('rotateTitle')}</h2>
          <label className="mt-token-sm block text-token-sm">
            {t('newSecret')}
            <input
              type="password"
              className="mt-token-xs block w-full rounded border border-border bg-surface px-token-sm py-token-sm"
              value={newSecret}
              onChange={(e) => setNewSecret(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="mt-token-md rounded bg-brand px-token-md py-token-sm text-token-sm text-white"
            onClick={() => rotate.mutate()}
            disabled={!newSecret}
          >
            {t('rotate')}
          </button>
        </div>
      ) : null}

      <div className="mt-token-xl max-w-lg border-t border-border pt-token-lg">
        <h2 className="text-token-lg">{t('goLiveTitle')}</h2>
        <p className="mt-token-sm text-token-sm text-foreground/70">
          {t('goLiveIntro')}
        </p>
        <label className="mt-token-md flex items-center gap-token-xs text-token-sm">
          <input
            type="checkbox"
            checked={goLiveClear}
            onChange={(e) => setGoLiveClear(e.target.checked)}
          />
          {t('goLiveClear')}
        </label>
        {goLiveClear ? (
          <label className="mt-token-sm block text-token-sm">
            {t('clearSandboxConfirmLabel')}
            <input
              className="mt-token-xs block w-full rounded border border-border bg-surface px-token-sm py-token-sm"
              value={goLiveConfirm}
              onChange={(e) => setGoLiveConfirm(e.target.value)}
              data-testid="go-live-confirm"
            />
          </label>
        ) : null}
        <button
          type="button"
          className="mt-token-md rounded bg-brand px-token-md py-token-sm text-token-sm text-white disabled:opacity-50"
          onClick={() => live.mutate()}
          disabled={
            live.isPending ||
            active === 'PRODUCTION' ||
            !envStatus.data?.canSwitchToProduction ||
            (goLiveClear && !goLiveConfirm.trim())
          }
        >
          {t('goLiveConfirm')}
        </button>
      </div>

      <div className="mt-token-xl max-w-lg border-t border-border pt-token-lg">
        <h2 className="text-token-lg text-danger">{t('clearSandboxTitle')}</h2>
        <p className="mt-token-sm text-token-sm text-foreground/70">
          {t('clearSandboxIntro')}
        </p>
        <p className="mt-token-xs text-token-sm font-medium text-danger">
          {t('clearSandboxIrreversible')}
        </p>
        <label className="mt-token-md block text-token-sm">
          {t('clearSandboxConfirmLabel')}
          <input
            className="mt-token-xs block w-full rounded border border-border bg-surface px-token-sm py-token-sm"
            value={clearConfirm}
            onChange={(e) => setClearConfirm(e.target.value)}
            data-testid="clear-sandbox-confirm"
          />
        </label>
        <button
          type="button"
          className="mt-token-md rounded border border-danger px-token-md py-token-sm text-token-sm text-danger disabled:opacity-50"
          onClick={() => clearSandbox.mutate()}
          disabled={clearSandbox.isPending || !clearConfirm.trim()}
        >
          {t('clearSandboxButton')}
        </button>
      </div>

      {actionMsg ? (
        <p className="mt-token-md text-token-sm" role="status">
          {actionMsg}
        </p>
      ) : null}
    </section>
  );
}
