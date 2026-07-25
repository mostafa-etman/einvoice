'use client';

import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  createPairingCode,
  listDevices,
  unpairDevice,
  type PairingCodeCreated,
} from '@/lib/api/devices';
import { ApiError } from '@/lib/api/client';
import { useTenant } from '@/lib/tenant-provider';

export default function DevicesPage() {
  const t = useTranslations('devices');
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const [freshCode, setFreshCode] = useState<PairingCodeCreated | null>(null);

  const query = useQuery({
    queryKey: ['devices', tenantId],
    queryFn: async () => {
      const res = await listDevices();
      return res.items;
    },
    enabled: !!tenantId,
  });

  const createCode = useMutation({
    mutationFn: createPairingCode,
    onSuccess: (data) => {
      setFreshCode(data);
    },
  });

  const unpair = useMutation({
    mutationFn: (id: string) => unpairDevice(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['devices', tenantId] });
    },
  });

  const forbidden =
    (query.error instanceof ApiError && query.error.status === 403) ||
    (createCode.error instanceof ApiError && createCode.error.status === 403);

  return (
    <section>
      <h1 className="font-display text-token-xl">{t('title')}</h1>
      <p className="mt-token-sm text-token-md text-foreground/70">{t('intro')}</p>
      {forbidden ? (
        <p className="mt-token-md text-token-sm text-red-700">{t('forbidden')}</p>
      ) : null}

      <div className="mt-token-lg">
        <button
          type="button"
          disabled={createCode.isPending}
          className="rounded bg-brand px-token-md py-token-sm text-token-sm text-white disabled:opacity-60"
          onClick={() => createCode.mutate()}
        >
          {t('createPairingCode')}
        </button>
      </div>

      {freshCode ? (
        <div className="mt-token-md rounded border border-border bg-surface p-token-md">
          <p className="text-token-sm text-foreground/70">{t('pairingCodeOnce')}</p>
          <p className="mt-token-sm font-mono text-token-lg break-all">{freshCode.code}</p>
          <p className="mt-token-xs text-token-sm text-foreground/60">
            {t('expiresAt')}: {new Date(freshCode.expiresAt).toLocaleString()}
          </p>
        </div>
      ) : null}

      <ul className="mt-token-xl space-y-token-sm">
        {(query.data ?? []).map((d) => (
          <li
            key={d.id}
            className="flex flex-wrap items-center justify-between gap-token-md border-b border-border py-token-sm text-token-sm"
          >
            <div>
              <span className="font-medium">{d.label}</span>
              <span className="text-foreground/60">
                {' '}
                · {t('status')}: {d.status}
              </span>
              <span className="block text-foreground/60">
                {t('lastSeen')}:{' '}
                {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : t('never')}
              </span>
              <span className="block text-foreground/60">
                {t('pairedAt')}: {new Date(d.pairedAt).toLocaleString()}
              </span>
            </div>
            {d.status !== 'REVOKED' ? (
              <button
                type="button"
                disabled={unpair.isPending}
                className="rounded border border-border px-token-sm py-token-xs hover:bg-brand-muted disabled:opacity-60"
                onClick={() => unpair.mutate(d.id)}
              >
                {t('unpair')}
              </button>
            ) : null}
          </li>
        ))}
        {!query.data?.length && !query.isLoading ? (
          <li className="text-token-sm text-foreground/60">{t('empty')}</li>
        ) : null}
      </ul>
    </section>
  );
}
