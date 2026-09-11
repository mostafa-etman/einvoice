import { screen } from '@testing-library/react';
import { Badge } from './badge';
import { renderUi } from './_test-utils';

describe('Badge', () => {
  it('renders ETA status variants', () => {
    renderUi(<Badge variant="valid">Valid</Badge>);
    expect(screen.getByText('Valid')).toBeInTheDocument();
  });
});
