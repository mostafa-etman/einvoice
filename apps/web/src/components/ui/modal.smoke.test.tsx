import { fireEvent, screen } from '@testing-library/react';
import { Modal } from './modal';
import { renderUi } from './_test-utils';

describe('Modal', () => {
  it('traps focus and closes on Escape', () => {
    const onClose = jest.fn();
    renderUi(
      <Modal open onClose={onClose} title="Details">
        <button type="button">Inside</button>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Details' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
