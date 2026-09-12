import { buildZipStore, safeInvoicePdfFilename } from './zip-store';

describe('zip-store', () => {
  it('builds a ZIP with the expected number of stored files', () => {
    const zip = buildZipStore([
      { name: 'a.pdf', body: Buffer.from('%PDF-a') },
      { name: 'b.pdf', body: Buffer.from('%PDF-b') },
    ]);
    expect(zip.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(zip.toString('latin1')).toContain('a.pdf');
    expect(zip.toString('latin1')).toContain('b.pdf');
  });

  it('sanitizes filenames and avoids duplicates and path traversal', () => {
    const used = new Set<string>();
    expect(safeInvoicePdfFilename('../etc/passwd', 'abc', used)).toBe(
      'etc_passwd-abc.pdf',
    );
    const second = safeInvoicePdfFilename('../etc/passwd', 'abc', used);
    expect(second).toBe('etc_passwd-abc-2.pdf');
    expect(second).not.toContain('..');
    expect(second).not.toContain('/');
  });
});
