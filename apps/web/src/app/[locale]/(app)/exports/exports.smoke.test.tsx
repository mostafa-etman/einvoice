import en from '@/messages/en.json';
import ar from '@/messages/ar.json';
import {
  packageStepIndex,
  PACKAGE_STEPS,
  type ExportJob,
} from '@/lib/api/exports';

const baseJob: ExportJob = {
  id: 'job-1',
  kind: 'ETA_PACKAGE',
  status: 'RUNNING',
  createdAt: '2026-08-01T00:00:00Z',
};

describe('ETA package progress steps', () => {
  it('has Requested → In progress → Ready → Downloaded labels in en + ar', () => {
    expect(PACKAGE_STEPS).toEqual([
      'REQUESTED',
      'IN_PROGRESS',
      'READY',
      'DOWNLOADED',
    ]);
    for (const messages of [en, ar]) {
      expect(messages.exports.stepRequested).toBeTruthy();
      expect(messages.exports.stepInProgress).toBeTruthy();
      expect(messages.exports.stepReady).toBeTruthy();
      expect(messages.exports.stepDownloaded).toBeTruthy();
      expect(messages.exports.rangeRequired).toBeTruthy();
      expect(messages.exports.packageFailed).toBeTruthy();
      expect(messages.exports.downloadFailed).toBeTruthy();
    }
  });

  it('advances through the ETA lifecycle', () => {
    expect(
      packageStepIndex({
        ...baseJob,
        etaPackage: {
          etaRequestId: 'PKG-1',
          localStatus: 'REQUESTED',
          etaStatusRaw: null,
          readyAt: null,
        },
      }),
    ).toBe(0);
    expect(
      packageStepIndex({
        ...baseJob,
        etaPackage: {
          etaRequestId: 'PKG-1',
          localStatus: 'IN_PROGRESS',
          etaStatusRaw: 1,
          readyAt: null,
        },
      }),
    ).toBe(1);
    expect(
      packageStepIndex({
        ...baseJob,
        status: 'READY',
        etaPackage: {
          etaRequestId: 'PKG-1',
          localStatus: 'READY',
          etaStatusRaw: 2,
          readyAt: '2026-08-01T01:00:00Z',
        },
      }),
    ).toBe(2);
    expect(packageStepIndex({ ...baseJob, status: 'READY' }, true)).toBe(3);
  });

  it('reports failure for ETA errors and for requests ETA never accepted', () => {
    expect(
      packageStepIndex({
        ...baseJob,
        status: 'FAILED',
        etaPackage: {
          etaRequestId: 'PKG-1',
          localStatus: 'ERROR',
          etaStatusRaw: 3,
          readyAt: null,
        },
      }),
    ).toBe(-1);
    expect(
      packageStepIndex({
        ...baseJob,
        status: 'FAILED',
        errorSummary: 'No documents were accepted by ETA in the selected date range.',
      }),
    ).toBe(-1);
  });
});
