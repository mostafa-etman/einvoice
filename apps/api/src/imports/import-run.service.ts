import {
  resolveImportTerminalStatus,
  type ImportTerminalStatus,
} from './import-partial-status';
import type { RowValidationResult } from './import-validate.service';
import { ImportErrorReportService } from './import-error-report.service';

export type CreatedDoc = {
  rowNumber: number;
  documentId: string;
  internalId: string;
};

export type ImportRunResult = {
  status: ImportTerminalStatus;
  createdDocs: number;
  failedRows: number;
  validRows: number;
  invalidRows: number;
  created: CreatedDoc[];
  errorReportCsv: string;
  /** document ids that should be enqueued for sign when runMode requests it */
  signEnqueueDocumentIds: string[];
};

export type CreateDocumentFn = (mapped: Record<string, string>) => Promise<{
  documentId: string;
}>;

/**
 * Creates documents for VALID rows only. Invalid rows never block valid creates.
 * Idempotent skip: rows that already have documentId are not re-created.
 */
export class ImportRunService {
  constructor(
    private readonly errorReports = new ImportErrorReportService(),
    private readonly createDocument: CreateDocumentFn = async (mapped) => ({
      documentId: `doc-${mapped.internalID}`,
    }),
  ) {}

  async run(options: {
    results: RowValidationResult[];
    /** Prior document ids by rowNumber (resume after crash) */
    existingDocumentIds?: Map<number, string>;
    /** Simulate create failures for specific row numbers (tests) */
    failRowNumbers?: Set<number>;
    signAndSubmit?: boolean;
    /** When sign enqueue fails for a doc id */
    signEnqueueFail?: (documentId: string) => boolean;
  }): Promise<ImportRunResult> {
    const valid = options.results.filter((r) => r.status === 'VALID');
    const invalidRows = options.results.filter(
      (r) => r.status === 'INVALID',
    ).length;
    const created: CreatedDoc[] = [];
    let failedRows = 0;
    const signEnqueueDocumentIds: string[] = [];

    for (const row of valid) {
      const existing = options.existingDocumentIds?.get(row.rowNumber);
      if (existing) {
        created.push({
          rowNumber: row.rowNumber,
          documentId: existing,
          internalId: row.businessKey ?? row.mapped!.internalID,
        });
        continue;
      }
      if (options.failRowNumbers?.has(row.rowNumber)) {
        failedRows += 1;
        continue;
      }
      try {
        const { documentId } = await this.createDocument(row.mapped!);
        created.push({
          rowNumber: row.rowNumber,
          documentId,
          internalId: row.mapped!.internalID,
        });
        if (options.signAndSubmit) {
          if (options.signEnqueueFail?.(documentId)) {
            failedRows += 1;
          } else {
            signEnqueueDocumentIds.push(documentId);
          }
        }
      } catch {
        failedRows += 1;
      }
    }

    const status = resolveImportTerminalStatus({
      validRows: valid.length,
      invalidRows,
      createdDocs: created.length,
      failedRows,
      runAttempted: true,
    });

    return {
      status,
      createdDocs: created.length,
      failedRows,
      validRows: valid.length,
      invalidRows,
      created,
      errorReportCsv: this.errorReports.buildCsv(options.results),
      signEnqueueDocumentIds,
    };
  }
}
