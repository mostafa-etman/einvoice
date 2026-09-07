import { Workbook, type DataValidation, type Worksheet } from 'exceljs';
import {
  IMPORT_COLUMNS,
  IMPORT_ALL_FIELD_KEYS,
  IMPORT_TAX_SLOTS,
  arabicColumnHeaders,
  arabicSampleImportRows,
} from './import-schema';
import {
  NAMED,
  TEMPLATE_DATA_ROWS,
  TEMPLATE_SHEET_INVOICES,
  TEMPLATE_SHEET_LISTS,
  applyTemplateListLabels,
  buildListsSheetLayout,
} from './import-lists';

const HEADER_NOTE =
  'صف واحد = بند. نفس الرقم الداخلي = نفس الفاتورة. الأعمدة ذات (*) إلزامية. القوائم المنسدلة إجبارية — لا تكتب قيمة حرة. اسم وعنوان المُصدر من الإعدادات.';

const ERROR_TITLE = 'قيمة غير مسموحة';
const ERROR_TEXT =
  'يجب اختيار قيمة من القائمة المنسدلة فقط. الكتابة الحرة غير مسموحة.';
const SUBTYPE_ERROR =
  'اختر النوع الفرعي المناسب لنوع الضريبة المحدد في نفس الصف. الكتابة الحرة غير مسموحة.';

const GROUP_FILL: Record<string, string> = {
  header: 'FF1F4E79',
  receiver: 'FF0E6655',
  line: 'FF6C3483',
  tax: 'FF9A7D0A',
  payment: 'FF1A5276',
  delivery: 'FF7B241C',
};

type SheetValidations = {
  add: (address: string, validation: DataValidation) => void;
};

function validationsOf(ws: Worksheet): SheetValidations {
  return (ws as Worksheet & { dataValidations: SheetValidations }).dataValidations;
}

function colLetter(index0: number): string {
  let n = index0 + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function fieldCol(key: string): string | null {
  const i = IMPORT_ALL_FIELD_KEYS.indexOf(key);
  return i >= 0 ? colLetter(i) : null;
}

function listValidation(namedRange: string): DataValidation {
  return {
    type: 'list',
    allowBlank: true,
    formulae: [namedRange],
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: ERROR_TITLE,
    error: ERROR_TEXT,
    showInputMessage: true,
    promptTitle: 'اختيار من القائمة',
    prompt: 'اختر قيمة من القائمة فقط',
  };
}

function subtypeValidation(taxTypeCol: string): DataValidation {
  const cell = `${taxTypeCol}2`;
  const formula = `INDIRECT(IFERROR(VLOOKUP(${cell},${NAMED.taxMap},2,FALSE),"${NAMED.taxSubBlank}"))`;
  return {
    type: 'list',
    allowBlank: true,
    formulae: [formula],
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: ERROR_TITLE,
    error: SUBTYPE_ERROR,
    showInputMessage: true,
    promptTitle: 'النوع الفرعي',
    prompt: 'يتغير حسب نوع الضريبة في هذا الصف',
  };
}

function addDropdown(
  ws: Worksheet,
  key: string,
  namedRange: string,
) {
  const col = fieldCol(key);
  if (!col) return;
  validationsOf(ws).add(
    `${col}2:${col}${TEMPLATE_DATA_ROWS}`,
    listValidation(namedRange),
  );
}

export async function buildImportTemplateXlsx(): Promise<Buffer> {
  const issued = new Date().toISOString();
  const layout = buildListsSheetLayout();
  const sample = arabicSampleImportRows(issued);
  const headers = sample[0] ?? arabicColumnHeaders();
  const dataRows = sample.slice(1).map((row) => {
    const mapped = Object.fromEntries(
      IMPORT_ALL_FIELD_KEYS.map((k, i) => [k, row[i] ?? '']),
    );
    const labeled = applyTemplateListLabels(mapped, layout.catalog);
    return IMPORT_ALL_FIELD_KEYS.map((k) => labeled[k] ?? '');
  });

  const wb = new Workbook();
  wb.creator = 'eInvoice';
  wb.title = 'قالب استيراد الفواتير';
  wb.description = HEADER_NOTE;
  wb.created = new Date();

  const invoices = wb.addWorksheet(TEMPLATE_SHEET_INVOICES, {
    views: [
      {
        state: 'frozen',
        ySplit: 1,
        rightToLeft: true,
        activeCell: 'A2',
        showGridLines: true,
      },
    ],
    properties: { defaultColWidth: 18, defaultRowHeight: 18 },
  });

  const lists = wb.addWorksheet(TEMPLATE_SHEET_LISTS, {
    state: 'hidden',
    properties: { defaultColWidth: 28 },
  });

  lists.addRows(layout.rows);
  const headerRow = invoices.addRow(headers);
  headerRow.height = 36;
  headerRow.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.alignment = {
    vertical: 'middle',
    horizontal: 'center',
    wrapText: true,
    readingOrder: 'rtl',
  };

  for (let i = 0; i < IMPORT_COLUMNS.length; i++) {
    const col = IMPORT_COLUMNS[i]!;
    const cell = headerRow.getCell(i + 1);
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: GROUP_FILL[col.group] ?? GROUP_FILL.header! },
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF1B2631' } },
      left: { style: 'thin', color: { argb: 'FF1B2631' } },
      bottom: { style: 'thin', color: { argb: 'FF1B2631' } },
      right: { style: 'thin', color: { argb: 'FF1B2631' } },
    };
    const hint = [
      col.required ? 'مطلوب' : 'اختياري',
      col.allowedValues ? `القيم: ${col.allowedValues}` : '',
      col.description,
    ]
      .filter(Boolean)
      .join('\n');
    cell.note = i === 0 ? `${HEADER_NOTE}\n\n${hint}` : hint;
    invoices.getColumn(i + 1).width = Math.min(
      36,
      Math.max(16, String(headers[i] ?? '').length + 2),
    );
  }

  for (const row of dataRows) {
    const added = invoices.addRow(row);
    added.alignment = { vertical: 'middle', readingOrder: 'rtl' };
    added.height = 20;
  }

  invoices.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };

  addDropdown(invoices, 'receiverType', NAMED.receiverType);
  addDropdown(invoices, 'itemType', NAMED.itemType);
  addDropdown(invoices, 'unitType', NAMED.unitType);
  addDropdown(invoices, 'currencyCode', NAMED.currency);
  addDropdown(invoices, 'receiverCountry', NAMED.country);
  addDropdown(invoices, 'documentType', NAMED.documentType);

  for (let n = 1; n <= IMPORT_TAX_SLOTS; n++) {
    addDropdown(invoices, `taxType${n}`, NAMED.taxType);
    const typeCol = fieldCol(`taxType${n}`);
    const subCol = fieldCol(`taxSubType${n}`);
    if (typeCol && subCol) {
      validationsOf(invoices).add(
        `${subCol}2:${subCol}${TEMPLATE_DATA_ROWS}`,
        subtypeValidation(typeCol),
      );
    }
  }

  for (const nr of layout.namedRanges) {
    wb.definedNames.add(nr.a1, nr.name);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
