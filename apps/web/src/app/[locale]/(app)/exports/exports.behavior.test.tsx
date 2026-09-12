import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';
import {
  createEtaPackageExport,
  createLocalExport,
  downloadExportArtifact,
  getExportJob,
  listExportJobs,
  type ExportJob,
} from '@/lib/api/exports';
import ExportsPage from './page';

jest.mock('@/lib/api/exports', () => {
  const actual = jest.requireActual('@/lib/api/exports');
  return {
    ...actual,
    listExportJobs: jest.fn(),
    getExportJob: jest.fn(),
    createLocalExport: jest.fn(),
    createEtaPackageExport: jest.fn(),
    downloadExportArtifact: jest.fn(),
  };
});

function job(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    id: 'exp-1',
    kind: 'LOCAL',
    status: 'READY',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage(locale: 'en' | 'ar' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
      <ExportsPage />
    </NextIntlClientProvider>,
  );
}

describe('exports page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    (listExportJobs as jest.Mock).mockResolvedValue({ items: [] });
    (getExportJob as jest.Mock).mockResolvedValue(job());
    (createLocalExport as jest.Mock).mockResolvedValue(job({ status: 'RUNNING' }));
    (createEtaPackageExport as jest.Mock).mockResolvedValue(
      job({ id: 'pkg-1', kind: 'ETA_PACKAGE', status: 'RUNNING' }),
    );
    (downloadExportArtifact as jest.Mock).mockResolvedValue(new Blob(['x']));
    URL.createObjectURL = jest.fn(() => 'blob:export');
    URL.revokeObjectURL = jest.fn();
  });

  it('renders the exports title', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: en.exports.title })).toBeInTheDocument();
  });

  it('shows loading instead of empty while jobs are in flight', () => {
    (listExportJobs as jest.Mock).mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByText(en.exports.noJobs)).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('shows empty history when there are no jobs', async () => {
    renderPage();
    expect(await screen.findByText(en.exports.noJobs)).toBeInTheDocument();
  });

  it('lists jobs without a kind filter and keeps package progress test ids', async () => {
    (listExportJobs as jest.Mock).mockResolvedValue({
      items: [
        job(),
        job({
          id: 'pkg-1',
          kind: 'ETA_PACKAGE',
          status: 'RUNNING',
          etaPackage: {
            etaRequestId: 'ETA-1',
            localStatus: 'IN_PROGRESS',
            etaStatusRaw: 1,
            readyAt: null,
          },
        }),
      ],
    });
    renderPage();
    expect(await screen.findByText('LOCAL')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('ETA_PACKAGE')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByTestId('package-progress-pkg-1')).toBeInTheDocument();
    expect(listExportJobs).toHaveBeenCalledWith();
  });

  it('creates a local export with formats, ISO date filters, and All document types', async () => {
    (getExportJob as jest.Mock).mockResolvedValue(job({ status: 'READY' }));
    renderPage();
    await screen.findByText(en.exports.noJobs);
    fireEvent.change(screen.getByLabelText(en.exports.from), {
      target: { value: '2026-01-01' },
    });
    fireEvent.change(screen.getByLabelText(en.exports.to), {
      target: { value: '2026-01-31' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.exports.createLocal }));
    await waitFor(() => {
      expect(createLocalExport).toHaveBeenCalledWith({
        formats: ['CSV', 'JSON'],
        filters: {
          from: '2026-01-01T00:00:00.000+02:00',
          to: '2026-01-31T23:59:59.999+02:00',
          documentTypes: [
            'INVOICE',
            'CREDIT_NOTE',
            'DEBIT_NOTE',
            'EXPORT_INVOICE',
            'EXPORT_CREDIT_NOTE',
            'EXPORT_DEBIT_NOTE',
            'PURCHASE_INVOICE',
            'PURCHASE_RETURN',
            'OTHER_RECEIVED',
          ],
        },
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1000));
    });
    await waitFor(() => {
      expect(getExportJob).toHaveBeenCalledWith('exp-1');
    });
  });

  it('exports sales or purchases using existing documentTypes kinds', async () => {
    (getExportJob as jest.Mock).mockResolvedValue(job({ status: 'READY' }));
    renderPage();
    await screen.findByText(en.exports.noJobs);
    expect(screen.getByRole('radio', { name: en.exports.documentTypeAll })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: en.exports.documentTypeSales }));
    fireEvent.click(screen.getByRole('button', { name: en.exports.createLocal }));
    await waitFor(() => {
      expect(createLocalExport).toHaveBeenCalledWith({
        formats: ['CSV', 'JSON'],
        filters: {
          from: undefined,
          to: undefined,
          documentTypes: [
            'INVOICE',
            'CREDIT_NOTE',
            'DEBIT_NOTE',
            'EXPORT_INVOICE',
            'EXPORT_CREDIT_NOTE',
            'EXPORT_DEBIT_NOTE',
          ],
        },
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1000));
    });
    fireEvent.click(screen.getByRole('radio', { name: en.exports.documentTypePurchases }));
    fireEvent.click(screen.getByRole('button', { name: en.exports.createLocal }));
    await waitFor(() => {
      expect(createLocalExport).toHaveBeenLastCalledWith({
        formats: ['CSV', 'JSON'],
        filters: {
          from: undefined,
          to: undefined,
          documentTypes: [
            'PURCHASE_INVOICE',
            'PURCHASE_RETURN',
            'OTHER_RECEIVED',
          ],
        },
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1000));
    });
  });

  it('disables local export when no formats are selected', async () => {
    renderPage();
    await screen.findByText(en.exports.noJobs);
    fireEvent.click(screen.getByLabelText('CSV'));
    fireEvent.click(screen.getByLabelText('JSON'));
    expect(screen.getByRole('button', { name: en.exports.createLocal })).toBeDisabled();
  });

  it('requires a date range before requesting an ETA package', async () => {
    renderPage();
    await screen.findByText(en.exports.noJobs);
    expect(screen.getByRole('button', { name: en.exports.createPackage })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: en.exports.createPackage }));
    expect(createEtaPackageExport).not.toHaveBeenCalled();
  });

  it('requests an ETA package with type full, format JSON, and end-of-day dateTo', async () => {
    (getExportJob as jest.Mock).mockResolvedValue(
      job({ id: 'pkg-1', kind: 'ETA_PACKAGE', status: 'READY' }),
    );
    renderPage();
    await screen.findByText(en.exports.noJobs);
    fireEvent.change(screen.getByLabelText(en.exports.from), {
      target: { value: '2026-02-01' },
    });
    fireEvent.change(screen.getByLabelText(en.exports.to), {
      target: { value: '2026-02-28' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.exports.createPackage }));
    await waitFor(() => {
      expect(createEtaPackageExport).toHaveBeenCalledWith({
        dateFrom: new Date('2026-02-01').toISOString(),
        dateTo: new Date('2026-02-28T23:59:59').toISOString(),
        type: 'full',
        format: 'JSON',
      });
    });
  });

  it('downloads local and ETA artifacts with the existing filenames', async () => {
    const orig = document.createElement.bind(document);
    const anchors: HTMLAnchorElement[] = [];
    const createSpy = jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = orig(tag);
      if (tag === 'a') anchors.push(el as HTMLAnchorElement);
      return el;
    });
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    (listExportJobs as jest.Mock).mockResolvedValue({
      items: [
        job(),
        job({ id: 'pkg-1', kind: 'ETA_PACKAGE', status: 'READY' }),
      ],
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: `${en.exports.download} CSV` }));
    await waitFor(() => {
      expect(downloadExportArtifact).toHaveBeenCalledWith('exp-1', 'csv');
    });
    expect(anchors.map((a) => a.download)).toContain('export-exp-1.csv');
    fireEvent.click(screen.getByRole('button', { name: `${en.exports.download} ZIP` }));
    await waitFor(() => {
      expect(downloadExportArtifact).toHaveBeenCalledWith('pkg-1', undefined);
    });
    expect(anchors.map((a) => a.download)).toContain('eta-package-pkg-1.zip');
    click.mockRestore();
    createSpy.mockRestore();
  });

  it('retries a failed jobs load', async () => {
    (listExportJobs as jest.Mock)
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ items: [job()] });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('down');
    expect(screen.queryByText(en.exports.noJobs)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.exports.retryLoad }));
    expect(await screen.findByText('LOCAL')).toBeInTheDocument();
  });

  it('shows a mutation error without a list retry', async () => {
    (createLocalExport as jest.Mock).mockRejectedValue(new Error('export down'));
    renderPage();
    await screen.findByText(en.exports.noJobs);
    fireEvent.click(screen.getByRole('button', { name: en.exports.createLocal }));
    expect(await screen.findByRole('alert')).toHaveTextContent('export down');
    expect(screen.queryByRole('button', { name: en.exports.retryLoad })).not.toBeInTheDocument();
  });

  it('keeps Arabic chrome RTL while kinds stay LTR', async () => {
    (listExportJobs as jest.Mock).mockResolvedValue({ items: [job()] });
    renderPage('ar');
    expect(await screen.findByRole('heading', { level: 1, name: ar.exports.title })).toBeInTheDocument();
    expect(await screen.findByText('LOCAL')).toHaveAttribute('dir', 'ltr');
  });
});
