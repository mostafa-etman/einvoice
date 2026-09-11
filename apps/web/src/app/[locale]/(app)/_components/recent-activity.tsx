'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { DocumentListItem } from '@/lib/api/documents';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, type TableColumn } from '@/components/ui/table';
import { resolveDocumentStatus } from '@/lib/document-status-display';
import { formatMoneyDisplay } from '@/lib/format-number';
import { ChevronEndIcon } from './dashboard-icons';

function statusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case 'SIGNED':
      return 'signed';
    case 'SUBMITTED':
      return 'submitted';
    case 'VALID':
      return 'valid';
    case 'INVALID':
      return 'invalid';
    case 'CANCELLED':
      return 'cancelled';
    case 'REJECTED':
      return 'rejected';
    case 'DRAFT':
    case 'READY':
    case 'PENDING_SIGNATURE':
      return 'draft';
    default:
      return 'neutral';
  }
}

export function RecentActivity({
  rows,
  loading,
  error,
  onRetry,
}: {
  rows: DocumentListItem[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('dashboard');
  const tDocs = useTranslations('documents');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();

  const statusLabel = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return tDocs('statusDraft');
      case 'READY':
        return tDocs('statusReady');
      case 'PENDING_SIGNATURE':
        return tDocs('statusPendingSignature');
      case 'SIGNED':
        return tDocs('statusSigned');
      case 'SUBMITTED':
        return tDocs('statusSubmitted');
      case 'VALID':
        return tDocs('statusValid');
      case 'INVALID':
        return tDocs('statusInvalid');
      case 'CANCELLED':
        return tDocs('statusCancelled');
      case 'REJECTED':
        return tDocs('statusRejected');
      default:
        return status;
    }
  };

  const columns: TableColumn<DocumentListItem>[] = [
    {
      id: 'internalId',
      header: t('colNumber'),
      cell: (row) => <span className="font-en">{row.internalId}</span>,
    },
    {
      id: 'receiver',
      header: t('colReceiver'),
      cell: (row) => (
        <span className="font-medium text-foreground">
          {row.receiverName?.trim() || '—'}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('colStatus'),
      cell: (row) => {
        const status = resolveDocumentStatus(row.status, row.etaStatus);
        return <Badge variant={statusBadgeVariant(status)}>{statusLabel(status)}</Badge>;
      },
    },
    {
      id: 'total',
      header: t('colTotal'),
      align: 'end',
      cell: (row) => formatMoneyDisplay(row.totalAmount),
    },
  ];

  return (
    <Card data-testid="dashboard-activity">
      <CardHeader>
        <div>
          <CardTitle>{t('activityTitle')}</CardTitle>
          <CardDescription>{t('activityDesc')}</CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          iconEnd={<ChevronEndIcon />}
          onClick={() => router.push(`/${locale}/documents`)}
        >
          {t('viewAll')}
        </Button>
      </CardHeader>
      {error ? (
        <div data-testid="dashboard-activity-error" role="alert">
          <p className="m-0 text-token-sm text-danger">{t('activityError')}</p>
          <Button className="mt-token-sm" size="sm" variant="secondary" onClick={onRetry}>
            {tCommon('actions.retry')}
          </Button>
        </div>
      ) : (
        <Table
          caption={t('activityCaption')}
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          dense
          loading={loading}
          loadingRowCount={5}
          onRowClick={(row) => router.push(`/${locale}/documents/${row.id}`)}
          empty={
            <EmptyState
              title={t('activityEmptyTitle')}
              description={t('activityEmptyDesc')}
              action={{
                label: t('newDocument'),
                onClick: () => router.push(`/${locale}/documents/new`),
              }}
            />
          }
        />
      )}
    </Card>
  );
}
