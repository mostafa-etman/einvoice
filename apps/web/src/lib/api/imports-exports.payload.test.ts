import { uploadImportFile, putImportMapping, runImportJob } from '@/lib/api/imports';
import {
  createEtaPackageExport,
  createLocalExport,
  downloadExportArtifact,
} from '@/lib/api/exports';

jest.mock('@/lib/session', () => ({
  getAccessToken: () => 'token-1',
  getActiveTenantId: () => 'tenant-1',
}));

describe('imports/exports API payloads', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_API_URL = 'https://api.localhost';
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('posts import FormData with file, documentType, and optional branchId', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'imp-1' }),
    });
    const file = new File(['a'], 'rows.csv', { type: 'text/csv' });
    await uploadImportFile({ file, documentType: 'C', branchId: 'branch-9' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.localhost/imports/jobs',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }),
    );
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get('file')).toBe(file);
    expect(body.get('documentType')).toBe('C');
    expect(body.get('branchId')).toBe('branch-9');
    expect(Array.from(body.keys()).sort()).toEqual(['branchId', 'documentType', 'file']);
  });

  it('omits branchId from FormData when it is not provided', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'imp-2' }),
    });
    const file = new File(['a'], 'rows.csv', { type: 'text/csv' });
    await uploadImportFile({ file, documentType: 'I' });
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get('branchId')).toBeNull();
    expect(Array.from(body.keys()).sort()).toEqual(['documentType', 'file']);
  });

  it('puts mapping as { fields } and runs with { runMode }', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 'imp-1' }),
    });
    await putImportMapping('imp-1', { internalID: 'id' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.localhost/imports/jobs/imp-1/mapping',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ fields: { internalID: 'id' } }),
      }),
    );
    await runImportJob('imp-1', 'CREATE_SIGN_SUBMIT');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.localhost/imports/jobs/imp-1/run',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ runMode: 'CREATE_SIGN_SUBMIT' }),
      }),
    );
  });

  it('posts local export and ETA package bodies unchanged', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 'exp-1' }),
    });
    await createLocalExport({
      formats: ['CSV', 'JSON'],
      locale: 'ar',
      filters: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-31T00:00:00.000Z' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.localhost/exports/local',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          formats: ['CSV', 'JSON'],
          locale: 'ar',
          filters: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-31T00:00:00.000Z' },
        }),
      }),
    );
    await createEtaPackageExport({
      dateFrom: '2026-02-01T00:00:00.000Z',
      dateTo: '2026-02-28T23:59:59.000Z',
      type: 'full',
      format: 'JSON',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.localhost/exports/packages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          dateFrom: '2026-02-01T00:00:00.000Z',
          dateTo: '2026-02-28T23:59:59.000Z',
          type: 'full',
          format: 'JSON',
        }),
      }),
    );
  });

  it('downloads export artifacts with optional format query', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['x']),
    });
    await downloadExportArtifact('exp-1', 'csv');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.localhost/exports/jobs/exp-1/download?format=csv',
      expect.objectContaining({ credentials: 'include' }),
    );
    await downloadExportArtifact('pkg-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.localhost/exports/jobs/pkg-1/download',
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
