'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APP_SCREEN_KEYS } from '@einvoice/shared';
import { screenMessageKey } from '@/lib/screen-labels';
import {
  listFeedback,
  listTenants,
  setFeedbackStatus,
  type FeedbackItem,
  type FeedbackStatus,
} from '@/lib/api/platform-admin';
import { formatDateTimeDisplay } from '@/lib/format-date';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterBar } from '@/components/ui/filter-bar';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, type TableColumn } from '@/components/ui/table';
import { useMutationToast } from '@/components/ui/use-mutation-toast';

function statusVariant(status: FeedbackStatus): BadgeVariant {
  if (status === 'RESOLVED') return 'success';
  if (status === 'REVIEWED') return 'info';
  return 'warning';
}

export function FeedbackPanel() {
  const t = useTranslations('admin');
  const tScreens = useTranslations('screens');
  const tStatus = useTranslations('admin.feedbackStatus');
  const locale = useLocale();
  const toast = useMutationToast();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [screen, setScreen] = useState('');
  const [status, setStatus] = useState<FeedbackStatus | ''>('');

  useEffect(() => {
    const handle = window.setTimeout(() => setQDebounced(q.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [q]);

  const tenantsQuery = useQuery({
    queryKey: ['platform-admin-tenants', '', ''],
    queryFn: () => listTenants(),
  });
  const feedbackQuery = useQuery({
    queryKey: ['platform-admin-feedback', qDebounced, tenantId, screen, status],
    queryFn: () =>
      listFeedback({
        q: qDebounced || undefined,
        tenantId: tenantId || undefined,
        screen: screen || undefined,
        status: status || undefined,
      }),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, next }: { id: string; next: FeedbackStatus }) => setFeedbackStatus(id, next),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-admin-feedback'] });
      void qc.invalidateQueries({ queryKey: ['platform-admin-feedback-summary'] });
      toast.saved();
    },
    onError: (err) => toast.error(err),
  });

  const items = feedbackQuery.data?.items ?? [];
  const tenants = tenantsQuery.data?.items ?? [];

  const columns: TableColumn<FeedbackItem>[] = [
    {
      id: 'tenant',
      header: t('colTenant'),
      cell: (row) => row.tenantName,
    },
    {
      id: 'author',
      header: t('colWho'),
      cell: (row) => (
        <span className="font-en" dir="ltr">
          {row.authorName ? `${row.authorName} · ${row.authorEmail}` : row.authorEmail}
        </span>
      ),
    },
    {
      id: 'screen',
      header: t('colScreen'),
      cell: (row) => (
        <div>
          <div>{tScreens(screenMessageKey(row.screenKey))}</div>
          <div className="font-en text-token-xs text-foreground-muted" dir="ltr">
            {row.routePath}
          </div>
        </div>
      ),
    },
    {
      id: 'note',
      header: t('colNote'),
      cell: (row) => <p className="m-0 max-w-md whitespace-pre-wrap">{row.note}</p>,
    },
    {
      id: 'date',
      header: t('colDate'),
      ltr: true,
      cell: (row) => formatDateTimeDisplay(row.createdAt, locale),
    },
    {
      id: 'status',
      header: t('colStatus'),
      cell: (row) => (
        <Badge variant={statusVariant(row.status)}>{tStatus(row.status)}</Badge>
      ),
    },
    {
      id: 'actions',
      header: t('colActions'),
      cell: (row) => (
        <div className="flex flex-wrap gap-token-xs">
          {row.status !== 'REVIEWED' ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => statusMut.mutate({ id: row.id, next: 'REVIEWED' })}
            >
              {t('markReviewed')}
            </Button>
          ) : null}
          {row.status !== 'RESOLVED' ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => statusMut.mutate({ id: row.id, next: 'RESOLVED' })}
            >
              {t('markResolved')}
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-token-md">
      <FilterBar>
        <Input
          label={t('searchFeedback')}
          placeholder={t('searchFeedbackPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          label={t('filterTenant')}
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
        >
          <option value="">{t('allTenants')}</option>
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}
            </option>
          ))}
        </Select>
        <Select label={t('filterScreen')} value={screen} onChange={(e) => setScreen(e.target.value)}>
          <option value="">{t('allScreens')}</option>
          {APP_SCREEN_KEYS.map((key) => (
            <option key={key} value={key}>
              {tScreens(screenMessageKey(key))}
            </option>
          ))}
        </Select>
        <Select
          label={t('filterFeedbackStatus')}
          value={status}
          onChange={(e) => setStatus(e.target.value as FeedbackStatus | '')}
        >
          <option value="">{t('allStatuses')}</option>
          <option value="NEW">{tStatus('NEW')}</option>
          <option value="REVIEWED">{tStatus('REVIEWED')}</option>
          <option value="RESOLVED">{tStatus('RESOLVED')}</option>
        </Select>
      </FilterBar>
      <Table
        caption={t('tabFeedback')}
        columns={columns}
        rows={items}
        getRowId={(row) => row.id}
        loading={feedbackQuery.isLoading}
        empty={<EmptyState title={t('feedbackEmpty')} />}
      />
    </div>
  );
}
