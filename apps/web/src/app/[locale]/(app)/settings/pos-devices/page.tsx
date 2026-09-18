'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { listBranches } from '@/lib/api/branches';
import { listDevices } from '@/lib/api/devices';
import {
  createPosDevice,
  listPosDevices,
  updatePosDevice,
  type PosDevice,
  type PosDeviceStatus,
} from '@/lib/api/pos-devices';
import { useTenant } from '@/lib/tenant-provider';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsPageHeader } from '../_components/settings-page-header';
import { QueryErrorCard } from '@/components/ui/query-error-card';
import { useMutationToast } from '@/components/ui/use-mutation-toast';

const createSchema = z.object({
  branchId: z.string().min(1),
  label: z.string().optional(),
  serialNumber: z.string().min(1),
  osVersion: z.string().min(1),
  modelFramework: z.string().min(1),
  preSharedKey: z.string().min(1),
  signingDeviceId: z.string().optional(),
});

type CreateValues = z.infer<typeof createSchema>;

const editSchema = z.object({
  label: z.string().optional(),
  serialNumber: z.string().min(1),
  osVersion: z.string().min(1),
  modelFramework: z.string().min(1),
  preSharedKey: z.string().optional(),
  signingDeviceId: z.string().optional(),
  status: z.enum(['ACTIVE', 'RETIRED', 'PERMANENTLY_RETIRED']),
});

type EditValues = z.infer<typeof editSchema>;

function statusVariant(status: PosDeviceStatus): BadgeVariant {
  if (status === 'ACTIVE') return 'success';
  if (status === 'PERMANENTLY_RETIRED') return 'danger';
  return 'warning';
}

function PosDevicesFallback() {
  return (
    <div className="space-y-token-lg">
      <SettingsPageHeader title="POS" />
      <Card aria-busy="true">
        <Skeleton className="mb-token-sm" />
        <Skeleton className="w-2/3" />
      </Card>
    </div>
  );
}

export default function PosDevicesSettingsPage() {
  return (
    <Suspense fallback={<PosDevicesFallback />}>
      <PosDevicesSettingsInner />
    </Suspense>
  );
}

function PosDevicesSettingsInner() {
  const t = useTranslations('settingsPosDevices');
  const tRetry = useTranslations('common.actions');
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const toast = useMutationToast();
  const params = useSearchParams();
  const branchFilter = params.get('branchId') ?? '';
  const [error, setError] = useState<string | null>(null);

  const branches = useQuery({
    queryKey: ['branches', tenantId],
    queryFn: listBranches,
    enabled: !!tenantId,
  });
  const devices = useQuery({
    queryKey: ['pos-devices', tenantId, branchFilter || 'all'],
    queryFn: () => listPosDevices(branchFilter || undefined),
    enabled: !!tenantId,
  });
  const signing = useQuery({
    queryKey: ['devices', tenantId],
    queryFn: async () => (await listDevices()).items,
    enabled: !!tenantId,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { branchId: branchFilter, signingDeviceId: '' },
  });

  useEffect(() => {
    const next = branchFilter || branches.data?.[0]?.id || '';
    if (next) reset((current) => ({ ...current, branchId: current.branchId || next }));
  }, [branchFilter, branches.data, reset]);

  const create = useMutation({
    mutationFn: (values: CreateValues) =>
      createPosDevice({
        branchId: values.branchId,
        label: values.label,
        serialNumber: values.serialNumber,
        osVersion: values.osVersion,
        modelFramework: values.modelFramework,
        preSharedKey: values.preSharedKey,
        signingDeviceId: values.signingDeviceId || null,
      }),
    onSuccess: async () => {
      setError(null);
      reset({
        branchId: branchFilter || branches.data?.[0]?.id || '',
        label: '',
        serialNumber: '',
        osVersion: '',
        modelFramework: '',
        preSharedKey: '',
        signingDeviceId: '',
      });
      await qc.invalidateQueries({ queryKey: ['pos-devices', tenantId] });
      toast.created();
    },
    onError: (e: Error) => {
      setError(e.message);
      toast.error(e);
    },
  });

  const pairedAgents = useMemo(
    () => (signing.data ?? []).filter((d) => d.status.toUpperCase() === 'PAIRED'),
    [signing.data],
  );
  const branchName = (id: string) =>
    branches.data?.find((b) => b.id === id)?.name ?? id;

  return (
    <div className="space-y-token-lg">
      <SettingsPageHeader title={t('title')} subtitle={t('intro')} />
      <p className="text-token-sm text-foreground-muted">{t('b2cSelfService')}</p>

      <Card>
        <form
          id="pos-create-form"
          className="space-y-token-md"
          onSubmit={handleSubmit((v) => create.mutateAsync(v))}
        >
          <div className="grid gap-token-md sm:grid-cols-2 lg:grid-cols-3">
            <Select
              label={t('branch')}
              error={errors.branchId ? t('required') : undefined}
              {...register('branchId')}
            >
              <option value="">{t('branch')}</option>
              {(branches.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
            <Input label={t('label')} {...register('label')} />
            <Input
              label={t('serialNumber')}
              dir="ltr"
              error={errors.serialNumber ? t('required') : undefined}
              {...register('serialNumber')}
            />
            <Input
              label={t('osVersion')}
              dir="ltr"
              error={errors.osVersion ? t('required') : undefined}
              {...register('osVersion')}
            />
            <Input
              label={t('modelFramework')}
              dir="ltr"
              error={errors.modelFramework ? t('required') : undefined}
              {...register('modelFramework')}
            />
            <Input
              type="password"
              autoComplete="new-password"
              label={t('preSharedKey')}
              hint={t('preSharedKeyHelp')}
              error={errors.preSharedKey ? t('required') : undefined}
              {...register('preSharedKey')}
            />
            <Select
              label={t('signingDevice')}
              hint={t('signingDeviceHelp')}
              {...register('signingDeviceId')}
            >
              <option value="">{t('signingDeviceNone')}</option>
              {pairedAgents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </Select>
          </div>
          {error ? (
            <p className="text-token-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={isSubmitting}>
            {t('create')}
          </Button>
        </form>
      </Card>

      {devices.isError ? (
        <QueryErrorCard
          message={
            devices.error instanceof Error ? devices.error.message : tRetry('retry')
          }
          retryLabel={tRetry('retry')}
          onRetry={() => void devices.refetch()}
        />
      ) : devices.isLoading ? (
        <Card aria-busy="true">
          <Skeleton className="mb-token-sm" />
          <Skeleton className="w-2/3" />
        </Card>
      ) : !devices.data?.length ? (
        <EmptyState
          title={t('empty')}
          action={{
            label: t('create'),
            onClick: () =>
              document.getElementById('pos-create-form')?.scrollIntoView({
                behavior: 'smooth',
              }),
          }}
        />
      ) : (
        <ul className="m-0 list-none space-y-token-sm p-0">
          {devices.data.map((row) => (
            <li key={row.id}>
              <PosDeviceCard
                device={row}
                branchName={branchName(row.branchId)}
                pairedAgents={pairedAgents.map((d) => ({ id: d.id, label: d.label }))}
                onSaved={() =>
                  qc.invalidateQueries({ queryKey: ['pos-devices', tenantId] })
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PosDeviceCard({
  device,
  branchName,
  pairedAgents,
  onSaved,
}: {
  device: PosDevice;
  branchName: string;
  pairedAgents: { id: string; label: string }[];
  onSaved: () => Promise<unknown> | void;
}) {
  const t = useTranslations('settingsPosDevices');
  const toast = useMutationToast();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      label: device.label,
      serialNumber: device.serialNumber,
      osVersion: device.osVersion,
      modelFramework: device.modelFramework,
      preSharedKey: '',
      signingDeviceId: device.signingDeviceId ?? '',
      status: device.status,
    },
  });

  const serialLocked = Boolean(device.lastReceiptUuid);
  const permanentlyRetired = device.status === 'PERMANENTLY_RETIRED';

  return (
    <Card className="text-token-sm">
      <div className="flex flex-wrap items-center gap-token-xs">
        <span className="font-medium">{device.label}</span>
        <span className="font-en text-foreground-muted" dir="ltr">
          {device.serialNumber}
        </span>
        <Badge variant="info">{branchName}</Badge>
        <Badge variant={statusVariant(device.status)}>
          {device.status === 'ACTIVE'
            ? t('statusActive')
            : device.status === 'RETIRED'
              ? t('statusRetired')
              : t('statusPermanentlyRetired')}
        </Badge>
        {device.hasPreSharedKey ? (
          <span className="text-foreground-muted">{t('secretMasked')}</span>
        ) : null}
        {!permanentlyRetired ? (
          <Button
            type="button"
            variant="link"
            className="ms-auto"
            onClick={() => setEditing(!editing)}
          >
            {editing ? t('cancel') : t('edit')}
          </Button>
        ) : null}
      </div>
      <p className="mt-token-xs font-en text-token-xs text-foreground-muted" dir="ltr">
        {t('lastReceiptUuid')}:{' '}
        {device.lastReceiptUuid || t('lastReceiptEmpty')}
      </p>
      {editing ? (
        <form
          className="mt-token-sm space-y-token-sm"
          onSubmit={handleSubmit(async (values) => {
            try {
              setError(null);
              await updatePosDevice(device.id, {
                label: values.label,
                serialNumber: serialLocked ? undefined : values.serialNumber,
                osVersion: values.osVersion,
                modelFramework: values.modelFramework,
                preSharedKey: values.preSharedKey || undefined,
                signingDeviceId: values.signingDeviceId || null,
                status: values.status,
              });
              toast.saved();
              setEditing(false);
              await onSaved();
            } catch (e) {
              setError(e instanceof Error ? e.message : t('required'));
              toast.error(e);
            }
          })}
        >
          <div className="grid gap-token-sm sm:grid-cols-2 lg:grid-cols-3">
            <Input label={t('label')} {...register('label')} />
            <Input
              label={t('serialNumber')}
              dir="ltr"
              disabled={serialLocked}
              error={errors.serialNumber ? t('required') : undefined}
              {...register('serialNumber')}
            />
            <Input
              label={t('osVersion')}
              dir="ltr"
              error={errors.osVersion ? t('required') : undefined}
              {...register('osVersion')}
            />
            <Input
              label={t('modelFramework')}
              dir="ltr"
              error={errors.modelFramework ? t('required') : undefined}
              {...register('modelFramework')}
            />
            <Input
              type="password"
              autoComplete="new-password"
              label={t('preSharedKeyUpdate')}
              {...register('preSharedKey')}
            />
            <Select label={t('signingDevice')} {...register('signingDeviceId')}>
              <option value="">{t('signingDeviceNone')}</option>
              {pairedAgents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </Select>
            <Select label={t('status')} {...register('status')}>
              <option value="ACTIVE">{t('statusActive')}</option>
              <option value="RETIRED">{t('statusRetired')}</option>
              <option value="PERMANENTLY_RETIRED">{t('statusPermanentlyRetired')}</option>
            </Select>
          </div>
          {error ? (
            <p className="text-token-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-token-sm">
            <Button type="submit" disabled={isSubmitting}>
              {t('save')}
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
