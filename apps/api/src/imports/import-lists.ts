import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TAX_TYPES: Array<{ code: string; ar: string }> = [
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

const CURRENCIES = ['EGP', 'USD', 'EUR', 'SAR', 'AED', 'GBP', 'KWD', 'QAR', 'OMR', 'JOD'];

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

function loadCountries(): Array<{ code: string; ar: string }> {
  try {
    const path = join(process.cwd(), 'data', 'eta-codes', 'CountryCodes.json');
    const rows = JSON.parse(readFileSync(path, 'utf8')) as Array<{
      code: string;
      Desc_ar?: string;
      Desc_en?: string;
    }>;
    if (!Array.isArray(rows) || rows.length === 0) return FALLBACK_COUNTRIES;
    return rows.map((r) => ({
      code: r.code,
      ar: r.Desc_ar || r.Desc_en || r.code,
    }));
  } catch {
    return FALLBACK_COUNTRIES;
  }
}

export function importListsAoA(): string[][] {
  const countries = loadCountries();
  const receiver = ['شركة', 'شخصي', 'أجنبي'];
  const itemTypes = ['EGS', 'GS1'];
  const docTypes = [
    'I — فاتورة',
    'C — إشعار دائن / مرتجع',
    'D — إشعار مدين',
    'EI — فاتورة تصدير',
    'EC — مرتجع تصدير',
    'ED — إشعار مدين تصدير',
  ];
  const tax = TAX_TYPES.map((t) => `${t.code} — ${t.ar}`);
  const units = UNITS.map((u) => `${u.code} — ${u.ar}`);
  const countryCells = countries.map((c) => `${c.code} — ${c.ar}`);
  const len = Math.max(
    receiver.length,
    itemTypes.length,
    units.length,
    CURRENCIES.length,
    tax.length,
    countryCells.length,
    docTypes.length,
  );
  const rows: string[][] = [
    [
      'نوع المستلم',
      '',
      'نوع كود الصنف',
      '',
      'وحدة القياس',
      '',
      'العملة',
      '',
      'نوع الضريبة',
      '',
      'الدولة',
      '',
      'نوع المستند',
    ],
  ];
  for (let i = 0; i < len; i++) {
    rows.push([
      receiver[i] ?? '',
      '',
      itemTypes[i] ?? '',
      '',
      units[i] ?? '',
      '',
      CURRENCIES[i] ?? '',
      '',
      tax[i] ?? '',
      '',
      countryCells[i] ?? '',
      '',
      docTypes[i] ?? '',
    ]);
  }
  return rows;
}

export const LIST_RANGES = {
  receiverType: 'Lists!$A$2:$A$4',
  itemType: 'Lists!$C$2:$C$3',
  unitType: `Lists!$E$2:$E$${UNITS.length + 1}`,
  currencyCode: `Lists!$G$2:$G$${CURRENCIES.length + 1}`,
  taxType: `Lists!$I$2:$I$${TAX_TYPES.length + 1}`,
  receiverCountry: 'Lists!$K$2:$K$400',
  documentType: 'Lists!$M$2:$M$7',
} as const;
