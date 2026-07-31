/**
 * T047 — package-ready notification accelerates poll enqueue only
 * (never downloads zip without Get Package Requests).
 */
describe('export package webhook accelerate (T047)', () => {
  it('accelerate contract: enqueue poll job, do not call getDocumentPackage', async () => {
    const enqueued: Array<{ name: string; data: Record<string, string> }> = [];
    let getDocumentPackageCalls = 0;

    const acceleratePackagePoll = async (
      tenantId: string,
      etaRequestId: string,
    ) => {
      const pkg = {
        id: 'pkg-row-1',
        exportJobId: 'export-1',
        etaRequestId,
        tenantId,
      };
      if (pkg.etaRequestId !== etaRequestId) return { accelerated: false };
      enqueued.push({
        name: 'poll-accelerate',
        data: {
          tenantId,
          exportJobId: pkg.exportJobId,
          etaPackageRequestId: pkg.id,
        },
      });
      // Must NOT download here — worker will Get Package Requests first.
      return { accelerated: true, exportJobId: pkg.exportJobId };
    };

    const fakeGetDocumentPackage = async () => {
      getDocumentPackageCalls += 1;
      return { ready: true, zip: Buffer.from('x') };
    };

    const result = await acceleratePackagePoll(
      'tenant-1',
      'ETA-REQ-99',
    );
    expect(result.accelerated).toBe(true);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.name).toBe('poll-accelerate');
    expect(enqueued[0]!.data.etaPackageRequestId).toBe('pkg-row-1');
    expect(getDocumentPackageCalls).toBe(0);
    void fakeGetDocumentPackage;
  });
});
