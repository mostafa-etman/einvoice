/**
 * Excel/CSV display headers. Values are the canonical web UI strings
 * (documents / reports / exports). JSON export keeps internal field names.
 *
 * When locale is omitted, headers stay the legacy field names so existing
 * API consumers keep working.
 */

export const EXPORT_DOC_FIELDS = [
  'id',
  'internalId',
  'side',
  'kind',
  'status',
  'issueDateTime',
  'currencyCode',
  'totalAmount',
  'netAmount',
  'receiverName',
  'etaUuid',
] as const;

export type ExportDocField = (typeof EXPORT_DOC_FIELDS)[number];
export type ExportLocale = 'en' | 'ar';

/** Message paths asserted against apps/web/src/messages/{en,ar}.json */
export const EXPORT_COLUMN_MESSAGE_PATHS: Record<ExportDocField, string> = {
  id: 'exports.colRecordId',
  internalId: 'documents.colInvoice',
  side: 'reports.fields.side',
  kind: 'reports.detail.docType',
  status: 'documents.colStatus',
  issueDateTime: 'documents.colIssueDate',
  currencyCode: 'documents.colCurrency',
  totalAmount: 'documents.colAmount',
  netAmount: 'documents.netAmount',
  receiverName: 'documents.colReceiver',
  etaUuid: 'documents.colEtaId',
};

const EN: Record<ExportDocField, string> = {
  id: 'Record ID',
  internalId: 'Invoice #',
  side: 'Side',
  kind: 'Document type',
  status: 'Status',
  issueDateTime: 'Issue date',
  currencyCode: 'Currency',
  totalAmount: 'Amount',
  netAmount: 'Net amount',
  receiverName: 'Receiver',
  etaUuid: 'ETA UUID / long ID',
};

const AR: Record<ExportDocField, string> = {
  id: 'معرّف السجل',
  internalId: 'رقم الفاتورة',
  side: 'الجانب',
  kind: 'نوع المستند',
  status: 'الحالة',
  issueDateTime: 'تاريخ الإصدار',
  currencyCode: 'العملة',
  totalAmount: 'المبلغ',
  netAmount: 'الصافي',
  receiverName: 'المستلم',
  etaUuid: 'معرّف المصلحة / المعرّف الطويل',
};

export function normalizeExportLocale(
  raw?: string | null,
): ExportLocale | undefined {
  if (!raw?.trim()) return undefined;
  return raw.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export function exportColumnLabel(
  field: ExportDocField,
  locale: ExportLocale,
): string {
  return (locale === 'ar' ? AR : EN)[field];
}

export function exportColumnHeaders(locale?: ExportLocale): string[] {
  if (!locale) return [...EXPORT_DOC_FIELDS];
  return EXPORT_DOC_FIELDS.map((field) => exportColumnLabel(field, locale));
}
