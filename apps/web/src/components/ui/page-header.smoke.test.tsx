import { screen } from '@testing-library/react';
import { PageHeader } from './page-header';
import { renderUi } from './_test-utils';

describe('PageHeader', () => {
  it('renders title, subtitle, and actions', () => {
    renderUi(
      <PageHeader title="Documents" subtitle="This month" actions={<button type="button">New</button>} />,
    );
    expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
    expect(screen.getByText('This month')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });
});
