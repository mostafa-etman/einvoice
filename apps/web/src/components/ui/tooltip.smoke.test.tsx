import { fireEvent, screen } from '@testing-library/react';
import { Button } from './button';
import { Tooltip } from './tooltip';
import { renderUi } from './_test-utils';

describe('Tooltip', () => {
  it('describes the trigger after the delay', async () => {
    renderUi(
      <Tooltip content="Helpful" delayMs={0}>
        <Button>Hint</Button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button', { name: 'Hint' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Helpful');
  });
});
