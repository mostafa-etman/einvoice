import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { ArabicShaper } from 'arabic-persian-reshaper';
import bidiFactory from 'bidi-js';
import { formatMoney } from '@einvoice/eta-core';

const bidi = bidiFactory();

export type LocalInvoicePdfLocale = 'en' | 'ar';

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
    taxes?: Array<{
      taxType: string;
      subType: string;
      rate: string;
      amount?: string;
    }>;
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
  total: string;
  address: string;
};

const EN: Labels = {
  title: 'Invoice preview',
  localNote: 'Local preview — not the official ETA printout',
  issuer: 'Issuer',
  receiver: 'Receiver',
  taxId: 'Tax registration',
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
  total: 'Total amount',
  address: 'Address',
};

const AR: Labels = {
  title: 'معاينة الفاتورة',
  localNote: 'معاينة محلية — ليست الطبعة الرسمية لمصلحة الضرائب',
  issuer: 'البائع',
  receiver: 'المشتري',
  taxId: 'الرقم الضريبي',
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
  total: 'الإجمالي',
  address: 'العنوان',
};

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

/** Reshape + reorder Arabic so pdfkit draws glyphs in visual order. */
export function shapeForPdf(text: string, rtl: boolean): string {
  if (!text) return '';
  if (!rtl && !hasArabic(text)) return text;
  const reshaped = ArabicShaper.convertArabic(text);
  if (!hasArabic(text) && !rtl) return reshaped;
  const levels = bidi.getEmbeddingLevels(reshaped, rtl ? 'rtl' : 'ltr');
  return bidi.getReorderedString(reshaped, levels);
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

function money(value: unknown): string {
  try {
    return formatMoney(String(value ?? '0'));
  } catch {
    return '0.00';
  }
}

function parseTaxTotals(
  raw: unknown,
): Array<{ taxType: string; amount: string }> {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((t) => {
      const row = t as Record<string, unknown>;
      return {
        taxType: String(row.taxType ?? row.type ?? ''),
        amount: money(row.amount ?? '0'),
      };
    });
  }
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([k, v]) => ({
      taxType: k,
      amount: money(
        typeof v === 'object' && v && 'amount' in v
          ? (v as { amount: unknown }).amount
          : v,
      ),
    }));
  }
  return [];
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

  const fontFor = (text: string) =>
    rtl || hasArabic(text) ? 'Arabic' : 'Latin';

  const drawText = (
    text: string,
    x: number,
    y: number,
    opts: { width?: number; align?: 'left' | 'right' | 'center'; size?: number } = {},
  ) => {
    const shaped = shapeForPdf(text, rtl);
    doc
      .font(fontFor(text))
      .fontSize(opts.size ?? 9)
      .fillColor('#111')
      .text(shaped, x, y, {
        width: opts.width ?? contentWidth,
        align: opts.align ?? (rtl ? 'right' : 'left'),
        lineBreak: true,
      });
  };

  let y = margin;

  // Header: logo + title
  if (input.logo?.buffer?.length) {
    try {
      const logoW = 72;
      const logoX = rtl ? pageWidth - margin - logoW : margin;
      doc.image(input.logo.buffer, logoX, y, {
        fit: [logoW, 48],
      });
    } catch {
      // ignore corrupt logo; still render invoice
    }
  }
  drawText(L.title, margin, y, {
    width: contentWidth,
    align: 'center',
    size: 16,
  });
  y += 28;
  drawText(L.localNote, margin, y, {
    width: contentWidth,
    align: 'center',
    size: 8,
  });
  y += 22;

  // Meta row
  const metaLines = [
    `${L.documentType}: ${input.kind}`,
    `${L.internalId}: ${input.internalId}`,
    `${L.date}: ${input.issueDateTime}`,
    `${L.currency}: ${input.currencyCode}`,
  ];
  for (const line of metaLines) {
    drawText(line, margin, y, { size: 9 });
    y += 13;
  }
  y += 8;

  const partyBlock = (
    title: string,
    party: LocalInvoicePdfInput['issuer'],
    activity?: string,
  ) => {
    drawText(title, margin, y, { size: 11 });
    y += 14;
    if (party.name) {
      drawText(String(party.name), margin, y, { size: 10 });
      y += 13;
    }
    if (party.id) {
      drawText(`${L.taxId}: ${party.id}`, margin, y);
      y += 12;
    }
    if (activity) {
      drawText(`${L.activity}: ${activity}`, margin, y);
      y += 12;
    }
    const addr = formatAddress(party.address ?? null);
    if (addr) {
      drawText(`${L.address}: ${addr}`, margin, y, { width: contentWidth });
      y = doc.y + 6;
    } else {
      y += 4;
    }
    y += 6;
  };

  partyBlock(L.issuer, input.issuer, input.taxpayerActivityCode);
  if (input.receiver?.name || input.receiver?.id) {
    partyBlock(L.receiver, input.receiver);
  }

  // Line table header
  const cols = rtl
    ? ([
        { key: 'taxes', w: 90, label: L.taxes },
        { key: 'discount', w: 50, label: L.discount },
        { key: 'unitPrice', w: 55, label: L.unitPrice },
        { key: 'unit', w: 35, label: L.unit },
        { key: 'qty', w: 35, label: L.qty },
        { key: 'description', w: 130, label: L.description },
        { key: 'code', w: 70, label: L.code },
      ] as const)
    : ([
        { key: 'code', w: 70, label: L.code },
        { key: 'description', w: 130, label: L.description },
        { key: 'qty', w: 35, label: L.qty },
        { key: 'unit', w: 35, label: L.unit },
        { key: 'unitPrice', w: 55, label: L.unitPrice },
        { key: 'discount', w: 50, label: L.discount },
        { key: 'taxes', w: 90, label: L.taxes },
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
  let x = margin;
  for (const col of cols) {
    drawText(col.label, x, y, { width: col.w, size: 8 });
    x += col.w;
  }
  y += 14;
  doc.moveTo(margin, y).lineTo(pageWidth - margin, y).stroke('#999');
  y += 6;

  for (const line of input.lines) {
    const taxText = (line.taxes ?? [])
      .map(
        (t) =>
          `${t.taxType}/${t.subType} ${t.rate}%${t.amount != null && t.amount !== '' ? `=${money(t.amount)}` : ''}`,
      )
      .join('; ');
    const row: Record<(typeof cols)[number]['key'], string> = {
      code: `${line.itemType}:${line.itemCode}`,
      description: line.description || '',
      qty: String(line.quantity ?? ''),
      unit: String(line.unitType ?? ''),
      unitPrice: money(line.unitPrice),
      discount: money(line.discountAmount ?? '0'),
      taxes: taxText || '—',
    };
    const descHeight = Math.max(
      24,
      Math.ceil((row.description.length || 1) / 28) * 11,
    );
    ensureSpace(descHeight + 8);
    x = margin;
    let rowBottom = y;
    for (const col of cols) {
      drawText(row[col.key], x, y, { width: col.w - 2, size: 8 });
      rowBottom = Math.max(rowBottom, doc.y);
      x += col.w;
    }
    y = rowBottom + 6;
  }

  y += 10;
  ensureSpace(120);
  doc.moveTo(margin, y).lineTo(pageWidth - margin, y).stroke('#999');
  y += 10;

  const totalsBlock = [
    [L.totalSales, money(input.totals.totalSalesAmount)],
    [L.totalDiscount, money(input.totals.totalDiscountAmount)],
    [L.extraDiscount, money(input.totals.extraDiscountAmount ?? '0')],
    [L.net, money(input.totals.netAmount)],
  ] as const;

  for (const [label, value] of totalsBlock) {
    drawText(`${label}: ${value}`, margin, y, {
      width: contentWidth,
      align: rtl ? 'left' : 'right',
      size: 10,
    });
    y += 14;
  }

  const taxTotals = parseTaxTotals(input.totals.taxTotals);
  if (taxTotals.length) {
    drawText(L.taxByType, margin, y, {
      width: contentWidth,
      align: rtl ? 'left' : 'right',
      size: 9,
    });
    y += 13;
    for (const t of taxTotals) {
      drawText(`${t.taxType}: ${t.amount}`, margin, y, {
        width: contentWidth,
        align: rtl ? 'left' : 'right',
        size: 9,
      });
      y += 12;
    }
  }

  y += 4;
  drawText(`${L.total}: ${money(input.totals.totalAmount)} ${input.currencyCode}`, margin, y, {
    width: contentWidth,
    align: rtl ? 'left' : 'right',
    size: 12,
  });

  y += 28;
  drawText(L.localNote, margin, y, {
    width: contentWidth,
    align: 'center',
    size: 8,
  });

  doc.end();
  return done;
}
