'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
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
import { Select } from '@/components/ui/select';
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

const schema = z
  .object({
    name: z.string().min(1),
    etaBranchCode: z.string().optional(),
    activityCode: z.string().optional(),
    syndicateLicenseNumber: z.string().optional(),
    defaultReceiptType: z.enum(['s', 'r', 'SR', '']).optional(),
    isDefault: z.boolean().optional(),
    receiptsEnabled: z.boolean().optional(),
    address: addressSchema,
  })
  .superRefine((value, ctx) => {
    if (!value.receiptsEnabled) return;
    if (!value.etaBranchCode?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['etaBranchCode'],
        message: 'required',
      });
    }
    if (!value.activityCode?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['activityCode'],
        message: 'required',
      });
    }
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

const GAP_KEYS: Record<string, string> = {
  MISSING_ETA_BRANCH_CODE: 'gapMissingEtaBranchCode',
  MISSING_ACTIVITY_CODE: 'gapMissingActivityCode',
  INCOMPLETE_ADDRESS: 'gapIncompleteAddress',
  MISSING_SYNDICATE_LICENSE: 'gapMissingSyndicateLicense',
};

export default function BranchesSettingsPage() {
  const t = useTranslations('settingsBranches');
  const tRetry = useTranslations('common.actions');
  const locale = useLocale();
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
    defaultValues: {
      isDefault: false,
      receiptsEnabled: false,
      address: { country: 'EG' },
    },
  });

  const create = useMutation({
    mutationFn: (values: FormValues) => createBranch(values),
    onSuccess: async () => {
      setError(null);
      reset({
        isDefault: false,
        receiptsEnabled: false,
        address: { country: 'EG' },
      });
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
      <p className="text-token-sm text-foreground-muted">{t('b2cSelfService')}</p>

      <Card>
        <form
          id="branch-create-form"
          className="space-y-token-md"
          onSubmit={handleSubmit((v) => create.mutateAsync(v))}
        >
          <div className="grid gap-token-md sm:grid-cols-2 lg:grid-cols-3">
            <Input label={t('name')} {...register('name')} />
            <Input
              label={t('etaBranchCode')}
              hint={t('etaBranchCodeHelp')}
              dir="ltr"
              error={errors.etaBranchCode ? t('required') : undefined}
              {...register('etaBranchCode')}
            />
            <Input
              label={t('activityCode')}
              hint={t('activityCodeHelp')}
              dir="ltr"
              error={errors.activityCode ? t('required') : undefined}
              {...register('activityCode')}
            />
            <Input
              label={t('syndicateLicense')}
              hint={t('syndicateLicenseHelp')}
              dir="ltr"
              {...register('syndicateLicenseNumber')}
            />
            <Select
              label={t('defaultReceiptType')}
              hint={t('defaultReceiptTypeHelp')}
              {...register('defaultReceiptType')}
            >
              <option value="">{t('receiptTypeInherit')}</option>
              <option value="s">{t('receiptTypeS')}</option>
              <option value="r">{t('receiptTypeR')}</option>
              <option value="SR">{t('receiptTypeSR')}</option>
            </Select>
          </div>
          <Checkbox label={t('default')} {...register('isDefault')} />
          <Checkbox
            label={t('receiptsEnabled')}
            hint={t('receiptsHelp')}
            {...register('receiptsEnabled')}
          />

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
            onClick: () =>
              document.getElementById('branch-create-form')?.scrollIntoView({
                behavior: 'smooth',
              }),
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
                  {b.receiptsEnabled ? (
                    <Badge variant={b.receiptsReady ? 'success' : 'danger'}>
                      {b.receiptsReady ? t('receiptsReady') : t('receiptsNotReady')}
                    </Badge>
                  ) : (
                    <Badge variant="info">{t('receiptsInvoiceOnly')}</Badge>
                  )}
                  <Link
                    className="text-brand underline"
                    href={`/${locale}/settings/pos-devices?branchId=${b.id}`}
                  >
                    {t('managePos')}
                  </Link>
                  <Button
                    type="button"
                    variant="link"
                    className="ms-auto"
                    onClick={() => setEditing(editing === b.id ? null : b.id)}
                  >
                    {editing === b.id ? t('cancel') : t('edit')}
                  </Button>
                </div>
                {b.receiptsEnabled && b.receiptsGaps.length ? (
                  <ul className="mt-token-xs list-disc ps-token-md text-token-xs text-danger">
                    {b.receiptsGaps.map((gap) => (
                      <li key={gap}>{t(GAP_KEYS[gap] ?? gap)}</li>
                    ))}
                  </ul>
                ) : null}
                {editing === b.id ? (
                  <BranchEditor
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

const editorSchema = schema;

function BranchEditor({
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
  } = useForm<FormValues>({
    resolver: zodResolver(editorSchema),
    defaultValues: {
      name: branch.name,
      etaBranchCode: branch.etaBranchCode ?? '',
      activityCode: branch.activityCode ?? '',
      syndicateLicenseNumber: branch.syndicateLicenseNumber ?? '',
      defaultReceiptType: (branch.defaultReceiptType as 's' | 'r' | 'SR' | '') ?? '',
      isDefault: branch.isDefault,
      receiptsEnabled: branch.receiptsEnabled,
      address: {
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
    },
  });

  return (
    <form
      className="mt-token-sm space-y-token-sm"
      onSubmit={handleSubmit(async (values) => {
        try {
          setError(null);
          await updateBranch(branch.id, {
            name: values.name,
            etaBranchCode: values.etaBranchCode || null,
            activityCode: values.activityCode || null,
            syndicateLicenseNumber: values.syndicateLicenseNumber || null,
            defaultReceiptType: values.defaultReceiptType || null,
            isDefault: values.isDefault,
            receiptsEnabled: Boolean(values.receiptsEnabled),
            address: values.address,
          });
          toast.saved();
          await onSaved();
        } catch (e) {
          setError(e instanceof Error ? e.message : t('addressIncomplete'));
          toast.error(e, t('addressIncomplete'));
        }
      })}
    >
      <div className="grid gap-token-sm sm:grid-cols-2 lg:grid-cols-3">
        <Input label={t('name')} {...register('name')} />
        <Input
          label={t('etaBranchCode')}
          dir="ltr"
          error={errors.etaBranchCode ? t('required') : undefined}
          {...register('etaBranchCode')}
        />
        <Input
          label={t('activityCode')}
          dir="ltr"
          error={errors.activityCode ? t('required') : undefined}
          {...register('activityCode')}
        />
        <Input
          label={t('syndicateLicense')}
          dir="ltr"
          {...register('syndicateLicenseNumber')}
        />
        <Select label={t('defaultReceiptType')} {...register('defaultReceiptType')}>
          <option value="">{t('receiptTypeInherit')}</option>
          <option value="s">{t('receiptTypeS')}</option>
          <option value="r">{t('receiptTypeR')}</option>
          <option value="SR">{t('receiptTypeSR')}</option>
        </Select>
      </div>
      <Checkbox label={t('default')} {...register('isDefault')} />
      <Checkbox
        label={t('receiptsEnabled')}
        hint={t('receiptsHelp')}
        {...register('receiptsEnabled')}
      />
      <div className="grid gap-token-sm sm:grid-cols-2 lg:grid-cols-3">
        <Input
          label={`${t('country')} *`}
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
          <Input key={field} label={t(field)} {...register(`address.${field}`)} />
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
