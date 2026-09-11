import { fireEvent, screen } from '@testing-library/react';
import { Switch } from './switch';
import { renderUi } from './_test-utils';

describe('Switch', () => {
  it('toggles aria-checked from the keyboard', () => {
    const onCheckedChange = jest.fn();
    renderUi(<Switch checked={false} onCheckedChange={onCheckedChange} label="Dark" />);
    const control = screen.getByRole('switch', { name: 'Dark' });
    expect(control).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
