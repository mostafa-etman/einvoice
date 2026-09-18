'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { listBranches } from '@/lib/api/branches';
import {
  createReturnReceipt,
  deleteReceipt,
  listReceipts,
} from '@/lib/api/receipts';
import { useTenant } from '@/lib/tenant-provider';
import { formatMoneyDisplay } from '@/lib/format-number';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TableWrap, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { QueryErrorCard } from '@/components/ui/query-error-card';
import { useMutationToast } from '@/components/ui/use-mutation-toast';

function typeLabel(
  t: ReturnType<typeof useTranslations<'receipts'>>,
  type: string,
) {
  if (type === 'r') return t('typeR');
  if (type === 'SR') return t('typeSR');
  return t('typeS');
}

export default function ReceiptsListPage() {
  const t = useTranslations('receipts');
  const tNav = useTranslations('nav');
  const tRetry = useTranslations('common.actions');
  const locale = useLocale();
  const router = useRouter();
  const { tenantId } = useTenant();
  const toast = useMutationToast();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ['receipts', tenantId],
    queryFn: () => listReceipts(),
  });
  const branches = useQuery({
    queryKey: ['branches', tenantId],
    queryFn: listBranches,
  });

  const remove = useMutation({
    mutationFn: deleteReceipt,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['receipts', tenantId] });
      toast.deleted();
    },
    onError: (e) => toast.error(e, t('deleteFailed')),
  });

  const runReturn = useMutation({
    mutationFn: createReturnReceipt,
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ['receipts', tenantId] });
      router.push(`/${locale}/receipts/${created.id}`);
    },
    onError: (e) => toast.error(e, t('returnReceiptFailed')),
  });

  const branchName = (id: string) =>
    branches.data?.find((b) => b.id === id)?.name ?? id;

  return (
    <div className="space-y-token-lg">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs items={[{ label: tNav('receipts') }]} />
        }
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button
            onClick={() => router.push(`/${locale}/receipts/new`)}
            data-testid="receipts-new"
          >
            {t('new')}
          </Button>
        }
      />
      <p className="text-token-sm text-foreground/70">{t('selfService')}</p>

      {list.isError ? (
        <QueryErrorCard
          message={
            list.error instanceof ApiError ? list.error.message : t('previewFailed')
          }
          retryLabel={tRetry('retry')}
          onRetry={() => void list.refetch()}
        />
      ) : null}

      {list.isLoading ? (
        <Card aria-busy="true">
          <Skeleton className="mb-token-sm w-1/3" />
          <Skeleton />
          <Skeleton className="w-2/3" />
        </Card>
      ) : !list.data?.length ? (
        <EmptyState title={t('empty')} />
      ) : (
        <Card className="space-y-token-sm">
          <h2 className="m-0 text-token-sm font-semibold">{t('saved')}</h2>
          <TableWrap>
            <table className="w-full min-w-[48rem] border-collapse text-token-sm">
              <caption className="sr-only">{t('saved')}</caption>
              <thead>
                <tr className="border-b border-border text-foreground/60">
                  <Th>{t('colNumber')}</Th>
                  <Th>{t('colType')}</Th>
                  <Th>{t('colDate')}</Th>
                  <Th>{t('colBuyer')}</Th>
                  <Th>{t('colAmount')}</Th>
                  <Th>{t('colStatus')}</Th>
                  <Th>{t('actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((row) => (
                  <tr key={row.id} className="border-b border-border">
                    <Td>
                      <Link
                        href={`/${locale}/receipts/${row.id}`}
                        className="font-en text-brand underline-offset-2 hover:underline"
                        dir="ltr"
                      >
                        {row.receiptNumber}
                      </Link>
                      <span className="mt-token-xs block text-token-xs text-foreground/60">
                        {branchName(row.branchId)}
                      </span>
                    </Td>
                    <Td>{typeLabel(t, row.receiptType)}</Td>
                    <Td>
                      <span dir="ltr" className="font-en">
                        {row.dateTimeIssued.slice(0, 16).replace('T', ' ')}
                      </span>
                    </Td>
                    <Td>
                      {row.buyerName || row.buyerType}
                    </Td>
                    <Td>
                      <span dir="ltr">{formatMoneyDisplay(row.totalAmount)}</span>
                    </Td>
                    <Td>
                      <Badge variant={row.status === 'READY' ? 'valid' : 'neutral'}>
                        {row.status === 'READY' ? t('statusReady') : t('statusDraft')}
                      </Badge>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-token-xs">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => router.push(`/${locale}/receipts/${row.id}`)}
                        >
                          {t('view')}
                        </Button>
                        {row.canReturn ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={runReturn.isPending}
                            title={t('returnReceiptHint')}
                            onClick={() => runReturn.mutate(row.id)}
                          >
                            {t('returnReceipt')}
                          </Button>
                        ) : null}
                        {row.isChainTip ? (
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={remove.isPending}
                            onClick={() => remove.mutate(row.id)}
                          >
                            {t('delete')}
                          </Button>
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}
    </div>
  );
}
