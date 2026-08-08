import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { ArabicShaper } from 'arabic-persian-reshaper';
import { formatMoneyDisplay, formatQuantityDisplay } from '@einvoice/eta-core';

export type LocalInvoicePdfLocale = 'en' | 'ar';

export type LocalInvoicePdfTax = {
  taxType: string;
  subType: string;
  rate: string;
  amount?: string;
};

export type LocalInvoicePdfInput = {
  locale: LocalInvoicePdfLocale;
  kind: string;
  internalId: string;
  issueDateTime: string;
  currencyCode: string;
  taxpayerActivityCode?: string;
  issuer: {
    type?: string;
    id?: string;
    name?: string;
    address?: Record<string, unknown> | null;
  };
  receiver?: {
    type?: string;
    id?: string;
    name?: string;
    address?: Record<string, unknown> | null;
  } | null;
  lines: Array<{
    description: string;
    itemType: string;
    itemCode: string;
    unitType: string;
    quantity: string;
    unitPrice: string;
    discountAmount?: string;
    taxes?: LocalInvoicePdfTax[];
  }>;
  totals: {
    totalSalesAmount: string;
    totalDiscountAmount: string;
    netAmount: string;
    totalAmount: string;
    extraDiscountAmount?: string;
    taxTotals?: unknown;
  };
  logo?: { buffer: Buffer; contentType?: string } | null;
};

type Labels = {
  title: string;
  localNote: string;
  issuer: string;
  receiver: string;
  taxId: string;
  activity: string;
  documentType: string;
  internalId: string;
  date: string;
  currency: string;
  code: string;
  description: string;
  qty: string;
  unit: string;
  unitPrice: string;
  discount: string;
  taxes: string;
  totalSales: string;
  totalDiscount: string;
  extraDiscount: string;
  net: string;
  taxByType: string;
  vatSummary: string;
  withholdingSummary: string;
  total: string;
  address: string;
};

const EN: Labels = {
  title: 'Invoice preview',
  localNote: 'Local preview — not the official ETA printout',
  issuer: 'Issuer',
  receiver: 'Receiver',
  taxId: 'Tax Registration Number',
  activity: 'Activity code',
  documentType: 'Document type',
  internalId: 'Internal ID',
  date: 'Issue date',
  currency: 'Currency',
  code: 'Code',
  description: 'Description',
  qty: 'Qty',
  unit: 'Unit',
  unitPrice: 'Unit price',
  discount: 'Discount',
  taxes: 'Taxes',
  totalSales: 'Total sales',
  totalDiscount: 'Total discount',
  extraDiscount: 'Extra discount',
  net: 'Net amount',
  taxByType: 'Taxes by type',
  vatSummary: 'VAT (output)',
  withholdingSummary: 'Withholding',
  total: 'Total amount',
  address: 'Address',
};

const AR: Labels = {
  title: 'معاينة الفاتورة',
  localNote: 'معاينة محلية — ليست الطبعة الرسمية لمصلحة الضرائب',
  issuer: 'البائع',
  receiver: 'المشتري',
  taxId: 'رقم التسجيل الضريبي',
  activity: 'كود النشاط',
  documentType: 'نوع المستند',
  internalId: 'الرقم الداخلي',
  date: 'تاريخ الإصدار',
  currency: 'العملة',
  code: 'الكود',
  description: 'الوصف',
  qty: 'الكمية',
  unit: 'الوحدة',
  unitPrice: 'سعر الوحدة',
  discount: 'الخصم',
  taxes: 'الضرائب',
  totalSales: 'إجمالي المبيعات',
  totalDiscount: 'إجمالي الخصم',
  extraDiscount: 'خصم إضافي',
  net: 'الصافي',
  taxByType: 'الضرائب حسب النوع',
  vatSummary: 'ضريبة القيمة المضافة',
  withholdingSummary: 'ضريبة الخصم والتحصيل',
  total: 'الإجمالي',
  address: 'العنوان',
};

type TextSeg = { kind: 'ar' | 'ltr'; text: string };

function resolveFontPaths(): { latin: string; arabic: string } {
  const candidates = [
    path.join(__dirname, '..', '..', 'assets', 'fonts'),
    path.join(__dirname, 'assets', 'fonts'),
    path.join(process.cwd(), 'assets', 'fonts'),
    path.join(process.cwd(), 'apps', 'api', 'assets', 'fonts'),
  ];
  for (const dir of candidates) {
    const latin = path.join(dir, 'NotoSans-Regular.ttf');
    const arabic = path.join(dir, 'NotoNaskhArabic-Regular.ttf');
    if (fs.existsSync(latin) && fs.existsSync(arabic)) {
      return { latin, arabic };
    }
  }
  throw new Error('PDF fonts not found under assets/fonts');
}

function hasArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

/** Split mixed strings so Arabic and LTR (digits/latin/codes) never share one RTL font run. */
export function segmentMixedText(text: string): TextSeg[] {
  if (!text) return [];
  const segs: TextSeg[] = [];
  let buf = '';
  let kind: TextSeg['kind'] | null = null;
  const flush = () => {
    if (!buf || !kind) return;
    segs.push({ kind, text: buf });
    buf = '';
  };
  for (const ch of text) {
    const isAr = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(ch);
    // Keep spaces with the previous run so labels stay glued to values visually.
    const next: TextSeg['kind'] = isAr ? 'ar' : 'ltr';
    if (kind == null) kind = next;
    if (next !== kind && ch !== ' ') {
      flush();
      kind = next;
    }
    buf += ch;
  }
  flush();
  return segs;
}

/** Reshape Arabic runs only — never reshape digits/dates/IDs. */
export function shapeForPdf(text: string, _rtl = false): string {
  if (!text) return '';
  if (!hasArabic(text)) return text;
  try {
    // Segment so ArabicShaper never touches LTR substrings.
    return segmentMixedText(text)
      .map((s) =>
        s.kind === 'ar' ? ArabicShaper.convertArabic(s.text) : s.text,
      )
      .join('');
  } catch {
    return text;
  }
}

/** Re-export shared display money helper (UI/PDF only — never for ETA payloads). */
export { formatMoneyDisplay } from '@einvoice/eta-core';

/** Display date as yyyy-MM-dd HH:mm (UTC, always LTR). */
export function formatDateDisplay(input: string): string {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    // Already a display string — keep as-is if it looks sane.
    return input.length > 16 ? input.slice(0, 16).replace('T', ' ') : input;
  }
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function formatAddress(addr?: Record<string, unknown> | null): string {
  if (!addr) return '';
  const parts = [
    addr.buildingNumber,
    addr.street,
    addr.floor,
    addr.room,
    addr.regionCity,
    addr.governate,
    addr.postalCode,
    addr.country,
    addr.landmark,
    addr.additionalInformation,
  ]
    .map((p) => (p == null ? '' : String(p).trim()))
    .filter(Boolean);
  return parts.join(', ');
}

/** Normalize taxableItems / taxes arrays from ETA or Prisma. */
export function normalizeLineTaxes(raw: unknown): LocalInvoicePdfTax[] {
  if (!raw) return [];
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.taxableItems)) arr = o.taxableItems;
    else if (Array.isArray(o.TaxableItems)) arr = o.TaxableItems;
    else if (Array.isArray(o.taxes)) arr = o.taxes;
  }
  return arr
    .map((item): LocalInvoicePdfTax | null => {
      if (!item || typeof item !== 'object') return null;
      const t = item as Record<string, unknown>;
      const taxType = String(t.taxType ?? t.TaxType ?? t.type ?? '').trim();
      const subType = String(
        t.subType ?? t.subtype ?? t.SubType ?? t.taxSubType ?? '',
      ).trim();
      const rate = String(t.rate ?? t.ratePercent ?? t.Rate ?? '0').trim();
      const amount =
        t.amount != null
          ? String(t.amount)
          : t.Amount != null
            ? String(t.Amount)
            : undefined;
      if (!taxType && !subType && !amount) return null;
      return { taxType, subType, rate, amount };
    })
    .filter((t): t is LocalInvoicePdfTax => t != null);
}

export function parseTaxTotals(
  raw: unknown,
): Array<{ taxType: string; amount: string }> {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((t) => {
        const row = t as Record<string, unknown>;
        const taxType = String(row.taxType ?? row.type ?? row.TaxType ?? '');
        if (!taxType && row.amount == null) return null;
        return {
          taxType,
          amount: formatMoneyDisplay(row.amount ?? '0'),
        };
      })
      .filter((t): t is { taxType: string; amount: string } => t != null);
  }
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([k, v]) => ({
      taxType: k,
      amount: formatMoneyDisplay(
        typeof v === 'object' && v && 'amount' in v
          ? (v as { amount: unknown }).amount
          : v,
      ),
    }));
  }
  return [];
}

/** Aggregate tax totals from line taxes when document-level totals are missing. */
export function aggregateTaxTotalsFromLines(
  lines: LocalInvoicePdfInput['lines'],
): Array<{ taxType: string; amount: string }> {
  const map = new Map<string, number>();
  for (const line of lines) {
    for (const t of line.taxes ?? []) {
      const key = t.taxType || 'TAX';
      const n = Number(String(t.amount ?? '0').replace(/,/g, ''));
      if (!Number.isFinite(n)) continue;
      map.set(key, (map.get(key) ?? 0) + n);
    }
  }
  return [...map.entries()].map(([taxType, amount]) => ({
    taxType,
    amount: formatMoneyDisplay(amount),
  }));
}

function formatLineTaxes(taxes: LocalInvoicePdfTax[] | undefined): string {
  if (!taxes?.length) return '—';
  return taxes
    .map((t) => {
      const code = [t.taxType, t.subType].filter(Boolean).join('/');
      const rate = t.rate ? `${t.rate}%` : '';
      const amt =
        t.amount != null && t.amount !== ''
          ? formatMoneyDisplay(t.amount)
          : '';
      return [code, rate, amt ? `=${amt}` : ''].filter(Boolean).join(' ');
    })
    .join('; ');
}

/**
 * Display-only local invoice PDF. Never used for signing / ETA submission.
 */
export async function renderLocalInvoicePdf(
  input: LocalInvoicePdfInput,
): Promise<Buffer> {
  const rtl = input.locale === 'ar';
  const L = rtl ? AR : EN;
  const fonts = resolveFontPaths();
  const margin = 40;
  const pageWidth = 595.28;
  const contentWidth = pageWidth - margin * 2;

  const doc = new PDFDocument({
    size: 'A4',
    margin,
    info: {
      Title: `${input.internalId} — local preview`,
      Author: 'eInvoice local preview',
    },
  });
  doc.registerFont('Latin', fonts.latin);
  doc.registerFont('Arabic', fonts.arabic);

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  /**
   * Draw mixed Arabic + LTR without reversing numbers/dates/IDs.
   * Arabic runs: Noto Naskh + reshape. LTR runs: Noto Sans, never reshaped.
   * RTL paragraphs are composed right-to-left by placing segments from the right edge.
   */
  const drawMixed = (
    text: string,
    x: number,
    y: number,
    opts: {
      width?: number;
      align?: 'left' | 'right' | 'center';
      size?: number;
    } = {},
  ) => {
    const width = opts.width ?? contentWidth;
    const size = opts.size ?? 9;
    const align = opts.align ?? (rtl ? 'right' : 'left');
    const segs = segmentMixedText(text);
    if (!segs.length) return y;

    const prepared = segs.map((s) => {
      const shaped =
        s.kind === 'ar' ? ArabicShaper.convertArabic(s.text) : s.text;
      const font = s.kind === 'ar' || (rtl && hasArabic(s.text)) ? 'Arabic' : 'Latin';
      doc.font(font).fontSize(size);
      const w = doc.widthOfString(shaped);
      return { ...s, shaped, font, w };
    });
    const totalW = prepared.reduce((a, s) => a + s.w, 0);

    let cursorX: number;
    if (align === 'center') {
      cursorX = x + Math.max(0, (width - totalW) / 2);
    } else if (align === 'right') {
      cursorX = x + Math.max(0, width - totalW);
    } else {
      cursorX = x;
    }

    // For RTL, draw segments in visual order from right: reverse segment list
    // so the first logical Arabic label sits on the right and LTR values stay LTR.
    const drawOrder =
      align === 'right' && rtl ? [...prepared].reverse() : prepared;
    if (align === 'right' && rtl) {
      cursorX = x + Math.max(0, width - totalW);
    }

    let maxBottom = y + size + 2;
    for (const s of drawOrder) {
      doc
        .font(s.font)
        .fontSize(size)
        .fillColor('#111')
        .text(s.shaped, cursorX, y, {
          width: s.w + 1,
          lineBreak: false,
          features: [],
        });
      cursorX += s.w;
      maxBottom = Math.max(maxBottom, doc.y);
    }
    return maxBottom;
  };

  let y = margin;

  if (input.logo?.buffer?.length) {
    try {
      const logoW = 72;
      const logoX = rtl ? pageWidth - margin - logoW : margin;
      doc.image(input.logo.buffer, logoX, y, { fit: [logoW, 48] });
    } catch {
      /* ignore corrupt logo */
    }
  }
  y = drawMixed(L.title, margin, y, {
    width: contentWidth,
    align: 'center',
    size: 16,
  });
  y += 8;
  y = drawMixed(L.localNote, margin, y, {
    width: contentWidth,
    align: 'center',
    size: 8,
  });
  y += 14;

  const metaLines = [
    `${L.documentType}: ${input.kind}`,
    `${L.internalId}: ${input.internalId}`,
    `${L.date}: ${formatDateDisplay(input.issueDateTime)}`,
    `${L.currency}: ${input.currencyCode}`,
  ];
  for (const line of metaLines) {
    y = drawMixed(line, margin, y, { size: 9 });
    y += 4;
  }
  y += 8;

  const partyBlock = (
    title: string,
    party: LocalInvoicePdfInput['issuer'],
    activity?: string,
  ) => {
    y = drawMixed(title, margin, y, { size: 11 });
    y += 4;
    if (party.name) {
      y = drawMixed(String(party.name), margin, y, { size: 10 });
      y += 3;
    }
    if (party.id) {
      y = drawMixed(`${L.taxId}: ${party.id}`, margin, y, { size: 9 });
      y += 3;
    }
    if (party.type) {
      y = drawMixed(`${party.type}`, margin, y, { size: 8 });
      y += 2;
    }
    if (activity) {
      y = drawMixed(`${L.activity}: ${activity}`, margin, y, { size: 9 });
      y += 3;
    }
    const addr = formatAddress(party.address ?? null);
    if (addr) {
      y = drawMixed(`${L.address}: ${addr}`, margin, y, {
        width: contentWidth,
        size: 8,
      });
      y += 4;
    }
    y += 8;
  };

  partyBlock(L.issuer, input.issuer, input.taxpayerActivityCode);
  if (input.receiver?.name || input.receiver?.id) {
    partyBlock(L.receiver, input.receiver);
  }

  const cols = rtl
    ? ([
        { key: 'taxes', w: 100, label: L.taxes },
        { key: 'discount', w: 48, label: L.discount },
        { key: 'unitPrice', w: 52, label: L.unitPrice },
        { key: 'unit', w: 32, label: L.unit },
        { key: 'qty', w: 32, label: L.qty },
        { key: 'description', w: 120, label: L.description },
        { key: 'code', w: 70, label: L.code },
      ] as const)
    : ([
        { key: 'code', w: 70, label: L.code },
        { key: 'description', w: 120, label: L.description },
        { key: 'qty', w: 32, label: L.qty },
        { key: 'unit', w: 32, label: L.unit },
        { key: 'unitPrice', w: 52, label: L.unitPrice },
        { key: 'discount', w: 48, label: L.discount },
        { key: 'taxes', w: 100, label: L.taxes },
      ] as const);

  const ensureSpace = (need: number) => {
    if (y + need > 800) {
      doc.addPage();
      y = margin;
    }
  };

  ensureSpace(40);
  doc.moveTo(margin, y).lineTo(pageWidth - margin, y).stroke('#999');
  y += 4;
  {
    let x = margin;
    let headerBottom = y;
    for (const col of cols) {
      headerBottom = Math.max(
        headerBottom,
        drawMixed(col.label, x, y, { width: col.w - 2, size: 8 }),
      );
      x += col.w;
    }
    y = headerBottom + 4;
  }
  doc.moveTo(margin, y).lineTo(pageWidth - margin, y).stroke('#999');
  y += 6;

  const lines = input.lines.map((line) => ({
    ...line,
    taxes: normalizeLineTaxes(line.taxes),
  }));

  for (const line of lines) {
    const row: Record<(typeof cols)[number]['key'], string> = {
      code: `${line.itemType}:${line.itemCode}`,
      description: line.description || '',
      qty: formatQuantityDisplay(line.quantity),
      unit: String(line.unitType ?? ''),
      unitPrice: formatMoneyDisplay(line.unitPrice),
      discount: formatMoneyDisplay(line.discountAmount ?? '0'),
      taxes: formatLineTaxes(line.taxes),
    };
    ensureSpace(36);
    let x = margin;
    let rowBottom = y;
    for (const col of cols) {
      rowBottom = Math.max(
        rowBottom,
        drawMixed(row[col.key], x, y, { width: col.w - 2, size: 7 }),
      );
      x += col.w;
    }
    y = rowBottom + 6;
  }

  y += 10;
  ensureSpace(140);
  doc.moveTo(margin, y).lineTo(pageWidth - margin, y).stroke('#999');
  y += 10;

  const totalsBlock: Array<[string, string]> = [
    [L.totalSales, formatMoneyDisplay(input.totals.totalSalesAmount)],
    [L.totalDiscount, formatMoneyDisplay(input.totals.totalDiscountAmount)],
    [
      L.extraDiscount,
      formatMoneyDisplay(input.totals.extraDiscountAmount ?? '0'),
    ],
    [L.net, formatMoneyDisplay(input.totals.netAmount)],
  ];

  for (const [label, value] of totalsBlock) {
    y = drawMixed(`${label}: ${value}`, margin, y, {
      width: contentWidth,
      align: rtl ? 'right' : 'right',
      size: 10,
    });
    y += 4;
  }

  let taxTotals = parseTaxTotals(input.totals.taxTotals);
  if (!taxTotals.length) {
    taxTotals = aggregateTaxTotalsFromLines(lines);
  }

  if (taxTotals.length) {
    y += 4;
    y = drawMixed(L.taxByType, margin, y, {
      width: contentWidth,
      align: 'right',
      size: 9,
    });
    y += 4;
    for (const t of taxTotals) {
      const isWithholding = /^T4$/i.test(t.taxType) || /W/i.test(t.taxType);
      const label = isWithholding
        ? `${L.withholdingSummary} (${t.taxType})`
        : /^T1$/i.test(t.taxType)
          ? `${L.vatSummary} (${t.taxType})`
          : t.taxType;
      y = drawMixed(`${label}: ${t.amount}`, margin, y, {
        width: contentWidth,
        align: 'right',
        size: 9,
      });
      y += 3;
    }
  }

  y += 6;
  y = drawMixed(
    `${L.total}: ${formatMoneyDisplay(input.totals.totalAmount)} ${input.currencyCode}`,
    margin,
    y,
    { width: contentWidth, align: 'right', size: 12 },
  );

  y += 20;
  drawMixed(L.localNote, margin, y, {
    width: contentWidth,
    align: 'center',
    size: 8,
  });

  doc.end();
  return done;
}
