import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TEMPLATE_SHEET_INVOICES = 'Invoices';
export const TEMPLATE_SHEET_LISTS = 'Lists';
export const TEMPLATE_DATA_ROWS = 2000;

export const NAMED = {
  receiverType: 'List_ReceiverType',
  itemType: 'List_ItemType',
  unitType: 'List_UnitType',
  currency: 'List_Currency',
  country: 'List_Country',
  documentType: 'List_DocumentType',
  taxType: 'List_TaxType',
  taxMap: 'List_TaxMap',
  taxSubBlank: 'TaxSub_Blank',
} as const;

const FALLBACK_TAX_TYPES: Array<{ code: string; ar: string }> = [
  { code: 'T1', ar: 'ضريبة القيمة المضافة' },
  { code: 'T2', ar: 'ضريبة الجدول (نسبية)' },
  { code: 'T3', ar: 'ضريبة الجدول (قطعية)' },
  { code: 'T4', ar: 'الخصم تحت حساب الضريبة' },
  { code: 'T5', ar: 'ضريبة الدمغة (نسبية)' },
  { code: 'T6', ar: 'ضريبة الدمغة (قطعية)' },
  { code: 'T7', ar: 'ضريبة الملاهي' },
  { code: 'T8', ar: 'رسم تنمية الموارد' },
  { code: 'T9', ar: 'رسم خدمة' },
  { code: 'T10', ar: 'رسم المحليات' },
  { code: 'T11', ar: 'رسم التأمين الصحي' },
  { code: 'T12', ar: 'رسوم أخرى' },
  { code: 'T13', ar: 'ضريبة الدمغة (نسبية) غير خاضعة' },
  { code: 'T14', ar: 'ضريبة الدمغة (قطعية) غير خاضعة' },
  { code: 'T15', ar: 'ضريبة الملاهي غير خاضعة' },
  { code: 'T16', ar: 'رسم تنمية الموارد غير خاضع' },
  { code: 'T17', ar: 'رسم خدمة غير خاضع' },
  { code: 'T18', ar: 'رسم المحليات غير خاضع' },
  { code: 'T19', ar: 'رسم التأمين الصحي غير خاضع' },
  { code: 'T20', ar: 'رسوم أخرى غير خاضعة' },
];

const UNITS: Array<{ code: string; ar: string }> = [
  { code: 'EA', ar: 'قطعة' },
  { code: 'KG', ar: 'كيلوجرام' },
  { code: 'GRM', ar: 'جرام' },
  { code: 'TNE', ar: 'طن' },
  { code: 'LTR', ar: 'لتر' },
  { code: 'MTR', ar: 'متر' },
  { code: 'MTK', ar: 'متر مربع' },
  { code: 'MTQ', ar: 'متر مكعب' },
  { code: 'CMT', ar: 'سنتيمتر' },
  { code: 'MMT', ar: 'مليمتر' },
  { code: 'KMT', ar: 'كيلومتر' },
  { code: 'HUR', ar: 'ساعة' },
  { code: 'DAY', ar: 'يوم' },
  { code: 'MON', ar: 'شهر' },
  { code: 'SET', ar: 'طقم' },
  { code: 'PK', ar: 'عبوة' },
  { code: 'BOX', ar: 'صندوق' },
  { code: 'PR', ar: 'زوج' },
  { code: 'NMB', ar: 'عدد' },
];

const CURRENCIES = [
  'EGP',
  'USD',
  'EUR',
  'SAR',
  'AED',
  'GBP',
  'KWD',
  'QAR',
  'OMR',
  'JOD',
];

const FALLBACK_COUNTRIES: Array<{ code: string; ar: string }> = [
  { code: 'EG', ar: 'مصر' },
  { code: 'SA', ar: 'السعودية' },
  { code: 'AE', ar: 'الإمارات' },
  { code: 'KW', ar: 'الكويت' },
  { code: 'QA', ar: 'قطر' },
  { code: 'BH', ar: 'البحرين' },
  { code: 'OM', ar: 'عُمان' },
  { code: 'JO', ar: 'الأردن' },
  { code: 'SD', ar: 'السودان' },
  { code: 'LY', ar: 'ليبيا' },
  { code: 'US', ar: 'الولايات المتحدة' },
  { code: 'GB', ar: 'المملكة المتحدة' },
  { code: 'DE', ar: 'ألمانيا' },
  { code: 'CN', ar: 'الصين' },
  { code: 'IN', ar: 'الهند' },
];

export type CodeLabel = { code: string; ar: string };

export type TemplateListCatalog = {
  receiverTypes: string[];
  itemTypes: string[];
  units: string[];
  currencies: string[];
  countries: string[];
  documentTypes: string[];
  taxTypes: string[];
  taxTypeCodes: string[];
  taxSubtypesByType: Record<string, string[]>;
};

export type NamedRangeSpec = {
  name: string;
  a1: string;
};

export type ListsSheetLayout = {
  rows: string[][];
  namedRanges: NamedRangeSpec[];
  catalog: TemplateListCatalog;
};

function etaCodesDir(): string {
  const candidates = [
    join(__dirname, '..', '..', 'data', 'eta-codes'),
    join(process.cwd(), 'data', 'eta-codes'),
    join(process.cwd(), 'apps', 'api', 'data', 'eta-codes'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'CountryCodes.json'))) return dir;
  }
  return candidates[0]!;
}

function readJsonArray<T>(file: string): T[] {
  try {
    const rows = JSON.parse(readFileSync(join(etaCodesDir(), file), 'utf8')) as T[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export function formatCodeLabel(code: string, ar?: string): string {
  const label = (ar ?? '').trim();
  return label ? `${code} — ${label}` : code;
}

export function listToken(raw: string): string {
  return raw.trim().split(/[\s—–-]+/)[0] ?? '';
}

export function pickListValue(values: string[], code: string): string {
  const u = code.trim().toUpperCase();
  if (!u) return '';
  return values.find((v) => listToken(v).toUpperCase() === u) ?? code;
}

function loadCountries(): CodeLabel[] {
  const rows = readJsonArray<{
    code?: string;
    Code?: string;
    Desc_ar?: string;
    Desc_en?: string;
  }>('CountryCodes.json');
  if (!rows.length) return FALLBACK_COUNTRIES;
  return rows
    .map((r) => ({
      code: String(r.code ?? r.Code ?? '').trim().toUpperCase(),
      ar: String(r.Desc_ar || r.Desc_en || r.code || '').trim(),
    }))
    .filter((r) => r.code.length === 2);
}

function loadTaxTypes(): CodeLabel[] {
  const main = readJsonArray<{ Code?: string; code?: string; Desc_ar?: string }>(
    'TaxTypes.json',
  );
  const extra = readJsonArray<{
    Code?: string;
    code?: string;
    Desc_ar?: string;
  }>('NonTaxableTaxTypes.json');
  const byCode = new Map<string, CodeLabel>();
  for (const row of [...main, ...extra]) {
    const code = String(row.Code ?? row.code ?? '').trim().toUpperCase();
    if (!/^T\d{1,2}$/.test(code)) continue;
    byCode.set(code, { code, ar: String(row.Desc_ar ?? '').trim() });
  }
  if (byCode.size === 0) return FALLBACK_TAX_TYPES;
  for (const fb of FALLBACK_TAX_TYPES) {
    if (!byCode.has(fb.code)) byCode.set(fb.code, fb);
  }
  return [...byCode.values()].sort(
    (a, b) => Number(a.code.slice(1)) - Number(b.code.slice(1)),
  );
}

function loadTaxSubtypes(): Array<{ code: string; ar: string; parent: string }> {
  const rows = readJsonArray<{
    Code?: string;
    code?: string;
    Desc_ar?: string;
    TaxtypeReference?: string;
  }>('TaxSubtypes.json');
  return rows
    .map((r) => ({
      code: String(r.Code ?? r.code ?? '').trim(),
      ar: String(r.Desc_ar ?? '').trim(),
      parent: String(r.TaxtypeReference ?? '').trim().toUpperCase(),
    }))
    .filter((r) => r.code && r.parent);
}

function taxSubNamedRange(code: string): string {
  return `TaxSub_${code}`;
}

export function loadTemplateLists(): TemplateListCatalog {
  const taxTypes = loadTaxTypes();
  const subtypes = loadTaxSubtypes();
  const taxSubtypesByType: Record<string, string[]> = {};
  for (const t of taxTypes) taxSubtypesByType[t.code] = [];
  for (const s of subtypes) {
    const list = taxSubtypesByType[s.parent] ?? (taxSubtypesByType[s.parent] = []);
    list.push(formatCodeLabel(s.code, s.ar));
  }
  for (const t of taxTypes) {
    if ((taxSubtypesByType[t.code] ?? []).length === 0) {
      taxSubtypesByType[t.code] = [t.code];
    }
  }
  return {
    receiverTypes: ['شركة', 'شخصي', 'أجنبي'],
    itemTypes: ['EGS', 'GS1'],
    units: UNITS.map((u) => formatCodeLabel(u.code, u.ar)),
    currencies: [...CURRENCIES],
    countries: loadCountries().map((c) => formatCodeLabel(c.code, c.ar)),
    documentTypes: [
      'I — فاتورة',
      'C — إشعار دائن / مرتجع',
      'D — إشعار مدين',
      'EI — فاتورة تصدير',
      'EC — مرتجع تصدير',
      'ED — إشعار مدين تصدير',
    ],
    taxTypes: taxTypes.map((t) => formatCodeLabel(t.code, t.ar)),
    taxTypeCodes: taxTypes.map((t) => t.code),
    taxSubtypesByType,
  };
}

function excelCol(index0: number): string {
  let n = index0 + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function colRange(sheet: string, col0: number, startRow: number, count: number): string {
  const c = excelCol(col0);
  const end = startRow + Math.max(count, 1) - 1;
  return `'${sheet}'!$${c}$${startRow}:$${c}$${end}`;
}

/**
 * Hidden Lists sheet: lookup columns + per-tax-type subtype columns for INDIRECT.
 */
export function buildListsSheetLayout(): ListsSheetLayout {
  const catalog = loadTemplateLists();
  const columns: string[][] = [
    catalog.receiverTypes,
    catalog.itemTypes,
    catalog.units,
    catalog.currencies,
    catalog.countries,
    catalog.documentTypes,
    catalog.taxTypes,
    catalog.taxTypeCodes.map((code) => taxSubNamedRange(code)),
  ];
  const headers = [
    'نوع المستلم',
    'نوع كود الصنف',
    'وحدة القياس',
    'العملة',
    'الدولة',
    'نوع المستند',
    'نوع الضريبة',
    'نطاق النوع الفرعي',
  ];

  const namedRanges: NamedRangeSpec[] = [
    { name: NAMED.receiverType, a1: colRange(TEMPLATE_SHEET_LISTS, 0, 2, catalog.receiverTypes.length) },
    { name: NAMED.itemType, a1: colRange(TEMPLATE_SHEET_LISTS, 1, 2, catalog.itemTypes.length) },
    { name: NAMED.unitType, a1: colRange(TEMPLATE_SHEET_LISTS, 2, 2, catalog.units.length) },
    { name: NAMED.currency, a1: colRange(TEMPLATE_SHEET_LISTS, 3, 2, catalog.currencies.length) },
    { name: NAMED.country, a1: colRange(TEMPLATE_SHEET_LISTS, 4, 2, catalog.countries.length) },
    { name: NAMED.documentType, a1: colRange(TEMPLATE_SHEET_LISTS, 5, 2, catalog.documentTypes.length) },
    { name: NAMED.taxType, a1: colRange(TEMPLATE_SHEET_LISTS, 6, 2, catalog.taxTypes.length) },
    {
      name: NAMED.taxMap,
      a1: `'${TEMPLATE_SHEET_LISTS}'!$G$2:$H$${catalog.taxTypes.length + 1}`,
    },
  ];

  for (let i = 0; i < catalog.taxTypeCodes.length; i++) {
    const code = catalog.taxTypeCodes[i]!;
    const values = catalog.taxSubtypesByType[code] ?? [code];
    headers.push(code);
    columns.push(values);
    namedRanges.push({
      name: taxSubNamedRange(code),
      a1: colRange(TEMPLATE_SHEET_LISTS, 8 + i, 2, values.length),
    });
  }

  const blankCol = columns.length;
  headers.push('فارغ');
  columns.push(['']);
  namedRanges.push({
    name: NAMED.taxSubBlank,
    a1: `'${TEMPLATE_SHEET_LISTS}'!$${excelCol(blankCol)}$2`,
  });

  const height = Math.max(...columns.map((c) => c.length), 1);
  const rows: string[][] = [headers];
  for (let r = 0; r < height; r++) {
    rows.push(columns.map((col) => col[r] ?? ''));
  }
  return { rows, namedRanges, catalog };
}

export function applyTemplateListLabels(
  mapped: Record<string, string>,
  catalog: TemplateListCatalog = loadTemplateLists(),
): Record<string, string> {
  const out = { ...mapped };
  if (out.receiverType) {
    const folded = out.receiverType.trim();
    if (folded === 'B' || /^business$/i.test(folded)) out.receiverType = 'شركة';
    else if (folded === 'P' || /^p/i.test(folded)) out.receiverType = 'شخصي';
    else if (folded === 'F' || /^f/i.test(folded)) out.receiverType = 'أجنبي';
  }
  if (out.documentType) {
    out.documentType = pickListValue(catalog.documentTypes, out.documentType);
  }
  if (out.itemType) out.itemType = pickListValue(catalog.itemTypes, out.itemType);
  if (out.unitType) out.unitType = pickListValue(catalog.units, out.unitType);
  if (out.currencyCode) {
    out.currencyCode = pickListValue(catalog.currencies, out.currencyCode);
  }
  if (out.receiverCountry) {
    out.receiverCountry = pickListValue(catalog.countries, out.receiverCountry);
  }
  for (const key of Object.keys(out)) {
    const n = key.startsWith('taxType') ? key.slice('taxType'.length) : '';
    if (!/^\d+$/.test(n)) continue;
    const typeCode = listToken(out[key] ?? '');
    if (typeCode) out[key] = pickListValue(catalog.taxTypes, typeCode);
    const subKey = `taxSubType${n}`;
    const subCode = listToken(out[subKey] ?? '');
    const parent = listToken(out[key] ?? '');
    const subList = catalog.taxSubtypesByType[parent] ?? [];
    if (subCode && subList.length) out[subKey] = pickListValue(subList, subCode);
  }
  return out;
}
