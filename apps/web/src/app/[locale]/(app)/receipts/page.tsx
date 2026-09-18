'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatEtaDateTimeIssued } from '@einvoice/eta-core';
import { ApiError } from '@/lib/api/client';
import { listBranches } from '@/lib/api/branches';
import { listPosDevices } from '@/lib/api/pos-devices';
import { getEtaCredentials } from '@/lib/api/eta-credentials';
import { listItemCodes } from '@/lib/api/item-codes';
import {
  createReceipt,
  deleteReceipt,
  listReceipts,
  previewReceipt,
  type ReceiptPreview,
  type ReceiptValidationIssue,
  type ReceiptWrite,
} from '@/lib/api/receipts';
import { useTenant } from '@/lib/tenant-provider';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TableWrap, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { QueryErrorCard } from '@/components/ui/query-error-card';
import { useMutationToast } from '@/components/ui/use-mutation-toast';

type LineForm = {
  internalCode: string;
  description: string;
  itemType: 'EGS' | 'GS1';
  itemCode: string;
  unitType: string;
  quantity: string;
  unitPrice: string;
  tax: boolean;
};

function emptyLine(): LineForm {
  return {
    internalCode: '',
    description: '',
    itemType: 'EGS',
    itemCode: '',
    unitType: 'EA',
    quantity: '1',
    unitPrice: '0.00',
    tax: true,
  };
}

function nowLocalInput() {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

function issueMessage(
  t: ReturnType<typeof useTranslations<'receipts'>>,
  issue: ReceiptValidationIssue,
) {
  const key = issue.messageKey.replace(/^receipts\./, '') as Parameters<typeof t>[0];
  if (t.has(key)) return t(key, issue.params);
  return issue.messageKey;
}

export default function ReceiptsPage() {
  const t = useTranslations('receipts');
  const tNav = useTranslations('nav');
  const tRetry = useTranslations('common.actions');
  const locale = useLocale();
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const toast = useMutationToast();

  const [branchId, setBranchId] = useState('');
  const [posDeviceId, setPosDeviceId] = useState('');
  const [receiptType, setReceiptType] = useState<'s' | 'r' | 'SR'>('s');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [dateTimeIssued, setDateTimeIssued] = useState(nowLocalInput);
  const [paymentMethod, setPaymentMethod] = useState('C');
  const [orderdeliveryMode, setOrderdeliveryMode] = useState('');
  const [referenceUUID, setReferenceUUID] = useState('');
  const [buyerType, setBuyerType] = useState<'P' | 'B' | 'F'>('P');
  const [buyerId, setBuyerId] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [lines, setLines] = useState<LineForm[]>([emptyLine()]);
  const [preview, setPreview] = useState<ReceiptPreview | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const branches = useQuery({
    queryKey: ['branches', tenantId],
    queryFn: listBranches,
    enabled: !!tenantId,
  });
  const pos = useQuery({
    queryKey: ['pos-devices', tenantId, branchId],
    queryFn: () => listPosDevices(branchId || undefined),
    enabled: !!tenantId,
  });
  const creds = useQuery({
    queryKey: ['eta-credentials', tenantId],
    queryFn: () => getEtaCredentials(),
    enabled: !!tenantId,
  });
  const items = useQuery({
    queryKey: ['item-codes', tenantId],
    queryFn: listItemCodes,
    enabled: !!tenantId,
  });
  const list = useQuery({
    queryKey: ['receipts', tenantId, branchId, posDeviceId],
    queryFn: () =>
      listReceipts({
        branchId: branchId || undefined,
        posDeviceId: posDeviceId || undefined,
      }),
    enabled: !!tenantId,
  });

  const receiptBranches = useMemo(
    () => (branches.data ?? []).filter((b) => b.receiptsEnabled),
    [branches.data],
  );
  const activePos = useMemo(
    () =>
      (pos.data ?? []).filter(
        (d) => d.status === 'ACTIVE' && (!branchId || d.branchId === branchId),
      ),
    [pos.data, branchId],
  );

  const selectedBranch = receiptBranches.find((b) => b.id === branchId);
  const resolvedType =
    receiptType ||
    (selectedBranch?.defaultReceiptType as typeof receiptType | null) ||
    (creds.data?.defaultReceiptType as typeof receiptType | undefined) ||
    's';

  function buildBody(): ReceiptWrite {
    const branch = branchId || receiptBranches[0]?.id || '';
    const posId = posDeviceId || activePos[0]?.id || '';
    return {
      branchId: branch,
      posDeviceId: posId,
      receiptType: resolvedType,
      receiptNumber: receiptNumber.trim() || undefined,
      dateTimeIssued: formatEtaDateTimeIssued(new Date(dateTimeIssued)),
      paymentMethod,
      orderdeliveryMode:
        resolvedType === 'SR' ? orderdeliveryMode.trim() || undefined : undefined,
      referenceUUID: resolvedType === 'r' ? referenceUUID.trim() || undefined : undefined,
      buyer: {
        type: buyerType,
        id: buyerId.trim() || undefined,
        name: buyerName.trim() || undefined,
      },
      lines: lines.map((line) => ({
        internalCode: line.internalCode.trim(),
        description: line.description.trim(),
        itemType: line.itemType,
        itemCode: line.itemCode.trim(),
        unitType: line.unitType.trim() || 'EA',
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxes: line.tax
          ? [{ taxType: 'T1', subType: 'V009', rate: '14' }]
          : undefined,
      })),
    };
  }

  const previewMut = useMutation({
    mutationFn: () => previewReceipt(buildBody()),
    onSuccess: (data) => {
      setPreview(data);
      setFormError(null);
    },
    onError: (err) => {
      setPreview(null);
      setFormError(err instanceof Error ? err.message : t('previewFailed'));
      toast.error(err);
    },
  });

  const saveMut = useMutation({
    mutationFn: () => createReceipt(buildBody()),
    onSuccess: async () => {
      setPreview(null);
      setFormError(null);
      setReceiptNumber('');
      await qc.invalidateQueries({ queryKey: ['receipts', tenantId] });
      await qc.invalidateQueries({ queryKey: ['pos-devices', tenantId] });
      toast.created();
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : t('saveFailed'));
      toast.error(err);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteReceipt(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['receipts', tenantId] });
      await qc.invalidateQueries({ queryKey: ['pos-devices', tenantId] });
      toast.deleted();
    },
    onError: (err) => toast.error(err),
  });

  const apiIssues = (preview?.issues ?? []).filter((i) => i.severity === 'error');
  const errorBody =
    saveMut.error instanceof ApiError ? saveMut.error.body : previewMut.error instanceof ApiError
      ? previewMut.error.body
      : null;
  const bodyIssues = Array.isArray((errorBody as { issues?: ReceiptValidationIssue[] } | null)?.issues)
    ? ((errorBody as { issues: ReceiptValidationIssue[] }).issues)
    : [];

  return (
    <div className="space-y-token-lg">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { href: `/${locale}`, label: tNav('home') },
              { label: t('title') },
            ]}
          />
        }
      />

      <Card>
        <p className="m-0 text-token-sm text-foreground-muted">{t('selfService')}</p>
        <div className="mt-token-md grid gap-token-sm sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label={t('branch')}
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              setPosDeviceId('');
            }}
          >
            <option value="">{t('selectBranch')}</option>
            {receiptBranches.map((b) => (
              <option key={b.id} value={b.id} disabled={!b.receiptsReady}>
                {b.name}
                {b.receiptsReady ? '' : ` — ${t('branchNotReady')}`}
              </option>
            ))}
          </Select>
          <Select
            label={t('posDevice')}
            value={posDeviceId}
            onChange={(e) => setPosDeviceId(e.target.value)}
          >
            <option value="">{t('selectPos')}</option>
            {activePos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} ({d.serialNumber})
              </option>
            ))}
          </Select>
          <Select
            label={t('receiptType')}
            hint={t('receiptTypeHelp')}
            value={resolvedType}
            onChange={(e) => setReceiptType(e.target.value as 's' | 'r' | 'SR')}
          >
            <option value="s">{t('typeS')}</option>
            <option value="r">{t('typeR')}</option>
            <option value="SR">{t('typeSR')}</option>
          </Select>
          <Input
            label={t('receiptNumber')}
            hint={t('receiptNumberHelp')}
            dir="ltr"
            value={receiptNumber}
            onChange={(e) => setReceiptNumber(e.target.value)}
          />
          <Input
            type="datetime-local"
            label={t('dateTimeIssued')}
            value={dateTimeIssued}
            onChange={(e) => setDateTimeIssued(e.target.value)}
          />
          <Select
            label={t('paymentMethod')}
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
          >
            <option value="C">{t('payC')}</option>
            <option value="V">{t('payV')}</option>
            <option value="CC">{t('payCC')}</option>
            <option value="VC">{t('payVC')}</option>
            <option value="VO">{t('payVO')}</option>
            <option value="PR">{t('payPR')}</option>
            <option value="GC">{t('payGC')}</option>
            <option value="P">{t('payP')}</option>
            <option value="O">{t('payO')}</option>
          </Select>
          {resolvedType === 'SR' ? (
            <Input
              label={t('orderDeliveryMode')}
              hint={t('orderDeliveryModeHelp')}
              dir="ltr"
              value={orderdeliveryMode}
              onChange={(e) => setOrderdeliveryMode(e.target.value)}
            />
          ) : null}
          {resolvedType === 'r' ? (
            <Input
              label={t('referenceUuid')}
              hint={t('referenceUuidHelp')}
              dir="ltr"
              value={referenceUUID}
              onChange={(e) => setReferenceUUID(e.target.value)}
            />
          ) : null}
        </div>

        <h2 className="mt-token-lg text-token-md font-semibold">{t('buyer')}</h2>
        <div className="mt-token-sm grid gap-token-sm sm:grid-cols-3">
          <Select
            label={t('buyerType')}
            value={buyerType}
            onChange={(e) => setBuyerType(e.target.value as 'P' | 'B' | 'F')}
          >
            <option value="P">{t('buyerP')}</option>
            <option value="B">{t('buyerB')}</option>
            <option value="F">{t('buyerF')}</option>
          </Select>
          <Input
            label={t('buyerId')}
            hint={t('buyerIdHelp')}
            dir="ltr"
            value={buyerId}
            onChange={(e) => setBuyerId(e.target.value)}
          />
          <Input
            label={t('buyerName')}
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
          />
        </div>

        <h2 className="mt-token-lg text-token-md font-semibold">{t('lines')}</h2>
        <div className="mt-token-sm space-y-token-md">
          {lines.map((line, i) => (
            <div
              key={i}
              className="grid gap-token-sm rounded-lg border border-border p-token-sm sm:grid-cols-2 lg:grid-cols-4"
            >
              <Input
                label={t('internalCode')}
                dir="ltr"
                value={line.internalCode}
                onChange={(e) =>
                  setLines((rows) =>
                    rows.map((row, idx) =>
                      idx === i ? { ...row, internalCode: e.target.value } : row,
                    ),
                  )
                }
              />
              <Input
                label={t('description')}
                value={line.description}
                onChange={(e) =>
                  setLines((rows) =>
                    rows.map((row, idx) =>
                      idx === i ? { ...row, description: e.target.value } : row,
                    ),
                  )
                }
              />
              <Select
                label={t('itemCode')}
                value={line.itemCode}
                onChange={(e) => {
                  const code = items.data?.find((c) => c.code === e.target.value);
                  setLines((rows) =>
                    rows.map((row, idx) =>
                      idx === i
                        ? {
                            ...row,
                            itemCode: e.target.value,
                            itemType: code?.type ?? row.itemType,
                            description: row.description || code?.description || '',
                            internalCode: row.internalCode || e.target.value,
                          }
                        : row,
                    ),
                  );
                }}
              >
                <option value="">{t('selectItem')}</option>
                {(items.data ?? [])
                  .filter((c) => c.isActive)
                  .map((c) => (
                    <option key={c.id} value={c.code}>
                      {c.code} — {c.description}
                    </option>
                  ))}
              </Select>
              <Input
                label={t('unitPrice')}
                dir="ltr"
                value={line.unitPrice}
                onChange={(e) =>
                  setLines((rows) =>
                    rows.map((row, idx) =>
                      idx === i ? { ...row, unitPrice: e.target.value } : row,
                    ),
                  )
                }
              />
              <Input
                label={t('quantity')}
                dir="ltr"
                value={line.quantity}
                onChange={(e) =>
                  setLines((rows) =>
                    rows.map((row, idx) =>
                      idx === i ? { ...row, quantity: e.target.value } : row,
                    ),
                  )
                }
              />
              <label className="flex items-center gap-token-xs text-token-sm">
                <input
                  type="checkbox"
                  checked={line.tax}
                  onChange={(e) =>
                    setLines((rows) =>
                      rows.map((row, idx) =>
                        idx === i ? { ...row, tax: e.target.checked } : row,
                      ),
                    )
                  }
                />
                {t('vat14')}
              </label>
            </div>
          ))}
        </div>
        <div className="mt-token-sm flex flex-wrap gap-token-sm">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setLines((rows) => [...rows, emptyLine()])}
          >
            {t('addLine')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => previewMut.mutate()}
            disabled={previewMut.isPending}
          >
            {t('preview')}
          </Button>
          <Button
            type="button"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
          >
            {t('save')}
          </Button>
        </div>
        {formError ? (
          <p className="mt-token-sm text-token-sm text-danger" role="alert">
            {formError}
          </p>
        ) : null}
        {[...apiIssues, ...bodyIssues].length ? (
          <ul className="mt-token-sm list-disc ps-token-lg text-token-sm text-danger" role="alert">
            {[...apiIssues, ...bodyIssues].map((issue, i) => (
              <li key={`${issue.code}-${i}`}>{issueMessage(t, issue)}</li>
            ))}
          </ul>
        ) : null}
      </Card>

      {preview ? (
        <Card>
          <h2 className="m-0 text-token-md font-semibold">{t('previewTitle')}</h2>
          <dl className="mt-token-sm grid gap-token-xs text-token-sm sm:grid-cols-2">
            <div>
              <dt className="text-foreground-muted">{t('uuid')}</dt>
              <dd className="m-0 font-mono" dir="ltr">
                {preview.uuid}
              </dd>
            </div>
            <div>
              <dt className="text-foreground-muted">{t('previousUuid')}</dt>
              <dd className="m-0 font-mono" dir="ltr">
                {preview.previousUUID || t('firstOnPos')}
              </dd>
            </div>
            <div>
              <dt className="text-foreground-muted">{t('totalAmount')}</dt>
              <dd className="m-0">{preview.totals.totalAmount}</dd>
            </div>
            <div>
              <dt className="text-foreground-muted">{t('netAmount')}</dt>
              <dd className="m-0">{preview.totals.netAmount}</dd>
            </div>
          </dl>
          <pre
            className="mt-token-md max-h-64 overflow-auto rounded-lg bg-surface-muted p-token-sm text-token-xs"
            dir="ltr"
          >
            {JSON.stringify(preview.etaPayload, null, 2)}
          </pre>
        </Card>
      ) : null}

      {list.isError ? (
        <QueryErrorCard
          message={list.error instanceof Error ? list.error.message : tRetry('retry')}
          retryLabel={tRetry('retry')}
          onRetry={() => void list.refetch()}
        />
      ) : list.isLoading ? (
        <Card aria-busy="true">
          <Skeleton className="mb-token-sm" />
          <Skeleton className="w-2/3" />
        </Card>
      ) : !list.data?.length ? (
        <EmptyState title={t('empty')} />
      ) : (
        <Card>
          <h2 className="m-0 text-token-md font-semibold">{t('saved')}</h2>
          <TableWrap className="mt-token-sm">
            <table>
              <thead>
                <tr>
                  <Th>{t('receiptNumber')}</Th>
                  <Th>{t('receiptType')}</Th>
                  <Th>{t('uuid')}</Th>
                  <Th>{t('previousUuid')}</Th>
                  <Th>{t('totalAmount')}</Th>
                  <Th>{t('actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((row) => (
                  <tr key={row.id}>
                    <Td>{row.receiptNumber}</Td>
                    <Td>
                      <Badge>{row.receiptType}</Badge>
                    </Td>
                    <Td>
                      <span className="font-mono text-token-xs" dir="ltr">
                        {row.uuid.slice(0, 12)}…
                      </span>
                    </Td>
                    <Td>
                      <span className="font-mono text-token-xs" dir="ltr">
                        {row.previousUuid ? `${row.previousUuid.slice(0, 12)}…` : '—'}
                      </span>
                    </Td>
                    <Td>{row.totalAmount}</Td>
                    <Td>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => deleteMut.mutate(row.id)}
                      >
                        {tRetry('delete')}
                      </Button>
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
