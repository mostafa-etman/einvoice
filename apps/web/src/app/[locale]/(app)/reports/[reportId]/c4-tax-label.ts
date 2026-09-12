/**
 * C4 display helper: prefer catalog names already attached by the API.
 * Never invent labels; unknown/null codes fall back to the stored code or em dash.
 */
export function localizedTaxTypeLabel(
  locale: string,
  taxType: unknown,
  nameEn: unknown,
  nameAr: unknown,
): string {
  const code = String(taxType ?? '').trim();
  const en = String(nameEn ?? '').trim();
  const ar = String(nameAr ?? '').trim();
  if (locale === 'ar') return ar || en || code || '—';
  return en || ar || code || '—';
}

export function taxTypeLabelFromRows(
  locale: string,
  code: string,
  rows: Array<Record<string, unknown>>,
): string {
  const row = rows.find((r) => String(r.taxType ?? '') === code);
  return localizedTaxTypeLabel(
    locale,
    code,
    row?.taxTypeNameEn,
    row?.taxTypeNameAr,
  );
}
