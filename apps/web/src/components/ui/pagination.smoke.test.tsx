import { fireEvent, screen } from '@testing-library/react';
import { Pagination } from './pagination';
import { renderUi } from './_test-utils';

describe('Pagination', () => {
  it('moves pages with RTL-safe controls', () => {
    const onPageChange = jest.fn();
    renderUi(
      <Pagination page={2} pageCount={5} pageSize={10} onPageChange={onPageChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /previous/i }));
    expect(onPageChange).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });
});
