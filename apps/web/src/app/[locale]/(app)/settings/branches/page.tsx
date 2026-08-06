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

// ETA refuses documents without these issuer address fields, and the issuer is
// company-level — so they are required here rather than on every invoice.
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

const inputClass =
  'mt-token-xs block w-full rounded border border-border bg-surface px-token-sm py-token-sm';

export default function BranchesSettingsPage() {
  const t = useTranslations('settingsBranches');
  const { tenantId } = useTenant();
  const qc = useQueryClient();
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
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <section className="space-y-token-xl">
      <h1 className="font-display text-token-xl">{t('title')}</h1>

      <form
        className="space-y-token-md"
        onSubmit={handleSubmit((v) => create.mutateAsync(v))}
      >
        <div className="flex flex-wrap items-end gap-token-md">
          <label className="text-token-sm">
            {t('name')}
            <input className={inputClass} {...register('name')} />
          </label>
          <label className="text-token-sm">
            {t('etaBranchCode')}
            <input className={inputClass} {...register('etaBranchCode')} />
          </label>
          <label className="text-token-sm">
            {t('activityCode')}
            <input className={inputClass} {...register('activityCode')} />
          </label>
          <label className="flex items-center gap-token-xs text-token-sm">
            <input type="checkbox" {...register('isDefault')} />
            {t('default')}
          </label>
        </div>

        <fieldset className="rounded border border-border p-token-md">
          <legend className="px-token-xs text-token-sm font-medium">
            {t('issuerAddress')}
          </legend>
          <p className="mb-token-sm text-token-xs text-foreground/70">
            {t('issuerAddressHelp')}
          </p>
          <div className="grid gap-token-sm sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-token-sm">
              {t('country')} *
              <input
                className={inputClass}
                defaultValue="EG"
                {...register('address.country')}
              />
              {errors.address?.country ? (
                <span className="text-token-xs text-danger">{t('required')}</span>
              ) : null}
            </label>
            {REQUIRED_ADDRESS_FIELDS.map((field) => (
              <label key={field} className="text-token-sm">
                {t(field)} *
                <input className={inputClass} {...register(`address.${field}`)} />
                {errors.address?.[field] ? (
                  <span className="text-token-xs text-danger">
                    {t('required')}
                  </span>
                ) : null}
              </label>
            ))}
            {OPTIONAL_ADDRESS_FIELDS.map((field) => (
              <label key={field} className="text-token-sm">
                {t(field)}
                <input className={inputClass} {...register(`address.${field}`)} />
              </label>
            ))}
          </div>
        </fieldset>

        {error ? <p className="text-token-sm text-danger">{error}</p> : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-brand px-token-md py-token-sm text-token-sm text-white disabled:opacity-50"
        >
          {t('create')}
        </button>
      </form>

      <ul className="space-y-token-sm">
        {(query.data ?? []).map((b) => (
          <li key={b.id} className="border-b border-border py-token-sm text-token-sm">
            <div className="flex flex-wrap items-center gap-token-xs">
              <span className="font-medium">{b.name}</span>
              {b.isDefault ? <span>· {t('default')}</span> : null}
              {b.isActive ? <span>· {t('active')}</span> : null}
              {b.activityCode ? <span>· {b.activityCode}</span> : null}
              <span
                className={
                  b.addressComplete
                    ? 'text-token-xs text-foreground/60'
                    : 'text-token-xs text-danger'
                }
              >
                · {b.addressComplete ? t('addressComplete') : t('addressIncomplete')}
              </span>
              <button
                type="button"
                className="ms-auto text-brand"
                onClick={() => setEditing(editing === b.id ? null : b.id)}
              >
                {editing === b.id ? t('cancel') : t('edit')}
              </button>
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
          </li>
        ))}
        {!query.data?.length ? (
          <li className="text-token-sm text-foreground/60">{t('empty')}</li>
        ) : null}
      </ul>
    </section>
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
          await onSaved();
        } catch (e) {
          setError(e instanceof Error ? e.message : t('addressIncomplete'));
        }
      })}
    >
      <div className="grid gap-token-sm sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-token-sm">
          {t('country')} *
          <input className={inputClass} {...register('country')} />
          {errors.country ? (
            <span className="text-token-xs text-danger">{t('required')}</span>
          ) : null}
        </label>
        {REQUIRED_ADDRESS_FIELDS.map((field) => (
          <label key={field} className="text-token-sm">
            {t(field)} *
            <input className={inputClass} {...register(field)} />
            {errors[field] ? (
              <span className="text-token-xs text-danger">{t('required')}</span>
            ) : null}
          </label>
        ))}
        {OPTIONAL_ADDRESS_FIELDS.map((field) => (
          <label key={field} className="text-token-sm">
            {t(field)}
            <input className={inputClass} {...register(field)} />
          </label>
        ))}
      </div>
      {error ? <p className="text-token-sm text-danger">{error}</p> : null}
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded bg-brand px-token-md py-token-sm text-token-sm text-white disabled:opacity-50"
      >
        {t('save')}
      </button>
    </form>
  );
}
