import * as XLSX from 'xlsx';

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
};

export function exportDocsToCsv(rows: ExportDocRow[]): Buffer {
  const headers = [
    'id',
    'internalId',
    'kind',
    'status',
    'issueDateTime',
    'currencyCode',
    'totalAmount',
    'netAmount',
    'receiverName',
    'etaUuid',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        csv(r.internalId),
        r.kind,
        r.status,
        r.issueDateTime,
        r.currencyCode,
        r.totalAmount,
        r.netAmount,
        csv(r.receiverName ?? ''),
        csv(r.etaUuid ?? ''),
      ].join(','),
    );
  }
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}

export function exportDocsToXlsx(rows: ExportDocRow[]): Buffer {
  const sheetRows = rows.map((r) => ({
    id: r.id,
    internalId: r.internalId,
    kind: r.kind,
    status: r.status,
    issueDateTime: r.issueDateTime,
    currencyCode: r.currencyCode,
    totalAmount: r.totalAmount,
    netAmount: r.netAmount,
    receiverName: r.receiverName,
    etaUuid: r.etaUuid,
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(wb, ws, 'Documents');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

export function exportDocsToJson(rows: ExportDocRow[]): Buffer {
  return Buffer.from(JSON.stringify({ documents: rows }, null, 2), 'utf8');
}

/** Minimal multi-doc “PDF” package: labeled text inventory as application/pdf-ish placeholder zip of text. */
export function exportDocsToPdfInventory(rows: ExportDocRow[]): {
  buffer: Buffer;
  contentType: string;
  fileName: string;
  inventory: { included: string[]; skipped: string[] };
} {
  const included = rows.map((r) => r.internalId);
  // Lightweight PDF: one page of plain text encoded as minimal PDF
  const text = [
    'eInvoice local export inventory',
    `Documents: ${rows.length}`,
    ...rows.map(
      (r) =>
        `- ${r.internalId} | ${r.kind} | ${r.status} | ${r.totalAmount} ${r.currencyCode}`,
    ),
  ].join('\n');
  const pdf = minimalPdf(text);
  return {
    buffer: pdf,
    contentType: 'application/pdf',
    fileName: 'documents-export.pdf',
    inventory: { included, skipped: [] },
  };
}

function csv(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function minimalPdf(text: string): Buffer {
  const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = `BT /F1 10 Tf 50 750 Td (${escaped.slice(0, 2000)}) Tj ET`;
  const objects = [
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n',
    '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n',
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n',
    `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}
