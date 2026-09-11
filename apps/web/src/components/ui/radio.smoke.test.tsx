import { screen } from '@testing-library/react';
import { Radio } from './radio';
import { renderUi } from './_test-utils';

describe('Radio', () => {
  it('renders with an accessible name', () => {
    renderUi(<Radio name="env" label="Sandbox" />);
    expect(screen.getByRole('radio', { name: 'Sandbox' })).toBeInTheDocument();
  });
});
