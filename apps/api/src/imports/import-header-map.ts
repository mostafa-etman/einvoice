import { IMPORT_ALL_FIELD_KEYS, IMPORT_COLUMNS } from './import-schema';
import { IMPORT_AR_HEADERS, arabicHeaderForField } from './import-ar-headers';

export function normalizeImportHeader(raw: string): string {
  return String(raw ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[*＊✦]/g, '')
    .replace(/[()（）]/g, ' ')
    .replace(/[ً-ْٰ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[_/|,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const HEADER_TO_KEY = new Map<string, string>();

function register(header: string, key: string) {
  const n = normalizeImportHeader(header);
  if (n && !HEADER_TO_KEY.has(n)) HEADER_TO_KEY.set(n, key);
}

for (const key of IMPORT_ALL_FIELD_KEYS) {
  register(key, key);
  const col = IMPORT_COLUMNS.find((c) => c.key === key);
  register(arabicHeaderForField(key, Boolean(col?.required)), key);
  register(IMPORT_AR_HEADERS[key] ?? key, key);
}

const EXTRA_ALIASES: Record<string, string> = {
  'الرقم الداخلي': 'internalID',
  'تاريخ الاصدار': 'dateTimeIssued',
  'تاريخ الإصدار': 'dateTimeIssued',
  'رقم تسجيل المستلم': 'receiverId',
  'اسم المستلم': 'receiverName',
  'نوع المستلم': 'receiverType',
  'دولة المستلم': 'receiverCountry',
  'محافظة المستلم': 'receiverGovernate',
  'مدينة المستلم': 'receiverRegionCity',
  'شارع المستلم': 'receiverStreet',
  'مبنى المستلم': 'receiverBuildingNumber',
  'وصف الصنف': 'description',
  'نوع كود الصنف': 'itemType',
  'كود الصنف': 'itemCode',
  'وحدة القياس': 'unitType',
  'الكميه': 'quantity',
  'الكمية': 'quantity',
  'سعر الوحده': 'unitPrice',
  'سعر الوحدة': 'unitPrice',
  'نسبة الخصم': 'discountRate',
  'قيمه الخصم': 'discountAmount',
  'قيمة الخصم': 'discountAmount',
  'internalid': 'internalID',
  'internal_id': 'internalID',
  'datetimeissued': 'dateTimeIssued',
  'issue date': 'dateTimeIssued',
};

for (const [alias, key] of Object.entries(EXTRA_ALIASES)) {
  register(alias, key);
}

export function resolveImportFieldKey(header: string): string | undefined {
  const n = normalizeImportHeader(header);
  if (!n) return undefined;
  return HEADER_TO_KEY.get(n);
}

export function proposeColumnMapping(
  headers: Iterable<string>,
): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const header of headers) {
    const trimmed = String(header ?? '').trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const key = resolveImportFieldKey(trimmed);
    if (key && !mapping[key]) mapping[key] = trimmed;
  }
  return mapping;
}
