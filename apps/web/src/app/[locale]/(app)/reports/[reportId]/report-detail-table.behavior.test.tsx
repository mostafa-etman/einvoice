import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { ReportDetailDocumentsTable } from './report-detail-table';

function renderTable() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ReportDetailDocumentsTable
        side="sales"
        rows={[
          {
            id: 'doc-1',
            internalId: 'INV-1',
            kind: 'INVOICE',
            receiverName: 'Acme',
            netAmount: '100',
            lines: [{ itemName: 'Widget', quantity: '1', total: '100' }],
          },
        ]}
        sortBy="internalId"
        sortDir="asc"
        onSort={jest.fn()}
        hasMore={false}
        loadingMore={false}
        onLoadMore={jest.fn()}
        documentCount={1}
      />
    </NextIntlClientProvider>,
  );
}

describe('ReportDetailDocumentsTable expand control', () => {
  it('names the expand control and toggles line items without changing row identity', () => {
    renderTable();
    const expand = screen.getByRole('button', {
      name: en.reports.detail.expandRow.replace('{id}', 'INV-1'),
    });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Widget')).not.toBeInTheDocument();
    fireEvent.click(expand);
    expect(
      screen.getByRole('button', {
        name: en.reports.detail.collapseRow.replace('{id}', 'INV-1'),
      }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Widget')).toBeInTheDocument();
  });
});
