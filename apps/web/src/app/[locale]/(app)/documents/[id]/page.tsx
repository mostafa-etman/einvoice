'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  createDocument,
  getDocument,
  markDocumentReady,
  previewDocument,
  sendDocumentForSignature,
  submitDocumentToEta,
  resetDocumentSubmitCooldown,
  updateDocument,
  validateDocument,
  type AddressInput,
  type DocumentUpsert,
} from '@/lib/api/documents';
import { listEtaCodes, type EtaCodeEntry } from '@/lib/api/eta-codes';
import { listItemCodes, type ItemCode } from '@/lib/api/item-codes';
import { apiFetch, ApiError } from '@/lib/api/client';
import {
  defaultTaxableTax,
  documentKindTypicallyRequiresTax,
  ETA_EXEMPT_SUBTYPES,
  ETA_ZERO_RATED_SUBTYPES,
  findDuplicateTaxTypes,
  firstSubtypeForTaxType,
  inferLineTaxMode,
  isFullyTaxFree,
  isSubtypeOfTaxType,
  nextUnusedTaxType,
  sortEtaCodeEntries,
  subtypesForTaxType,
  taxesForMode,
  type LineTaxMode,
} from '@einvoice/eta-core';

type Line = DocumentUpsert['lines'][number];
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

function toUiTaxMode(mode: LineTaxMode): UiTaxMode {
  if (mode === 'none') return 'none';
  if (mode === 'zero_rated' || mode === 'exempt') return 'zero_or_exempt';
  return 'taxable';
}

function codeLabel(entry: EtaCodeEntry): string {
  const name = entry.nameEn || entry.nameAr || '';
  return name ? `${entry.code} — ${name}` : entry.code;
}

function fieldClass() {
  return 'mt-token-xs w-full rounded border border-border bg-background px-token-sm py-token-xs';
}

function AddressFields(props: {
  value: AddressInput;
  onChange: (next: AddressInput) => void;
  countries: EtaCodeEntry[];
  showBranchId?: boolean;
  t: ReturnType<typeof useTranslations<'documents'>>;
}) {
  const { value, onChange, countries, showBranchId, t } = props;
  const set = (key: keyof AddressInput, v: string) =>
    onChange({ ...value, [key]: v });
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
          {(countries.length ? countries : [{ code: 'EG', nameEn: 'Egypt', nameAr: '', parentCode: null, meta: null }]).map(
            (c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.nameEn}
              </option>
            ),
          )}
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
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const isNew = params.id === 'new';
  const isExportKind = (k: string) => k.startsWith('EXPORT');

  const [branches, setBranches] = useState<
    Array<{
      id: string;
      name: string;
      isActive: boolean;
      activityCode?: string | null;
      etaBranchCode?: string | null;
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
  const [taxFreeWarningDismissed, setTaxFreeWarningDismissed] = useState(false);

  const [kind, setKind] = useState<DocumentUpsert['kind']>('INVOICE');
  const [branchId, setBranchId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('EGP');
  const [internalId, setInternalId] = useState(`INV-${Date.now()}`);
  const [issueDateTime, setIssueDateTime] = useState(
    () => new Date().toISOString().slice(0, 16),
  );
  const [taxpayerActivityCode, setTaxpayerActivityCode] = useState('');
  const [serviceDeliveryDate, setServiceDeliveryDate] = useState('');
  const [purchaseOrderReference, setPurchaseOrderReference] = useState('');
  const [purchaseOrderDescription, setPurchaseOrderDescription] = useState('');
  const [salesOrderReference, setSalesOrderReference] = useState('');
  const [salesOrderDescription, setSalesOrderDescription] = useState('');
  const [proformaInvoiceNumber, setProformaInvoiceNumber] = useState('');
  const [extraDiscountAmount, setExtraDiscountAmount] = useState('0.00');
  const [referencesText, setReferencesText] = useState('');

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

  const [version, setVersion] = useState(0);
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [canonical, setCanonical] = useState('');
  const [etaJson, setEtaJson] = useState('');
  const [totals, setTotals] = useState<Record<string, unknown> | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [docStatus, setDocStatus] = useState<string>('DRAFT');
  const [needsAttention, setNeedsAttention] = useState(false);
  const [needsAttentionReason, setNeedsAttentionReason] = useState<string | null>(
    null,
  );
  const [submissionUuid, setSubmissionUuid] = useState<string | null>(null);
  const [etaUuid, setEtaUuid] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null);
  const [submitAttemptLog, setSubmitAttemptLog] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [submitAttemptCount, setSubmitAttemptCount] = useState(0);
  /** Ticks so an elapsed cooldown re-enables Submit without a reload. */
  const [nowMs, setNowMs] = useState(() => Date.now());

  const cooldownActive = Boolean(
    cooldownUntil && new Date(cooldownUntil).getTime() > nowMs,
  );

  useEffect(() => {
    if (!cooldownUntil) return;
    const handle = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [cooldownUntil]);

  useEffect(() => {
    apiFetch<
      Array<{
        id: string;
        name: string;
        isActive: boolean;
        activityCode?: string | null;
        etaBranchCode?: string | null;
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
    } | null>('/settings/eta-credentials', { tenantScoped: true })
      .then((creds) => {
        if (!creds) return;
        if (isNew) {
          setTaxpayerActivityCode((prev) => prev || creds.activityCode || '');
          setIssuer((prev) => ({
            ...prev,
            id: prev.id || creds.registrationNumber || '',
          }));
        }
      })
      .catch(() => undefined);

    listItemCodes()
      .then((rows) => setItemCodes(rows.filter((i) => i.isActive)))
      .catch(() => undefined);

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
  }, [isNew]);

  useEffect(() => {
    if (!isNew || !branchId) return;
    const b = branches.find((x) => x.id === branchId);
    if (!b) return;
    if (b.activityCode) {
      setTaxpayerActivityCode((prev) => prev || b.activityCode || '');
    }
    setIssuer((prev) => ({
      ...prev,
      name: prev.name || b.name,
      address: {
        ...prev.address,
        branchId: prev.address.branchId || b.etaBranchCode || '0',
        country: prev.address.country || 'EG',
      },
    }));
  }, [isNew, branchId, branches]);

  useEffect(() => {
    if (Object.keys(fieldErrors).some((k) => k.startsWith('issuer'))) {
      setShowIssuer(true);
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
        setIssueDateTime(String(doc.issueDateTime).slice(0, 16));
        setVersion(Number(doc.version));
        setDocStatus(String(doc.status ?? 'DRAFT'));
        setNeedsAttention(Boolean(doc.needsAttention));
        setNeedsAttentionReason(
          doc.needsAttentionReason ? String(doc.needsAttentionReason) : null,
        );
        setSubmissionUuid(
          doc.submissionUuid ? String(doc.submissionUuid) : null,
        );
        setEtaUuid(doc.etaUuid ? String(doc.etaUuid) : null);
        setCooldownUntil(
          doc.submitCooldownUntil ? String(doc.submitCooldownUntil) : null,
        );
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
            (doc.totals as { extraDiscountAmount?: string } | undefined)
              ?.extraDiscountAmount ??
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
            docLines.map((l, idx) => {
              const pl = payloadLines[idx] ?? {};
              const unitValue = (pl.unitValue ?? {}) as Record<string, string>;
              const taxes =
                ((l.taxes as Array<Record<string, string>>) ?? []).map((tx) => ({
                  taxType: tx.taxType,
                  subType: tx.subType,
                  rate: tx.rate,
                }));
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
      lines: lines.map((l) => ({
        ...l,
        currencySold: l.currencySold || currencyCode,
        amountEGP: l.amountEGP || l.unitPrice,
      })),
    };
  };

  const refreshPreview = async () => {
    if (!branchId) return;
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
    const kind: LineTaxMode =
      current === 'exempt' ? 'exempt' : 'zero_rated';
    const sub = line.taxes?.[0]?.subType;
    updateLine(idx, {
      taxes: taxesForMode(kind, {
        zeroRatedSubtype:
          kind === 'zero_rated' &&
          (ETA_ZERO_RATED_SUBTYPES as readonly string[]).includes(sub ?? '')
            ? sub
            : undefined,
        exemptSubtype:
          kind === 'exempt' &&
          (ETA_EXEMPT_SUBTYPES as readonly string[]).includes(sub ?? '')
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
          kind === 'exempt' &&
          (ETA_EXEMPT_SUBTYPES as readonly string[]).includes(sub ?? '')
            ? sub
            : undefined,
      }),
    });
  };

  const showTaxFreeWarning =
    documentKindTypicallyRequiresTax(kind) &&
    isFullyTaxFree(lines) &&
    !taxFreeWarningDismissed;

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
  const subtypeOptionsFor = (taxType: string) =>
    subtypesForTaxType(taxSubtypes, taxType);

  const sectionTitle = (label: string) => (
    <h2 className="font-medium text-token-md text-brand">{label}</h2>
  );

  return (
    <div className="grid gap-token-lg lg:grid-cols-2">
      <div className="space-y-token-lg">
        <h1 className="font-display text-token-2xl text-brand">
          {isNew ? t('new') : internalId}
        </h1>
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
                <span className="font-medium">{t('submissionUuid')}:</span>{' '}
                {submissionUuid}
              </p>
            ) : null}
            {etaUuid ? (
              <p>
                <span className="font-medium">{t('etaUuid')}:</span> {etaUuid}
              </p>
            ) : null}
            {needsAttention && needsAttentionReason ? (
              <p className="text-danger">
                <span className="font-medium">{t('submissionError')}:</span>{' '}
                {needsAttentionReason}
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
                <span className="font-medium">{t('submitAttempts')}:</span>{' '}
                {submitAttemptCount}
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
                      {e.retryAfterSeconds
                        ? ` retryAfter=${String(e.retryAfterSeconds)}s`
                        : ''}
                      {e.message ? `: ${String(e.message).slice(0, 120)}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="text-token-sm text-danger">{error}</p> : null}

        <section className="space-y-token-sm">
          {sectionTitle(t('sectionHeader'))}
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
          <label className="block text-token-sm">
            {t('internalId')}
            <input
              className={fieldClass()}
              value={internalId}
              onChange={(e) => setInternalId(e.target.value)}
            />
          </label>
          <label className="block text-token-sm">
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

        <section className="space-y-token-sm">
          <button
            type="button"
            className="text-token-sm text-brand"
            onClick={() => setShowIssuer((v) => !v)}
          >
            {showIssuer ? t('hideIssuer') : t('showIssuer')}
          </button>
          {showIssuer ? (
            <div className="space-y-token-sm rounded border border-border p-token-sm">
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
        </section>

        {(kind.includes('CREDIT') || kind.includes('DEBIT')) && (
          <section className="space-y-token-sm">
            {sectionTitle(t('sectionReferences'))}
            <label className="block text-token-sm">
              {t('referencesHelp')}
              <textarea
                className={fieldClass()}
                rows={3}
                value={referencesText}
                onChange={(e) => setReferencesText(e.target.value)}
              />
            </label>
          </section>
        )}

        <section className="space-y-token-sm">
          <div className="flex items-center justify-between">
            {sectionTitle(t('lines'))}
            <button
              type="button"
              className="text-token-sm text-brand"
              onClick={() => setLines((prev) => [...prev, emptyLine(currencyCode)])}
            >
              {t('addLine')}
            </button>
          </div>
          {lines.map((line, idx) => (
            <div key={idx} className="space-y-token-xs rounded border border-border p-token-sm">
              <input
                className={fieldClass()}
                placeholder={t('description')}
                value={line.description}
                onChange={(e) => updateLine(idx, { description: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-token-xs">
                <label className="block text-token-xs">
                  {t('itemType')}
                  <select
                    className={fieldClass()}
                    value={line.itemType}
                    onChange={(e) => updateLine(idx, { itemType: e.target.value })}
                  >
                    <option value="EGS">EGS</option>
                    <option value="GS1">GS1</option>
                  </select>
                </label>
                <label className="block text-token-xs">
                  {t('itemCode')}
                  <select
                    className={fieldClass()}
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
                </label>
                <label className="block text-token-xs">
                  {t('unitType')}
                  <select
                    className={fieldClass()}
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
                </label>
                <label className="block text-token-xs">
                  {t('quantity')}
                  <input
                    className={fieldClass()}
                    value={line.quantity}
                    onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                  />
                </label>
                <label className="block text-token-xs">
                  {t('unitPrice')}
                  <input
                    className={fieldClass()}
                    value={line.unitPrice}
                    onChange={(e) =>
                      updateLine(idx, {
                        unitPrice: e.target.value,
                        amountEGP: e.target.value,
                      })
                    }
                  />
                </label>
                <label className="block text-token-xs">
                  {t('discount')}
                  <input
                    className={fieldClass()}
                    value={line.discountAmount ?? '0.00'}
                    onChange={(e) => updateLine(idx, { discountAmount: e.target.value })}
                  />
                </label>
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
                        onChange={(e) =>
                          updateLine(idx, { currencyExchangeRate: e.target.value })
                        }
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
              <div className="space-y-token-xs border-t border-border pt-token-xs">
                <p className="text-token-xs font-medium">{t('taxMode')}</p>
                <div className="flex flex-wrap gap-token-sm text-token-xs">
                  {(
                    [
                      ['taxable', 'taxModeTaxable'],
                      ['zero_or_exempt', 'taxModeZeroOrExempt'],
                      ['none', 'taxModeNone'],
                    ] as const
                  ).map(([value, labelKey]) => (
                    <label key={value} className="inline-flex items-center gap-1">
                      <input
                        type="radio"
                        name={`tax-mode-${idx}`}
                        checked={toUiTaxMode(inferLineTaxMode(line.taxes)) === value}
                        onChange={() => setLineTaxMode(idx, value)}
                      />
                      {t(labelKey)}
                    </label>
                  ))}
                </div>
                {(() => {
                  const mode = inferLineTaxMode(line.taxes);
                  const uiMode = toUiTaxMode(mode);
                  if (uiMode === 'taxable') {
                    const dupes = findDuplicateTaxTypes(line.taxes);
                    return (
                      <div className="space-y-token-xs">
                        <p className="text-token-xs text-foreground/70">
                          {t('taxModeHelpTaxable')}
                        </p>
                        {(line.taxes ?? []).map((tx, tIdx) => {
                          const subtypeOptions = subtypeOptionsFor(tx.taxType);
                          const subtypeMismatch =
                            Boolean(tx.subType) &&
                            subtypeOptions.length > 0 &&
                            !subtypeOptions.some((s) => s.code === tx.subType);
                          return (
                          <div
                            key={tIdx}
                            className="grid grid-cols-2 gap-token-xs sm:grid-cols-4"
                          >
                            <label className="block text-token-xs">
                              {t('taxType')}
                              <select
                                className={fieldClass()}
                                value={tx.taxType}
                                onChange={(e) => {
                                  const nextType = e.target.value;
                                  const taxes = [...(line.taxes ?? [])];
                                  // Subtypes are children of a tax type: keep the
                                  // pair consistent instead of leaving a foreign code.
                                  taxes[tIdx] = {
                                    ...tx,
                                    taxType: nextType,
                                    subType: isSubtypeOfTaxType(
                                      taxSubtypes,
                                      nextType,
                                      tx.subType,
                                    )
                                      ? tx.subType
                                      : firstSubtypeForTaxType(taxSubtypes, nextType),
                                  };
                                  updateLine(idx, { taxes });
                                }}
                              >
                                {taxTypeOptions.map((tt) => (
                                  <option key={tt.code} value={tt.code}>
                                    {codeLabel(tt)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="block text-token-xs">
                              {t('taxSubtype')}
                              <select
                                className={fieldClass()}
                                value={tx.subType}
                                onChange={(e) => {
                                  const taxes = [...(line.taxes ?? [])];
                                  taxes[tIdx] = { ...tx, subType: e.target.value };
                                  updateLine(idx, { taxes });
                                }}
                              >
                                {/* Show a stored code that does not belong to this
                                    tax type, so the field never displays a
                                    different subtype than the one held in state. */}
                                {subtypeMismatch ? (
                                  <option value={tx.subType}>
                                    {tx.subType} — {t('taxSubtypeMismatchOption')}
                                  </option>
                                ) : null}
                                {subtypeOptions.map((s) => (
                                  <option key={s.code} value={s.code}>
                                    {codeLabel(s)}
                                  </option>
                                ))}
                              </select>
                              {subtypeMismatch ? (
                                <span className="block text-token-xs text-red-700">
                                  {t('taxSubtypeMismatch', {
                                    subType: tx.subType,
                                    taxType: tx.taxType,
                                  })}
                                </span>
                              ) : null}
                            </label>
                            <label className="block text-token-xs">
                              {t('taxRate')}
                              <input
                                className={fieldClass()}
                                value={tx.rate}
                                onChange={(e) => {
                                  const taxes = [...(line.taxes ?? [])];
                                  taxes[tIdx] = { ...tx, rate: e.target.value };
                                  updateLine(idx, { taxes });
                                }}
                              />
                            </label>
                            <div className="flex items-end">
                              <button
                                type="button"
                                className="text-token-xs text-brand"
                                onClick={() => {
                                  const taxes = (line.taxes ?? []).filter(
                                    (_, i) => i !== tIdx,
                                  );
                                  updateLine(idx, {
                                    taxes: taxes.length ? taxes : [defaultTaxableTax()],
                                  });
                                }}
                              >
                                {t('removeTax')}
                              </button>
                            </div>
                          </div>
                          );
                        })}
                        {dupes.length ? (
                          <p className="text-token-xs text-red-700">
                            {t('duplicateTaxType', { taxTypes: dupes.join(', ') })}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          className="text-token-xs text-brand"
                          onClick={() => {
                            const nextType = nextUnusedTaxType(
                              taxTypeOptions,
                              (line.taxes ?? []).map((t) => t.taxType),
                            );
                            if (!nextType) return;
                            updateLine(idx, {
                              taxes: [
                                ...(line.taxes ?? []),
                                {
                                  taxType: nextType,
                                  subType: firstSubtypeForTaxType(
                                    taxSubtypes,
                                    nextType,
                                  ),
                                  rate: '0',
                                },
                              ],
                            });
                          }}
                        >
                          {t('addTax')}
                        </button>
                      </div>
                    );
                  }
                  if (uiMode === 'zero_or_exempt') {
                    const isExempt = mode === 'exempt';
                    const options = isExempt
                      ? exemptSubtypeOptions.length
                        ? exemptSubtypeOptions
                        : ETA_EXEMPT_SUBTYPES.map((code) => ({
                            code,
                            nameEn: code,
                            nameAr: '',
                            parentCode: 'T1',
                            meta: null,
                          }))
                      : zeroRatedSubtypeOptions.length
                        ? zeroRatedSubtypeOptions
                        : ETA_ZERO_RATED_SUBTYPES.map((code) => ({
                            code,
                            nameEn: code,
                            nameAr: '',
                            parentCode: 'T1',
                            meta: null,
                          }));
                    const currentSubtype = line.taxes?.[0]?.subType ?? options[0]!.code;
                    return (
                      <div className="space-y-token-xs">
                        <p className="text-token-xs text-foreground/70">
                          {t('taxModeHelpZeroOrExempt')}
                        </p>
                        <p className="text-token-xs text-foreground/70">
                          {t('taxKindVsNone')}
                        </p>
                        <div className="flex flex-wrap gap-token-sm text-token-xs">
                          <label className="inline-flex items-center gap-1">
                            <input
                              type="radio"
                              name={`tax-kind-${idx}`}
                              checked={!isExempt}
                              onChange={() => setLineZeroExemptKind(idx, 'zero_rated')}
                            />
                            {t('taxKindZeroRated')}
                          </label>
                          <label className="inline-flex items-center gap-1">
                            <input
                              type="radio"
                              name={`tax-kind-${idx}`}
                              checked={isExempt}
                              onChange={() => setLineZeroExemptKind(idx, 'exempt')}
                            />
                            {t('taxKindExempt')}
                          </label>
                        </div>
                        <p className="text-token-xs text-foreground/70">
                          {isExempt
                            ? t('taxKindExemptHelp')
                            : t('taxKindZeroRatedHelp')}
                        </p>
                        <label className="block text-token-xs">
                          {t('taxSubtype')}
                          <select
                            className={fieldClass()}
                            value={currentSubtype}
                            onChange={(e) => {
                              updateLine(idx, {
                                taxes: taxesForMode(
                                  isExempt ? 'exempt' : 'zero_rated',
                                  {
                                    zeroRatedSubtype: e.target.value,
                                    exemptSubtype: e.target.value,
                                  },
                                ),
                              });
                            }}
                          >
                            {options.map((s) => (
                              <option key={s.code} value={s.code}>
                                {codeLabel(s)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p className="text-token-xs text-foreground/60">
                          {t('taxType')}: T1 · {t('taxRate')}: 0
                        </p>
                      </div>
                    );
                  }
                  return (
                    <p className="text-token-xs text-foreground/70">
                      {t('taxModeHelpNone')}
                    </p>
                  );
                })()}
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-token-sm">
          <button
            type="button"
            className="text-token-sm text-brand"
            onClick={() => setShowPayment((v) => !v)}
          >
            {showPayment ? t('hidePayment') : t('showPayment')}
          </button>
          {showPayment ? (
            <div className="grid gap-token-xs sm:grid-cols-2">
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
            <div className="grid gap-token-xs sm:grid-cols-2">
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

        <div className="flex flex-wrap gap-token-sm">
          <button
            type="button"
            className="rounded bg-brand px-token-md py-token-sm text-white"
            onClick={async () => {
              try {
                setError(null);
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
                  const warnings = res.issues.filter((i) => i.severity === 'warning');
                  const errors = res.issues.filter((i) => i.severity !== 'warning');
                  if (res.ok && warnings.length) {
                    setIssues([
                      t('validationOkWithWarnings'),
                      ...warnings.map(
                        (i) =>
                          `${i.code}${i.path ? ` @ ${i.path}` : ''}: ${i.message}`,
                      ),
                    ]);
                  } else if (res.ok) {
                    setIssues([t('validationOk')]);
                  } else {
                    setIssues(
                      errors.map(
                        (i) =>
                          `${i.code}${i.path ? ` @ ${i.path}` : ''}: ${i.message}`,
                      ),
                    );
                  }
                }}
              >
                {t('validate')}
              </button>
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
              {docStatus === 'SIGNED' || needsAttention ? (
                <>
                  <button
                    type="button"
                    disabled={submitting || cooldownActive}
                    className="rounded bg-brand px-token-md py-token-sm text-white disabled:opacity-50"
                    onClick={async () => {
                      try {
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
                              ? String(
                                  (first.intakeError as { message: unknown }).message,
                                )
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
                          refreshed.submissionUuid
                            ? String(refreshed.submissionUuid)
                            : null,
                        );
                        setEtaUuid(
                          refreshed.etaUuid ? String(refreshed.etaUuid) : null,
                        );
                        setCooldownUntil(
                          refreshed.submitCooldownUntil
                            ? String(refreshed.submitCooldownUntil)
                            : null,
                        );
                        setSubmitAttemptCount(
                          Number(refreshed.submitAttemptCount ?? 0),
                        );
                        setSubmitAttemptLog(
                          Array.isArray(refreshed.submitAttemptLog)
                            ? (refreshed.submitAttemptLog as Array<
                                Record<string, unknown>
                              >)
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
                              ? (refreshed.submitAttemptLog as Array<
                                  Record<string, unknown>
                                >)
                              : [],
                          );
                          setSubmitAttemptCount(
                            Number(refreshed.submitAttemptCount ?? 0),
                          );
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
                              ? (res.submitAttemptLog as Array<
                                  Record<string, unknown>
                                >)
                              : [],
                          );
                        } catch (e) {
                          setError(
                            e instanceof Error ? e.message : t('submitFailed'),
                          );
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
        {issues.length ? (
          <ul className="text-token-sm text-foreground/80">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="space-y-token-md">
        <div>
          <h2 className="mb-token-sm font-medium">{t('totals')}</h2>
          <p className="text-token-sm">
            {t('totalAmount')}: {String(totals?.totalAmount ?? '—')}
          </p>
          <p className="text-token-sm">
            {t('totalSalesAmount')}: {String(totals?.totalSalesAmount ?? '—')}
          </p>
          <p className="text-token-sm">
            {t('netAmount')}: {String(totals?.netAmount ?? '—')}
          </p>
        </div>
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
    </div>
  );
}
