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
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { TableWrap, Th, Td } from '@/components/ui/table';
import { Drawer } from '@/components/ui/drawer';
import { CustomerForm } from './_components/customer-form';
import { useMutationToast } from '@/components/ui/use-mutation-toast';
import {
  PAGE_SIZE,
  emptyAddress,
  emptyForm,
  type ActiveFilter,
} from './_components/customer-list-utils';

export default function CustomersPage() {
  const t = useTranslations('customers');
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const toast = useMutationToast();

  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('true');
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
        limit: PAGE_SIZE,
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
      toast.saved();
    },
    onError: (err) => {
      setFormError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('errorGeneric'),
      );
      toast.error(err, t('errorGeneric'));
    },
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => deactivateCustomer(id),
    onSuccess: async () => {
      setCursor(undefined);
      await qc.invalidateQueries({ queryKey: ['customers', tenantId] });
      toast.saved();
    },
    onError: (err) => {
      toast.error(err);
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

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormError(null);
  };

  const resetFilters = () => {
    setQ('');
    setTypeFilter('');
    setActiveFilter('true');
    setCursor(undefined);
  };

  const forbidden =
    listQuery.error instanceof ApiError && listQuery.error.status === 403;
  const listError =
    listQuery.error && !forbidden
      ? listQuery.error instanceof Error
        ? listQuery.error.message
        : t('errorGeneric')
      : null;
  const filtersActive = Boolean(q.trim() || typeFilter || activeFilter !== 'true');
  const listLoading = listQuery.isLoading && pages.length === 0 && !forbidden;

  return (
    <div className="space-y-token-lg" data-testid="customers-page">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: tNav('home'), href: `/${locale}` },
              { label: t('title') },
            ]}
          />
        }
        title={t('title')}
        subtitle={t('intro')}
        actions={
          <Button onClick={startCreate}>{t('create')}</Button>
        }
      />

      {forbidden ? (
        <Card className="border-danger" role="alert" data-testid="customers-forbidden">
          <p className="m-0 text-token-sm font-medium text-danger">{t('forbidden')}</p>
        </Card>
      ) : null}

      {listError ? (
        <Card className="border-danger" role="alert" data-testid="customers-error">
          <p className="m-0 text-token-sm font-medium text-danger">{listError}</p>
          <Button
            className="mt-token-sm"
            size="sm"
            variant="secondary"
            onClick={() => void listQuery.refetch()}
          >
            {t('retryLoad')}
          </Button>
        </Card>
      ) : null}

      <FilterBar
        search={q}
        onSearchChange={(value) => {
          setCursor(undefined);
          setQ(value);
        }}
        searchPlaceholder={t('searchPlaceholder')}
        onReset={resetFilters}
        chips={[
          {
            id: 'active',
            label: t('activeOnly'),
            active: activeFilter === 'true',
            onClick: () => {
              setCursor(undefined);
              setActiveFilter('true');
            },
          },
          {
            id: 'inactive',
            label: t('inactiveOnly'),
            active: activeFilter === 'false',
            onClick: () => {
              setCursor(undefined);
              setActiveFilter('false');
            },
          },
          {
            id: 'all-status',
            label: t('statusAll'),
            active: activeFilter === 'all',
            onClick: () => {
              setCursor(undefined);
              setActiveFilter('all');
            },
          },
        ]}
      >
        <Select
          label={t('type')}
          value={typeFilter}
          onChange={(e) => {
            setCursor(undefined);
            setTypeFilter(e.target.value);
          }}
          className="w-auto"
        >
          <option value="">{t('typeAll')}</option>
          <option value="B">{t('typeB')}</option>
          <option value="P">{t('typeP')}</option>
          <option value="F">{t('typeF')}</option>
        </Select>
        <Select
          label={t('sortBy')}
          value={sortBy}
          onChange={(e) => {
            setCursor(undefined);
            setSortBy(e.target.value);
          }}
          className="w-auto"
        >
          <option value="name">{t('colName')}</option>
          <option value="registrationId">{t('colRegistrationId')}</option>
          <option value="code">{t('colCode')}</option>
          <option value="updatedAt">{t('colUpdated')}</option>
        </Select>
        <Select
          label={t('sortDir')}
          value={sortDir}
          onChange={(e) => {
            setCursor(undefined);
            setSortDir(e.target.value as 'asc' | 'desc');
          }}
          className="w-auto"
        >
          <option value="asc">{t('asc')}</option>
          <option value="desc">{t('desc')}</option>
        </Select>
      </FilterBar>

      {listLoading ? (
        <div data-testid="customers-loading" className="space-y-token-sm" aria-busy="true">
          <Skeleton variant="rect" className="h-token-xl" />
          <Skeleton variant="rect" className="h-[12rem]" />
        </div>
      ) : pages.length === 0 && !forbidden && !listError ? (
        <div data-testid="customers-empty">
          <EmptyState
            title={filtersActive ? t('emptyFiltered') : t('empty')}
            action={{
              label: filtersActive ? t('retryLoad') : t('create'),
              onClick: () => {
                if (filtersActive) resetFilters();
                else startCreate();
              },
            }}
          />
        </div>
      ) : pages.length === 0 ? null : (
        <TableWrap data-testid="customers-table">
          <table className="w-full min-w-[56rem] border-collapse text-start text-token-sm">
            <caption className="sr-only">{t('listCaption')}</caption>
            <thead>
              <tr>
                <Th>{t('colName')}</Th>
                <Th>{t('colType')}</Th>
                <Th>{t('colRegistrationId')}</Th>
                <Th>{t('colCode')}</Th>
                <Th>{t('colStatus')}</Th>
                <Th>{t('colActions')}</Th>
              </tr>
            </thead>
            <tbody>
              {pages.map((c) => (
                <tr key={c.id} className="hover:bg-surface-alt">
                  <Td>
                    <div className="font-medium">{c.name}</div>
                    {c.nameEn ? (
                      <div className="text-token-xs text-foreground-muted" dir="ltr">
                        {c.nameEn}
                      </div>
                    ) : null}
                  </Td>
                  <Td>{typeLabel[c.type] ?? c.type}</Td>
                  <Td>
                    <span className="font-en" dir="ltr">
                      {c.registrationId}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-en" dir="ltr">
                      {c.code ?? '—'}
                    </span>
                  </Td>
                  <Td>
                    <Badge variant={c.isActive ? 'success' : 'neutral'}>
                      {c.isActive ? t('active') : t('inactive')}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-token-sm">
                      <Button variant="link" onClick={() => startEdit(c)}>
                        {t('edit')}
                      </Button>
                      {c.isActive ? (
                        <Button
                          variant="link"
                          className="text-danger hover:text-danger"
                          disabled={deactivate.isPending}
                          onClick={() => deactivate.mutate(c.id)}
                        >
                          {t('deactivate')}
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      {listQuery.data?.nextCursor ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            onClick={() => setCursor(listQuery.data!.nextCursor!)}
          >
            {t('loadMore')}
          </Button>
        </div>
      ) : null}

      <Drawer
        open={showForm}
        onClose={closeForm}
        title={editingId ? t('editTitle') : t('createTitle')}
        footer={
          <div className="flex flex-wrap gap-token-sm">
            <Button
              type="submit"
              form="customer-form"
              disabled={save.isPending}
              loading={save.isPending}
            >
              {t('save')}
            </Button>
            <Button variant="secondary" onClick={closeForm}>
              {t('cancel')}
            </Button>
          </div>
        }
      >
        <CustomerForm
          formId="customer-form"
          form={form}
          onChange={setForm}
          countries={countries}
          locale={locale}
          t={t}
          error={formError}
          onSubmit={() => save.mutate()}
        />
      </Drawer>
    </div>
  );
}
