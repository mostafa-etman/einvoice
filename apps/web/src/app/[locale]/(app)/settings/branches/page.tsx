'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  createBranch,
  listBranches,
  updateBranch,
  type Branch,
} from '@/lib/api/branches';
import { useTenant } from '@/lib/tenant-provider';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsPageHeader } from '../_components/settings-page-header';
import { QueryErrorCard } from '@/components/ui/query-error-card';
import { useMutationToast } from '@/components/ui/use-mutation-toast';

const addressSchema = z.object({
  country: z.string().min(1),
  governate: z.string().min(1),
  regionCity: z.string().min(1),
  street: z.string().min(1),
  buildingNumber: z.string().min(1),
  postalCode: z.string().optional(),
  floor: z.string().optional(),
  room: z.string().optional(),
  landmark: z.string().optional(),
  additionalInformation: z.string().optional(),
});

const schema = z.object({
  name: z.string().min(1),
  etaBranchCode: z.string().optional(),
  activityCode: z.string().optional(),
  isDefault: z.boolean().optional(),
  address: addressSchema,
});

type FormValues = z.infer<typeof schema>;

const REQUIRED_ADDRESS_FIELDS = [
  'governate',
  'regionCity',
  'street',
  'buildingNumber',
] as const;

const OPTIONAL_ADDRESS_FIELDS = [
  'postalCode',
  'floor',
  'room',
  'landmark',
  'additionalInformation',
] as const;

export default function BranchesSettingsPage() {
  const t = useTranslations('settingsBranches');
  const tRetry = useTranslations('common.actions');
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const toast = useMutationToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['branches', tenantId],
    queryFn: listBranches,
    enabled: !!tenantId,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { isDefault: false, address: { country: 'EG' } },
  });

  const create = useMutation({
    mutationFn: (values: FormValues) => createBranch(values),
    onSuccess: async () => {
      setError(null);
      reset({ isDefault: false, address: { country: 'EG' } });
      await qc.invalidateQueries({ queryKey: ['branches', tenantId] });
      toast.created();
    },
    onError: (e: Error) => {
      setError(e.message);
      toast.error(e);
    },
  });

  return (
    <div className="space-y-token-lg">
      <SettingsPageHeader title={t('title')} />

      <Card>
        <form
          id="branch-create-form"
          className="space-y-token-md"
          onSubmit={handleSubmit((v) => create.mutateAsync(v))}
        >
          <div className="grid gap-token-md sm:grid-cols-2 lg:grid-cols-3">
            <Input label={t('name')} {...register('name')} />
            <Input label={t('etaBranchCode')} {...register('etaBranchCode')} />
            <Input label={t('activityCode')} {...register('activityCode')} />
          </div>
          <Checkbox label={t('default')} {...register('isDefault')} />

          <fieldset className="rounded-lg border border-border p-token-md">
            <legend className="px-token-xs text-token-sm font-medium">
              {t('issuerAddress')}
            </legend>
            <p className="mb-token-sm text-token-xs text-foreground-muted">
              {t('issuerAddressHelp')}
            </p>
            <div className="grid gap-token-sm sm:grid-cols-2 lg:grid-cols-3">
              <Input
                label={`${t('country')} *`}
                defaultValue="EG"
                error={errors.address?.country ? t('required') : undefined}
                {...register('address.country')}
              />
              {REQUIRED_ADDRESS_FIELDS.map((field) => (
                <Input
                  key={field}
                  label={`${t(field)} *`}
                  error={errors.address?.[field] ? t('required') : undefined}
                  {...register(`address.${field}`)}
                />
              ))}
              {OPTIONAL_ADDRESS_FIELDS.map((field) => (
                <Input
                  key={field}
                  label={t(field)}
                  {...register(`address.${field}`)}
                />
              ))}
            </div>
          </fieldset>

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

      {query.isError ? (
        <QueryErrorCard
          message={query.error instanceof Error ? query.error.message : tRetry('retry')}
          retryLabel={tRetry('retry')}
          onRetry={() => void query.refetch()}
        />
      ) : query.isLoading ? (
        <Card aria-busy="true">
          <Skeleton className="mb-token-sm" />
          <Skeleton className="w-2/3" />
        </Card>
      ) : !query.data?.length ? (
        <EmptyState
          title={t('empty')}
          action={{
            label: t('create'),
            onClick: () => document.getElementById('branch-create-form')?.scrollIntoView({ behavior: 'smooth' }),
          }}
        />
      ) : (
        <ul className="m-0 list-none space-y-token-sm p-0">
          {query.data.map((b) => (
            <li key={b.id}>
              <Card className="text-token-sm">
                <div className="flex flex-wrap items-center gap-token-xs">
                  <span className="font-medium">{b.name}</span>
                  {b.isDefault ? <Badge variant="info">{t('default')}</Badge> : null}
                  {b.isActive ? <Badge variant="success">{t('active')}</Badge> : null}
                  {b.activityCode ? (
                    <span className="text-foreground-muted">{b.activityCode}</span>
                  ) : null}
                  <Badge variant={b.addressComplete ? 'success' : 'danger'}>
                    {b.addressComplete ? t('addressComplete') : t('addressIncomplete')}
                  </Badge>
                  <Button
                    type="button"
                    variant="link"
                    className="ms-auto"
                    onClick={() => setEditing(editing === b.id ? null : b.id)}
                  >
                    {editing === b.id ? t('cancel') : t('edit')}
                  </Button>
                </div>
                {editing === b.id ? (
                  <BranchAddressEditor
                    branch={b}
                    onSaved={async () => {
                      setEditing(null);
                      await qc.invalidateQueries({ queryKey: ['branches', tenantId] });
                    }}
                  />
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BranchAddressEditor({
  branch,
  onSaved,
}: {
  branch: Branch;
  onSaved: () => Promise<void> | void;
}) {
  const t = useTranslations('settingsBranches');
  const toast = useMutationToast();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof addressSchema>>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      country: branch.address.country ?? 'EG',
      governate: branch.address.governate ?? '',
      regionCity: branch.address.regionCity ?? '',
      street: branch.address.street ?? '',
      buildingNumber: branch.address.buildingNumber ?? '',
      postalCode: branch.address.postalCode ?? '',
      floor: branch.address.floor ?? '',
      room: branch.address.room ?? '',
      landmark: branch.address.landmark ?? '',
      additionalInformation: branch.address.additionalInformation ?? '',
    },
  });

  return (
    <form
      className="mt-token-sm space-y-token-sm"
      onSubmit={handleSubmit(async (address) => {
        try {
          setError(null);
          await updateBranch(branch.id, { address });
          toast.saved();
          await onSaved();
        } catch (e) {
          setError(e instanceof Error ? e.message : t('addressIncomplete'));
          toast.error(e, t('addressIncomplete'));
        }
      })}
    >
      <div className="grid gap-token-sm sm:grid-cols-2 lg:grid-cols-3">
        <Input
          label={`${t('country')} *`}
          error={errors.country ? t('required') : undefined}
          {...register('country')}
        />
        {REQUIRED_ADDRESS_FIELDS.map((field) => (
          <Input
            key={field}
            label={`${t(field)} *`}
            error={errors[field] ? t('required') : undefined}
            {...register(field)}
          />
        ))}
        {OPTIONAL_ADDRESS_FIELDS.map((field) => (
          <Input key={field} label={t(field)} {...register(field)} />
        ))}
      </div>
      {error ? (
        <p className="text-token-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={isSubmitting}>
        {t('save')}
      </Button>
    </form>
  );
}
