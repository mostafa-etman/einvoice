/**
 * Normalize dates coming from Excel/CSV import cells.
 *
 * Excel date cells are stored as serial numbers (e.g. 46277 = 2026-09-12).
 * `parseXlsxBuffer` previously did String(cell.v), so the import path received
 * "46277". `new Date("46277")` is treated as year 46277 (same as new Date("2026")),
 * which Prisma then rejects as DateTime "+046277-01-01T00:00:00.000Z".
 *
 * Never pass an Excel serial to `new Date(number)` — that is milliseconds since
 * the Unix epoch, not an Excel day count.
 */

export const IMPORT_DATE_FIELDS = [
  'dateTimeIssued',
  'serviceDeliveryDate',
  'deliveryDateValidity',
] as const;

export type ImportDateField = (typeof IMPORT_DATE_FIELDS)[number];

export type NormalizeImportDateResult =
  | { status: 'empty' }
  | { status: 'ok'; date: Date; iso: string; ymd: string }
  | { status: 'invalid'; original: string };

/** Excel 1900 system: serial 25569 = 1970-01-01. 1904 system is 1462 days earlier. */
const EXCEL_SERIAL_UNIX_EPOCH = 25569;
const EXCEL_1904_OFFSET_DAYS = 1462;
const EXCEL_SERIAL_MAX = 2_958_465; // 9999-12-31 in the 1900 system

/**
 * Integers 1000–2150 are treated as 4-digit years (existing `new Date("2026")`
 * behaviour). Values above that in the Excel serial range are serial dates.
 */
const YEAR_ONLY_MAX = 2150;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function utcYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function isValidInvoiceCalendarDate(d: Date): boolean {
  if (Number.isNaN(d.getTime())) return false;
  const year = d.getUTCFullYear();
  // ETA dateTimeIssued is `\d{4}-…`; Prisma DateTime cannot encode year 46277.
  return year >= 1 && year <= 9999;
}

function ok(date: Date): NormalizeImportDateResult {
  return { status: 'ok', date, iso: date.toISOString(), ymd: utcYmd(date) };
}

export function excelSerialToUtcDate(
  serial: number,
  date1904 = false,
): Date | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > EXCEL_SERIAL_MAX) {
    return null;
  }
  const adjusted = date1904 ? serial + EXCEL_1904_OFFSET_DAYS : serial;
  const ms = Math.round((adjusted - EXCEL_SERIAL_UNIX_EPOCH) * 86400 * 1000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function looksLikeExcelSerial(n: number): boolean {
  if (!Number.isFinite(n) || n < 0 || n > EXCEL_SERIAL_MAX) return false;
  if (!Number.isInteger(n)) return n >= 1;
  return n > YEAR_ONLY_MAX;
}

const FORMATTED_DATE_RE =
  /^\d{4}-\d{1,2}-\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i;
const SLASH_DATE_RE = /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/;
const ISO_YMD_RE =
  /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?$/i;
const SLASH_YMD_RE =
  /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

function utcCalendarDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date | null {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }
  const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}

function expandTwoDigitYear(year: number): number {
  if (year >= 100) return year;
  return year >= 50 ? 1900 + year : 2000 + year;
}

/**
 * Parse ISO / `YYYY-MM-DD`. Date-only and naive datetimes are UTC so Egypt
 * local offset cannot shift the calendar day.
 */
function parseIsoDateTime(original: string): Date | null {
  const m = ISO_YMD_RE.exec(original);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (m[8]) {
    const d = new Date(original);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const hour = m[4] != null ? Number(m[4]) : 0;
  const minute = m[5] != null ? Number(m[5]) : 0;
  const second = m[6] != null ? Number(m[6]) : 0;
  const ms =
    m[7] != null ? Number(String(m[7]).padEnd(3, '0').slice(0, 3)) : 0;
  return utcCalendarDate(year, month, day, hour, minute, second, ms);
}

/**
 * Parse `01/07/2026` as DD/MM/YYYY (Egypt / ETA). `new Date("01/07/2026")` is
 * MM/DD in Node and would store 7 January instead of 1 July.
 * If DD/MM is not a real calendar date (e.g. 12/31/2026), try MM/DD.
 */
function parseDayMonthYear(original: string): Date | null {
  const m = SLASH_YMD_RE.exec(original);
  if (!m) return null;
  const first = Number(m[1]);
  const second = Number(m[2]);
  const year = expandTwoDigitYear(Number(m[3]));
  const hour = m[4] != null ? Number(m[4]) : 0;
  const minute = m[5] != null ? Number(m[5]) : 0;
  const secondOfDay = m[6] != null ? Number(m[6]) : 0;
  const dmy = utcCalendarDate(
    year,
    second,
    first,
    hour,
    minute,
    secondOfDay,
  );
  if (dmy) return dmy;
  return utcCalendarDate(year, first, second, hour, minute, secondOfDay);
}

export function looksLikeFormattedExcelDate(w: string | undefined): boolean {
  if (!w) return false;
  const s = w.trim();
  return FORMATTED_DATE_RE.test(s) || SLASH_DATE_RE.test(s);
}

function isDateNumFmt(z: unknown): boolean {
  if (typeof z !== 'string' || !z) return false;
  const lower = z.toLowerCase();
  return /yy/.test(lower) && /m/.test(lower);
}

function fromSerial(
  n: number,
  date1904: boolean,
  original: string,
): NormalizeImportDateResult {
  const d = excelSerialToUtcDate(n, date1904);
  if (!d || !isValidInvoiceCalendarDate(d)) {
    return { status: 'invalid', original };
  }
  return ok(d);
}

/**
 * Parse a mapped import cell (string / Date / Excel serial) into a UTC Date.
 */
export function normalizeImportDate(
  raw: unknown,
  opts?: { date1904?: boolean; preferSerial?: boolean },
): NormalizeImportDateResult {
  const date1904 = Boolean(opts?.date1904);
  if (raw == null) return { status: 'empty' };
  if (raw instanceof Date) {
    return isValidInvoiceCalendarDate(raw)
      ? ok(raw)
      : { status: 'invalid', original: raw.toISOString() };
  }

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { status: 'invalid', original: String(raw) };
    if (opts?.preferSerial || looksLikeExcelSerial(raw)) {
      return fromSerial(raw, date1904, String(raw));
    }
  }

  const original = String(raw).trim();
  if (!original) return { status: 'empty' };

  const asNumber = Number(original);
  const numeric =
    Number.isFinite(asNumber) && /^-?\d+(?:\.\d+)?$/.test(original);

  if (numeric && (opts?.preferSerial || looksLikeExcelSerial(asNumber))) {
    return fromSerial(asNumber, date1904, original);
  }

  const iso = parseIsoDateTime(original);
  if (iso && isValidInvoiceCalendarDate(iso)) return ok(iso);

  const dmy = parseDayMonthYear(original);
  if (dmy && isValidInvoiceCalendarDate(dmy)) return ok(dmy);

  // Last resort for uncommon Date.parse forms — never keep year 46277.
  const parsed = new Date(original);
  if (!Number.isNaN(parsed.getTime()) && isValidInvoiceCalendarDate(parsed)) {
    return ok(parsed);
  }

  // "46277" → year 46277 via Date.parse; recover as Excel serial.
  if (numeric && looksLikeExcelSerial(asNumber)) {
    return fromSerial(asNumber, date1904, original);
  }
  if (
    numeric &&
    asNumber >= 1 &&
    asNumber <= EXCEL_SERIAL_MAX &&
    !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() > 9999
  ) {
    return fromSerial(asNumber, date1904, original);
  }

  return { status: 'invalid', original };
}

type ExcelLikeCell = {
  t?: string;
  v?: unknown;
  w?: string;
  z?: string | number;
};

/** Convert a SheetJS cell to a string, turning Excel date serials into ISO. */
export function excelCellToImportString(
  cell: ExcelLikeCell | undefined,
  date1904 = false,
): string {
  if (cell == null || cell.v == null || cell.v === '') return '';
  if (cell.t === 'd') {
    const n = normalizeImportDate(cell.v instanceof Date ? cell.v : new Date(String(cell.v)));
    return n.status === 'ok' ? n.iso : String(cell.v).trim();
  }
  if (cell.t === 'n' && typeof cell.v === 'number') {
    const formatted = String(cell.w ?? '');
    if (looksLikeFormattedExcelDate(formatted) || isDateNumFmt(cell.z)) {
      const n = normalizeImportDate(cell.v, { preferSerial: true, date1904 });
      if (n.status === 'ok') return n.iso;
    }
  }
  return String(cell.v ?? '').trim();
}

export function invalidImportDateMessage(
  rowNumber: number,
  columnLabel: string,
  original: string,
): string {
  const shown = original.length > 80 ? `${original.slice(0, 77)}...` : original;
  return `تاريخ غير صالح في الصف ${rowNumber}، العمود ${columnLabel} (القيمة: ${shown})`;
}

export function isPrismaDateTimeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    /prisma\.document\.(create|update)/i.test(msg) ||
    /Could not convert argument value Object/i.test(msg) ||
    /\+0\d{5}-\d{2}-\d{2}T/.test(msg)
  );
}
