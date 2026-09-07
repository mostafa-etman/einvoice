import type { ImportRow } from './import-parse.service';
import {
  DOC_TYPE_TO_KIND,
  IMPORT_REQUIRED_FIELDS,
  IMPORT_TAX_SLOTS,
} from './import-schema';
import { arabicHeaderForField } from './import-ar-headers';
import { normalizeMappedImportValues } from './import-value-aliases';
import {
  groupRowsByInternalId,
  headerConflicts,
  resolveDocumentKind,
  type MappedImportRow,
} from './import-document-builder';
import { isFixedAmountTaxType } from '@einvoice/eta-core';

export type FieldError = {
  field: string;
  code: string;
  message: string;
};

export type RowValidationResult = {
  rowNumber: number;
  businessKey?: string;
  status: 'VALID' | 'INVALID';
  errors: FieldError[];
  /** Mapped fields for create (no raw dump of entire sheet) */
  mapped?: Record<string, string>;
};

/** @deprecated Prefer IMPORT_REQUIRED_FIELDS from import-schema — re-exported for tests. */
export { IMPORT_REQUIRED_FIELDS };

export type ColumnMapping = Record<string, string>; // targetField -> sourceColumn

export function applyMapping(
  cells: Record<string, string>,
  mapping: ColumnMapping,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [target, source] of Object.entries(mapping)) {
    out[target] = cells[source] ?? '';
  }
  return out;
}

function cell(mapped: Record<string, string>, key: string): string {
  return (mapped[key] ?? '').trim();
}

/**
 * Per-line validation. Duplicate internalID across rows is allowed (multi-line
 * invoice). Invoice-level checks run after grouping.
 */
export function validateMappedRow(
  rowNumber: number,
  mappedInput: Record<string, string>,
): RowValidationResult {
  const mapped = normalizeMappedImportValues(mappedInput);
  const errors: FieldError[] = [];
  const ar = (field: string) => arabicHeaderForField(field, false);
  for (const field of IMPORT_REQUIRED_FIELDS) {
    const v = cell(mapped, field);
    if (!v) {
      errors.push({
        field,
        code: 'REQUIRED',
        message: `${ar(field)} مطلوب`,
      });
    }
  }

  const qty = Number(mapped.quantity);
  if (mapped.quantity && (Number.isNaN(qty) || qty <= 0)) {
    errors.push({
      field: 'quantity',
      code: 'INVALID_NUMBER',
      message: `${ar('quantity')} يجب أن يكون رقماً أكبر من صفر`,
    });
  }
  const price = Number(mapped.unitPrice);
  if (mapped.unitPrice && (Number.isNaN(price) || price < 0)) {
    errors.push({
      field: 'unitPrice',
      code: 'INVALID_NUMBER',
      message: `${ar('unitPrice')} يجب أن يكون رقماً صفر أو أكبر`,
    });
  }

  for (let n = 1; n <= IMPORT_TAX_SLOTS; n++) {
    const taxType = cell(mapped, `taxType${n}`);
    if (!taxType) continue;
    const subType = cell(mapped, `taxSubType${n}`);
    if (!subType) {
      errors.push({
        field: `taxSubType${n}`,
        code: 'REQUIRED',
        message: `${ar(`taxSubType${n}`)} مطلوب عند تحديد ${ar(`taxType${n}`)}`,
      });
    }
    if (isFixedAmountTaxType(taxType)) {
      const amount = cell(mapped, `taxAmount${n}`);
      if (!amount) {
        errors.push({
          field: `taxAmount${n}`,
          code: 'REQUIRED',
          message: `${ar(`taxAmount${n}`)} مطلوب لنوع الضريبة الثابتة ${taxType}`,
        });
      } else if (Number.isNaN(Number(amount)) || Number(amount) < 0) {
        errors.push({
          field: `taxAmount${n}`,
          code: 'INVALID_NUMBER',
          message: `${ar(`taxAmount${n}`)} يجب أن يكون رقماً صفر أو أكبر`,
        });
      }
    } else {
      const rate = cell(mapped, `taxRate${n}`);
      if (rate && (Number.isNaN(Number(rate)) || Number(rate) < 0)) {
        errors.push({
          field: `taxRate${n}`,
          code: 'INVALID_NUMBER',
          message: `${ar(`taxRate${n}`)} يجب أن يكون رقماً صفر أو أكبر`,
        });
      }
    }
  }

  const docType = cell(mapped, 'documentType');
  if (docType && !DOC_TYPE_TO_KIND[docType.toUpperCase()]) {
    errors.push({
      field: 'documentType',
      code: 'INVALID_VALUE',
      message: `${ar('documentType')} يجب أن يكون أحد: ${Object.keys(DOC_TYPE_TO_KIND).join(', ')} أو فاتورة/مرتجع من ورقة القوائم`,
    });
  }

  const internalID = cell(mapped, 'internalID');
  if (errors.length > 0) {
    return {
      rowNumber,
      businessKey: internalID || undefined,
      status: 'INVALID',
      errors,
    };
  }
  return {
    rowNumber,
    businessKey: internalID,
    status: 'VALID',
    errors: [],
    mapped: { ...mapped, internalID },
  };
}

function applyInvoiceLevelChecks(
  results: RowValidationResult[],
  jobDocumentType: string,
): void {
  const validMapped: MappedImportRow[] = results
    .filter((r) => r.status === 'VALID' && r.mapped)
    .map((r) => ({ rowNumber: r.rowNumber, mapped: r.mapped! }));

  const groups = groupRowsByInternalId(validMapped);
  const byRow = new Map(results.map((r) => [r.rowNumber, r]));

  for (const group of groups) {
    const conflicts = headerConflicts(group);
    if (conflicts.length) {
      for (const row of group.rows) {
        const result = byRow.get(row.rowNumber);
        if (!result || result.status !== 'VALID') continue;
        result.status = 'INVALID';
        result.errors = [
          ...result.errors,
          {
            field: 'internalID',
            code: 'HEADER_CONFLICT',
            message: `صفوف ${group.internalId} غير متفقة في: ${conflicts.map((f) => arabicHeaderForField(f, false)).join('، ')}`,
          },
        ];
        delete result.mapped;
      }
      continue;
    }

    const kind = resolveDocumentKind(
      group.rows[0]?.mapped.documentType,
      jobDocumentType,
    );
    const needsRefs =
      kind.includes('CREDIT') || kind.includes('DEBIT');
    const refs = (group.rows[0]?.mapped.references ?? '').trim();
    if (needsRefs && !refs) {
      for (const row of group.rows) {
        const result = byRow.get(row.rowNumber);
        if (!result || result.status !== 'VALID') continue;
        result.status = 'INVALID';
        result.errors = [
          ...result.errors,
          {
            field: 'references',
            code: 'REQUIRED',
            message: 'الرقم المرجعي للمستند الأصلي مطلوب لإشعار الدائن/المدين (مرتجع)',
          },
        ];
        delete result.mapped;
      }
    }
  }
}

export class ImportValidateService {
  validateRows(
    rows: ImportRow[],
    mapping: ColumnMapping,
    opts?: { jobDocumentType?: string },
  ): {
    results: RowValidationResult[];
    validRows: number;
    invalidRows: number;
  } {
    const results: RowValidationResult[] = [];
    for (const row of rows) {
      const mapped = applyMapping(row.cells, mapping);
      results.push(validateMappedRow(row.rowNumber, mapped));
    }
    applyInvoiceLevelChecks(results, opts?.jobDocumentType ?? 'I');
    const validRows = results.filter((r) => r.status === 'VALID').length;
    const invalidRows = results.length - validRows;
    return { results, validRows, invalidRows };
  }
}
