import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';
import { IMPORT_REQUIRED_FIELDS } from '@/lib/imports/import-columns';
import {
  downloadImportErrorReport,
  downloadImportTemplate,
  getImportJob,
  listImportJobs,
  listImportRows,
  putImportMapping,
  runImportJob,
  uploadImportFile,
  validateImportJob,
  type ImportJob,
} from '@/lib/api/imports';
import { listBranches } from '@/lib/api/branches';
import ImportsPage from './page';

jest.mock('@/lib/tenant-provider', () => ({
  useTenant: () => ({
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    memberships: [],
    branches: [],
    setTenantId: jest.fn(),
    setBranchId: jest.fn(),
    roleName: 'Owner',
  }),
}));

jest.mock('@/lib/api/imports', () => ({
  listImportJobs: jest.fn(),
  getImportJob: jest.fn(),
  listImportRows: jest.fn(),
  uploadImportFile: jest.fn(),
  putImportMapping: jest.fn(),
  validateImportJob: jest.fn(),
  runImportJob: jest.fn(),
  downloadImportTemplate: jest.fn(),
  downloadImportErrorReport: jest.fn(),
}));

jest.mock('@/lib/api/branches', () => ({
  listBranches: jest.fn(),
}));

const filledMapping = Object.fromEntries(
  IMPORT_REQUIRED_FIELDS.map((field) => [field, field]),
);

function job(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'imp-1',
    status: 'UPLOADED',
    documentType: 'I',
    runMode: null,
    totalRows: 2,
    validRows: 0,
    invalidRows: 0,
    createdDocs: 0,
    signEnqueued: 0,
    failedRows: 0,
    sourceFileName: 'invoices.csv',
    mappingJson: filledMapping,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage(locale: 'en' | 'ar' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
      <ImportsPage />
    </NextIntlClientProvider>,
  );
}

function fileInput() {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

describe('imports page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    (listImportJobs as jest.Mock).mockResolvedValue({ items: [] });
    (listBranches as jest.Mock).mockResolvedValue([
      {
        id: 'branch-1',
        name: 'HQ',
        isDefault: true,
        isActive: true,
        etaBranchCode: '0',
        activityCode: null,
        defaultCurrencyCode: 'EGP',
        address: {},
        addressComplete: true,
      },
    ]);
    (getImportJob as jest.Mock).mockResolvedValue(job());
    (listImportRows as jest.Mock).mockResolvedValue({ items: [] });
    (uploadImportFile as jest.Mock).mockResolvedValue(job());
    (putImportMapping as jest.Mock).mockResolvedValue(job());
    (validateImportJob as jest.Mock).mockResolvedValue(job({ status: 'VALIDATING' }));
    (runImportJob as jest.Mock).mockResolvedValue(job({ status: 'RUNNING' }));
    (downloadImportTemplate as jest.Mock).mockResolvedValue(new Blob(['a']));
    (downloadImportErrorReport as jest.Mock).mockResolvedValue(new Blob(['e']));
    URL.createObjectURL = jest.fn(() => 'blob:import');
    URL.revokeObjectURL = jest.fn();
  });

  it('renders the imports title', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: en.imports.title })).toBeInTheDocument();
  });

  it('shows loading instead of empty while jobs are in flight', () => {
    (listImportJobs as jest.Mock).mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByText(en.imports.noJobs)).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('shows empty history when there are no jobs', async () => {
    renderPage();
    expect(await screen.findByText(en.imports.noJobs)).toBeInTheDocument();
  });

  it('renders job filename and status as LTR technical values', async () => {
    (listImportJobs as jest.Mock).mockResolvedValue({
      items: [job({ status: 'SUCCEEDED', validRows: 2, totalRows: 2 })],
    });
    renderPage();
    expect(await screen.findByText('invoices.csv')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('SUCCEEDED')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('2/2')).toHaveAttribute('dir', 'ltr');
  });

  it('uploads with file, documentType, and branchId', async () => {
    renderPage();
    await screen.findByRole('option', { name: 'HQ (default)' });
    const file = new File(['internalID'], 'batch.csv', { type: 'text/csv' });
    fireEvent.change(fileInput(), { target: { files: [file] } });
    await waitFor(() => {
      expect(uploadImportFile).toHaveBeenCalledWith({
        file,
        documentType: 'I',
        branchId: 'branch-1',
      });
    });
  });

  it('does not upload a rejected file type', async () => {
    renderPage();
    await screen.findByText(en.imports.noJobs);
    const file = new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput(), { target: { files: [file] } });
    await waitFor(() => expect(listBranches).toHaveBeenCalled());
    expect(uploadImportFile).not.toHaveBeenCalled();
  });

  it('blocks validate when required fields are unmapped', async () => {
    (listImportJobs as jest.Mock).mockResolvedValue({
      items: [job({ mappingJson: {} })],
    });
    (getImportJob as jest.Mock).mockResolvedValue(job({ mappingJson: {} }));
    renderPage();
    fireEvent.click(await screen.findByText('invoices.csv'));
    fireEvent.click(await screen.findByRole('button', { name: en.imports.validate }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.imports.requiredUnmapped);
    expect(putImportMapping).not.toHaveBeenCalled();
    expect(validateImportJob).not.toHaveBeenCalled();
  });

  it('validates with mapping then polls until VALIDATED', async () => {
    const uploaded = job({ status: 'UPLOADED' });
    const validated = job({
      status: 'VALIDATED',
      validRows: 2,
      invalidRows: 0,
      totalRows: 2,
    });
    (listImportJobs as jest.Mock).mockResolvedValue({ items: [uploaded] });
    (getImportJob as jest.Mock)
      .mockResolvedValueOnce(uploaded)
      .mockResolvedValue(validated);
    renderPage();
    fireEvent.click(await screen.findByText('invoices.csv'));
    fireEvent.click(await screen.findByRole('button', { name: en.imports.validate }));
    await waitFor(() => {
      expect(putImportMapping).toHaveBeenCalledWith('imp-1', filledMapping);
      expect(validateImportJob).toHaveBeenCalledWith('imp-1');
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    await waitFor(() => {
      expect(getImportJob).toHaveBeenCalledWith('imp-1');
    });
  });

  it('runs CREATE_ONLY with the existing payload', async () => {
    const validated = job({
      status: 'VALIDATED',
      validRows: 2,
      invalidRows: 0,
      totalRows: 2,
    });
    (listImportJobs as jest.Mock).mockResolvedValue({ items: [validated] });
    (getImportJob as jest.Mock)
      .mockResolvedValueOnce(validated)
      .mockResolvedValue(job({ status: 'SUCCEEDED', validRows: 2, createdDocs: 2 }));
    renderPage();
    fireEvent.click(await screen.findByText('invoices.csv'));
    fireEvent.click(await screen.findByRole('button', { name: en.imports.runCreateOnly }));
    await waitFor(() => {
      expect(runImportJob).toHaveBeenCalledWith('imp-1', 'CREATE_ONLY');
    });
  });

  it('runs CREATE_SIGN_SUBMIT with the existing payload', async () => {
    const validated = job({
      status: 'VALIDATED',
      validRows: 2,
      invalidRows: 0,
      totalRows: 2,
    });
    (listImportJobs as jest.Mock).mockResolvedValue({ items: [validated] });
    (getImportJob as jest.Mock)
      .mockResolvedValueOnce(validated)
      .mockResolvedValue(job({ status: 'SUCCEEDED', validRows: 2, createdDocs: 2 }));
    renderPage();
    fireEvent.click(await screen.findByText('invoices.csv'));
    fireEvent.click(await screen.findByRole('button', { name: en.imports.runSignSubmit }));
    await waitFor(() => {
      expect(runImportJob).toHaveBeenCalledWith('imp-1', 'CREATE_SIGN_SUBMIT');
    });
  });

  it('surfaces a server upload error without retrying the list', async () => {
    (uploadImportFile as jest.Mock).mockRejectedValue(new Error('disk full'));
    renderPage();
    await screen.findByText(en.imports.noJobs);
    const file = new File(['x'], 'ok.csv', { type: 'text/csv' });
    fireEvent.change(fileInput(), { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full');
    expect(screen.queryByRole('button', { name: en.imports.retryLoad })).not.toBeInTheDocument();
  });

  it('retries a failed jobs load', async () => {
    (listImportJobs as jest.Mock)
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ items: [job({ status: 'FAILED' })] });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('down');
    expect(screen.queryByText(en.imports.noJobs)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.imports.retryLoad }));
    expect(await screen.findByText('invoices.csv')).toBeInTheDocument();
  });

  it('downloads templates and error reports with the existing filenames', async () => {
    const orig = document.createElement.bind(document);
    const anchors: HTMLAnchorElement[] = [];
    const createSpy = jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = orig(tag);
      if (tag === 'a') anchors.push(el as HTMLAnchorElement);
      return el;
    });
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const validated = job({
      status: 'FAILED',
      validRows: 0,
      invalidRows: 1,
      errorReportAvailable: true,
    });
    (listImportJobs as jest.Mock).mockResolvedValue({ items: [validated] });
    (getImportJob as jest.Mock).mockResolvedValue(validated);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: `${en.imports.downloadTemplate} (${en.imports.csv})` }));
    await waitFor(() => {
      expect(downloadImportTemplate).toHaveBeenCalledWith('I', 'csv');
    });
    expect(anchors.map((a) => a.download)).toContain('import-template-I.csv');
    fireEvent.click(screen.getByRole('button', { name: `${en.imports.downloadTemplate} (${en.imports.xlsx})` }));
    await waitFor(() => {
      expect(downloadImportTemplate).toHaveBeenCalledWith('I', 'xlsx');
    });
    expect(anchors.map((a) => a.download)).toContain('import-template-I.xlsx');
    fireEvent.click(await screen.findByText('invoices.csv'));
    fireEvent.click(await screen.findByRole('button', { name: en.imports.downloadErrors }));
    await waitFor(() => {
      expect(downloadImportErrorReport).toHaveBeenCalledWith('imp-1');
    });
    expect(anchors.map((a) => a.download)).toContain('import-imp-1-errors.csv');
    click.mockRestore();
    createSpy.mockRestore();
  });

  it('keeps Arabic chrome RTL while filenames stay LTR', async () => {
    (listImportJobs as jest.Mock).mockResolvedValue({ items: [job()] });
    renderPage('ar');
    expect(await screen.findByRole('heading', { level: 1, name: ar.imports.title })).toBeInTheDocument();
    expect(screen.getByText('invoices.csv')).toHaveAttribute('dir', 'ltr');
  });
});
