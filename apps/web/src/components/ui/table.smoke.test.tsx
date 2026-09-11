import { screen } from '@testing-library/react';
import { Table } from './table';
import { renderUi } from './_test-utils';

describe('Table', () => {
  it('exposes a caption and column headers', () => {
    renderUi(
      <Table
        caption="Documents"
        columns={[
          { id: 'name', header: 'Name', cell: (r: { name: string }) => r.name },
        ]}
        rows={[{ name: 'Al-Noor' }]}
        getRowId={(r) => r.name}
      />,
    );
    expect(screen.getByRole('table', { name: 'Documents' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('scope', 'col');
    expect(screen.getByText('Al-Noor')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Documents' }).parentElement?.className).toContain(
      '[&_th:first-child]:sticky',
    );
  });

  it('keeps technical cells LTR', () => {
    renderUi(
      <Table
        caption="Codes"
        columns={[
          { id: 'code', header: 'Code', ltr: true, cell: (r: { code: string }) => r.code },
        ]}
        rows={[{ code: 'EGS-1' }]}
        getRowId={(r) => r.code}
      />,
    );
    expect(screen.getByText('EGS-1').closest('td')).toHaveAttribute('dir', 'ltr');
  });

  it('renders skeleton rows while loading', () => {
    renderUi(
      <Table
        caption="Documents"
        columns={[{ id: 'name', header: 'Name', cell: () => null }]}
        rows={[]}
        getRowId={() => 'x'}
        loading
        loadingRowCount={2}
      />,
    );
    expect(screen.queryByText('No rows')).not.toBeInTheDocument();
  });
});
