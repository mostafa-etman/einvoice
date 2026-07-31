import type { ImportRow } from './import-parse.service';

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

/** Minimal issued-invoice template fields for bulk import MVP validation. */
export const IMPORT_REQUIRED_FIELDS = [
  'internalID',
  'dateTimeIssued',
  'receiverName',
  'receiverId',
  'itemCode',
  'quantity',
  'unitPrice',
] as const;

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

export function validateMappedRow(
  rowNumber: number,
  mapped: Record<string, string>,
  seenInternalIds: Set<string>,
): RowValidationResult {
  const errors: FieldError[] = [];
  for (const field of IMPORT_REQUIRED_FIELDS) {
    const v = (mapped[field] ?? '').trim();
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

  const internalID = (mapped.internalID ?? '').trim();
  if (internalID) {
    if (seenInternalIds.has(internalID)) {
      errors.push({
        field: 'internalID',
        code: 'DUPLICATE',
        message: `duplicate internalID in file: ${internalID}`,
      });
    } else {
      seenInternalIds.add(internalID);
    }
  }

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

export class ImportValidateService {
  validateRows(
    rows: ImportRow[],
    mapping: ColumnMapping,
  ): {
    results: RowValidationResult[];
    validRows: number;
    invalidRows: number;
  } {
    const seen = new Set<string>();
    const results: RowValidationResult[] = [];
    for (const row of rows) {
      const mapped = applyMapping(row.cells, mapping);
      results.push(validateMappedRow(row.rowNumber, mapped, seen));
    }
    const validRows = results.filter((r) => r.status === 'VALID').length;
    const invalidRows = results.length - validRows;
    return { results, validRows, invalidRows };
  }
}
