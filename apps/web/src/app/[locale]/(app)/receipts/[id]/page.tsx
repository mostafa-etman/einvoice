'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  calculateLine,
  defaultTaxableTax,
  ETA_EXEMPT_SUBTYPES,
  ETA_ZERO_RATED_SUBTYPES,
  formatEtaDateTimeIssued,
  inferLineTaxMode,
  isFixedAmountTaxType,
  isFullyTaxFree,
  RECEIPT_PAYMENT_METHODS,
  sortEtaCodeEntries,
  subtypesForTaxType,
  taxesForMode,
  type LineTaxMode,
} from '@einvoice/eta-core';
import { LocalPdfPreviewModal } from '@/components/local-pdf-preview-modal';
import { CustomerPicker } from '@/components/customers/customer-picker';
import { ApiError } from '@/lib/api/client';
import { listBranches } from '@/lib/api/branches';
import { getCompanyProfile } from '@/lib/api/company';
import { listTenantCurrencies } from '@/lib/api/currencies';
import { getEtaCredentials } from '@/lib/api/eta-credentials';
import { listEtaCodes, type EtaCodeEntry } from '@/lib/api/eta-codes';
import { listItemCodes, type ItemCode } from '@/lib/api/item-codes';
import { listPosDevices } from '@/lib/api/pos-devices';
import {
  createReceipt,
  createReturnReceipt,
  deleteReceipt,
  downloadReceiptLocalPrintoutFromBody,
  getReceipt,
  previewReceipt,
  updateReceipt,
  type ReceiptWrite,
} from '@/lib/api/receipts';
import type { DocumentUpsert } from '@/lib/api/documents';
import { catalogOptionLabel } from '@/lib/eta-display';
import { formatMoneyDisplay } from '@/lib/format-number';
import {
  removeRowByKey,
  stripRowKey,
  withRowKey,
  withRowKeys,
  type RowKeyed,
} from '@/lib/documents/line-rows';
import { useTenant } from '@/lib/tenant-provider';
import { cn } from '@/lib/cn';
import { LineTaxesEditor, taxRowSummary } from '../../documents/[id]/line-taxes-editor';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { CopyButton } from '@/components/ui/copy-button';
import { QueryErrorCard } from '@/components/ui/query-error-card';
import { tableStickyFirstClass } from '@/components/ui/table';
import { useMutationToast } from '@/components/ui/use-mutation-toast';

type Line = DocumentUpsert['lines'][number];
type LineRow = RowKeyed<Line>;
type UiTaxMode = 'taxable' | 'zero_or_exempt' | 'none';
type ReceiptType = 's' | 'r' | 'SR';

function fieldClass() {
  return 'mt-token-xs w-full rounded-control border border-border-strong bg-surface px-input-x py-input-y text-token-sm';
}

function cellClass() {
  return 'w-full rounded-control border border-border-strong bg-surface px-token-xs py-token-xs text-token-xs';
}

function emptyLine(currency = 'EGP'): Line {
  return {
    description: '',
    itemType: 'EGS',
    itemCode: '',
    unitType: 'EA',
    quantity: '1',
    unitPrice: '0.00',
    discountAmount: '0.00',
    discountRate: '0',
    currencySold: currency,
    amountEGP: '0.00',
    internalCode: '',
    taxes: [defaultTaxableTax()],
  };
}

function nowLocalInput() {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

function lineTotalDisplay(line: Line): string {
  try {
    return calculateLine(line).total;
  } catch {
    return '—';
  }
}

function issueMessage(
  t: ReturnType<typeof useTranslations<'receipts'>>,
  issue: { messageKey: string; params?: Record<string, string> },
) {
  const key = issue.messageKey.replace(/^receipts\./, '') as Parameters<typeof t>[0];
  if (t.has(key)) return t(key, issue.params);
  return issue.messageKey;
}

export default function ReceiptEditorPage() {
  const t = useTranslations('receipts');
  const td = useTranslations('documents');
  const tNav = useTranslations('nav');
  const tRetry = useTranslations('common.actions');
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ id: string; locale: string }>();
  const { tenantId } = useTenant();
  const toast = useMutationToast();
  const isNew = params.id === 'new';

  const [receiptType, setReceiptType] = useState<ReceiptType>('s');
  const [branchId, setBranchId] = useState('');
  const [posDeviceId, setPosDeviceId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('EGP');
  const [exchangeRate, setExchangeRate] = useState('0');
  const [issueDateTime, setIssueDateTime] = useState(nowLocalInput);
  const [receiptNumber, setReceiptNumber] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('C');
  const [orderDeliveryMode, setOrderDeliveryMode] = useState('');
  const [referenceUUID, setReferenceUUID] = useState('');
  const [buyerType, setBuyerType] = useState<'P' | 'B' | 'F'>('P');
  const [buyerId, setBuyerId] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerMobile, setBuyerMobile] = useState('');
  const [buyerPaymentNumber, setBuyerPaymentNumber] = useState('');
  const [lines, setLines] = useState<LineRow[]>(() => [withRowKey(emptyLine())]);
  const [showSeller, setShowSeller] = useState(false);
  const [showBuyer, setShowBuyer] = useState(true);
  const [showDevPreview, setShowDevPreview] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [taxModalLineIdx, setTaxModalLineIdx] = useState<number | null>(null);
  const [taxFreeWarningDismissed, setTaxFreeWarningDismissed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [uuid, setUuid] = useState('');
  const [previousUuid, setPreviousUuid] = useState('');
  const [status, setStatus] = useState('DRAFT');
  const [isChainTip, setIsChainTip] = useState(true);
  const [canReturn, setCanReturn] = useState(false);
  const [etaJson, setEtaJson] = useState('');
  const [canonical, setCanonical] = useState('');
  const [totals, setTotals] = useState<Record<string, unknown> | null>(null);

  const branchesQ = useQuery({
    queryKey: ['branches', tenantId],
    queryFn: listBranches,
  });
  const posQ = useQuery({
    queryKey: ['pos-devices', tenantId],
    queryFn: () => listPosDevices(),
  });
  const credsQ = useQuery({
    queryKey: ['eta-credentials', tenantId],
    queryFn: () => getEtaCredentials(),
  });
  const companyQ = useQuery({
    queryKey: ['company', tenantId],
    queryFn: getCompanyProfile,
  });
  const currenciesQ = useQuery({
    queryKey: ['currencies', tenantId],
    queryFn: listTenantCurrencies,
  });
  const itemsQ = useQuery({
    queryKey: ['item-codes', tenantId],
    queryFn: listItemCodes,
  });
  const receiptQ = useQuery({
    queryKey: ['receipt', tenantId, params.id],
    queryFn: () => getReceipt(params.id),
    enabled: !isNew,
  });

  const [unitTypes, setUnitTypes] = useState<EtaCodeEntry[]>([]);
  const [taxTypes, setTaxTypes] = useState<EtaCodeEntry[]>([]);
  const [taxSubtypes, setTaxSubtypes] = useState<EtaCodeEntry[]>([]);

  useEffect(() => {
    void Promise.all([
      listEtaCodes('UNIT_TYPE', { limit: 200 }),
      listEtaCodes('TAX_TYPE', { limit: 100 }),
      listEtaCodes('TAX_SUBTYPE', { limit: 500 }),
    ]).then(([units, types, subtypes]) => {
      setUnitTypes(units.entries ?? []);
      setTaxTypes(types.entries ?? []);
      setTaxSubtypes(subtypes.entries ?? []);
    });
  }, []);

  const receiptBranches = useMemo(
    () => (branchesQ.data ?? []).filter((b) => b.receiptsEnabled && b.isActive),
    [branchesQ.data],
  );
  const companyScope = companyQ.data?.posSerialScope === 'COMPANY';
  const sharedPosId = companyQ.data?.sharedPosDeviceId ?? '';
  const activePos = useMemo(
    () => (posQ.data ?? []).filter((p) => p.status === 'ACTIVE'),
    [posQ.data],
  );
  const posForBranch = useMemo(() => {
    if (companyScope) {
      if (sharedPosId) return activePos.filter((p) => p.id === sharedPosId);
      return activePos;
    }
    return activePos.filter((p) => p.branchId === branchId);
  }, [activePos, branchId, companyScope, sharedPosId]);

  useEffect(() => {
    if (!isNew) return;
    if (!branchId && receiptBranches[0]) setBranchId(receiptBranches[0].id);
  }, [isNew, branchId, receiptBranches]);

  useEffect(() => {
    if (!isNew) return;
    const selected = receiptBranches.find((b) => b.id === branchId);
    const nextType =
      (selected?.defaultReceiptType as ReceiptType | null) ||
      (credsQ.data?.defaultReceiptType as ReceiptType | undefined) ||
      's';
    setReceiptType(nextType);
    if (selected?.defaultCurrencyCode) setCurrencyCode(selected.defaultCurrencyCode);
  }, [isNew, branchId, receiptBranches, credsQ.data?.defaultReceiptType]);

  useEffect(() => {
    if (companyScope && sharedPosId) {
      setPosDeviceId(sharedPosId);
      return;
    }
    if (posForBranch.some((p) => p.id === posDeviceId)) return;
    if (posForBranch[0]) setPosDeviceId(posForBranch[0].id);
  }, [companyScope, sharedPosId, posForBranch, posDeviceId]);

  useEffect(() => {
    if (!receiptQ.data) return;
    const row = receiptQ.data;
    const form = row.form;
    setStatus(row.status);
    setUuid(row.uuid);
    setPreviousUuid(row.previousUuid);
    setIsChainTip(row.isChainTip !== false);
    setCanReturn(Boolean(row.canReturn));
    setReceiptType((form?.receiptType as ReceiptType) || (row.receiptType as ReceiptType));
    setBranchId(form?.branchId || row.branchId);
    setPosDeviceId(form?.posDeviceId || row.posDeviceId);
    setCurrencyCode(row.currencyCode || 'EGP');
    setExchangeRate(row.exchangeRate || '0');
    setReceiptNumber(form?.receiptNumber || row.receiptNumber);
    setPaymentMethod(form?.paymentMethod || row.paymentMethod || 'C');
    setOrderDeliveryMode(form?.orderdeliveryMode || row.orderDeliveryMode || '');
    setReferenceUUID(form?.referenceUUID || row.referenceUuid || '');
    setBuyerType((form?.buyer.type as 'P' | 'B' | 'F') || (row.buyerType as 'P' | 'B' | 'F') || 'P');
    setBuyerId(form?.buyer.id || row.buyerId || '');
    setBuyerName(form?.buyer.name || row.buyerName || '');
    setBuyerMobile(form?.buyer.mobileNumber || '');
    setBuyerPaymentNumber(form?.buyer.paymentNumber || '');
    const issued = new Date(form?.dateTimeIssued || row.dateTimeIssued);
    if (!Number.isNaN(issued.getTime())) {
      setIssueDateTime(
        new Date(issued.getTime() - issued.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16),
      );
    }
    const mapped = (form?.lines ?? []).map((l) => ({
      description: l.description,
      itemType: l.itemType,
      itemCode: l.itemCode,
      unitType: l.unitType,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountAmount: l.commercialDiscountData?.[0]?.amount ?? '0.00',
      discountRate: l.commercialDiscountData?.[0]?.rate ?? '0',
      internalCode: l.internalCode,
      taxes: l.taxes ?? [defaultTaxableTax()],
    }));
    setLines(mapped.length ? withRowKeys(mapped) : [withRowKey(emptyLine())]);
    setEtaJson(JSON.stringify(row.etaPayload, null, 2));
    setCanonical(row.canonicalString);
    setTotals({
      totalSales: row.totalSales,
      netAmount: row.netAmount,
      totalAmount: row.totalAmount,
    });
  }, [receiptQ.data]);

  const selectedBranch = receiptBranches.find((b) => b.id === branchId);
  const selectedPos = posForBranch.find((p) => p.id === posDeviceId) ?? activePos.find((p) => p.id === posDeviceId);
  const documentReadOnly = !isNew && !isChainTip;
  const currencies = (currenciesQ.data ?? []).map((c) => c.currencyCode);
  const currencyOptions = currencies.length ? currencies : ['EGP'];
  const itemCodes: ItemCode[] = itemsQ.data ?? [];

  const issueIso = useMemo(() => {
    const d = new Date(issueDateTime);
    if (Number.isNaN(d.getTime())) return new Date().toISOString();
    return formatEtaDateTimeIssued(d);
  }, [issueDateTime]);

  const body = (): ReceiptWrite => ({
    branchId,
    posDeviceId: posDeviceId || undefined,
    receiptType,
    receiptNumber: receiptNumber.trim() || undefined,
    dateTimeIssued: issueIso,
    currencyCode,
    exchangeRate: currencyCode === 'EGP' ? 0 : exchangeRate,
    referenceUUID: receiptType === 'r' ? referenceUUID || undefined : undefined,
    orderdeliveryMode: receiptType === 'SR' ? orderDeliveryMode || undefined : orderDeliveryMode || undefined,
    paymentMethod,
    buyer: {
      type: buyerType,
      id: buyerId.trim() || undefined,
      name: buyerName.trim() || undefined,
      mobileNumber: buyerMobile.trim() || undefined,
      paymentNumber: buyerPaymentNumber.trim() || undefined,
    },
    lines: lines.map(stripRowKey).map((l) => ({
      internalCode: String(l.internalCode || l.itemCode || ''),
      description: l.description,
      itemType: l.itemType,
      itemCode: l.itemCode,
      unitType: l.unitType,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxes: (l.taxes ?? []).map((tx) => {
        const fixed = isFixedAmountTaxType(tx.taxType);
        return {
          taxType: tx.taxType,
          subType: tx.subType,
          rate: fixed ? '0' : tx.rate,
          ...(fixed ? { amount: tx.amount ?? '0.00' } : {}),
        };
      }),
      ...(l.discountAmount && l.discountAmount !== '0' && l.discountAmount !== '0.00'
        ? { commercialDiscountData: [{ amount: l.discountAmount }] }
        : {}),
    })),
  });

  const refreshPreview = async () => {
    if (!branchId || !lines.length) {
      setTotals(null);
      return;
    }
    try {
      const preview = await previewReceipt(body());
      setCanonical(preview.uuidCanonicalString);
      setEtaJson(JSON.stringify(preview.etaPayload, null, 2));
      setTotals(preview.totals as unknown as Record<string, unknown>);
      setUuid(preview.uuid);
      setPreviousUuid(preview.previousUUID);
      setIssues(
        preview.issues.map((i) => issueMessage(t, i)),
      );
    } catch {
      /* incomplete form */
    }
  };

  useEffect(() => {
    const handle = setTimeout(() => {
      void refreshPreview();
    }, 400);
    return () => clearTimeout(handle);
  }, [
    receiptType,
    branchId,
    posDeviceId,
    currencyCode,
    exchangeRate,
    receiptNumber,
    issueDateTime,
    paymentMethod,
    orderDeliveryMode,
    referenceUUID,
    buyerType,
    buyerId,
    buyerName,
    buyerMobile,
    buyerPaymentNumber,
    lines,
  ]);

  const updateLine = (idx: number, patch: Partial<Line>) => {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, ...patch };
      return next;
    });
  };
  const addLine = () => setLines((prev) => [...prev, withRowKey(emptyLine(currencyCode))]);
  const removeLine = (rowKey: string) => {
    setTaxModalLineIdx((openIdx) => {
      if (openIdx == null) return null;
      const openKey = lines[openIdx]?.rowKey;
      if (openKey === rowKey) return null;
      const next = removeRowByKey(lines, rowKey);
      const nextIdx = next.findIndex((l) => l.rowKey === openKey);
      return nextIdx >= 0 ? nextIdx : null;
    });
    setLines((prev) => removeRowByKey(prev, rowKey));
  };

  const setLineTaxMode = (idx: number, uiMode: UiTaxMode) => {
    const line = lines[idx]!;
    const current = inferLineTaxMode(line.taxes);
    if (uiMode === 'taxable') {
      updateLine(idx, {
        taxes: taxesForMode('taxable', {
          taxes: current === 'taxable' ? line.taxes : [defaultTaxableTax()],
        }),
      });
      return;
    }
    if (uiMode === 'none') {
      updateLine(idx, { taxes: [] });
      setTaxFreeWarningDismissed(false);
      return;
    }
    const kind: LineTaxMode = current === 'exempt' ? 'exempt' : 'zero_rated';
    const sub = line.taxes?.[0]?.subType;
    updateLine(idx, {
      taxes: taxesForMode(kind, {
        zeroRatedSubtype:
          kind === 'zero_rated' &&
          (ETA_ZERO_RATED_SUBTYPES as readonly string[]).includes(sub ?? '')
            ? sub
            : undefined,
        exemptSubtype:
          kind === 'exempt' && (ETA_EXEMPT_SUBTYPES as readonly string[]).includes(sub ?? '')
            ? sub
            : undefined,
      }),
    });
  };

  const setLineZeroExemptKind = (idx: number, kind: 'zero_rated' | 'exempt') => {
    const line = lines[idx]!;
    const sub = line.taxes?.[0]?.subType;
    updateLine(idx, {
      taxes: taxesForMode(kind, {
        zeroRatedSubtype:
          kind === 'zero_rated' &&
          (ETA_ZERO_RATED_SUBTYPES as readonly string[]).includes(sub ?? '')
            ? sub
            : undefined,
        exemptSubtype:
          kind === 'exempt' && (ETA_EXEMPT_SUBTYPES as readonly string[]).includes(sub ?? '')
            ? sub
            : undefined,
      }),
    });
  };

  const showTaxFreeWarning = isFullyTaxFree(lines) && !taxFreeWarningDismissed;
  const vatSubtypes = subtypesForTaxType(taxSubtypes, 'T1');
  const zeroRatedSubtypeOptions = vatSubtypes.filter((s) =>
    (ETA_ZERO_RATED_SUBTYPES as readonly string[]).includes(s.code),
  );
  const exemptSubtypeOptions = vatSubtypes.filter((s) =>
    (ETA_EXEMPT_SUBTYPES as readonly string[]).includes(s.code),
  );
  const taxTypeOptions = taxTypes.length
    ? sortEtaCodeEntries(taxTypes)
    : [
        {
          code: 'T1',
          nameEn: td('taxTypeVatFallbackEn'),
          nameAr: td('taxTypeVatFallbackAr'),
          parentCode: null,
          meta: null,
        },
      ];
  const subtypeOptionsFor = (taxType: string) => subtypesForTaxType(taxSubtypes, taxType);
  const sectionTitle = (label: string) => (
    <h2 className="m-0 text-token-sm font-semibold text-foreground">{label}</h2>
  );
  const taxModalLine = taxModalLineIdx == null ? null : (lines[taxModalLineIdx] ?? null);

  const save = async () => {
    try {
      setSubmitting(true);
      setError(null);
      if (isNew) {
        const created = await createReceipt(body());
        toast.saved();
        router.replace(`/${locale}/receipts/${created.id}`);
      } else {
        const updated = await updateReceipt(params.id, body());
        setUuid(updated.uuid);
        setPreviousUuid(updated.previousUuid);
        setEtaJson(JSON.stringify(updated.etaPayload, null, 2));
        setCanonical(updated.canonicalString);
        toast.saved();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveFailed'));
      toast.error(e, t('saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isNew && receiptQ.isError) {
    return (
      <QueryErrorCard
        message={
          receiptQ.error instanceof ApiError ? receiptQ.error.message : t('previewFailed')
        }
        retryLabel={tRetry('retry')}
        onRetry={() => void receiptQ.refetch()}
      />
    );
  }

  return (
    <div className="w-full space-y-token-lg pb-[4.5rem]" data-testid="receipt-detail">
      <div className="space-y-token-lg">
        <PageHeader
          breadcrumbs={
            <Breadcrumbs
              items={[
                { label: tNav('receipts'), href: `/${locale}/receipts` },
                { label: isNew ? t('new') : receiptNumber || t('title') },
              ]}
            />
          }
          title={isNew ? t('new') : receiptNumber}
          subtitle={
            !isNew ? (
              <span className="inline-flex flex-wrap items-center gap-token-sm">
                <Badge variant={status === 'READY' ? 'valid' : 'draft'}>
                  {status === 'READY' ? t('statusReady') : t('statusDraft')}
                </Badge>
              </span>
            ) : undefined
          }
        />
        <p className="text-token-sm text-foreground/70">{t('selfService')}</p>
        {selectedBranch && !selectedBranch.receiptsReady ? (
          <div
            role="status"
            className="space-y-token-xs rounded border border-danger/40 bg-danger/5 p-token-sm text-token-sm"
          >
            <p className="font-medium">{td('issuerFromSettingsTitle')}</p>
            <p>{t('sellerFromSettings')}</p>
            <Link href={`/${locale}/settings/branches`} className="text-brand underline">
              {td('issuerFromSettingsLink')}
            </Link>
          </div>
        ) : null}
        {showTaxFreeWarning ? (
          <div
            role="status"
            className="space-y-token-xs rounded-lg border border-warning bg-warning-muted p-token-sm text-token-sm"
          >
            <p className="font-medium">{td('taxFreeWarningTitle')}</p>
            <p>{td('taxFreeWarningBody')}</p>
            <button
              type="button"
              className="text-brand underline"
              onClick={() => setTaxFreeWarningDismissed(true)}
            >
              {td('taxFreeWarningDismiss')}
            </button>
          </div>
        ) : null}
        {!isNew ? (
          <Card className="space-y-token-xs text-token-sm">
            {uuid ? (
              <p className="inline-flex flex-wrap items-center gap-token-xs">
                <span className="font-medium">{t('uuid')}:</span>
                <span dir="ltr" className="font-en">
                  {uuid}
                </span>
                <CopyButton value={uuid} />
              </p>
            ) : null}
            <p>
              <span className="font-medium">{t('previousUuid')}:</span>{' '}
              <span dir="ltr" className="font-en">
                {previousUuid || t('firstOnPos')}
              </span>
            </p>
            {!isChainTip ? (
              <p className="text-warning" role="status">
                {t('notChainTip')}
              </p>
            ) : null}
            {canReturn ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={submitting}
                title={t('returnReceiptHint')}
                onClick={async () => {
                  try {
                    setSubmitting(true);
                    const created = await createReturnReceipt(params.id);
                    router.push(`/${locale}/receipts/${created.id}`);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : t('returnReceiptFailed'));
                  } finally {
                    setSubmitting(false);
                  }
                }}
              >
                {t('returnReceipt')}
              </Button>
            ) : null}
          </Card>
        ) : null}
        {error ? (
          <p role="alert" className="text-token-sm text-danger">
            {error}
          </p>
        ) : null}
        {issues.length ? (
          <ul className="list-disc ps-token-md text-token-sm text-warning">
            {issues.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        ) : null}

        <fieldset
          disabled={documentReadOnly}
          className="min-w-0 space-y-token-lg border-0 p-0 disabled:opacity-[0.92]"
        >
          <section className="grid grid-cols-1 gap-token-sm rounded border border-border bg-surface p-token-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-3 xl:col-span-4">
              {sectionTitle(t('sectionHeader'))}
            </div>
            <label className="block text-token-sm">
              {t('receiptType')}
              <select
                className={fieldClass()}
                value={receiptType}
                onChange={(e) => setReceiptType(e.target.value as ReceiptType)}
              >
                <option value="s">{t('typeS')}</option>
                <option value="r">{t('typeR')}</option>
                <option value="SR">{t('typeSR')}</option>
              </select>
              <span className="mt-token-xs block text-token-xs text-foreground/60">
                {t('receiptTypeHelp')}
              </span>
            </label>
            <label className="block text-token-sm">
              {t('branch')}
              <select
                className={fieldClass()}
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
              >
                {receiptBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.receiptsReady ? '' : ` (${t('branchNotReady')})`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-token-sm">
              {t('currency')}
              <select
                className={fieldClass()}
                value={currencyCode}
                onChange={(e) => setCurrencyCode(e.target.value)}
              >
                {currencyOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-token-sm">
              {td('issueDate')}
              <input
                type="datetime-local"
                className={fieldClass()}
                value={issueDateTime}
                onChange={(e) => setIssueDateTime(e.target.value)}
              />
            </label>
            <label className="block text-token-sm sm:col-span-2">
              {t('receiptNumber')}
              <input
                className={fieldClass()}
                value={receiptNumber}
                onChange={(e) => setReceiptNumber(e.target.value)}
              />
              <span className="mt-token-xs block text-token-xs text-foreground/60">
                {t('receiptNumberHelp')}
              </span>
            </label>
          </section>

          <section
            className="grid grid-cols-1 gap-token-sm rounded border border-brand/30 bg-brand/5 p-token-sm sm:grid-cols-2 lg:grid-cols-3"
            data-testid="receipt-extras"
          >
            <div className="sm:col-span-2 lg:col-span-3">
              {sectionTitle(t('sectionExtra'))}
              <p className="mt-token-xs text-token-xs text-foreground/70">{t('sectionExtraHelp')}</p>
              <p className="mt-token-xs text-token-xs text-foreground/60">
                {companyScope ? t('posLockedCompany') : t('posPerBranch')}
              </p>
            </div>
            <label className="block text-token-sm">
              {t('posDevice')}
              <select
                className={fieldClass()}
                value={posDeviceId}
                disabled={companyScope && Boolean(sharedPosId)}
                onChange={(e) => setPosDeviceId(e.target.value)}
              >
                {posForBranch.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} — {p.serialNumber}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-token-sm">
              {t('paymentMethod')}
              <select
                className={fieldClass()}
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                required
              >
                {RECEIPT_PAYMENT_METHODS.map((code) => (
                  <option key={code} value={code}>
                    {t(`pay${code}` as 'payC')}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-token-sm">
              {t('buyerMobile')}
              <input
                className={fieldClass()}
                value={buyerMobile}
                onChange={(e) => setBuyerMobile(e.target.value)}
                dir="ltr"
              />
            </label>
            <label className="block text-token-sm">
              {t('buyerPaymentNumber')}
              <input
                className={fieldClass()}
                value={buyerPaymentNumber}
                onChange={(e) => setBuyerPaymentNumber(e.target.value)}
                dir="ltr"
              />
            </label>
            <label className="block text-token-sm">
              {t('orderDeliveryMode')}
              <select
                className={fieldClass()}
                value={orderDeliveryMode}
                onChange={(e) => setOrderDeliveryMode(e.target.value)}
              >
                <option value="">—</option>
                <option value="FC">{t('deliveryFC')}</option>
                <option value="DLV">{t('deliveryDLV')}</option>
              </select>
              <span className="mt-token-xs block text-token-xs text-foreground/60">
                {t('orderDeliveryModeHelp')}
              </span>
            </label>
            {currencyCode !== 'EGP' ? (
              <label className="block text-token-sm">
                {t('exchangeRate')}
                <input
                  className={fieldClass()}
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(e.target.value)}
                  dir="ltr"
                />
                <span className="mt-token-xs block text-token-xs text-foreground/60">
                  {t('exchangeRateHelp')}
                </span>
              </label>
            ) : null}
            {receiptType === 'r' ? (
              <label className="block text-token-sm sm:col-span-2">
                {t('referenceUuid')}
                <input
                  className={fieldClass() + ' font-en'}
                  value={referenceUUID}
                  onChange={(e) => setReferenceUUID(e.target.value)}
                  dir="ltr"
                />
                <span className="mt-token-xs block text-token-xs text-foreground/60">
                  {t('referenceUuidHelp')}
                </span>
              </label>
            ) : null}
          </section>

          <section className="space-y-token-sm">
            <button
              type="button"
              className="text-token-sm text-brand"
              onClick={() => setShowSeller((v) => !v)}
            >
              {showSeller ? t('hideSeller') : t('showSeller')}
            </button>
            {showSeller || documentReadOnly ? (
              <div className="space-y-token-sm rounded border border-border bg-surface p-token-sm">
                {sectionTitle(t('sectionSeller'))}
                <p className="text-token-xs text-foreground/60">{t('sellerFromSettings')}</p>
                <label className="block text-token-sm">
                  {t('sellerRin')}
                  <input
                    className={fieldClass()}
                    value={credsQ.data?.registrationNumber ?? ''}
                    readOnly
                    dir="ltr"
                  />
                </label>
                <label className="block text-token-sm">
                  {t('sellerName')}
                  <input
                    className={fieldClass()}
                    value={credsQ.data?.taxpayerLegalName ?? ''}
                    readOnly
                  />
                </label>
                <label className="block text-token-sm">
                  {t('sellerBranchCode')}
                  <input
                    className={fieldClass()}
                    value={selectedBranch?.etaBranchCode ?? ''}
                    readOnly
                    dir="ltr"
                  />
                </label>
                <label className="block text-token-sm">
                  {t('sellerSerial')}
                  <input
                    className={fieldClass()}
                    value={selectedPos?.serialNumber ?? ''}
                    readOnly
                    dir="ltr"
                  />
                </label>
                <label className="block text-token-sm">
                  {t('sellerActivity')}
                  <input
                    className={fieldClass()}
                    value={selectedBranch?.activityCode ?? credsQ.data?.activityCode ?? ''}
                    readOnly
                    dir="ltr"
                  />
                </label>
              </div>
            ) : null}
          </section>

          <section className="space-y-token-sm">
            <button
              type="button"
              className="text-token-sm text-brand"
              onClick={() => setShowBuyer((v) => !v)}
            >
              {showBuyer ? t('hideBuyer') : t('showBuyer')}
            </button>
            {showBuyer ? (
              <div className="space-y-token-sm rounded border border-border bg-surface p-token-sm">
                {sectionTitle(t('sectionBuyer'))}
                <CustomerPicker
                  receiver={{
                    type: buyerType,
                    id: buyerId,
                    name: buyerName,
                    address: { country: 'EG' },
                  }}
                  disabled={documentReadOnly}
                  onPick={(next) => {
                    const nextType =
                      next.type === 'P' || next.type === 'B' || next.type === 'F'
                        ? next.type
                        : 'P';
                    setBuyerType(nextType);
                    setBuyerId(next.id || '');
                    setBuyerName(next.name || '');
                  }}
                />
                <label className="block text-token-sm">
                  {t('buyerType')}
                  <select
                    className={fieldClass()}
                    value={buyerType}
                    onChange={(e) => setBuyerType(e.target.value as 'P' | 'B' | 'F')}
                  >
                    <option value="P">{t('buyerP')}</option>
                    <option value="B">{t('buyerB')}</option>
                    <option value="F">{t('buyerF')}</option>
                  </select>
                </label>
                <label className="block text-token-sm">
                  {t('buyerId')}
                  <input
                    className={fieldClass()}
                    value={buyerId}
                    onChange={(e) => setBuyerId(e.target.value)}
                    dir="ltr"
                  />
                  <span className="mt-token-xs block text-token-xs text-foreground/60">
                    {t('buyerIdHelp')}
                  </span>
                </label>
                <label className="block text-token-sm">
                  {t('buyerName')}
                  <input
                    className={fieldClass()}
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                  />
                </label>
              </div>
            ) : null}
          </section>

          <section className="space-y-token-sm rounded border border-border bg-surface p-token-sm">
            <div className="flex items-center justify-between">
              {sectionTitle(t('lines'))}
              {!documentReadOnly ? (
                <button type="button" className="text-token-sm text-brand" onClick={addLine}>
                  {t('addLine')}
                </button>
              ) : null}
            </div>
            {lines.length === 0 ? (
              <div className="space-y-token-sm rounded border border-dashed border-border p-token-md text-center">
                <p className="text-token-sm text-foreground/70">{t('noLines')}</p>
                {!documentReadOnly ? (
                  <button
                    type="button"
                    className="rounded border border-border px-token-md py-token-xs text-token-sm text-brand"
                    onClick={addLine}
                  >
                    {t('addLine')}
                  </button>
                ) : null}
              </div>
            ) : null}
            {lines.length ? (
              <div className={cn('overflow-x-auto', tableStickyFirstClass)}>
                <table className="w-full min-w-[64rem] border-collapse text-token-xs">
                  <caption className="sr-only">{t('lines')}</caption>
                  <thead>
                    <tr className="border-b border-border text-foreground/60">
                      <th scope="col" className="px-token-xs py-token-xs text-start font-medium">
                        #
                      </th>
                      <th scope="col" className="px-token-xs py-token-xs text-start font-medium">
                        {t('itemType')}
                      </th>
                      <th scope="col" className="px-token-xs py-token-xs text-start font-medium">
                        {t('itemCode')}
                      </th>
                      <th scope="col" className="px-token-xs py-token-xs text-start font-medium">
                        {t('internalCode')}
                      </th>
                      <th scope="col" className="px-token-xs py-token-xs text-start font-medium">
                        {t('description')}
                      </th>
                      <th scope="col" className="px-token-xs py-token-xs text-start font-medium">
                        {t('quantity')}
                      </th>
                      <th scope="col" className="px-token-xs py-token-xs text-start font-medium">
                        {t('unitType')}
                      </th>
                      <th scope="col" className="px-token-xs py-token-xs text-start font-medium">
                        {t('unitPrice')}
                      </th>
                      <th scope="col" className="px-token-xs py-token-xs text-start font-medium">
                        {t('discount')}
                      </th>
                      <th scope="col" className="px-token-xs py-token-xs text-start font-medium">
                        {t('editTaxes')}
                      </th>
                      <th scope="col" className="px-token-xs py-token-xs text-end font-medium">
                        {t('lineTotal')}
                      </th>
                      <th scope="col" className="px-token-xs py-token-xs text-end font-medium">
                        <span className="sr-only">{t('removeLine')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, idx) => {
                      const taxSummary = taxRowSummary(line, td);
                      return (
                        <Fragment key={line.rowKey}>
                          <tr className="align-top">
                            <td className="px-token-xs py-token-xs text-foreground/60">
                              {idx + 1}
                            </td>
                            <td className="px-token-xs py-token-xs">
                              <select
                                aria-label={t('itemType')}
                                className={cellClass()}
                                value={line.itemType}
                                onChange={(e) => updateLine(idx, { itemType: e.target.value })}
                              >
                                <option value="EGS">EGS</option>
                                <option value="GS1">GS1</option>
                              </select>
                            </td>
                            <td className="px-token-xs py-token-xs">
                              <select
                                aria-label={t('itemCode')}
                                className={cellClass() + ' min-w-[9rem]'}
                                value={line.itemCode}
                                onChange={(e) => {
                                  const code = itemCodes.find((i) => i.code === e.target.value);
                                  updateLine(idx, {
                                    itemCode: e.target.value,
                                    description: code?.description || line.description,
                                    internalCode: line.internalCode || e.target.value,
                                  });
                                }}
                              >
                                <option value="">{t('selectItemCode')}</option>
                                {itemCodes
                                  .filter((i) => i.type === line.itemType)
                                  .map((i) => (
                                    <option key={i.id} value={i.code}>
                                      {i.code} — {i.description}
                                    </option>
                                  ))}
                              </select>
                            </td>
                            <td className="px-token-xs py-token-xs">
                              <input
                                aria-label={t('internalCode')}
                                className={cellClass() + ' min-w-[7rem]'}
                                value={line.internalCode ?? ''}
                                onChange={(e) => updateLine(idx, { internalCode: e.target.value })}
                              />
                            </td>
                            <td className="px-token-xs py-token-xs">
                              <input
                                className={cellClass() + ' min-w-[14rem]'}
                                aria-label={t('description')}
                                value={line.description}
                                onChange={(e) => updateLine(idx, { description: e.target.value })}
                              />
                            </td>
                            <td className="px-token-xs py-token-xs">
                              <input
                                aria-label={t('quantity')}
                                className={cellClass() + ' w-20 text-end'}
                                value={line.quantity}
                                onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                              />
                            </td>
                            <td className="px-token-xs py-token-xs">
                              <select
                                aria-label={t('unitType')}
                                className={cellClass()}
                                value={line.unitType}
                                onChange={(e) => updateLine(idx, { unitType: e.target.value })}
                              >
                                {(unitTypes.length
                                  ? unitTypes
                                  : [{ code: 'EA', nameEn: 'Each', nameAr: '', parentCode: null, meta: null }]
                                ).map((u) => (
                                  <option key={u.code} value={u.code}>
                                    {catalogOptionLabel(u, locale === 'ar' ? 'ar' : 'en')}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-token-xs py-token-xs">
                              <input
                                aria-label={t('unitPrice')}
                                className={cellClass() + ' w-24 text-end'}
                                value={line.unitPrice}
                                onChange={(e) =>
                                  updateLine(idx, {
                                    unitPrice: e.target.value,
                                    amountEGP: e.target.value,
                                  })
                                }
                              />
                            </td>
                            <td className="px-token-xs py-token-xs">
                              <input
                                aria-label={t('discount')}
                                className={cellClass() + ' w-24 text-end'}
                                value={line.discountAmount ?? '0.00'}
                                onChange={(e) => updateLine(idx, { discountAmount: e.target.value })}
                              />
                            </td>
                            <td className="px-token-xs py-token-xs">
                              <button
                                type="button"
                                className={
                                  'whitespace-nowrap rounded border px-token-sm py-token-xs text-token-xs ' +
                                  (taxSummary.mode === 'none'
                                    ? 'border-border text-foreground/60'
                                    : 'border-brand/40 text-brand')
                                }
                                onClick={() => setTaxModalLineIdx(idx)}
                              >
                                {taxSummary.label}
                              </button>
                            </td>
                            <td className="whitespace-nowrap px-token-xs py-token-xs text-end font-medium">
                              <span dir="ltr">{lineTotalDisplay(line)}</span>
                            </td>
                            <td className="px-token-xs py-token-xs text-end">
                              {!documentReadOnly ? (
                                <button
                                  type="button"
                                  className="inline-flex items-center rounded border border-danger/40 px-token-xs py-token-xs text-token-xs text-danger"
                                  aria-label={t('removeLineAria', { number: idx + 1 })}
                                  title={t('removeLine')}
                                  onClick={() => removeLine(line.rowKey)}
                                >
                                  ×
                                </button>
                              ) : null}
                            </td>
                          </tr>
                          <tr className="border-b border-border">
                            <td colSpan={12} className="px-token-xs pb-token-xs">
                              <details>
                                <summary className="cursor-pointer text-token-xs text-foreground/60">
                                  {t('lineDetails')}
                                </summary>
                                <div className="mt-token-xs grid grid-cols-2 gap-token-xs sm:grid-cols-4">
                                  <label className="block text-token-xs">
                                    {t('discountRate')}
                                    <input
                                      className={fieldClass()}
                                      value={line.discountRate ?? '0'}
                                      onChange={(e) =>
                                        updateLine(idx, { discountRate: e.target.value })
                                      }
                                    />
                                  </label>
                                </div>
                              </details>
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="space-y-token-sm">
            <button
              type="button"
              className="text-token-sm text-brand"
              onClick={() => setShowDevPreview((v) => !v)}
            >
              {showDevPreview ? t('hideDevPreview') : t('showDevPreview')}
            </button>
            {showDevPreview ? (
              <div className="grid grid-cols-1 gap-token-md lg:grid-cols-2">
                <div>
                  <h2 className="mb-token-sm font-medium">{t('previewJson')}</h2>
                  <pre className="max-h-64 overflow-auto rounded border border-border bg-surface p-token-sm text-token-xs">
                    {etaJson || '—'}
                  </pre>
                </div>
                <div>
                  <h2 className="mb-token-sm font-medium">{t('previewCanonical')}</h2>
                  <pre className="max-h-64 overflow-auto break-all rounded border border-border bg-surface p-token-sm text-token-xs">
                    {canonical || '—'}
                  </pre>
                </div>
              </div>
            ) : null}
          </section>
        </fieldset>
      </div>

      <div className="sticky bottom-0 z-30 max-h-[45vh] space-y-token-sm overflow-y-auto border-t border-border bg-surface p-token-md shadow-lg">
        <div className="flex flex-wrap items-end gap-x-token-lg gap-y-token-xs">
          <h2 className="m-0 text-token-sm font-semibold text-foreground">{t('totals')}</h2>
          <p className="text-token-sm">
            <span className="text-foreground/60">{t('totalSalesAmount')}:</span>{' '}
            <span dir="ltr">{formatMoneyDisplay(totals?.totalSales)}</span>
          </p>
          {totals?.totalCommercialDiscount != null ? (
            <p className="text-token-sm">
              <span className="text-foreground/60">{t('totalDiscountAmount')}:</span>{' '}
              <span dir="ltr">{formatMoneyDisplay(totals.totalCommercialDiscount)}</span>
            </p>
          ) : null}
          <p className="text-token-sm">
            <span className="text-foreground/60">{t('netAmount')}:</span>{' '}
            <span dir="ltr">{formatMoneyDisplay(totals?.netAmount)}</span>
          </p>
          {Array.isArray(totals?.taxTotals) && totals.taxTotals.length ? (
            <p className="text-token-sm">
              <span className="text-foreground/60">{t('taxTotals')}:</span>{' '}
              {(totals.taxTotals as Array<{ taxType?: string; amount?: string }>)
                .map(
                  (tt) =>
                    `${String(tt.taxType ?? '')} ${formatMoneyDisplay(tt.amount)}`.trim(),
                )
                .join(' · ')}
            </p>
          ) : null}
          <p className="text-token-md font-medium">
            <span className="text-foreground/60">{t('totalAmount')}:</span>{' '}
            <span dir="ltr">{formatMoneyDisplay(totals?.totalAmount)}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-token-sm">
          <Button
            variant="secondary"
            title={t('localPrintoutHint')}
            disabled={submitting || !branchId}
            onClick={() => setPreviewOpen(true)}
          >
            {t('previewPrint')}
          </Button>
          {!documentReadOnly ? (
            <Button disabled={submitting} onClick={() => void save()}>
              {t('save')}
            </Button>
          ) : null}
          {!isNew && isChainTip ? (
            <Button
              variant="danger"
              disabled={submitting}
              onClick={async () => {
                try {
                  setSubmitting(true);
                  await deleteReceipt(params.id);
                  toast.deleted();
                  router.push(`/${locale}/receipts`);
                } catch (e) {
                  setError(e instanceof Error ? e.message : t('deleteFailed'));
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {t('delete')}
            </Button>
          ) : null}
        </div>
      </div>

      <Modal
        open={taxModalLine != null && taxModalLineIdx != null && !documentReadOnly}
        onClose={() => setTaxModalLineIdx(null)}
        title={
          taxModalLineIdx != null
            ? `${t('editTaxes')} — ${t('lineNumber', { number: taxModalLineIdx + 1 })}`
            : t('editTaxes')
        }
        size="xl"
      >
        {taxModalLine && taxModalLineIdx != null ? (
          <LineTaxesEditor
            line={taxModalLine}
            lineIndex={taxModalLineIdx}
            locale={locale === 'ar' ? 'ar' : 'en'}
            taxTypes={taxTypes}
            taxSubtypes={taxSubtypes}
            taxTypeOptions={taxTypeOptions}
            zeroRatedSubtypeOptions={zeroRatedSubtypeOptions}
            exemptSubtypeOptions={exemptSubtypeOptions}
            subtypeOptionsFor={subtypeOptionsFor}
            updateLine={updateLine}
            setLineTaxMode={setLineTaxMode}
            setLineZeroExemptKind={setLineZeroExemptKind}
            t={td}
          />
        ) : null}
      </Modal>

      <LocalPdfPreviewModal
        open={previewOpen}
        title={t('previewPrint')}
        closeLabel={t('close')}
        downloadLabel={t('downloadPdf')}
        loadingLabel={t('previewLoading')}
        errorFallback={t('previewFailed')}
        onClose={() => setPreviewOpen(false)}
        loadPdf={() => downloadReceiptLocalPrintoutFromBody(body(), locale)}
      />
    </div>
  );
}
