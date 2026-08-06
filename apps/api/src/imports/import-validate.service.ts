import type { ImportRow } from './import-parse.service';
import {
  DOC_TYPE_TO_KIND,
  IMPORT_REQUIRED_FIELDS,
  IMPORT_TAX_SLOTS,
} from './import-schema';
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
  mapped: Record<string, string>,
): RowValidationResult {
  const errors: FieldError[] = [];
  for (const field of IMPORT_REQUIRED_FIELDS) {
    const v = cell(mapped, field);
    if (!v) {
      errors.push({
        field,
        code: 'REQUIRED',
        message: `${field} is required`,
      });
    }
  }

  const qty = Number(mapped.quantity);
  if (mapped.quantity && (Number.isNaN(qty) || qty <= 0)) {
    errors.push({
      field: 'quantity',
      code: 'INVALID_NUMBER',
      message: 'quantity must be a positive number',
    });
  }
  const price = Number(mapped.unitPrice);
  if (mapped.unitPrice && (Number.isNaN(price) || price < 0)) {
    errors.push({
      field: 'unitPrice',
      code: 'INVALID_NUMBER',
      message: 'unitPrice must be a non-negative number',
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
        message: `taxSubType${n} is required when taxType${n} is set`,
      });
    }
    if (isFixedAmountTaxType(taxType)) {
      const amount = cell(mapped, `taxAmount${n}`);
      if (!amount) {
        errors.push({
          field: `taxAmount${n}`,
          code: 'REQUIRED',
          message: `taxAmount${n} is required for fixed-amount tax type ${taxType}`,
        });
      } else if (Number.isNaN(Number(amount)) || Number(amount) < 0) {
        errors.push({
          field: `taxAmount${n}`,
          code: 'INVALID_NUMBER',
          message: `taxAmount${n} must be a non-negative number`,
        });
      }
    } else {
      const rate = cell(mapped, `taxRate${n}`);
      if (rate && (Number.isNaN(Number(rate)) || Number(rate) < 0)) {
        errors.push({
          field: `taxRate${n}`,
          code: 'INVALID_NUMBER',
          message: `taxRate${n} must be a non-negative number`,
        });
      }
    }
  }

  const docType = cell(mapped, 'documentType');
  if (docType && !DOC_TYPE_TO_KIND[docType.toUpperCase()]) {
    errors.push({
      field: 'documentType',
      code: 'INVALID_VALUE',
      message: `documentType must be one of ${Object.keys(DOC_TYPE_TO_KIND).join(', ')}`,
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
            message: `Rows for ${group.internalId} disagree on: ${conflicts.join(', ')}`,
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
            message: 'references (original ETA UUID) required for credit/debit notes',
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
