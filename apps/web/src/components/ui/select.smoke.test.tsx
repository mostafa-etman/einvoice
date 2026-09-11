import { screen } from '@testing-library/react';
import { Select } from './select';
import { renderUi } from './_test-utils';

describe('Select', () => {
  it('renders a labeled native select', () => {
    renderUi(
      <Select label="Env">
        <option>Sandbox</option>
      </Select>,
    );
    expect(screen.getByLabelText('Env')).toBeInTheDocument();
  });
});
