'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  createDocument,
  downloadLocalPrintoutFromBody,
  getDocument,
  listDocuments,
  markDocumentReady,
  previewDocument,
  recalculateDocumentTotals,
  sendDocumentForSignature,
  submitDocumentToEta,
  resetDocumentSubmitCooldown,
  updateDocument,
  validateDocument,
  type AddressInput,
  type DocumentUpsert,
} from '@/lib/api/documents';
import { allocateNextInternalId } from '@/lib/api/invoice-numbering';
import {
  cancelDocument,
  declineDocumentRejection,
  downloadDocumentEtaSource,
  downloadDocumentPrintout,
  refreshDocumentStatus,
  triggerBrowserDownload,
} from '@/lib/api/submissions';
import { listEtaCodes, type EtaCodeEntry } from '@/lib/api/eta-codes';
import { listItemCodes, type ItemCode } from '@/lib/api/item-codes';
import { apiFetch, ApiError } from '@/lib/api/client';
import { newIdempotencyKey, putDraft } from '@/lib/offline/draft-queue';
import {
  removeRowByKey,
  stripRowKey,
  withRowKey,
  withRowKeys,
  type RowKeyed,
} from '@/lib/documents/line-rows';
import { getActiveTenantId } from '@/lib/session';
import { useAuth } from '@/lib/auth-provider';
import { useTenant } from '@/lib/tenant-provider';
import {
  calculateLine,
  checkLateSubmission,
  isPlausibleEtaDocumentReference,
  resolveIssuerAddress,
  defaultTaxableTax,
  documentKindTypicallyRequiresTax,
  ETA_EXEMPT_SUBTYPES,
  ETA_ZERO_RATED_SUBTYPES,
  inferLineTaxMode,
  isFullyTaxFree,
  isFixedAmountTaxType,
  sortEtaCodeEntries,
  subtypesForTaxType,
  taxesForMode,
  type LineTaxMode,
} from '@einvoice/eta-core';
import { LineTaxesEditor, taxRowSummary } from './line-taxes-editor';

type Line = DocumentUpsert['lines'][number];
type LineRow = RowKeyed<Line>;
type UiTaxMode = 'taxable' | 'zero_or_exempt' | 'none';

const emptyAddress = (): AddressInput => ({
  country: 'EG',
  governate: '',
  regionCity: '',
  street: '',
  buildingNumber: '',
});

const emptyLine = (currency = 'EGP'): Line => ({
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
  taxes: [defaultTaxableTax()],
});

function fieldClass() {
  return 'mt-token-xs w-full rounded border border-border bg-background px-token-sm py-token-xs';
}

/** Compact variant for the dense line-items table (no stacked label above). */
function cellClass() {
  return 'w-full rounded border border-border bg-background px-token-xs py-token-xs text-token-xs';
}

/**
 * Display-only per-line total. The ETA payload and the authoritative totals
 * still come from previewDocument(); an incomplete row simply shows nothing.
 */
function lineTotalDisplay(line: Line): string {
  try {
    return calculateLine(line).total;
  } catch {
    return '—';
  }
}

function AddressFields(props: {
  value: AddressInput;
  onChange: (next: AddressInput) => void;
  countries: EtaCodeEntry[];
  showBranchId?: boolean;
  t: ReturnType<typeof useTranslations<'documents'>>;
}) {
  const { value, onChange, countries, showBranchId, t } = props;
  const set = (key: keyof AddressInput, v: string) => onChange({ ...value, [key]: v });
  return (
    <div className="grid gap-token-xs sm:grid-cols-2">
      {showBranchId ? (
        <label className="block text-token-sm">
          {t('branchId')}
          <input
            className={fieldClass()}
            value={value.branchId ?? ''}
            onChange={(e) => set('branchId', e.target.value)}
          />
        </label>
      ) : null}
      <label className="block text-token-sm">
        {t('country')}
        <select
          className={fieldClass()}
          value={value.country ?? 'EG'}
          onChange={(e) => set('country', e.target.value)}
        >
          {(countries.length
            ? countries
            : [{ code: 'EG', nameEn: 'Egypt', nameAr: '', parentCode: null, meta: null }]
          ).map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.nameEn}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-token-sm">
        {t('governate')}
        <input
          className={fieldClass()}
          value={value.governate ?? ''}
          onChange={(e) => set('governate', e.target.value)}
        />
      </label>
      <label className="block text-token-sm">
        {t('regionCity')}
        <input
          className={fieldClass()}
          value={value.regionCity ?? ''}
          onChange={(e) => set('regionCity', e.target.value)}
        />
      </label>
      <label className="block text-token-sm">
        {t('street')}
        <input
          className={fieldClass()}
          value={value.street ?? ''}
          onChange={(e) => set('street', e.target.value)}
        />
      </label>
      <label className="block text-token-sm">
        {t('buildingNumber')}
        <input
          className={fieldClass()}
          value={value.buildingNumber ?? ''}
          onChange={(e) => set('buildingNumber', e.target.value)}
        />
      </label>
      <label className="block text-token-sm">
        {t('postalCode')}
        <input
          className={fieldClass()}
          value={value.postalCode ?? ''}
          onChange={(e) => set('postalCode', e.target.value)}
        />
      </label>
      <label className="block text-token-sm">
        {t('floor')}
        <input
          className={fieldClass()}
          value={value.floor ?? ''}
          onChange={(e) => set('floor', e.target.value)}
        />
      </label>
      <label className="block text-token-sm">
        {t('room')}
        <input
          className={fieldClass()}
          value={value.room ?? ''}
          onChange={(e) => set('room', e.target.value)}
        />
      </label>
      <label className="block text-token-sm sm:col-span-2">
        {t('landmark')}
        <input
          className={fieldClass()}
          value={value.landmark ?? ''}
          onChange={(e) => set('landmark', e.target.value)}
        />
      </label>
      <label className="block text-token-sm sm:col-span-2">
        {t('additionalInformation')}
        <input
          className={fieldClass()}
          value={value.additionalInformation ?? ''}
          onChange={(e) => set('additionalInformation', e.target.value)}
        />
      </label>
    </div>
  );
}

export default function DocumentEditorPage() {
  const t = useTranslations('documents');
  const tOffline = useTranslations('offline');
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const isNew = params.id === 'new';
  const isExportKind = (k: string) => k.startsWith('EXPORT');
  const { user } = useAuth();
  const { tenantId: activeTenantId } = useTenant();
  const [offlineKey] = useState(() => newIdempotencyKey());
  const [offlineHint, setOfflineHint] = useState<string | null>(null);

  const [branches, setBranches] = useState<
    Array<{
      id: string;
      name: string;
      isActive: boolean;
      activityCode?: string | null;
      etaBranchCode?: string | null;
      address?: AddressInput;
      addressComplete?: boolean;
    }>
  >([]);
  const [currencies, setCurrencies] = useState<string[]>(['EGP']);
  const [itemCodes, setItemCodes] = useState<ItemCode[]>([]);
  const [activities, setActivities] = useState<EtaCodeEntry[]>([]);
  const [activityQuery, setActivityQuery] = useState('');
  const [unitTypes, setUnitTypes] = useState<EtaCodeEntry[]>([]);
  const [taxTypes, setTaxTypes] = useState<EtaCodeEntry[]>([]);
  const [taxSubtypes, setTaxSubtypes] = useState<EtaCodeEntry[]>([]);
  const [countries, setCountries] = useState<EtaCodeEntry[]>([]);
  const [weightUnits, setWeightUnits] = useState<EtaCodeEntry[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [settingsFixArea, setSettingsFixArea] = useState<'branches' | 'eta-credentials' | null>(
    null,
  );
  const [taxFreeWarningDismissed, setTaxFreeWarningDismissed] = useState(false);

  const [kind, setKind] = useState<DocumentUpsert['kind']>('INVOICE');
  const [branchId, setBranchId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('EGP');
  const [internalId, setInternalId] = useState('');
  const [internalIdManual, setInternalIdManual] = useState(false);
  const [issueDateTime, setIssueDateTime] = useState(() => new Date().toISOString().slice(0, 16));
  const [taxpayerActivityCode, setTaxpayerActivityCode] = useState('');
  const [serviceDeliveryDate, setServiceDeliveryDate] = useState('');
  const [purchaseOrderReference, setPurchaseOrderReference] = useState('');
  const [purchaseOrderDescription, setPurchaseOrderDescription] = useState('');
  const [salesOrderReference, setSalesOrderReference] = useState('');
  const [salesOrderDescription, setSalesOrderDescription] = useState('');
  const [proformaInvoiceNumber, setProformaInvoiceNumber] = useState('');
  const [extraDiscountAmount, setExtraDiscountAmount] = useState('0.00');
  const [referencesText, setReferencesText] = useState('');
  const [referencePickerQuery, setReferencePickerQuery] = useState('');
  const [referenceCandidates, setReferenceCandidates] = useState<
    Array<{
      id: string;
      internalId: string;
      etaUuid: string;
      issueDateTime: string;
      totalAmount: string;
      kind: string;
    }>
  >([]);
  const [referenceFormatHint, setReferenceFormatHint] = useState<string | null>(
    null,
  );

  const [issuer, setIssuer] = useState<{
    type: string;
    id: string;
    name: string;
    address: AddressInput;
  }>({
    type: 'B',
    id: '',
    name: '',
    address: { ...emptyAddress(), branchId: '0' },
  });
  const [receiver, setReceiver] = useState<{
    type: string;
    id: string;
    name: string;
    address: AddressInput;
  }>({
    type: 'B',
    id: '',
    name: '',
    address: emptyAddress(),
  });
  const [payment, setPayment] = useState({
    bankName: '',
    bankAddress: '',
    bankAccountNo: '',
    bankAccountIBAN: '',
    swiftCode: '',
    terms: '',
  });
  const [delivery, setDelivery] = useState({
    approach: '',
    packaging: '',
    dateValidity: '',
    exportPort: '',
    countryOfOrigin: '',
    grossWeight: '',
    netWeight: '',
    terms: '',
  });
  const [showPayment, setShowPayment] = useState(false);
  const [showDelivery, setShowDelivery] = useState(false);
  const [showIssuer, setShowIssuer] = useState(false);
  const [showReceiver, setShowReceiver] = useState(true);
  const [taxModalLineIdx, setTaxModalLineIdx] = useState<number | null>(null);
  const [showDevPreview, setShowDevPreview] = useState(false);

  const [version, setVersion] = useState(0);
  const [lines, setLines] = useState<LineRow[]>(() => [withRowKey(emptyLine())]);
  const [canonical, setCanonical] = useState('');
  const [etaJson, setEtaJson] = useState('');
  const [totals, setTotals] = useState<Record<string, unknown> | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [docStatus, setDocStatus] = useState<string>('DRAFT');
  const [needsAttention, setNeedsAttention] = useState(false);
  const [needsAttentionReason, setNeedsAttentionReason] = useState<string | null>(null);
  const [submissionUuid, setSubmissionUuid] = useState<string | null>(null);
  const [etaUuid, setEtaUuid] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null);
  const [submitAttemptLog, setSubmitAttemptLog] = useState<Array<Record<string, unknown>>>([]);
  const [submitAttemptCount, setSubmitAttemptCount] = useState(0);
  /** Ticks so an elapsed cooldown re-enables Submit without a reload. */
  const [nowMs, setNowMs] = useState(() => Date.now());

  const cooldownActive = Boolean(cooldownUntil && new Date(cooldownUntil).getTime() > nowMs);

  useEffect(() => {
    if (!cooldownUntil) return;
    const handle = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [cooldownUntil]);

  useEffect(() => {
    if (taxModalLineIdx == null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTaxModalLineIdx(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [taxModalLineIdx]);

  useEffect(() => {
    if (!activeTenantId) {
      setBranches([]);
      setItemCodes([]);
      setCurrencies(['EGP']);
      return;
    }

    // Reset tenant-private lookups immediately so a prior tenant's branches /
    // item codes cannot linger after a workspace switch.
    setBranches([]);
    setItemCodes([]);
    setBranchId('');

    apiFetch<
      Array<{
        id: string;
        name: string;
        isActive: boolean;
        activityCode?: string | null;
        etaBranchCode?: string | null;
        address?: AddressInput;
        addressComplete?: boolean;
      }>
    >('/branches', { tenantScoped: true })
      .then((rows) => {
        const active = rows.filter((b) => b.isActive);
        setBranches(active);
        if (active[0]) setBranchId((prev) => prev || active[0]!.id);
      })
      .catch(() => undefined);

    apiFetch<Array<{ currencyCode: string }>>('/currencies', { tenantScoped: true })
      .then((rows) => {
        const codes = rows.map((r) => r.currencyCode);
        if (codes.length) setCurrencies(codes);
      })
      .catch(() => undefined);

    apiFetch<{
      registrationNumber?: string | null;
      activityCode?: string | null;
      taxpayerLegalName?: string | null;
      issuerType?: string | null;
      issuerIdentityComplete?: boolean;
    } | null>('/settings/eta-credentials', { tenantScoped: true })
      .then((creds) => {
        if (!creds) return;
        if (isNew) {
          setTaxpayerActivityCode((prev) => prev || creds.activityCode || '');
          setIssuer((prev) => ({
            ...prev,
            type: prev.type || creds.issuerType || 'B',
            id: prev.id || creds.registrationNumber || '',
            name: prev.name || creds.taxpayerLegalName || '',
          }));
          if (creds.issuerIdentityComplete === false) {
            setSettingsFixArea('eta-credentials');
          }
        }
      })
      .catch(() => undefined);

    listItemCodes()
      .then((rows) => setItemCodes(rows.filter((i) => i.isActive)))
      .catch(() => undefined);

    // ETA code catalogs are global reference data (not tenant-private).
    void Promise.all([
      listEtaCodes('ACTIVITY_CODE', { limit: 500 }),
      listEtaCodes('UNIT_TYPE', { limit: 200 }),
      listEtaCodes('TAX_TYPE', { limit: 100 }),
      listEtaCodes('TAX_SUBTYPE', { limit: 500 }),
      listEtaCodes('COUNTRY', { limit: 300 }),
      listEtaCodes('WEIGHT_UNIT_TYPE', { limit: 50 }),
    ])
      .then(([a, u, tt, ts, c, w]) => {
        setActivities(a.entries);
        setUnitTypes(u.entries);
        setTaxTypes(tt.entries);
        setTaxSubtypes(ts.entries);
        setCountries(c.entries);
        setWeightUnits(w.entries);
      })
      .catch(() => undefined);
  }, [isNew, activeTenantId]);

  // The issuer is our own company: name/id/type from ETA company settings,
  // address from the branch. Blank fields inherit; never default name to the
  // branch label ("Main").
  useEffect(() => {
    if (!isNew || !branchId) return;
    const b = branches.find((x) => x.id === branchId);
    if (!b) return;
    if (b.activityCode) {
      setTaxpayerActivityCode((prev) => prev || b.activityCode || '');
    }
    setIssuer((prev) => ({
      ...prev,
      // Keep whatever legal name settings already filled; do NOT use b.name.
      address: {
        ...prev.address,
        ...resolveIssuerAddress(b.address, prev.address, {
          branchId: b.etaBranchCode,
          country: 'EG',
        }),
      },
    }));
  }, [isNew, branchId, branches]);

  // Allocate the next scheme-based internalId for new documents (not timestamps).
  useEffect(() => {
    if (!isNew || internalIdManual || !branchId) return;
    let cancelled = false;
    allocateNextInternalId({ branchId, kind })
      .then((r) => {
        if (!cancelled) setInternalId(r.internalId);
      })
      .catch(() => {
        if (!cancelled && !internalId) {
          setInternalId(`INV-${Date.now()}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isNew, branchId, kind, internalIdManual]);

  // Reference picker candidates (issued originals) for credit/debit notes.
  useEffect(() => {
    const isNote = kind.includes('CREDIT') || kind.includes('DEBIT');
    if (!isNote) return;
    listDocuments()
      .then((res) => {
        const items = (res.items ?? [])
          .filter((d) => {
            const status = String(d.status ?? '');
            const uuid = String(d.etaUuid ?? '');
            const k = String(d.kind ?? '');
            return (
              uuid &&
              (status === 'VALID' || status === 'SUBMITTED' || status === 'SIGNED') &&
              (k.includes('INVOICE') || k.includes('CREDIT') || k.includes('DEBIT'))
            );
          })
          .map((d) => ({
            id: String(d.id),
            internalId: String(d.internalId ?? ''),
            etaUuid: String(d.etaUuid ?? ''),
            issueDateTime: String(d.issueDateTime ?? ''),
            totalAmount: String(d.totalAmount ?? ''),
            kind: String(d.kind ?? ''),
          }));
        setReferenceCandidates(items);
      })
      .catch(() => setReferenceCandidates([]));
  }, [kind]);

  const selectedBranch = branches.find((b) => b.id === branchId);
  const branchAddressIncomplete = Boolean(
    selectedBranch && selectedBranch.addressComplete === false,
  );

  useEffect(() => {
    if (Object.keys(fieldErrors).some((k) => k.startsWith('issuer'))) {
      setShowIssuer(true);
    }
    if (Object.keys(fieldErrors).some((k) => k.startsWith('receiver'))) {
      setShowReceiver(true);
    }
  }, [fieldErrors]);

  useEffect(() => {
    // Never carry one document's submit state onto another (or onto a new one).
    setDocStatus('DRAFT');
    setNeedsAttention(false);
    setNeedsAttentionReason(null);
    setSubmissionUuid(null);
    setEtaUuid(null);
    setCooldownUntil(null);
    setSubmitAttemptCount(0);
    setSubmitAttemptLog([]);
    setIssues([]);
    setError(null);
  }, [params.id]);

  useEffect(() => {
    if (isNew) return;
    getDocument(params.id)
      .then((doc) => {
        const payload = (doc.etaPayload ?? {}) as Record<string, unknown>;
        setKind(doc.kind as DocumentUpsert['kind']);
        setBranchId(String(doc.branchId));
        setCurrencyCode(String(doc.currencyCode));
        setInternalId(String(doc.internalId));
        setInternalIdManual(true);
        setIssueDateTime(String(doc.issueDateTime).slice(0, 16));
        setVersion(Number(doc.version));
        setDocStatus(String(doc.status ?? 'DRAFT'));
        setNeedsAttention(Boolean(doc.needsAttention));
        setNeedsAttentionReason(doc.needsAttentionReason ? String(doc.needsAttentionReason) : null);
        setSubmissionUuid(doc.submissionUuid ? String(doc.submissionUuid) : null);
        setEtaUuid(doc.etaUuid ? String(doc.etaUuid) : null);
        setCooldownUntil(doc.submitCooldownUntil ? String(doc.submitCooldownUntil) : null);
        setSubmitAttemptCount(Number(doc.submitAttemptCount ?? 0));
        setSubmitAttemptLog(
          Array.isArray(doc.submitAttemptLog)
            ? (doc.submitAttemptLog as Array<Record<string, unknown>>)
            : [],
        );
        setCanonical(String(doc.canonicalString ?? ''));
        setEtaJson(JSON.stringify(doc.etaPayload, null, 2));
        setTotals(doc.totals as Record<string, unknown>);
        setTaxpayerActivityCode(String(payload.taxpayerActivityCode ?? ''));
        setServiceDeliveryDate(String(payload.serviceDeliveryDate ?? ''));
        setPurchaseOrderReference(String(payload.purchaseOrderReference ?? ''));
        setPurchaseOrderDescription(String(payload.purchaseOrderDescription ?? ''));
        setSalesOrderReference(String(payload.salesOrderReference ?? ''));
        setSalesOrderDescription(String(payload.salesOrderDescription ?? ''));
        setProformaInvoiceNumber(String(payload.proformaInvoiceNumber ?? ''));
        setExtraDiscountAmount(
          String(
            (doc.totals as { extraDiscountAmount?: string } | undefined)?.extraDiscountAmount ??
              payload.extraDiscountAmount ??
              '0.00',
          ),
        );

        const issuerSnap = (payload.issuer ?? {}) as Record<string, unknown>;
        const issuerAddr = (issuerSnap.address ?? {}) as AddressInput;
        setIssuer({
          type: String(issuerSnap.type ?? 'B'),
          id: String(issuerSnap.id ?? ''),
          name: String(issuerSnap.name ?? ''),
          address: { ...emptyAddress(), branchId: '0', ...issuerAddr },
        });

        const recv = (payload.receiver ?? {}) as Record<string, unknown>;
        const recvAddr = (recv.address ?? {}) as AddressInput;
        setReceiver({
          type: String(recv.type ?? doc.receiverType ?? 'B'),
          id: String(recv.id ?? doc.receiverId ?? ''),
          name: String(recv.name ?? doc.receiverName ?? ''),
          address: { ...emptyAddress(), ...recvAddr },
        });

        const pay = (payload.payment ?? {}) as typeof payment;
        setPayment({
          bankName: String(pay.bankName ?? ''),
          bankAddress: String(pay.bankAddress ?? ''),
          bankAccountNo: String(pay.bankAccountNo ?? ''),
          bankAccountIBAN: String(pay.bankAccountIBAN ?? ''),
          swiftCode: String(pay.swiftCode ?? ''),
          terms: String(pay.terms ?? ''),
        });
        if (payload.payment) setShowPayment(true);

        const del = (payload.delivery ?? {}) as typeof delivery;
        setDelivery({
          approach: String(del.approach ?? ''),
          packaging: String(del.packaging ?? ''),
          dateValidity: String(del.dateValidity ?? ''),
          exportPort: String(del.exportPort ?? ''),
          countryOfOrigin: String(del.countryOfOrigin ?? ''),
          grossWeight: String(del.grossWeight ?? ''),
          netWeight: String(del.netWeight ?? ''),
          terms: String(del.terms ?? ''),
        });
        if (payload.delivery) setShowDelivery(true);

        const refs = payload.references;
        if (Array.isArray(refs)) setReferencesText(refs.join('\n'));
        else if (refs && typeof refs === 'object') {
          setReferencesText(
            String(
              (refs as { internalID?: string; internalId?: string }).internalID ??
                (refs as { internalId?: string }).internalId ??
                '',
            ),
          );
        }

        const docLines = doc.lines as Array<Record<string, unknown>>;
        const payloadLines = (payload.invoiceLines as Array<Record<string, unknown>>) ?? [];
        if (docLines?.length) {
          setLines(
            withRowKeys(
              docLines.map((l, idx) => {
                const pl = payloadLines[idx] ?? {};
                const unitValue = (pl.unitValue ?? {}) as Record<string, string>;
                const taxes = ((l.taxes as Array<Record<string, string>>) ?? []).map((tx) => {
                  const fixed = isFixedAmountTaxType(tx.taxType);
                  return {
                    taxType: tx.taxType,
                    subType: tx.subType,
                    rate: fixed ? '0' : tx.rate,
                    ...(fixed ? { amount: tx.amount ?? '0.00' } : {}),
                  };
                });
                return {
                  description: String(l.description),
                  itemType: String(l.itemType),
                  itemCode: String(l.itemCode),
                  unitType: String(l.unitType),
                  quantity: String(l.quantity),
                  unitPrice: String(l.unitPrice),
                  discountAmount: String(l.discountAmount ?? '0.00'),
                  discountRate: String(l.discountRate ?? '0'),
                  currencySold: String(l.currencySold ?? unitValue.currencySold ?? 'EGP'),
                  amountEGP: String(l.amountEgp ?? unitValue.amountEGP ?? l.unitPrice),
                  amountSold: String(l.amountSold ?? unitValue.amountSold ?? ''),
                  currencyExchangeRate: String(
                    l.currencyExchangeRate ?? unitValue.currencyExchangeRate ?? '',
                  ),
                  internalCode: String(l.internalCode ?? pl.internalCode ?? ''),
                  weightUnitType: String(pl.weightUnitType ?? ''),
                  weightQuantity: String(pl.weightQuantity ?? ''),
                  taxes,
                };
              }),
            ),
          );
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [isNew, params.id]);

  const issueIso = useMemo(() => {
    const d = new Date(issueDateTime);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }, [issueDateTime]);

  const filteredActivities = useMemo(() => {
    const q = activityQuery.trim().toLowerCase();
    if (!q) return activities.slice(0, 80);
    return activities
      .filter(
        (a) =>
          a.code.toLowerCase().includes(q) ||
          a.nameEn.toLowerCase().includes(q) ||
          (a.nameAr ?? '').toLowerCase().includes(q),
      )
      .slice(0, 80);
  }, [activities, activityQuery]);

  const selectedActivity = activities.find((a) => a.code === taxpayerActivityCode);

  const body = (): DocumentUpsert => {
    const refs = referencesText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      kind,
      branchId,
      currencyCode,
      issueDateTime: issueIso,
      internalId,
      version,
      taxpayerActivityCode,
      purchaseOrderReference: purchaseOrderReference || undefined,
      purchaseOrderDescription: purchaseOrderDescription || undefined,
      salesOrderReference: salesOrderReference || undefined,
      salesOrderDescription: salesOrderDescription || undefined,
      proformaInvoiceNumber: proformaInvoiceNumber || undefined,
      serviceDeliveryDate: serviceDeliveryDate || undefined,
      extraDiscountAmount,
      issuer,
      receiver,
      payment: showPayment ? payment : null,
      delivery: showDelivery ? delivery : null,
      references: refs.length ? refs : null,
      lines: lines.map(stripRowKey).map((l) => ({
        ...l,
        currencySold: l.currencySold || currencyCode,
        amountEGP: l.amountEGP || l.unitPrice,
        taxes: (l.taxes ?? []).map((tx) => {
          const fixed = isFixedAmountTaxType(tx.taxType);
          return {
            taxType: tx.taxType,
            subType: tx.subType,
            rate: fixed ? '0' : tx.rate,
            ...(fixed ? { amount: tx.amount ?? '0.00' } : {}),
          };
        }),
      })),
    };
  };

  const refreshPreview = async () => {
    if (!branchId) return;
    // A line-less document is rejected by preview; clear rather than leave the
    // totals of the lines that were just removed on screen.
    if (!lines.length) {
      setCanonical('');
      setEtaJson('');
      setTotals(null);
      return;
    }
    try {
      const preview = await previewDocument(body());
      setCanonical(preview.canonicalString);
      setEtaJson(JSON.stringify(preview.etaPayload, null, 2));
      setTotals(preview.totals);
    } catch {
      /* ignore while incomplete */
    }
  };

  useEffect(() => {
    const handle = setTimeout(() => {
      void refreshPreview();
    }, 400);
    return () => clearTimeout(handle);
  }, [
    kind,
    branchId,
    currencyCode,
    internalId,
    issueDateTime,
    taxpayerActivityCode,
    serviceDeliveryDate,
    purchaseOrderReference,
    purchaseOrderDescription,
    salesOrderReference,
    salesOrderDescription,
    proformaInvoiceNumber,
    extraDiscountAmount,
    referencesText,
    issuer,
    receiver,
    payment,
    delivery,
    showPayment,
    showDelivery,
    lines,
  ]);

  const updateLine = (idx: number, patch: Partial<Line>) => {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, ...patch };
      return next;
    });
  };

  const addLine = () => {
    setLines((prev) => [...prev, withRowKey(emptyLine(currencyCode))]);
  };

  // Keyed removal: the line's taxes live on the line object, so dropping the row
  // drops its taxableItems too. Totals come back from the debounced preview.
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
    // zero_or_exempt — keep existing zero/exempt kind if already there
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

  const showTaxFreeWarning =
    documentKindTypicallyRequiresTax(kind) && isFullyTaxFree(lines) && !taxFreeWarningDismissed;

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
          nameEn: 'Value added tax',
          nameAr: '',
          parentCode: null,
          meta: null,
        },
      ];
  /** Only subtypes whose TaxtypeReference is the selected tax type. */
  const subtypeOptionsFor = (taxType: string) => subtypesForTaxType(taxSubtypes, taxType);

  const sectionTitle = (label: string) => (
    <h2 className="font-medium text-token-md text-brand">{label}</h2>
  );

  const taxModalLine = taxModalLineIdx == null ? null : (lines[taxModalLineIdx] ?? null);

  return (
    <div className="w-full space-y-token-lg pb-token-lg">
      <div className="space-y-token-lg">
        <h1 className="font-display text-token-2xl text-brand">{isNew ? t('new') : internalId}</h1>
        {branchAddressIncomplete || settingsFixArea ? (
          <div
            role="status"
            className="space-y-token-xs rounded border border-danger/40 bg-danger/5 p-token-sm text-token-sm"
          >
            <p className="font-medium">{t('issuerFromSettingsTitle')}</p>
            <p>{t('issuerFromSettingsBody')}</p>
            <Link
              href={`/${locale}/settings/${
                settingsFixArea === 'eta-credentials' ? 'eta-credentials' : 'branches'
              }`}
              className="text-brand underline"
            >
              {settingsFixArea === 'eta-credentials'
                ? t('issuerFromSettingsLinkEta')
                : t('issuerFromSettingsLink')}
            </Link>
          </div>
        ) : null}
        {showTaxFreeWarning ? (
          <div
            role="status"
            className="space-y-token-xs rounded border border-amber-600/40 bg-amber-50 p-token-sm text-token-sm dark:bg-amber-950/30"
          >
            <p className="font-medium">{t('taxFreeWarningTitle')}</p>
            <p>{t('taxFreeWarningBody')}</p>
            <button
              type="button"
              className="text-brand underline"
              onClick={() => setTaxFreeWarningDismissed(true)}
            >
              {t('taxFreeWarningDismiss')}
            </button>
          </div>
        ) : null}
        {!isNew ? (
          <div className="space-y-token-xs rounded border border-border bg-surface p-token-sm text-token-sm">
            <p>
              <span className="font-medium">{t('status')}:</span> {docStatus}
            </p>
            {submissionUuid ? (
              <p>
                <span className="font-medium">{t('submissionUuid')}:</span> {submissionUuid}
              </p>
            ) : null}
            {etaUuid ? (
              <p>
                <span className="font-medium">{t('etaUuid')}:</span> {etaUuid}
              </p>
            ) : null}
            {(docStatus === 'SIGNED' || needsAttention) &&
            issueDateTime &&
            checkLateSubmission(issueDateTime).isLate ? (
              <p className="text-amber-800" role="status">
                {t('lateSubmitWarnBanner', {
                  ageDays: String(Math.round(checkLateSubmission(issueDateTime).ageDays)),
                  warnDays: String(checkLateSubmission(issueDateTime).warnDays),
                })}
              </p>
            ) : null}
            {etaUuid ? (
              <div className="flex flex-wrap gap-token-xs pt-token-xs">
                <span className="w-full text-token-xs text-foreground/60">
                  {t('issuedActions')} — {t('officialPrintoutHint')}
                </span>
                <button
                  type="button"
                  disabled={submitting}
                  className="rounded border border-border px-token-sm py-token-xs text-token-sm disabled:opacity-50"
                  title={t('officialPrintoutHint')}
                  onClick={async () => {
                    try {
                      setSubmitting(true);
                      setError(null);
                      const { blob, filename } = await downloadDocumentPrintout(params.id);
                      triggerBrowserDownload(blob, filename);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : t('downloadFailed'));
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                >
                  {t('downloadPrintout')}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  className="rounded border border-border px-token-sm py-token-xs text-token-sm disabled:opacity-50"
                  onClick={async () => {
                    try {
                      setSubmitting(true);
                      setError(null);
                      const { blob, filename } = await downloadDocumentEtaSource(params.id);
                      triggerBrowserDownload(blob, filename);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : t('downloadFailed'));
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                >
                  {t('downloadEtaSource')}
                </button>
                {docStatus === 'VALID' || docStatus === 'SUBMITTED' ? (
                  <button
                    type="button"
                    disabled={submitting}
                    className="rounded border border-danger/40 px-token-sm py-token-xs text-token-sm text-danger disabled:opacity-50"
                    onClick={async () => {
                      const reason = window.prompt(t('cancelReasonPrompt')) ?? '';
                      if (!reason.trim()) {
                        setError(t('cancelReasonRequired'));
                        return;
                      }
                      try {
                        setSubmitting(true);
                        setError(null);
                        await cancelDocument(params.id, reason.trim());
                        setDocStatus('CANCELLED');
                        setIssues([
                          t('batchCancelSummary', {
                            cancelled: 1,
                            skipped: 0,
                            failed: 0,
                          }),
                        ]);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : t('forbidden'));
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                  >
                    {t('cancelDocument')}
                  </button>
                ) : null}
                {docStatus === 'REJECTED' ? (
                  <button
                    type="button"
                    disabled={submitting}
                    className="rounded border border-border px-token-sm py-token-xs text-token-sm disabled:opacity-50"
                    onClick={async () => {
                      try {
                        setSubmitting(true);
                        setError(null);
                        await declineDocumentRejection(params.id);
                        setIssues([t('declineRejectionDone')]);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : t('forbidden'));
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                  >
                    {t('declineRejection')}
                  </button>
                ) : null}
              </div>
            ) : null}
            {needsAttention && needsAttentionReason ? (
              <p className="text-danger">
                <span className="font-medium">{t('submissionError')}:</span> {needsAttentionReason}
              </p>
            ) : null}
            {cooldownActive && cooldownUntil ? (
              <p className="text-danger">
                <span className="font-medium">{t('cooldownActive')}:</span>{' '}
                {t('cooldownUntil', { until: cooldownUntil })}
              </p>
            ) : null}
            {submitAttemptCount > 0 ? (
              <p>
                <span className="font-medium">{t('submitAttempts')}:</span> {submitAttemptCount}
              </p>
            ) : null}
            {submitAttemptLog.length ? (
              <details className="text-token-xs">
                <summary>{t('submitAttemptLog')}</summary>
                <ul className="mt-token-xs space-y-token-xs">
                  {submitAttemptLog.map((e, i) => (
                    <li key={`${String(e.at)}-${i}`}>
                      {String(e.at)} — {String(e.outcome)}
                      {e.code ? ` [${String(e.code)}]` : ''}
                      {e.retryAfterSeconds ? ` retryAfter=${String(e.retryAfterSeconds)}s` : ''}
                      {e.message ? `: ${String(e.message).slice(0, 120)}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="text-token-sm text-danger">{error}</p> : null}

        <section className="grid grid-cols-1 gap-token-sm rounded border border-border bg-surface p-token-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-3 xl:col-span-4">
            {sectionTitle(t('sectionHeader'))}
          </div>
          <label className="block text-token-sm">
            {t('kind')}
            <select
              className={fieldClass()}
              value={kind}
              onChange={(e) => setKind(e.target.value as DocumentUpsert['kind'])}
            >
              <option value="INVOICE">INVOICE</option>
              <option value="CREDIT_NOTE">CREDIT_NOTE</option>
              <option value="DEBIT_NOTE">DEBIT_NOTE</option>
              <option value="EXPORT_INVOICE">EXPORT_INVOICE</option>
              <option value="EXPORT_CREDIT_NOTE">EXPORT_CREDIT_NOTE</option>
              <option value="EXPORT_DEBIT_NOTE">EXPORT_DEBIT_NOTE</option>
            </select>
          </label>
          <label className="block text-token-sm">
            {t('branch')}
            <select
              className={fieldClass()}
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
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
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-token-sm">
            {t('issueDate')}
            <input
              type="datetime-local"
              className={fieldClass()}
              value={issueDateTime}
              onChange={(e) => setIssueDateTime(e.target.value)}
            />
          </label>
          <label className="block text-token-sm sm:col-span-2">
            {t('internalId')}
            <div className="mt-token-xs flex flex-wrap gap-token-xs">
              <input
                className={fieldClass() + ' mt-0 flex-1'}
                value={internalId}
                onChange={(e) => {
                  setInternalIdManual(true);
                  setInternalId(e.target.value);
                }}
              />
              {isNew ? (
                <button
                  type="button"
                  className="rounded border border-border px-token-sm py-token-xs text-token-xs"
                  title={t('internalIdRegenerate')}
                  onClick={() => {
                    setInternalIdManual(false);
                    if (!branchId) return;
                    void allocateNextInternalId({ branchId, kind }).then((r) =>
                      setInternalId(r.internalId),
                    );
                  }}
                >
                  {t('internalIdRegenerate')}
                </button>
              ) : null}
            </div>
            <span className="mt-token-xs block text-token-xs text-foreground/60">
              {t('internalIdHelp')}
            </span>
          </label>
          <label className="block text-token-sm sm:col-span-2">
            {t('taxpayerActivityCode')}
            <input
              className={fieldClass()}
              list="activity-code-options"
              placeholder={t('searchActivity')}
              value={
                activityQuery ||
                (selectedActivity
                  ? `${selectedActivity.code} — ${locale === 'ar' ? selectedActivity.nameAr || selectedActivity.nameEn : selectedActivity.nameEn}`
                  : taxpayerActivityCode)
              }
              onChange={(e) => {
                const raw = e.target.value;
                setActivityQuery(raw);
                const code = raw.split('—')[0]?.trim() ?? raw.trim();
                const match = activities.find(
                  (a) =>
                    a.code === code ||
                    raw === a.code ||
                    raw.startsWith(`${a.code} `) ||
                    raw.startsWith(`${a.code}—`) ||
                    raw.startsWith(`${a.code} —`),
                );
                if (match) {
                  setTaxpayerActivityCode(match.code);
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.taxpayerActivityCode;
                    return next;
                  });
                } else if (!raw.trim()) {
                  setTaxpayerActivityCode('');
                }
              }}
              onBlur={() => {
                if (taxpayerActivityCode) setActivityQuery('');
              }}
            />
            <datalist id="activity-code-options">
              {filteredActivities.map((a) => (
                <option
                  key={a.code}
                  value={`${a.code} — ${locale === 'ar' ? a.nameAr || a.nameEn : a.nameEn}`}
                />
              ))}
            </datalist>
            {activities.length ? (
              <span className="mt-token-xs block text-token-xs text-foreground/60">
                {t('activityCount', { count: activities.length })}
                {taxpayerActivityCode ? ` · ${taxpayerActivityCode}` : ''}
              </span>
            ) : (
              <span className="mt-token-xs block text-token-xs text-danger">
                {t('activityLoadEmpty')}
              </span>
            )}
            {fieldErrors.taxpayerActivityCode ? (
              <span className="mt-token-xs block text-token-xs text-danger">
                {fieldErrors.taxpayerActivityCode}
              </span>
            ) : null}
          </label>
          {isExportKind(kind) || kind === 'INVOICE' ? (
            <label className="block text-token-sm">
              {t('serviceDeliveryDate')}
              <input
                type="date"
                className={fieldClass()}
                value={serviceDeliveryDate}
                onChange={(e) => setServiceDeliveryDate(e.target.value)}
              />
            </label>
          ) : null}
          <label className="block text-token-sm">
            {t('purchaseOrderReference')}
            <input
              className={fieldClass()}
              value={purchaseOrderReference}
              onChange={(e) => setPurchaseOrderReference(e.target.value)}
            />
          </label>
          <label className="block text-token-sm">
            {t('purchaseOrderDescription')}
            <input
              className={fieldClass()}
              value={purchaseOrderDescription}
              onChange={(e) => setPurchaseOrderDescription(e.target.value)}
            />
          </label>
          <label className="block text-token-sm">
            {t('salesOrderReference')}
            <input
              className={fieldClass()}
              value={salesOrderReference}
              onChange={(e) => setSalesOrderReference(e.target.value)}
            />
          </label>
          <label className="block text-token-sm">
            {t('salesOrderDescription')}
            <input
              className={fieldClass()}
              value={salesOrderDescription}
              onChange={(e) => setSalesOrderDescription(e.target.value)}
            />
          </label>
          <label className="block text-token-sm">
            {t('proformaInvoiceNumber')}
            <input
              className={fieldClass()}
              value={proformaInvoiceNumber}
              onChange={(e) => setProformaInvoiceNumber(e.target.value)}
            />
          </label>
          <label className="block text-token-sm">
            {t('extraDiscountAmount')}
            <input
              className={fieldClass()}
              value={extraDiscountAmount}
              onChange={(e) => setExtraDiscountAmount(e.target.value)}
            />
          </label>
        </section>

        {/* Issuer first in DOM so LTR renders issuer left / receiver right, and
            RTL mirrors it automatically without a second column order. */}
        <div className="grid grid-cols-1 gap-token-lg lg:grid-cols-2">
          <section className="space-y-token-sm">
            <button
              type="button"
              className="text-token-sm text-brand"
              onClick={() => setShowIssuer((v) => !v)}
            >
              {showIssuer ? t('hideIssuer') : t('showIssuer')}
            </button>
            {showIssuer ? (
              <div className="space-y-token-sm rounded border border-border bg-surface p-token-sm">
                {sectionTitle(t('sectionIssuer'))}
                <label className="block text-token-sm">
                  {t('issuerType')}
                  <select
                    className={fieldClass()}
                    value={issuer.type}
                    onChange={(e) => setIssuer({ ...issuer, type: e.target.value })}
                  >
                    <option value="B">B</option>
                    <option value="P">P</option>
                    <option value="F">F</option>
                  </select>
                </label>
                <label className="block text-token-sm">
                  {t('issuerId')}
                  <input
                    className={fieldClass()}
                    value={issuer.id}
                    onChange={(e) => setIssuer({ ...issuer, id: e.target.value })}
                  />
                </label>
                <label className="block text-token-sm">
                  {t('issuerName')}
                  <input
                    className={fieldClass()}
                    value={issuer.name}
                    onChange={(e) => setIssuer({ ...issuer, name: e.target.value })}
                  />
                </label>
                <AddressFields
                  value={issuer.address}
                  onChange={(address) => setIssuer({ ...issuer, address })}
                  countries={countries}
                  showBranchId
                  t={t}
                />
              </div>
            ) : null}
          </section>

          <section className="space-y-token-sm">
            <button
              type="button"
              className="text-token-sm text-brand"
              onClick={() => setShowReceiver((v) => !v)}
            >
              {showReceiver ? t('hideReceiver') : t('showReceiver')}
            </button>
            {showReceiver ? (
              <div className="space-y-token-sm rounded border border-border bg-surface p-token-sm">
                {sectionTitle(t('sectionReceiver'))}
                <label className="block text-token-sm">
                  {t('receiverType')}
                  <select
                    className={fieldClass()}
                    value={receiver.type}
                    onChange={(e) => setReceiver({ ...receiver, type: e.target.value })}
                    disabled={isExportKind(kind)}
                  >
                    <option value="B">B</option>
                    <option value="P">P</option>
                    <option value="F">F</option>
                  </select>
                </label>
                <label className="block text-token-sm">
                  {t('receiverId')}
                  <input
                    className={fieldClass()}
                    value={receiver.id}
                    onChange={(e) => setReceiver({ ...receiver, id: e.target.value })}
                  />
                </label>
                <label className="block text-token-sm">
                  {t('receiverName')}
                  <input
                    className={fieldClass()}
                    value={receiver.name}
                    onChange={(e) => setReceiver({ ...receiver, name: e.target.value })}
                  />
                </label>
                <AddressFields
                  value={receiver.address}
                  onChange={(address) => setReceiver({ ...receiver, address })}
                  countries={countries}
                  t={t}
                />
              </div>
            ) : null}
          </section>
        </div>

        {(kind.includes('CREDIT') || kind.includes('DEBIT')) && (
          <section className="space-y-token-sm rounded border border-border bg-surface p-token-sm">
            {sectionTitle(t('sectionReferences'))}
            <p className="text-token-xs text-foreground/70">{t('referencesRequired')}</p>
            <label className="block text-token-sm">
              {t('referencesPick')}
              <input
                className={fieldClass()}
                placeholder={t('referencesSearch')}
                value={referencePickerQuery}
                onChange={(e) => setReferencePickerQuery(e.target.value)}
              />
            </label>
            <div className="max-h-40 overflow-auto rounded border border-border">
              {referenceCandidates
                .filter((c) => {
                  const q = referencePickerQuery.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    c.internalId.toLowerCase().includes(q) ||
                    c.etaUuid.toLowerCase().includes(q)
                  );
                })
                .slice(0, 30)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="block w-full border-b border-border px-token-sm py-token-xs text-start text-token-xs hover:bg-brand-muted"
                    onClick={() => {
                      setReferencesText((prev) => {
                        const lines = prev
                          .split(/[\n,]+/)
                          .map((s) => s.trim())
                          .filter(Boolean);
                        if (lines.includes(c.etaUuid)) return prev;
                        return [...lines, c.etaUuid].join('\n');
                      });
                      setReferenceFormatHint(null);
                    }}
                  >
                    <span className="font-medium">{c.internalId}</span>
                    <span className="ms-token-sm text-foreground/60">{c.kind}</span>
                    <span className="ms-token-sm font-mono text-foreground/70">
                      {c.etaUuid}
                    </span>
                    <span className="ms-token-sm text-foreground/60">
                      {c.issueDateTime.slice(0, 10)} · {c.totalAmount}
                    </span>
                  </button>
                ))}
              {referenceCandidates.length === 0 ? (
                <p className="px-token-sm py-token-xs text-token-xs text-foreground/60">
                  {t('referencesNoneLocal')}
                </p>
              ) : null}
            </div>
            <label className="block text-token-sm">
              {t('referencesManual')}
              <textarea
                className={fieldClass()}
                rows={3}
                value={referencesText}
                onChange={(e) => {
                  const v = e.target.value;
                  setReferencesText(v);
                  const parts = v
                    .split(/[\n,]+/)
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const bad = parts.find((p) => !isPlausibleEtaDocumentReference(p));
                  setReferenceFormatHint(
                    bad ? t('referencesFormatHint', { value: bad }) : null,
                  );
                }}
              />
            </label>
            {referenceFormatHint ? (
              <p className="text-token-xs text-danger">{referenceFormatHint}</p>
            ) : null}
            <p className="text-token-xs text-foreground/60">{t('referencesHelp')}</p>
          </section>
        )}

        <section className="space-y-token-sm rounded border border-border bg-surface p-token-sm">
          <div className="flex items-center justify-between">
            {sectionTitle(t('lines'))}
            <button type="button" className="text-token-sm text-brand" onClick={addLine}>
              {t('addLine')}
            </button>
          </div>
          {lines.length === 0 ? (
            <div className="space-y-token-sm rounded border border-dashed border-border p-token-md text-center">
              <p className="text-token-sm text-foreground/70">{t('noLines')}</p>
              <button
                type="button"
                className="rounded border border-border px-token-md py-token-xs text-token-sm text-brand"
                onClick={addLine}
              >
                {t('addLine')}
              </button>
            </div>
          ) : null}
          {lines.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[64rem] border-collapse text-token-xs">
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
                    const taxSummary = taxRowSummary(line, t);
                    return (
                      <Fragment key={line.rowKey}>
                        <tr className="align-top">
                          <td
                            className="px-token-xs py-token-xs text-foreground/60"
                            title={t('lineNumber', { number: idx + 1 })}
                          >
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
                              onChange={(e) => updateLine(idx, { itemCode: e.target.value })}
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
                              className={cellClass() + ' min-w-[14rem]'}
                              aria-label={t('description')}
                              placeholder={t('description')}
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
                                  {u.code}
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
                            {lineTotalDisplay(line)}
                          </td>
                          <td className="px-token-xs py-token-xs text-end">
                            <button
                              type="button"
                              className="inline-flex items-center rounded border border-danger/40 px-token-xs py-token-xs text-token-xs text-danger"
                              aria-label={t('removeLineAria', { number: idx + 1 })}
                              title={t('removeLine')}
                              onClick={() => removeLine(line.rowKey)}
                            >
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                className="h-4 w-4"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                        <tr className="border-b border-border">
                          <td colSpan={11} className="px-token-xs pb-token-xs">
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
                                    onChange={(e) => updateLine(idx, { discountRate: e.target.value })}
                                  />
                                </label>
                                <label className="block text-token-xs">
                                  {t('internalCode')}
                                  <input
                                    className={fieldClass()}
                                    value={line.internalCode ?? ''}
                                    onChange={(e) => updateLine(idx, { internalCode: e.target.value })}
                                  />
                                </label>
                                {currencyCode !== 'EGP' ? (
                                  <>
                                    <label className="block text-token-xs">
                                      {t('amountSold')}
                                      <input
                                        className={fieldClass()}
                                        value={line.amountSold ?? ''}
                                        onChange={(e) => updateLine(idx, { amountSold: e.target.value })}
                                      />
                                    </label>
                                    <label className="block text-token-xs">
                                      {t('currencyExchangeRate')}
                                      <input
                                        className={fieldClass()}
                                        value={line.currencyExchangeRate ?? ''}
                                        onChange={(e) => updateLine(idx, { currencyExchangeRate: e.target.value })}
                                      />
                                    </label>
                                  </>
                                ) : null}
                                {isExportKind(kind) ? (
                                  <>
                                    <label className="block text-token-xs">
                                      {t('weightUnitType')}
                                      <select
                                        className={fieldClass()}
                                        value={line.weightUnitType ?? ''}
                                        onChange={(e) => updateLine(idx, { weightUnitType: e.target.value })}
                                      >
                                        <option value="">—</option>
                                        {weightUnits.map((w) => (
                                          <option key={w.code} value={w.code}>
                                            {w.code}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="block text-token-xs">
                                      {t('weightQuantity')}
                                      <input
                                        className={fieldClass()}
                                        value={line.weightQuantity ?? ''}
                                        onChange={(e) => updateLine(idx, { weightQuantity: e.target.value })}
                                      />
                                    </label>
                                  </>
                                ) : null}
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

        <div className="grid grid-cols-1 gap-token-lg lg:grid-cols-2">
          <section className="space-y-token-sm">
            <button
              type="button"
              className="text-token-sm text-brand"
              onClick={() => setShowPayment((v) => !v)}
            >
              {showPayment ? t('hidePayment') : t('showPayment')}
            </button>
            {showPayment ? (
              <div className="grid gap-token-xs rounded border border-border bg-surface p-token-sm sm:grid-cols-2">
                {(
                  [
                    'bankName',
                    'bankAddress',
                    'bankAccountNo',
                    'bankAccountIBAN',
                    'swiftCode',
                    'terms',
                  ] as const
                ).map((key) => (
                  <label key={key} className="block text-token-sm">
                    {t(key)}
                    <input
                      className={fieldClass()}
                      value={payment[key]}
                      onChange={(e) => setPayment({ ...payment, [key]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
            ) : null}
          </section>

          <section className="space-y-token-sm">
            <button
              type="button"
              className="text-token-sm text-brand"
              onClick={() => setShowDelivery((v) => !v)}
            >
              {showDelivery ? t('hideDelivery') : t('showDelivery')}
            </button>
            {showDelivery ? (
              <div className="grid gap-token-xs rounded border border-border bg-surface p-token-sm sm:grid-cols-2">
                {(
                  [
                    'approach',
                    'packaging',
                    'dateValidity',
                    'exportPort',
                    'countryOfOrigin',
                    'grossWeight',
                    'netWeight',
                    'terms',
                  ] as const
                ).map((key) =>
                  key === 'countryOfOrigin' ? (
                    <label key={key} className="block text-token-sm">
                      {t(key)}
                      <select
                        className={fieldClass()}
                        value={delivery.countryOfOrigin}
                        onChange={(e) =>
                          setDelivery({ ...delivery, countryOfOrigin: e.target.value })
                        }
                      >
                        <option value="">—</option>
                        {countries.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label key={key} className="block text-token-sm">
                      {t(key)}
                      <input
                        className={fieldClass()}
                        value={delivery[key]}
                        onChange={(e) => setDelivery({ ...delivery, [key]: e.target.value })}
                      />
                    </label>
                  ),
                )}
              </div>
            ) : null}
          </section>
        </div>

        {issues.length ? (
          <ul className="text-token-sm text-foreground/80">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        ) : null}

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
      </div>

      <div className="sticky bottom-0 z-30 max-h-[45vh] space-y-token-sm overflow-y-auto rounded-t border border-border bg-surface p-token-sm shadow-lg">
        <div className="flex flex-wrap items-end gap-x-token-lg gap-y-token-xs">
          <h2 className="font-medium text-brand">{t('totals')}</h2>
          <p className="text-token-sm">
            <span className="text-foreground/60">{t('totalSalesAmount')}:</span>{' '}
            {String(totals?.totalSalesAmount ?? '—')}
          </p>
          {totals?.totalDiscountAmount != null ? (
            <p className="text-token-sm">
              <span className="text-foreground/60">{t('totalDiscountAmount')}:</span>{' '}
              {String(totals.totalDiscountAmount)}
            </p>
          ) : null}
          <p className="text-token-sm">
            <span className="text-foreground/60">{t('netAmount')}:</span>{' '}
            {String(totals?.netAmount ?? '—')}
          </p>
          {Array.isArray(totals?.taxTotals) && totals.taxTotals.length ? (
            <p className="text-token-sm">
              <span className="text-foreground/60">{t('taxTotals')}:</span>{' '}
              {(totals.taxTotals as Array<{ taxType?: string; amount?: string }>)
                .map((tt) => `${String(tt.taxType ?? '')} ${String(tt.amount ?? '')}`.trim())
                .join(' · ')}
            </p>
          ) : null}
          <p className="text-token-md font-medium">
            <span className="text-foreground/60">{t('totalAmount')}:</span>{' '}
            {String(totals?.totalAmount ?? '—')}
          </p>
        </div>

        <div className="flex flex-wrap gap-token-sm">
          <button
            type="button"
            className="rounded border border-border px-token-md py-token-sm text-token-sm"
            title={t('localPrintoutHint')}
            disabled={submitting || !branchId || !internalId}
            onClick={async () => {
              try {
                setSubmitting(true);
                setError(null);
                const { blob, filename } = await downloadLocalPrintoutFromBody(
                  body(),
                  locale,
                );
                triggerBrowserDownload(blob, filename);
              } catch (e) {
                setError(e instanceof Error ? e.message : t('downloadFailed'));
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {t('previewPrint')}
          </button>
          <button
            type="button"
            className="rounded bg-brand px-token-md py-token-sm text-white"
            onClick={async () => {
              try {
                setError(null);
                setOfflineHint(null);
                if (isNew) {
                  const created = await createDocument(body());
                  router.replace(`/${locale}/documents/${String(created.id)}`);
                } else {
                  const updated = await updateDocument(params.id, body());
                  setVersion(Number(updated.version));
                  setCanonical(String(updated.canonicalString ?? ''));
                  setEtaJson(JSON.stringify(updated.etaPayload, null, 2));
                  setTotals(updated.totals as Record<string, unknown>);
                }
              } catch (e) {
                const offline = typeof navigator !== 'undefined' && !navigator.onLine;
                const networkFail =
                  offline || e instanceof TypeError || (e instanceof ApiError && e.status === 0);
                if (networkFail && user?.id) {
                  const tenantId = getActiveTenantId();
                  if (tenantId) {
                    await putDraft({
                      idempotencyKey: offlineKey,
                      tenantId,
                      userId: user.id,
                      serverDocumentId: isNew ? undefined : params.id,
                      baseRevision: 0,
                      localRevision: 1,
                      payload: body() as unknown as Record<string, unknown>,
                      status: 'pending',
                      updatedAt: new Date().toISOString(),
                    });
                    setOfflineHint(tOffline('savedLocally'));
                    return;
                  }
                }
                if (e instanceof ApiError && e.status === 409) {
                  setError(t('staleVersion'));
                } else {
                  setError(e instanceof Error ? e.message : t('forbidden'));
                }
              }
            }}
          >
            {t('save')}
          </button>
          {offlineHint ? <span className="text-token-sm text-amber-800">{offlineHint}</span> : null}
          {!isNew ? (
            <>
              <button
                type="button"
                className="rounded border border-border px-token-md py-token-sm"
                onClick={async () => {
                  const res = await validateDocument(params.id);
                  const nextErrors: Record<string, string> = {};
                  for (const issue of res.issues) {
                    if (issue.severity === 'warning') continue;
                    const path = issue.path || issue.code;
                    nextErrors[path] = issue.message;
                  }
                  setFieldErrors(nextErrors);
                  const settingsIssue = res.issues.find(
                    (i) => i.severity !== 'warning' && i.fixIn === 'settings',
                  );
                  setSettingsFixArea(
                    settingsIssue ? (settingsIssue.settingsArea ?? 'branches') : null,
                  );
                  const warnings = res.issues.filter((i) => i.severity === 'warning');
                  const errors = res.issues.filter((i) => i.severity !== 'warning');
                  if (res.ok && warnings.length) {
                    setIssues([
                      t('validationOkWithWarnings'),
                      ...warnings.map(
                        (i) => `${i.code}${i.path ? ` @ ${i.path}` : ''}: ${i.message}`,
                      ),
                    ]);
                  } else if (res.ok) {
                    setIssues([t('validationOk')]);
                  } else {
                    setIssues(
                      errors.map((i) => `${i.code}${i.path ? ` @ ${i.path}` : ''}: ${i.message}`),
                    );
                  }
                }}
              >
                {t('validate')}
              </button>
              {docStatus === 'DRAFT' || docStatus === 'READY' ? (
                <button
                  type="button"
                  className="rounded border border-border px-token-md py-token-sm"
                  title={t('recalculateTotalsHint')}
                  onClick={async () => {
                    try {
                      setError(null);
                      const updated = await recalculateDocumentTotals(params.id);
                      setVersion(Number(updated.version));
                      setDocStatus(String(updated.status ?? docStatus));
                      setCanonical(String(updated.canonicalString ?? ''));
                      setEtaJson(JSON.stringify(updated.etaPayload, null, 2));
                      setTotals(updated.totals as Record<string, unknown>);
                      const docLines = updated.lines as Array<Record<string, unknown>>;
                      if (docLines?.length) {
                        setLines(
                          withRowKeys(
                            docLines.map((l) => {
                              const taxes = ((l.taxes as Array<Record<string, string>>) ?? []).map(
                                (tx) => {
                                  const fixed = isFixedAmountTaxType(tx.taxType);
                                  return {
                                    taxType: tx.taxType,
                                    subType: tx.subType,
                                    rate: fixed ? '0' : tx.rate,
                                    ...(fixed ? { amount: tx.amount ?? '0.00' } : {}),
                                  };
                                },
                              );
                              return {
                                description: String(l.description),
                                itemType: String(l.itemType),
                                itemCode: String(l.itemCode),
                                unitType: String(l.unitType),
                                quantity: String(l.quantity),
                                unitPrice: String(l.unitPrice),
                                discountAmount: String(l.discountAmount ?? '0.00'),
                                discountRate: String(l.discountRate ?? '0'),
                                currencySold: String(l.currencySold ?? currencyCode),
                                amountEGP: String(l.amountEgp ?? l.unitPrice),
                                amountSold: String(l.amountSold ?? ''),
                                currencyExchangeRate: String(l.currencyExchangeRate ?? ''),
                                internalCode: String(l.internalCode ?? ''),
                                taxes,
                              };
                            }),
                          ),
                        );
                      }
                      setIssues([t('recalculateTotalsDone')]);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : t('recalculateTotalsBlocked'));
                    }
                  }}
                >
                  {t('recalculateTotals')}
                </button>
              ) : null}
              <button
                type="button"
                className="rounded border border-border px-token-md py-token-sm"
                onClick={async () => {
                  try {
                    await markDocumentReady(params.id);
                    setIssues([t('validationOk')]);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : t('validationFailed'));
                  }
                }}
              >
                {t('markReady')}
              </button>
              <button
                type="button"
                className="rounded border border-border px-token-md py-token-sm"
                onClick={async () => {
                  try {
                    setError(null);
                    await sendDocumentForSignature(params.id);
                    setDocStatus('READY');
                    setIssues([t('sendForSignature')]);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : t('forbidden'));
                  }
                }}
              >
                {t('sendForSignature')}
              </button>
              {docStatus === 'SUBMITTED' ||
              docStatus === 'VALID' ||
              docStatus === 'INVALID' ||
              docStatus === 'CANCELLED' ||
              docStatus === 'REJECTED' ? (
                <button
                  type="button"
                  disabled={submitting}
                  className="rounded border border-border px-token-md py-token-sm disabled:opacity-50"
                  onClick={async () => {
                    try {
                      setSubmitting(true);
                      setError(null);
                      const res = await refreshDocumentStatus(params.id);
                      if (res.status) setDocStatus(res.status);
                      setIssues([
                        t('refreshOneSummary', {
                          internalId: res.internalId,
                          status: res.status ?? '—',
                          outcome: res.outcome,
                        }),
                      ]);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : t('refreshStatusFailed'));
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                >
                  {t('refreshStatus')}
                </button>
              ) : null}
              {docStatus === 'SIGNED' || needsAttention ? (
                <>
                  <button
                    type="button"
                    disabled={submitting || cooldownActive}
                    className="rounded bg-brand px-token-md py-token-sm text-white disabled:opacity-50"
                    onClick={async () => {
                      try {
                        if (issueDateTime && checkLateSubmission(issueDateTime).isLate) {
                          const check = checkLateSubmission(issueDateTime);
                          const ok = window.confirm(
                            t('lateSubmitConfirm', {
                              count: 1,
                              days: check.warnDays,
                            }),
                          );
                          if (!ok) return;
                        }
                        setSubmitting(true);
                        setError(null);
                        const res = await submitDocumentToEta(params.id);
                        setSubmissionUuid(res.etaSubmissionUuid);
                        const first = res.documents[0];
                        if (first?.documentStatus) setDocStatus(first.documentStatus);
                        if (first?.etaUuid) setEtaUuid(first.etaUuid);
                        if (res.lastErrorMessage) {
                          setNeedsAttention(true);
                          setNeedsAttentionReason(res.lastErrorMessage);
                          setError(res.lastErrorMessage);
                        } else if (first?.intakeError) {
                          setNeedsAttention(true);
                          const msg =
                            typeof first.intakeError === 'object' &&
                            first.intakeError &&
                            'message' in first.intakeError
                              ? String((first.intakeError as { message: unknown }).message)
                              : JSON.stringify(first.intakeError);
                          setNeedsAttentionReason(msg);
                          setError(msg);
                        } else {
                          setNeedsAttention(false);
                          setNeedsAttentionReason(null);
                        }
                        setIssues([
                          res.isTransientCooldown || res.state === 'WAITING_COOLDOWN'
                            ? t('cooldownScheduled', {
                                until: res.nextAttemptAt ?? '—',
                              })
                            : t('submitResult', {
                                state: res.state,
                                uuid: res.etaSubmissionUuid ?? '—',
                                accepted: String(res.acceptedCount),
                                refused: String(res.refusedCount),
                              }),
                        ]);
                        const refreshed = await getDocument(params.id);
                        setDocStatus(String(refreshed.status ?? docStatus));
                        setNeedsAttention(Boolean(refreshed.needsAttention));
                        setNeedsAttentionReason(
                          refreshed.needsAttentionReason
                            ? String(refreshed.needsAttentionReason)
                            : null,
                        );
                        setSubmissionUuid(
                          refreshed.submissionUuid ? String(refreshed.submissionUuid) : null,
                        );
                        setEtaUuid(refreshed.etaUuid ? String(refreshed.etaUuid) : null);
                        setCooldownUntil(
                          refreshed.submitCooldownUntil
                            ? String(refreshed.submitCooldownUntil)
                            : null,
                        );
                        setSubmitAttemptCount(Number(refreshed.submitAttemptCount ?? 0));
                        setSubmitAttemptLog(
                          Array.isArray(refreshed.submitAttemptLog)
                            ? (refreshed.submitAttemptLog as Array<Record<string, unknown>>)
                            : [],
                        );
                      } catch (e) {
                        const msg =
                          e instanceof ApiError
                            ? e.message
                            : e instanceof Error
                              ? e.message
                              : t('submitFailed');
                        setError(msg);
                        const body = e instanceof ApiError ? e.body : null;
                        if (
                          body &&
                          typeof body === 'object' &&
                          body !== null &&
                          'submitCooldownUntil' in body
                        ) {
                          const b = body as {
                            submitCooldownUntil?: string;
                            retryAfterSeconds?: number;
                          };
                          if (b.submitCooldownUntil) {
                            setCooldownUntil(b.submitCooldownUntil);
                          }
                        }
                        try {
                          const refreshed = await getDocument(params.id);
                          setCooldownUntil(
                            refreshed.submitCooldownUntil
                              ? String(refreshed.submitCooldownUntil)
                              : null,
                          );
                          setSubmitAttemptLog(
                            Array.isArray(refreshed.submitAttemptLog)
                              ? (refreshed.submitAttemptLog as Array<Record<string, unknown>>)
                              : [],
                          );
                          setSubmitAttemptCount(Number(refreshed.submitAttemptCount ?? 0));
                          setNeedsAttentionReason(
                            refreshed.needsAttentionReason
                              ? String(refreshed.needsAttentionReason)
                              : null,
                          );
                        } catch {
                          /* ignore */
                        }
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                  >
                    {cooldownActive
                      ? t('cooldownActive')
                      : submitting
                        ? t('submitting')
                        : t('submitToEta')}
                  </button>
                  {(cooldownActive || needsAttention) && (
                    <button
                      type="button"
                      className="rounded border border-border px-token-md py-token-sm"
                      onClick={async () => {
                        try {
                          setError(null);
                          const res = await resetDocumentSubmitCooldown(params.id);
                          setCooldownUntil(null);
                          setIssues([res.message]);
                          setSubmitAttemptLog(
                            Array.isArray(res.submitAttemptLog)
                              ? (res.submitAttemptLog as Array<Record<string, unknown>>)
                              : [],
                          );
                        } catch (e) {
                          setError(e instanceof Error ? e.message : t('submitFailed'));
                        }
                      }}
                    >
                      {t('resetCooldown')}
                    </button>
                  )}
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {taxModalLine && taxModalLineIdx != null ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-token-md"
          role="dialog"
          aria-modal="true"
          aria-label={t('editTaxes')}
          onClick={() => setTaxModalLineIdx(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded border border-border bg-surface p-token-md shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-token-sm flex items-center justify-between gap-token-sm">
              <h2 className="font-medium text-brand">
                {t('editTaxes')} — {t('lineNumber', { number: taxModalLineIdx + 1 })}
              </h2>
              <button
                type="button"
                className="rounded border border-border px-token-sm py-token-xs text-token-sm"
                onClick={() => setTaxModalLineIdx(null)}
              >
                {t('close')}
              </button>
            </div>
            <LineTaxesEditor
              line={taxModalLine}
              lineIndex={taxModalLineIdx}
              taxTypes={taxTypes}
              taxSubtypes={taxSubtypes}
              taxTypeOptions={taxTypeOptions}
              zeroRatedSubtypeOptions={zeroRatedSubtypeOptions}
              exemptSubtypeOptions={exemptSubtypeOptions}
              subtypeOptionsFor={subtypeOptionsFor}
              updateLine={updateLine}
              setLineTaxMode={setLineTaxMode}
              setLineZeroExemptKind={setLineZeroExemptKind}
              t={t}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
