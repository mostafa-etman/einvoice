'use client';

import {
  defaultTaxableTax,
  ETA_EXEMPT_SUBTYPES,
  ETA_ZERO_RATED_SUBTYPES,
  findDuplicateTaxTypes,
  firstSubtypeForTaxType,
  inferLineTaxMode,
  isFixedAmountTaxType,
  isSubtypeOfTaxType,
  nextUnusedTaxType,
  taxesForMode,
  type LineTaxMode,
} from '@einvoice/eta-core';
import type { useTranslations } from 'next-intl';
import type { EtaCodeEntry } from '@/lib/api/eta-codes';
import type { DocumentUpsert } from '@/lib/api/documents';

type Line = DocumentUpsert['lines'][number];
type UiTaxMode = 'taxable' | 'zero_or_exempt' | 'none';
type TDocuments = ReturnType<typeof useTranslations<'documents'>>;

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

export type LineTaxesEditorProps = {
  line: Line;
  lineIndex: number;
  taxTypes: EtaCodeEntry[];
  taxSubtypes: EtaCodeEntry[];
  taxTypeOptions: EtaCodeEntry[];
  zeroRatedSubtypeOptions: EtaCodeEntry[];
  exemptSubtypeOptions: EtaCodeEntry[];
  subtypeOptionsFor: (taxType: string) => EtaCodeEntry[];
  updateLine: (idx: number, patch: Partial<Line>) => void;
  setLineTaxMode: (idx: number, mode: UiTaxMode) => void;
  setLineZeroExemptKind: (idx: number, kind: 'zero_rated' | 'exempt') => void;
  t: TDocuments;
};

/** Per-line tax editor (used inside the taxes modal). Logic-identical to the prior inline block. */
export function LineTaxesEditor(props: LineTaxesEditorProps) {
  const {
    line,
    lineIndex: idx,
    taxSubtypes,
    taxTypeOptions,
    zeroRatedSubtypeOptions,
    exemptSubtypeOptions,
    subtypeOptionsFor,
    updateLine,
    setLineTaxMode,
    setLineZeroExemptKind,
    t,
  } = props;

  return (
    <div className="space-y-token-sm">
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
              <p className="text-token-xs text-foreground/70">{t('taxModeHelpTaxable')}</p>
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
                          const nextFixed = isFixedAmountTaxType(nextType);
                          taxes[tIdx] = {
                            taxType: nextType,
                            subType: isSubtypeOfTaxType(taxSubtypes, nextType, tx.subType)
                              ? tx.subType
                              : firstSubtypeForTaxType(taxSubtypes, nextType),
                            rate: nextFixed ? '0' : tx.rate || '0',
                            ...(nextFixed ? { amount: tx.amount ?? '0.00' } : {}),
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
                    {isFixedAmountTaxType(tx.taxType) ? (
                      <label className="block text-token-xs">
                        {t('taxAmount')}
                        <input
                          className={fieldClass()}
                          value={tx.amount ?? '0.00'}
                          onChange={(e) => {
                            const taxes = [...(line.taxes ?? [])];
                            taxes[tIdx] = {
                              ...tx,
                              rate: '0',
                              amount: e.target.value,
                            };
                            updateLine(idx, { taxes });
                          }}
                        />
                        <span className="block text-token-xs text-foreground/60">
                          {t('taxAmountFixedHelp')}
                        </span>
                      </label>
                    ) : (
                      <label className="block text-token-xs">
                        {t('taxRate')}
                        <input
                          className={fieldClass()}
                          value={tx.rate}
                          onChange={(e) => {
                            const taxes = [...(line.taxes ?? [])];
                            const next = { ...tx, rate: e.target.value };
                            delete next.amount;
                            taxes[tIdx] = next;
                            updateLine(idx, { taxes });
                          }}
                        />
                      </label>
                    )}
                    <div className="flex items-end">
                      <button
                        type="button"
                        className="text-token-xs text-brand"
                        onClick={() => {
                          const taxes = (line.taxes ?? []).filter((_, i) => i !== tIdx);
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
                    (line.taxes ?? []).map((tax) => tax.taxType),
                  );
                  if (!nextType) return;
                  const fixed = isFixedAmountTaxType(nextType);
                  updateLine(idx, {
                    taxes: [
                      ...(line.taxes ?? []),
                      {
                        taxType: nextType,
                        subType: firstSubtypeForTaxType(taxSubtypes, nextType),
                        rate: fixed ? '0' : '0',
                        ...(fixed ? { amount: '0.00' } : {}),
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
              <p className="text-token-xs text-foreground/70">{t('taxModeHelpZeroOrExempt')}</p>
              <p className="text-token-xs text-foreground/70">{t('taxKindVsNone')}</p>
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
                {isExempt ? t('taxKindExemptHelp') : t('taxKindZeroRatedHelp')}
              </p>
              <label className="block text-token-xs">
                {t('taxSubtype')}
                <select
                  className={fieldClass()}
                  value={currentSubtype}
                  onChange={(e) => {
                    updateLine(idx, {
                      taxes: taxesForMode(isExempt ? 'exempt' : 'zero_rated', {
                        zeroRatedSubtype: e.target.value,
                        exemptSubtype: e.target.value,
                      }),
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
        return <p className="text-token-xs text-foreground/70">{t('taxModeHelpNone')}</p>;
      })()}
    </div>
  );
}

export function taxRowSummary(
  line: Line,
  t: TDocuments,
): { label: string; mode: UiTaxMode } {
  const mode = toUiTaxMode(inferLineTaxMode(line.taxes));
  if (mode === 'none') {
    return { label: t('taxModeNone'), mode };
  }
  if (mode === 'zero_or_exempt') {
    const core = inferLineTaxMode(line.taxes);
    return {
      label: core === 'exempt' ? t('taxKindExempt') : t('taxKindZeroRated'),
      mode,
    };
  }
  const count = line.taxes?.length ?? 0;
  return {
    label: t('taxBadgeCount', { count }),
    mode,
  };
}
