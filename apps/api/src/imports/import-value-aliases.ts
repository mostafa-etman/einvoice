const RECEIVER_TYPE_ALIASES: Record<string, string> = {
  b: 'B',
  business: 'B',
  company: 'B',
  شركه: 'B',
  شركة: 'B',
  p: 'P',
  person: 'P',
  personal: 'P',
  شخصي: 'P',
  f: 'F',
  foreign: 'F',
  اجنبي: 'F',
  أجنبي: 'F',
};

const DOCUMENT_TYPE_ALIASES: Record<string, string> = {
  i: 'I',
  invoice: 'I',
  فاتوره: 'I',
  فاتورة: 'I',
  c: 'C',
  credit: 'C',
  'credit note': 'C',
  مرتجع: 'C',
  'اشعار دائن': 'C',
  'إشعار دائن': 'C',
  d: 'D',
  debit: 'D',
  'debit note': 'D',
  'اشعار مدين': 'D',
  'إشعار مدين': 'D',
  ei: 'EI',
  'export invoice': 'EI',
  'فاتورة تصدير': 'EI',
  'فاتوره تصدير': 'EI',
  ec: 'EC',
  'export credit': 'EC',
  'مرتجع تصدير': 'EC',
  ed: 'ED',
  'export debit': 'ED',
};

function foldValue(raw: string): string {
  return raw
    .trim()
    .replace(/[ً-ْٰ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function firstToken(raw: string): string {
  return raw.trim().split(/[\s—–-]+/)[0] ?? '';
}

export function normalizeReceiverType(raw: string): string {
  const folded = foldValue(raw);
  return RECEIVER_TYPE_ALIASES[folded] ?? raw.trim().toUpperCase();
}

export function normalizeDocumentType(raw: string): string {
  const folded = foldValue(raw);
  if (DOCUMENT_TYPE_ALIASES[folded]) return DOCUMENT_TYPE_ALIASES[folded]!;
  const token = firstToken(raw).toUpperCase();
  if (['I', 'C', 'D', 'EI', 'EC', 'ED'].includes(token)) return token;
  return token || raw.trim().toUpperCase();
}

export function normalizeTaxTypeValue(raw: string): string {
  const m = raw.trim().match(/\bT\s*([0-9]{1,2})\b/i);
  if (m) return `T${Number(m[1])}`;
  return raw.trim();
}

export function normalizeCountryValue(raw: string): string {
  const token = firstToken(raw);
  if (/^[A-Za-z]{2}$/.test(token)) return token.toUpperCase();
  return raw.trim();
}

export function normalizeItemType(raw: string): string {
  const u = raw.trim().toUpperCase();
  if (u.includes('GS1')) return 'GS1';
  if (u.includes('EGS')) return 'EGS';
  return raw.trim() || 'EGS';
}

export function normalizeUnitType(raw: string): string {
  const token = firstToken(raw);
  return token || raw.trim();
}

export function normalizeMappedImportValues(
  mapped: Record<string, string>,
): Record<string, string> {
  const out = { ...mapped };
  if (out.receiverType) out.receiverType = normalizeReceiverType(out.receiverType);
  if (out.documentType) out.documentType = normalizeDocumentType(out.documentType);
  if (out.itemType) out.itemType = normalizeItemType(out.itemType);
  if (out.unitType) out.unitType = normalizeUnitType(out.unitType);
  if (out.receiverCountry) {
    out.receiverCountry = normalizeCountryValue(out.receiverCountry);
  }
  if (out.deliveryCountryOfOrigin) {
    out.deliveryCountryOfOrigin = normalizeCountryValue(
      out.deliveryCountryOfOrigin,
    );
  }
  if (out.currencyCode) {
    out.currencyCode = firstToken(out.currencyCode).toUpperCase() || out.currencyCode;
  }
  for (const key of Object.keys(out)) {
    if (key.startsWith('taxType')) out[key] = normalizeTaxTypeValue(out[key]!);
    if (key.startsWith('taxSubType')) {
      out[key] = firstToken(out[key]!) || out[key]!;
    }
  }
  return out;
}
