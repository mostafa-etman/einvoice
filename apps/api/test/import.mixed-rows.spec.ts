import { resolveImportTerminalStatus } from '../src/imports/import-partial-status';
import { ImportParseService } from '../src/imports/import-parse.service';
import {
  ImportValidateService,
  type ColumnMapping,
} from '../src/imports/import-validate.service';
import { ImportRunService } from '../src/imports/import-run.service';
import { ImportErrorReportService } from '../src/imports/import-error-report.service';

const IDENTITY_MAPPING: ColumnMapping = {
  internalID: 'internalID',
  dateTimeIssued: 'dateTimeIssued',
  receiverName: 'receiverName',
  receiverId: 'receiverId',
  itemCode: 'itemCode',
  quantity: 'quantity',
  unitPrice: 'unitPrice',
};

function csvHeader(): string {
  return [
    'internalID',
    'dateTimeIssued',
    'receiverName',
    'receiverId',
    'itemCode',
    'quantity',
    'unitPrice',
  ].join(',');
}

function validRow(id: string): string {
  return [
    id,
    '2026-07-01T10:00:00Z',
    'Buyer Co',
    '100',
    'EG-001',
    '2',
    '50.00',
  ].join(',');
}

/**
 * T018 — mixed dozens of rows: bad rows reported; only valid rows create docs;
 * job status PARTIAL when invalidRows > 0.
 */
describe('import partial-success / mixed rows (T018)', () => {
  it('imports only valid rows and returns PARTIAL when bad rows exist', async () => {
    const lines = [csvHeader()];
    for (let i = 1; i <= 40; i++) {
      if (i % 5 === 0) {
        lines.push(
          [`BAD-${i}`, '2026-07-01T10:00:00Z', 'Buyer', '', 'EG-001', '-1', '10'].join(
            ',',
          ),
        );
      } else {
        lines.push(validRow(`INV-${i}`));
      }
    }
    const csv = lines.join('\n');

    const parse = new ImportParseService();
    const rows: { rowNumber: number; cells: Record<string, string> }[] = [];
    const progress = { last: 0 };
    await parse.parseCsv(csv, {
      onRow: (row) => {
        rows.push(row);
      },
      onProgress: (p) => {
        progress.last = p.rowsEmitted;
      },
    });

    expect(rows.length).toBe(40);
    expect(progress.last).toBe(40);

    const validate = new ImportValidateService();
    const { results, validRows, invalidRows } = validate.validateRows(
      rows,
      IDENTITY_MAPPING,
    );
    expect(validRows).toBe(32);
    expect(invalidRows).toBe(8);

    const createdIds: string[] = [];
    const run = new ImportRunService(
      new ImportErrorReportService(),
      async (mapped) => {
        const id = `doc-${mapped.internalID}`;
        createdIds.push(id);
        return { documentId: id };
      },
    );

    const outcome = await run.run({ results });

    expect(outcome.createdDocs).toBe(32);
    expect(outcome.invalidRows).toBe(8);
    expect(outcome.failedRows).toBe(0);
    expect(outcome.status).toBe('PARTIAL');
    expect(createdIds).toHaveLength(32);
    expect(createdIds.some((id) => id.includes('BAD-'))).toBe(false);

    const report = outcome.errorReportCsv;
    expect(report).toContain('rowNumber,businessKey,field,code,message');
    for (let i = 5; i <= 40; i += 5) {
      expect(report).toContain(String(i));
    }
  });

  it('does not let create failures on some rows block other valid creates', async () => {
    const lines = [
      csvHeader(),
      validRow('INV-A'),
      validRow('INV-B'),
      validRow('INV-C'),
    ];
    const parse = new ImportParseService();
    const rows: { rowNumber: number; cells: Record<string, string> }[] = [];
    await parse.parseCsv(lines.join('\n'), { onRow: (r) => rows.push(r) });
    const { results } = new ImportValidateService().validateRows(
      rows,
      IDENTITY_MAPPING,
    );

    const run = new ImportRunService(undefined, async (mapped) => ({
      documentId: `doc-${mapped.internalID}`,
    }));
    const outcome = await run.run({
      results,
      failRowNumbers: new Set([2]),
    });

    expect(outcome.createdDocs).toBe(2);
    expect(outcome.failedRows).toBe(1);
    expect(outcome.status).toBe('PARTIAL');
    expect(outcome.created.map((c) => c.internalId).sort()).toEqual([
      'INV-A',
      'INV-C',
    ]);
  });

  it('resolveImportTerminalStatus: SUCCEEDED only when no invalid and no failed', () => {
    expect(
      resolveImportTerminalStatus({
        validRows: 10,
        invalidRows: 0,
        createdDocs: 10,
        failedRows: 0,
        runAttempted: true,
      }),
    ).toBe('SUCCEEDED');
    expect(
      resolveImportTerminalStatus({
        validRows: 10,
        invalidRows: 2,
        createdDocs: 10,
        failedRows: 0,
        runAttempted: true,
      }),
    ).toBe('PARTIAL');
    expect(
      resolveImportTerminalStatus({
        validRows: 10,
        invalidRows: 0,
        createdDocs: 0,
        failedRows: 10,
        runAttempted: true,
      }),
    ).toBe('FAILED');
  });

  it('CREATE_SIGN_SUBMIT enqueues sign only for created valid docs', async () => {
    const lines = [
      csvHeader(),
      validRow('INV-1'),
      ['BAD', '2026-07-01T10:00:00Z', '', '', '', '', ''].join(','),
      validRow('INV-2'),
    ];
    const rows: { rowNumber: number; cells: Record<string, string> }[] = [];
    await new ImportParseService().parseCsv(lines.join('\n'), {
      onRow: (r) => rows.push(r),
    });
    const { results } = new ImportValidateService().validateRows(
      rows,
      IDENTITY_MAPPING,
    );
    const run = new ImportRunService();
    const outcome = await run.run({ results, signAndSubmit: true });
    expect(outcome.signEnqueueDocumentIds).toEqual(['doc-INV-1', 'doc-INV-2']);
    expect(outcome.status).toBe('PARTIAL');
  });
});

describe('import parse format gates', () => {
  it('rejects legacy .xls', () => {
    const parse = new ImportParseService();
    expect(parse.detectFormat('book.xls')).toBe('unsupported');
    expect(parse.isLegacyXls(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).toBe(
      true,
    );
  });
});
