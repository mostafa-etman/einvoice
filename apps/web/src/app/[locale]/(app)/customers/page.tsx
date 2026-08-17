'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createCustomer,
  deactivateCustomer,
  listCustomers,
  updateCustomer,
  type Customer,
  type CustomerWrite,
} from '@/lib/api/customers';
import { listEtaCodes, type EtaCodeEntry } from '@/lib/api/eta-codes';
import { ApiError } from '@/lib/api/client';
import { useTenant } from '@/lib/tenant-provider';
import type { AddressInput } from '@/lib/api/documents';

const emptyAddress = (): AddressInput => ({
  country: 'EG',
  governate: '',
  regionCity: '',
  street: '',
  buildingNumber: '',
});

const emptyForm = (): CustomerWrite => ({
  type: 'B',
  registrationId: '',
  name: '',
  nameEn: '',
  address: emptyAddress(),
  code: '',
  email: '',
  phone: '',
  isActive: true,
});

function fieldClass() {
  return 'mt-token-xs block w-full rounded border border-border bg-surface px-token-sm py-token-sm';
}

function ltrFieldClass() {
  return `${fieldClass()} font-mono`;
}

export default function CustomersPage() {
  const t = useTranslations('customers');
  const locale = useLocale();
  const { tenantId } = useTenant();
  const qc = useQueryClient();

  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'true' | 'false'>('true');
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState<Customer[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CustomerWrite>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const countriesQuery = useQuery({
    queryKey: ['eta-codes', 'COUNTRY'],
    queryFn: () => listEtaCodes('COUNTRY', { limit: 300 }),
    enabled: !!tenantId,
  });
  const countries: EtaCodeEntry[] = countriesQuery.data?.entries ?? [];

  const listQuery = useQuery({
    queryKey: [
      'customers',
      tenantId,
      q,
      typeFilter,
      activeFilter,
      sortBy,
      sortDir,
      cursor,
    ],
    queryFn: () =>
      listCustomers({
        q: q || undefined,
        type: typeFilter || undefined,
        active:
          activeFilter === 'all'
            ? undefined
            : activeFilter === 'true',
        sortBy,
        sortDir,
        cursor,
        limit: 25,
      }),
    enabled: !!tenantId,
  });

  useEffect(() => {
    if (!listQuery.data) return;
    if (!cursor) {
      setPages(listQuery.data.items);
      return;
    }
    setPages((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      return [
        ...prev,
        ...listQuery.data.items.filter((i) => !seen.has(i.id)),
      ];
    });
  }, [listQuery.data, cursor]);

  const save = useMutation({
    mutationFn: async () => {
      if (editingId) return updateCustomer(editingId, form);
      return createCustomer(form);
    },
    onSuccess: async () => {
      setForm(emptyForm());
      setEditingId(null);
      setShowForm(false);
      setFormError(null);
      setCursor(undefined);
      await qc.invalidateQueries({ queryKey: ['customers', tenantId] });
    },
    onError: (err) => {
      setFormError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('errorGeneric'),
      );
    },
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => deactivateCustomer(id),
    onSuccess: async () => {
      setCursor(undefined);
      await qc.invalidateQueries({ queryKey: ['customers', tenantId] });
    },
  });

  const typeLabel = useMemo(
    () =>
      ({
        B: t('typeB'),
        P: t('typeP'),
        F: t('typeF'),
      }) as Record<string, string>,
    [t],
  );

  const startCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
    setShowForm(true);
  };

  const startEdit = (c: Customer) => {
    setEditingId(c.id);
    setForm({
      type: c.type,
      registrationId: c.registrationId,
      name: c.name,
      nameEn: c.nameEn ?? '',
      address: { ...emptyAddress(), ...c.address },
      code: c.code ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      isActive: c.isActive,
    });
    setFormError(null);
    setShowForm(true);
  };

  const idHint =
    form.type === 'B'
      ? t('idHintB')
      : form.type === 'P'
        ? t('idHintP')
        : t('idHintF');

  const forbidden =
    listQuery.error instanceof ApiError && listQuery.error.status === 403;

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-token-md">
        <div>
          <h1 className="font-display text-token-xl">{t('title')}</h1>
          <p className="mt-token-xs text-token-sm text-foreground/70">{t('intro')}</p>
        </div>
        <button
          type="button"
          className="rounded bg-brand px-token-md py-token-sm text-white"
          onClick={startCreate}
        >
          {t('create')}
        </button>
      </div>

      {forbidden ? (
        <p className="mt-token-md text-token-sm text-red-700">{t('forbidden')}</p>
      ) : null}

      <div className="mt-token-lg flex flex-wrap items-end gap-token-md">
        <label className="text-token-sm">
          {t('search')}
          <input
            className={fieldClass()}
            value={q}
            onChange={(e) => {
              setCursor(undefined);
              setQ(e.target.value);
            }}
            placeholder={t('searchPlaceholder')}
          />
        </label>
        <label className="text-token-sm">
          {t('type')}
          <select
            className={fieldClass()}
            value={typeFilter}
            onChange={(e) => {
              setCursor(undefined);
              setTypeFilter(e.target.value);
            }}
          >
            <option value="">{t('typeAll')}</option>
            <option value="B">{t('typeB')}</option>
            <option value="P">{t('typeP')}</option>
            <option value="F">{t('typeF')}</option>
          </select>
        </label>
        <label className="text-token-sm">
          {t('status')}
          <select
            className={fieldClass()}
            value={activeFilter}
            onChange={(e) => {
              setCursor(undefined);
              setActiveFilter(e.target.value as 'all' | 'true' | 'false');
            }}
          >
            <option value="true">{t('activeOnly')}</option>
            <option value="false">{t('inactiveOnly')}</option>
            <option value="all">{t('statusAll')}</option>
          </select>
        </label>
        <label className="text-token-sm">
          {t('sortBy')}
          <select
            className={fieldClass()}
            value={sortBy}
            onChange={(e) => {
              setCursor(undefined);
              setSortBy(e.target.value);
            }}
          >
            <option value="name">{t('colName')}</option>
            <option value="registrationId">{t('colRegistrationId')}</option>
            <option value="code">{t('colCode')}</option>
            <option value="updatedAt">{t('colUpdated')}</option>
          </select>
        </label>
        <label className="text-token-sm">
          {t('sortDir')}
          <select
            className={fieldClass()}
            value={sortDir}
            onChange={(e) => {
              setCursor(undefined);
              setSortDir(e.target.value as 'asc' | 'desc');
            }}
          >
            <option value="asc">{t('asc')}</option>
            <option value="desc">{t('desc')}</option>
          </select>
        </label>
      </div>

      {showForm ? (
        <form
          className="mt-token-xl space-y-token-md rounded border border-border bg-surface p-token-md"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <h2 className="font-display text-token-lg">
            {editingId ? t('editTitle') : t('createTitle')}
          </h2>
          <div className="grid gap-token-md sm:grid-cols-2">
            <label className="text-token-sm">
              {t('type')}
              <select
                className={fieldClass()}
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="B">{t('typeB')}</option>
                <option value="P">{t('typeP')}</option>
                <option value="F">{t('typeF')}</option>
              </select>
            </label>
            <label className="text-token-sm">
              {t('registrationId')}
              <input
                className={ltrFieldClass()}
                dir="ltr"
                value={form.registrationId}
                onChange={(e) =>
                  setForm({ ...form, registrationId: e.target.value })
                }
              />
              <span className="mt-token-xs block text-token-xs text-foreground/60">
                {idHint}
              </span>
            </label>
            <label className="text-token-sm">
              {t('name')}
              <input
                className={fieldClass()}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="text-token-sm">
              {t('nameEn')}
              <input
                className={fieldClass()}
                dir="ltr"
                value={form.nameEn ?? ''}
                onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
              />
            </label>
            <label className="text-token-sm">
              {t('code')}
              <input
                className={ltrFieldClass()}
                dir="ltr"
                value={form.code ?? ''}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </label>
            <label className="text-token-sm">
              {t('email')}
              <input
                className={ltrFieldClass()}
                dir="ltr"
                type="email"
                value={form.email ?? ''}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label className="text-token-sm">
              {t('phone')}
              <input
                className={ltrFieldClass()}
                dir="ltr"
                value={form.phone ?? ''}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </label>
          </div>

          <h3 className="text-token-md font-medium">{t('address')}</h3>
          <div className="grid gap-token-md sm:grid-cols-2">
            <label className="text-token-sm">
              {t('country')}
              <select
                className={fieldClass()}
                value={form.address.country ?? 'EG'}
                onChange={(e) =>
                  setForm({
                    ...form,
                    address: { ...form.address, country: e.target.value },
                  })
                }
              >
                {(countries.length
                  ? countries
                  : [
                      {
                        code: 'EG',
                        nameEn: 'Egypt',
                        nameAr: 'مصر',
                        parentCode: null,
                        meta: null,
                      },
                    ]
                ).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {locale === 'ar' && c.nameAr ? c.nameAr : c.nameEn}
                  </option>
                ))}
              </select>
            </label>
            {(
              [
                ['governate', t('governate')],
                ['regionCity', t('regionCity')],
                ['street', t('street')],
                ['buildingNumber', t('buildingNumber')],
                ['postalCode', t('postalCode')],
                ['floor', t('floor')],
                ['room', t('room')],
                ['landmark', t('landmark')],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="text-token-sm">
                {label}
                <input
                  className={fieldClass()}
                  value={form.address[key] ?? ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      address: { ...form.address, [key]: e.target.value },
                    })
                  }
                />
              </label>
            ))}
            <label className="text-token-sm sm:col-span-2">
              {t('additionalInformation')}
              <input
                className={fieldClass()}
                value={form.address.additionalInformation ?? ''}
                onChange={(e) =>
                  setForm({
                    ...form,
                    address: {
                      ...form.address,
                      additionalInformation: e.target.value,
                    },
                  })
                }
              />
            </label>
          </div>

          {formError ? (
            <p className="text-token-sm text-red-700">{formError}</p>
          ) : null}

          <div className="flex flex-wrap gap-token-sm">
            <button
              type="submit"
              disabled={save.isPending}
              className="rounded bg-brand px-token-md py-token-sm text-white disabled:opacity-60"
            >
              {t('save')}
            </button>
            <button
              type="button"
              className="rounded border border-border px-token-md py-token-sm"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
                setFormError(null);
              }}
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      ) : null}

      <div className="mt-token-xl overflow-x-auto">
        <table className="w-full border-collapse text-start text-token-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="py-token-sm">{t('colName')}</th>
              <th className="py-token-sm">{t('colType')}</th>
              <th className="py-token-sm">{t('colRegistrationId')}</th>
              <th className="py-token-sm">{t('colCode')}</th>
              <th className="py-token-sm">{t('colStatus')}</th>
              <th className="py-token-sm">{t('colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((c) => (
              <tr key={c.id} className="border-b border-border/60">
                <td className="py-token-sm">
                  <div>{c.name}</div>
                  {c.nameEn ? (
                    <div className="text-token-xs text-foreground/60" dir="ltr">
                      {c.nameEn}
                    </div>
                  ) : null}
                </td>
                <td className="py-token-sm">{typeLabel[c.type] ?? c.type}</td>
                <td className="py-token-sm font-mono" dir="ltr">
                  {c.registrationId}
                </td>
                <td className="py-token-sm font-mono" dir="ltr">
                  {c.code ?? '—'}
                </td>
                <td className="py-token-sm">
                  {c.isActive ? t('active') : t('inactive')}
                </td>
                <td className="py-token-sm">
                  <div className="flex flex-wrap gap-token-sm">
                    <button
                      type="button"
                      className="text-brand underline"
                      onClick={() => startEdit(c)}
                    >
                      {t('edit')}
                    </button>
                    {c.isActive ? (
                      <button
                        type="button"
                        className="text-red-700 underline"
                        disabled={deactivate.isPending}
                        onClick={() => deactivate.mutate(c.id)}
                      >
                        {t('deactivate')}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!listQuery.isLoading && pages.length === 0 && !forbidden ? (
          <p className="mt-token-md text-token-sm text-foreground/60">{t('empty')}</p>
        ) : null}
      </div>

      {listQuery.data?.nextCursor ? (
        <button
          type="button"
          className="mt-token-md rounded border border-border px-token-md py-token-sm"
          onClick={() => setCursor(listQuery.data!.nextCursor!)}
        >
          {t('loadMore')}
        </button>
      ) : null}
    </section>
  );
}
