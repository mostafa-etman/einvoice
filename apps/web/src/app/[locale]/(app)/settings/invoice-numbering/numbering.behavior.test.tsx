import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import {
  getInvoiceNumbering,
  upsertInvoiceNumbering,
} from '@/lib/api/invoice-numbering';
import InvoiceNumberingPage from './page';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

jest.mock('@/lib/api/invoice-numbering', () => ({
  getInvoiceNumbering: jest.fn(),
  upsertInvoiceNumbering: jest.fn(),
}));

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <InvoiceNumberingPage />
    </NextIntlClientProvider>,
  );
}

describe('invoice numbering form', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getInvoiceNumbering as jest.Mock).mockResolvedValue({
      prefix: 'INV-',
      padWidth: 6,
      startingNumber: 1,
      charset: 'NUMERIC',
      scope: 'TENANT',
      previewNext: 'INV-000001',
    });
    (upsertInvoiceNumbering as jest.Mock).mockResolvedValue({
      prefix: 'INV-',
      padWidth: 6,
      startingNumber: 1,
      charset: 'NUMERIC',
      scope: 'TENANT',
      previewNext: 'INV-000001',
    });
  });

  it('loads existing values before showing the form and keeps the save payload', async () => {
    renderPage();
    expect(screen.queryByDisplayValue('INV-')).not.toBeInTheDocument();
    expect(await screen.findByDisplayValue('INV-')).toBeInTheDocument();
    expect(screen.getByDisplayValue('6')).toBeInTheDocument();
    expect(screen.getByText(/INV-000001/)).toBeInTheDocument();

    screen.getByRole('button', { name: en.settingsNumbering.save }).click();
    await waitFor(() => {
      expect(upsertInvoiceNumbering).toHaveBeenCalledWith({
        prefix: 'INV-',
        padWidth: 6,
        startingNumber: 1,
        charset: 'NUMERIC',
        scope: 'TENANT',
      });
    });
    expect(await screen.findByText(en.settingsNumbering.saved)).toBeInTheDocument();
  });

  it('keeps the error visible after a failed save', async () => {
    (upsertInvoiceNumbering as jest.Mock).mockRejectedValue(new Error('scheme invalid'));
    renderPage();
    await screen.findByDisplayValue('INV-');
    screen.getByRole('button', { name: en.settingsNumbering.save }).click();
    expect(await screen.findByRole('alert')).toHaveTextContent('scheme invalid');
  });
});
