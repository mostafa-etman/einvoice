import { Readable } from 'node:stream';
import { ImportParseService } from '../src/imports/import-parse.service';

/**
 * T019 — large-file streaming import (≥2,000 rows).
 * Asserts incremental emission via papaparse step (no single giant row array
 * built inside the parser before callbacks).
 */
describe('import large-file stream (T019)', () => {
  it('stream-parses ≥2000 CSV rows with incremental progress', async () => {
    const header =
      'internalID,dateTimeIssued,receiverName,receiverId,itemCode,quantity,unitPrice\n';
    const chunkRows = 2500;
    let body = header;
    for (let i = 1; i <= chunkRows; i++) {
      body += `INV-${i},2026-07-01T10:00:00Z,Buyer,100,EG-1,1,1.00\n`;
    }

    const parse = new ImportParseService();
    let emitted = 0;
    const progressMarks: number[] = [];
    await parse.parseCsv(Readable.from([body]), {
      maxRows: 5000,
      onRow: () => {
        emitted += 1;
      },
      onProgress: (p) => {
        if (p.rowsEmitted % 500 === 0) progressMarks.push(p.rowsEmitted);
      },
    });

    expect(emitted).toBe(2500);
    expect(progressMarks.length).toBeGreaterThanOrEqual(4);
    expect(progressMarks[0]).toBeLessThan(2500);
  });
});
