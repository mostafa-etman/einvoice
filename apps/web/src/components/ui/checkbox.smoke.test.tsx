import { screen } from '@testing-library/react';
import { Checkbox } from './checkbox';
import { renderUi } from './_test-utils';

describe('Checkbox', () => {
  it('renders with an accessible name', () => {
    renderUi(<Checkbox label="Remember me" />);
    expect(screen.getByRole('checkbox', { name: 'Remember me' })).toBeInTheDocument();
  });
});
