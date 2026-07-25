'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  createDocument,
  getDocument,
  markDocumentReady,
  previewDocument,
  sendDocumentForSignature,
  updateDocument,
  validateDocument,
  type DocumentUpsert,
} from '@/lib/api/documents';
import { apiFetch, ApiError } from '@/lib/api/client';

type Line = DocumentUpsert['lines'][number];

const emptyLine = (): Line => ({
  description: '',
  itemType: 'EGS',
  itemCode: '',
  unitType: 'EA',
  quantity: '1',
  unitPrice: '0.00',
  discountAmount: '0.00',
  taxes: [{ taxType: 'T1', subType: 'V001', rate: '14.00' }],
});

export default function DocumentEditorPage() {
  const t = useTranslations('documents');
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const isNew = params.id === 'new';

  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [kind, setKind] = useState<DocumentUpsert['kind']>('INVOICE');
  const [branchId, setBranchId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('EGP');
  const [internalId, setInternalId] = useState(`INV-${Date.now()}`);
  const [issueDateTime, setIssueDateTime] = useState(new Date().toISOString());
  const [receiverName, setReceiverName] = useState('');
  const [referenceInternalId, setReferenceInternalId] = useState('');
  const [version, setVersion] = useState(0);
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [canonical, setCanonical] = useState('');
  const [etaJson, setEtaJson] = useState('');
  const [totals, setTotals] = useState<Record<string, unknown> | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Array<{ id: string; name: string; isActive: boolean }>>('/branches', {
      tenantScoped: true,
    })
      .then((rows: Array<{ id: string; name: string; isActive: boolean }>) => {
        const active = rows.filter((b) => b.isActive);
        setBranches(active);
        if (active[0]) setBranchId(active[0].id);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (isNew) return;
    getDocument(params.id)
      .then((doc: Record<string, unknown>) => {
        setKind(doc.kind as DocumentUpsert['kind']);
        setBranchId(String(doc.branchId));
        setCurrencyCode(String(doc.currencyCode));
        setInternalId(String(doc.internalId));
        setIssueDateTime(String(doc.issueDateTime));
        setVersion(Number(doc.version));
        setCanonical(String(doc.canonicalString ?? ''));
        setEtaJson(JSON.stringify(doc.etaPayload, null, 2));
        setTotals(doc.totals as Record<string, unknown>);
        const docLines = doc.lines as Array<Record<string, unknown>>;
        if (docLines?.length) {
          setLines(
            docLines.map((l) => ({
              description: String(l.description),
              itemType: String(l.itemType),
              itemCode: String(l.itemCode),
              unitType: String(l.unitType),
              quantity: String(l.quantity),
              unitPrice: String(l.unitPrice),
              discountAmount: String(l.discountAmount ?? '0.00'),
              taxes: ((l.taxes as Array<Record<string, string>>) ?? []).map((tx) => ({
                taxType: tx.taxType,
                subType: tx.subType,
                rate: tx.rate,
              })),
            })),
          );
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [isNew, params.id]);

  const body = (): DocumentUpsert => ({
    kind,
    branchId,
    currencyCode,
    issueDateTime,
    internalId,
    version,
    receiver: { type: 'B', name: receiverName },
    references: referenceInternalId
      ? { internalID: referenceInternalId }
      : null,
    lines,
  });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, branchId, currencyCode, internalId, issueDateTime, receiverName, referenceInternalId, lines]);

  return (
    <div className="grid gap-token-lg lg:grid-cols-2">
      <div className="space-y-token-md">
        <h1 className="font-display text-token-2xl text-brand">
          {isNew ? t('new') : internalId}
        </h1>
        {error ? <p className="text-token-sm text-danger">{error}</p> : null}
        <label className="block text-token-sm">
          {t('kind')}
          <select
            className="mt-token-xs w-full rounded border border-border bg-background px-token-sm py-token-xs"
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
            className="mt-token-xs w-full rounded border border-border bg-background px-token-sm py-token-xs"
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
          <input
            className="mt-token-xs w-full rounded border border-border bg-background px-token-sm py-token-xs"
            value={currencyCode}
            onChange={(e) => setCurrencyCode(e.target.value)}
          />
        </label>
        <label className="block text-token-sm">
          {t('internalId')}
          <input
            className="mt-token-xs w-full rounded border border-border bg-background px-token-sm py-token-xs"
            value={internalId}
            onChange={(e) => setInternalId(e.target.value)}
          />
        </label>
        <label className="block text-token-sm">
          {t('receiverName')}
          <input
            className="mt-token-xs w-full rounded border border-border bg-background px-token-sm py-token-xs"
            value={receiverName}
            onChange={(e) => setReceiverName(e.target.value)}
          />
        </label>
        {(kind.includes('CREDIT') || kind.includes('DEBIT')) && (
          <label className="block text-token-sm">
            {t('references')}
            <input
              className="mt-token-xs w-full rounded border border-border bg-background px-token-sm py-token-xs"
              value={referenceInternalId}
              onChange={(e) => setReferenceInternalId(e.target.value)}
            />
          </label>
        )}

        <div>
          <div className="mb-token-sm flex items-center justify-between">
            <h2 className="font-medium">{t('lines')}</h2>
            <button
              type="button"
              className="text-token-sm text-brand"
              onClick={() => setLines((prev) => [...prev, emptyLine()])}
            >
              {t('addLine')}
            </button>
          </div>
          {lines.map((line, idx) => (
            <div key={idx} className="mb-token-md space-y-token-xs border border-border p-token-sm">
              <input
                className="w-full rounded border border-border bg-background px-token-sm py-token-xs"
                placeholder={t('description')}
                value={line.description}
                onChange={(e) => {
                  const next = [...lines];
                  next[idx] = { ...line, description: e.target.value };
                  setLines(next);
                }}
              />
              <div className="grid grid-cols-2 gap-token-xs">
                <input
                  className="rounded border border-border bg-background px-token-sm py-token-xs"
                  placeholder={t('itemCode')}
                  value={line.itemCode}
                  onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...line, itemCode: e.target.value };
                    setLines(next);
                  }}
                />
                <input
                  className="rounded border border-border bg-background px-token-sm py-token-xs"
                  placeholder={t('quantity')}
                  value={line.quantity}
                  onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...line, quantity: e.target.value };
                    setLines(next);
                  }}
                />
                <input
                  className="rounded border border-border bg-background px-token-sm py-token-xs"
                  placeholder={t('unitPrice')}
                  value={line.unitPrice}
                  onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...line, unitPrice: e.target.value };
                    setLines(next);
                  }}
                />
                <input
                  className="rounded border border-border bg-background px-token-sm py-token-xs"
                  placeholder={t('discount')}
                  value={line.discountAmount ?? '0.00'}
                  onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...line, discountAmount: e.target.value };
                    setLines(next);
                  }}
                />
              </div>
            </div>
          ))}
        </div>

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
                    setIssues(res.issues.map((i: { code: string; message: string }) => `${i.code}: ${i.message}`));
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
                    setIssues([t('sendForSignature')]);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : t('forbidden'));
                  }
                }}
              >
                {t('sendForSignature')}
              </button>
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
