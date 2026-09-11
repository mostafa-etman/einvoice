import { screen } from '@testing-library/react';
import { Input } from './input';
import { renderUi } from './_test-utils';

describe('Input', () => {
  it('associates the label and shows an error', () => {
    renderUi(<Input label="Email" error="Required" />);
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });

  it('can be disabled', () => {
    renderUi(<Input label="Email" disabled />);
    expect(screen.getByLabelText('Email')).toBeDisabled();
  });

  it('uses LTR for technical input types', () => {
    renderUi(<Input label="Work email" type="email" />);
    expect(screen.getByLabelText('Work email')).toHaveAttribute('dir', 'ltr');
  });

  it('does not force direction on ordinary text', () => {
    renderUi(<Input label="Legal name" />);
    expect(screen.getByLabelText('Legal name')).not.toHaveAttribute('dir');
  });
});
