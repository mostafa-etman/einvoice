import * as XLSX from 'xlsx';
import {
  EXPORT_DOC_FIELDS,
  exportColumnHeaders,
  type ExportLocale,
} from '../export-column-labels';

export type ExportDocRow = {
  id: string;
  internalId: string;
  kind: string;
  status: string;
  issueDateTime: string;
  currencyCode: string;
  totalAmount: string;
  netAmount: string;
  receiverName: string | null;
  etaUuid: string | null;
  /** sales = issued documents; purchases = received documents */
  side?: 'sales' | 'purchases';
};

function rowValues(r: ExportDocRow): Array<string | number | null> {
  return [
    r.id,
    r.internalId,
    r.side ?? '',
    r.kind,
    r.status,
    r.issueDateTime,
    r.currencyCode,
    r.totalAmount,
    r.netAmount,
    r.receiverName,
    r.etaUuid,
  ];
}

export function exportDocsToCsv(
  rows: ExportDocRow[],
  locale?: ExportLocale,
): Buffer {
  const headers = exportColumnHeaders(locale);
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(rowValues(r).map((v) => csv(String(v ?? ''))).join(','));
  }
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}

export function exportDocsToXlsx(
  rows: ExportDocRow[],
  locale?: ExportLocale,
): Buffer {
  const headers = exportColumnHeaders(locale);
  const aoa: Array<Array<string | number | null>> = [
    headers,
    ...rows.map((r) => rowValues(r).map((v) => (v == null ? '' : v))),
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, 'Documents');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

export function exportDocsToJson(rows: ExportDocRow[]): Buffer {
  return Buffer.from(JSON.stringify({ documents: rows }, null, 2), 'utf8');
}

function csv(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export { EXPORT_DOC_FIELDS };
