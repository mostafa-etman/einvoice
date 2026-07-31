/**
 * Terminal ImportJob status after validate + run (analyze I1).
 *
 * - PARTIAL: any invalid rows from validation, or any create/sign failures,
 *   while at least one document was created (or valid rows existed and run ran).
 * - SUCCEEDED: every valid row created, zero failedRows, zero invalidRows.
 * - FAILED: run attempted but nothing created and there were failures / no valid rows processed.
 */
export type ImportTerminalStatus = 'SUCCEEDED' | 'PARTIAL' | 'FAILED';

export type ImportRunOutcomeInput = {
  validRows: number;
  invalidRows: number;
  createdDocs: number;
  failedRows: number;
  /** true when POST /run was invoked */
  runAttempted: boolean;
};

export function resolveImportTerminalStatus(
  input: ImportRunOutcomeInput,
): ImportTerminalStatus {
  if (!input.runAttempted) {
    throw new Error('resolveImportTerminalStatus requires runAttempted');
  }
  if (input.createdDocs === 0) {
    return 'FAILED';
  }
  if (
    input.invalidRows > 0 ||
    input.failedRows > 0 ||
    input.createdDocs < input.validRows
  ) {
    return 'PARTIAL';
  }
  return 'SUCCEEDED';
}
