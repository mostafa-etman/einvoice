import { screen } from '@testing-library/react';
import { Field } from './field';
import { renderUi } from './_test-utils';

describe('Field', () => {
  it('renders label, control, and error', () => {
    renderUi(
      <Field label="Name" error="Required" htmlFor="name">
        <input id="name" />
      </Field>,
    );
    expect(screen.getByLabelText(/Name/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });
});
