import { screen } from '@testing-library/react';
import { EmptyState } from './empty-state';
import { renderUi } from './_test-utils';

describe('EmptyState', () => {
  it('renders a title and primary action', () => {
    renderUi(
      <EmptyState title="No documents yet" action={{ label: 'Create', onClick: () => undefined }} />,
    );
    expect(screen.getByText('No documents yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });
});
