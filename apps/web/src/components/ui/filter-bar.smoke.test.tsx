import { fireEvent, screen } from '@testing-library/react';
import { FilterBar } from './filter-bar';
import { renderUi } from './_test-utils';

describe('FilterBar', () => {
  it('search, chips, and reset are operable', () => {
    const onSearch = jest.fn();
    const onChip = jest.fn();
    const onReset = jest.fn();
    renderUi(
      <FilterBar
        search=""
        onSearchChange={onSearch}
        onReset={onReset}
        chips={[{ id: 'all', label: 'All', count: 3, active: true, onClick: onChip }]}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'inv' } });
    expect(onSearch).toHaveBeenCalledWith('inv');
    fireEvent.click(screen.getByRole('button', { name: /all/i }));
    expect(onChip).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onReset).toHaveBeenCalled();
  });
});
