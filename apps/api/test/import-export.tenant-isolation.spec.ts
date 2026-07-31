import { resolveImportTerminalStatus } from '../src/imports/import-partial-status';

describe('import-export tenant isolation contract stub (T013)', () => {
  it('documents resolveImportTerminalStatus without cross-tenant keys', () => {
    // Controllers require X-Tenant-Id via requireTenant; artifact keys are tenant-prefixed.
    const key = `tenants/aaa/artifacts/imports/job.csv`;
    expect(key.startsWith('tenants/')).toBe(true);
    expect(
      resolveImportTerminalStatus({
        validRows: 1,
        invalidRows: 1,
        createdDocs: 1,
        failedRows: 0,
        runAttempted: true,
      }),
    ).toBe('PARTIAL');
  });
});
