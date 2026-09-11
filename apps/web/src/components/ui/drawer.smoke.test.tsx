import { fireEvent, screen } from '@testing-library/react';
import { Drawer } from './drawer';
import { renderUi } from './_test-utils';

describe('Drawer', () => {
  it('opens as a dialog and closes on Escape', () => {
    const onClose = jest.fn();
    renderUi(
      <Drawer open onClose={onClose} title="Edit">
        Form
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: 'Edit' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('places an on-dark drawer on the inline-start edge', () => {
    renderUi(
      <Drawer open onClose={() => undefined} title="Nav" side="start" tone="on-dark">
        Links
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Nav' });
    expect(dialog.className).toContain('start-0');
    expect(dialog.className).toContain('bg-navy');
  });
});
