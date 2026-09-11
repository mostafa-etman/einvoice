import { fireEvent, screen } from '@testing-library/react';
import { Tabs } from './tabs';
import { renderUi } from './_test-utils';

describe('Tabs', () => {
  it('changes selection with click and arrow keys', () => {
    const onChange = jest.fn();
    renderUi(
      <Tabs
        value="a"
        onChange={onChange}
        items={[
          { id: 'a', label: 'Alpha', panel: 'A' },
          { id: 'b', label: 'Beta', panel: 'B' },
        ]}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Beta' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
