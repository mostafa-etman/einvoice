import { Readable } from 'node:stream';
import * as Papa from 'papaparse';
import * as XLSX from 'xlsx';

export type ImportRow = {
  rowNumber: number;
  cells: Record<string, string>;
};

export type ParseProgress = {
  rowsEmitted: number;
};

export type StreamParseOptions = {
  onRow: (row: ImportRow) => void | Promise<void>;
  onProgress?: (p: ParseProgress) => void;
  /** Reject if more than this many data rows */
  maxRows?: number;
};

const XLS_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]); // OLE compound (legacy .xls)

export function isLegacyXls(buf: Buffer): boolean {
  return buf.length >= 4 && buf.subarray(0, 4).equals(XLS_MAGIC);
}

export function detectImportFormat(
  filename: string,
  contentType?: string,
): 'csv' | 'xlsx' | 'unsupported' {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xls') && !lower.endsWith('.xlsx')) return 'unsupported';
  if (lower.endsWith('.csv') || contentType?.includes('csv')) return 'csv';
  if (
    lower.endsWith('.xlsx') ||
    contentType?.includes(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
  ) {
    return 'xlsx';
  }
  return 'unsupported';
}

/**
 * Stream-parse CSV via papaparse step mode — never loads all rows then parses.
 */
export async function parseCsvStream(
  input: Readable | string,
  options: StreamParseOptions,
): Promise<{ totalRows: number }> {
  const maxRows = options.maxRows ?? 5000;
  let rowNumber = 0;
  let headers: string[] | null = null;

  await new Promise<void>((resolve, reject) => {
    Papa.parse(input as never, {
      header: false,
      skipEmptyLines: true,
      step: (results: Papa.ParseStepResult<string[]>, parser: Papa.Parser) => {
        const data = results.data;
        if (!data || data.length === 0) return;
        if (!headers) {
          headers = data.map((h) => String(h ?? '').trim());
          return;
        }
        // Stop at Notes section / comment rows from template CSV re-uploads.
        const firstCell = String(data[0] ?? '').trim();
        if (
          firstCell.startsWith('#') ||
          firstCell.toLowerCase() === 'column'
        ) {
          parser.abort();
          return;
        }
        rowNumber += 1;
        if (rowNumber > maxRows) {
          parser.abort();
          reject(new Error(`IMPORT_MAX_ROWS exceeded (${maxRows})`));
          return;
        }
        const cells: Record<string, string> = {};
        for (let i = 0; i < headers.length; i++) {
          const key = headers[i]!;
          if (!key) continue;
          cells[key] = String(data[i] ?? '').trim();
        }
        const maybe = options.onRow({ rowNumber, cells });
        if (maybe && typeof (maybe as Promise<void>).then === 'function') {
          // papaparse step is sync; queue microtask work via void
          void (maybe as Promise<void>).catch(reject);
        }
        options.onProgress?.({ rowsEmitted: rowNumber });
      },
      complete: () => resolve(),
      error: (err: Error) => reject(err),
    });
  });

  return { totalRows: rowNumber };
}

/**
 * Parse XLSX. Reads workbook once; emits rows via callback without retaining
 * a giant string[][] of the whole sheet in app state after emission.
 * Rejects legacy .xls buffers.
 */
export async function parseXlsxBuffer(
  buf: Buffer,
  options: StreamParseOptions,
): Promise<{ totalRows: number }> {
  if (isLegacyXls(buf)) {
    throw new Error('Legacy .xls is not supported; use CSV or XLSX');
  }
  const maxRows = options.maxRows ?? 5000;
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, dense: false });
  const sheetName =
    wb.SheetNames.find((n) => n.toLowerCase() === 'import') ?? wb.SheetNames[0];
  if (!sheetName) return { totalRows: 0 };
  const sheet = wb.Sheets[sheetName]!;
  const ref = sheet['!ref'];
  if (!ref) return { totalRows: 0 };

  const range = XLSX.utils.decode_range(ref);
  const headers: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
    const cell = sheet[addr];
    headers.push(cell ? String(cell.v ?? '').trim() : '');
  }

  let rowNumber = 0;
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const cells: Record<string, string> = {};
    let empty = true;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const header = headers[c - range.s.c]!;
      if (!header) continue;
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      const val = cell == null ? '' : String(cell.v ?? '').trim();
      if (val) empty = false;
      cells[header] = val;
    }
    if (empty) continue;
    rowNumber += 1;
    if (rowNumber > maxRows) {
      throw new Error(`IMPORT_MAX_ROWS exceeded (${maxRows})`);
    }
    await options.onRow({ rowNumber, cells });
    options.onProgress?.({ rowsEmitted: rowNumber });
  }

  return { totalRows: rowNumber };
}

export class ImportParseService {
  detectFormat = detectImportFormat;
  isLegacyXls = isLegacyXls;

  parseCsv(input: Readable | string, options: StreamParseOptions) {
    return parseCsvStream(input, options);
  }

  parseXlsx(buf: Buffer, options: StreamParseOptions) {
    return parseXlsxBuffer(buf, options);
  }
}
