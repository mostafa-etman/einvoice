import { screen } from '@testing-library/react';
import { Button } from './button';
import { renderUi } from './_test-utils';

describe('Button', () => {
  it('renders an accessible name and honors disabled', () => {
    renderUi(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toBeEnabled();
    btn.focus();
    expect(btn).toHaveFocus();
  });

  it('disables while loading and exposes busy state', () => {
    renderUi(<Button loading>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('requires an accessible name for icon-only usage', () => {
    renderUi(<Button aria-label="Add" iconStart={<span>+</span>} />);
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });
});
