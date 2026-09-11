'use client';

import { useTranslations } from 'next-intl';
import { CopyableTenantId } from '@/components/copyable-tenant-id';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, type TableColumn } from '@/components/ui/table';
import type { LifecycleStatus, TenantSummary } from '@/lib/api/platform-admin';
import { LifecycleActions } from './lifecycle-actions';

function statusVariant(status: LifecycleStatus): BadgeVariant {
  if (status === 'ACTIVE') return 'success';
  if (status === 'PENDING') return 'warning';
  if (status === 'SUSPENDED') return 'danger';
  return 'rejected';
}

export function TenantTable({
  tenants,
  loading,
  onView,
  onApprove,
  onReject,
  onActivate,
  onSuspend,
}: {
  tenants: TenantSummary[];
  loading: boolean;
  onView: (tenant: TenantSummary) => void;
  onApprove: (tenant: TenantSummary) => void;
  onReject: (tenant: TenantSummary) => void;
  onActivate: (tenant: TenantSummary) => void;
  onSuspend: (tenant: TenantSummary) => void;
}) {
  const t = useTranslations('admin');

  const columns: TableColumn<TenantSummary>[] = [
    {
      id: 'name',
      header: t('colName'),
      cell: (tenant) => tenant.name,
    },
    {
      id: 'id',
      header: t('colId'),
      cell: (tenant) => <CopyableTenantId id={tenant.id} showLabel={false} />,
    },
    {
      id: 'contact',
      header: t('colContact'),
      cell: (tenant) => (
        <span className="font-en" dir="ltr">
          {tenant.ownerEmail ?? '—'}
        </span>
      ),
    },
    {
      id: 'plan',
      header: t('colPlan'),
      cell: (tenant) => (
        <span className="font-en" dir="ltr">
          {tenant.planCode ?? '—'}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('colStatus'),
      cell: (tenant) => (
        <Badge variant={statusVariant(tenant.lifecycleStatus)}>
          <span className="font-en" dir="ltr">
            {tenant.lifecycleStatus}
          </span>
        </Badge>
      ),
    },
    {
      id: 'points',
      header: t('colPoints'),
      cell: (tenant) => (
        <span className="font-en tabular-nums" dir="ltr">
          {tenant.pointsBalance}
        </span>
      ),
    },
    {
      id: 'signup',
      header: t('colSignup'),
      cell: (tenant) => (
        <span className="font-en" dir="ltr">
          {new Date(tenant.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t('colActions'),
      cell: (tenant) => (
        <LifecycleActions
          status={tenant.lifecycleStatus}
          onView={() => onView(tenant)}
          onApprove={() => onApprove(tenant)}
          onReject={() => onReject(tenant)}
          onActivate={() => onActivate(tenant)}
          onSuspend={() => onSuspend(tenant)}
        />
      ),
    },
  ];

  return (
    <Table
      caption={t('listCaption')}
      columns={columns}
      rows={tenants}
      getRowId={(tenant) => tenant.id}
      loading={loading}
      empty={<EmptyState title={t('empty')} />}
    />
  );
}
