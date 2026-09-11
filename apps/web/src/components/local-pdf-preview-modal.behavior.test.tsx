import { fireEvent, screen, waitFor } from '@testing-library/react';
import { triggerBrowserDownload } from '@/lib/api/submissions';
import { LocalPdfPreviewModal } from './local-pdf-preview-modal';
import { renderUi } from './ui/_test-utils';

jest.mock('@/lib/api/submissions', () => ({
  triggerBrowserDownload: jest.fn(),
}));

const labels = {
  title: 'Preview / Print',
  closeLabel: 'Close',
  downloadLabel: 'Download PDF',
  loadingLabel: 'Loading preview…',
  errorFallback: 'Download failed',
};

describe('LocalPdfPreviewModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    URL.createObjectURL = jest.fn(() => 'blob:preview');
    URL.revokeObjectURL = jest.fn();
  });

  it('keeps download disabled while loading, exposes busy status, and closes on Escape', () => {
    const onClose = jest.fn();
    renderUi(
      <LocalPdfPreviewModal
        open
        {...labels}
        onClose={onClose}
        loadPdf={() => new Promise(() => {})}
      />,
    );
    expect(screen.getByRole('dialog', { name: labels.title })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(labels.loadingLabel)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: labels.downloadLabel })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('enables download after the blob loads and uses the existing download helper', async () => {
    const blob = new Blob(['pdf'], { type: 'application/pdf' });
    renderUi(
      <LocalPdfPreviewModal
        open
        {...labels}
        onClose={jest.fn()}
        loadPdf={async () => ({ blob, filename: 'doc.pdf' })}
      />,
    );
    const download = await waitFor(() => {
      const btn = screen.getByRole('button', { name: labels.downloadLabel });
      expect(btn).toBeEnabled();
      return btn;
    });
    fireEvent.click(download);
    expect(triggerBrowserDownload).toHaveBeenCalledWith(blob, 'doc.pdf');
    expect(screen.getByTitle(labels.title)).toHaveAttribute('src', 'blob:preview');
  });

  it('surfaces load failures as an alert without inventing a retry action', async () => {
    renderUi(
      <LocalPdfPreviewModal
        open
        {...labels}
        onClose={jest.fn()}
        loadPdf={async () => {
          throw new Error('preview exploded');
        }}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('preview exploded');
    expect(screen.getByRole('button', { name: labels.downloadLabel })).toBeDisabled();
  });
});
