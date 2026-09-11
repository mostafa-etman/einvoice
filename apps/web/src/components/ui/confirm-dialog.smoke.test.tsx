import { fireEvent, screen } from '@testing-library/react';
import { ConfirmDialog } from './confirm-dialog';
import { renderUi } from './_test-utils';

describe('ConfirmDialog', () => {
  it('blocks confirm until the typed value matches', () => {
    const onConfirm = jest.fn();
    renderUi(
      <ConfirmDialog
        open
        onClose={() => undefined}
        onConfirm={onConfirm}
        typedConfirmation="DELETE"
      />,
    );
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/DELETE/), { target: { value: 'DELETE' } });
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
