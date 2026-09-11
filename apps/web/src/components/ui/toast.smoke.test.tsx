import { fireEvent, screen } from '@testing-library/react';
import { Button } from './button';
import { useToast } from './toast';
import { renderUi } from './_test-utils';

function Trigger() {
  const { push } = useToast();
  return <Button onClick={() => push({ kind: 'success', title: 'Saved' })}>Notify</Button>;
}

describe('Toast', () => {
  it('announces a stacked message', () => {
    renderUi(<Trigger />);
    fireEvent.click(screen.getByRole('button', { name: 'Notify' }));
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });
});
