import { fireEvent, screen } from '@testing-library/react';
import { DropdownMenu } from './dropdown-menu';
import { renderUi } from './_test-utils';

describe('DropdownMenu', () => {
  it('opens, lists items, and closes after select', () => {
    const onSelect = jest.fn();
    renderUi(
      <DropdownMenu
        label="More"
        items={[{ id: 'edit', label: 'Edit', onSelect }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onSelect).toHaveBeenCalled();
  });
});
