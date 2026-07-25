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
} from '@/lib/api/eta-credentials';
import { getEtaConnection, testEtaConnection } from '@/lib/api/eta';
import { useTenant } from '@/lib/tenant-provider';

const schema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
  registrationNumber: z.string().optional(),
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
  const [rotateOpen, setRotateOpen] = useState(false);
  const [newSecret, setNewSecret] = useState('');
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['eta-credentials', tenantId],
    queryFn: () => getEtaCredentials(),
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
    formState: { isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: {
      clientId: query.data?.clientId ?? '',
      registrationNumber: query.data?.registrationNumber ?? '',
      activityCode: query.data?.activityCode ?? '',
      isIntermediary: query.data?.isIntermediary ?? false,
      onBehalfOfRegistrationNumber:
        query.data?.onBehalfOfRegistrationNumber ?? '',
      clientSecret: '',
    },
  });

  const save = useMutation({
    mutationFn: (values: FormValues) => upsertEtaCredentials(values),
    onSuccess: async () => {
      reset({ clientSecret: '' });
      await qc.invalidateQueries({ queryKey: ['eta-credentials', tenantId] });
      await qc.invalidateQueries({ queryKey: ['eta-connection', tenantId] });
    },
  });

  const rotate = useMutation({
    mutationFn: () => rotateEtaSecret(newSecret),
    onSuccess: async () => {
      setRotateOpen(false);
      setNewSecret('');
      await qc.invalidateQueries({ queryKey: ['eta-credentials', tenantId] });
    },
  });

  const test = useMutation({
    mutationFn: () => testEtaConnection(),
    onSuccess: async (res) => {
      // Do not surface accessToken in the UI
      setTestMsg(res.connected ? t('testSuccess') : t('testFailure'));
      await qc.invalidateQueries({ queryKey: ['eta-connection', tenantId] });
    },
    onError: () => setTestMsg(t('testFailure')),
  });

  const status = connection.data;

  return (
    <section>
      <h1 className="font-display text-token-xl">{t('title')}</h1>

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
            {status?.scope ? (
              <div>
                <dt className="inline text-foreground/60">{t('scope')}: </dt>
                <dd className="inline">{status.scope}</dd>
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

      {query.data?.hasClientSecret ? (
        <p className="mt-token-md text-token-sm">
          {t('secretMasked')}: {query.data.clientSecretMasked}
        </p>
      ) : null}

      <form
        className="mt-token-lg flex max-w-lg flex-col gap-token-md"
        onSubmit={handleSubmit((v) => save.mutateAsync(v))}
      >
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
          {t('registrationNumber')}
          <input
            className="mt-token-xs block w-full rounded border border-border bg-surface px-token-sm py-token-sm"
            {...register('registrationNumber')}
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
    </section>
  );
}
