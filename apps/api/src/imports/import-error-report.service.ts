import type { FieldError, RowValidationResult } from './import-validate.service';

export function buildErrorReportCsv(
  results: RowValidationResult[],
): string {
  const lines = ['rowNumber,businessKey,field,code,message'];
  for (const row of results) {
    if (row.status !== 'INVALID' && row.errors.length === 0) continue;
    for (const err of row.errors) {
      lines.push(
        [
          row.rowNumber,
          csvEscape(row.businessKey ?? ''),
          csvEscape(err.field),
          csvEscape(err.code),
          csvEscape(err.message),
        ].join(','),
      );
    }
    if (row.errors.length === 0 && row.status === 'INVALID') {
      lines.push(
        [
          row.rowNumber,
          csvEscape(row.businessKey ?? ''),
          '',
          'INVALID',
          'row invalid',
        ].join(','),
      );
    }
  }
  return lines.join('\n') + '\n';
}

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export class ImportErrorReportService {
  buildCsv(results: RowValidationResult[]): string {
    return buildErrorReportCsv(results);
  }

  buildFromErrors(
    rows: Array<{
      rowNumber: number;
      businessKey?: string;
      errors: FieldError[];
    }>,
  ): string {
    return buildErrorReportCsv(
      rows.map((r) => ({
        rowNumber: r.rowNumber,
        businessKey: r.businessKey,
        status: 'INVALID' as const,
        errors: r.errors,
      })),
    );
  }
}
