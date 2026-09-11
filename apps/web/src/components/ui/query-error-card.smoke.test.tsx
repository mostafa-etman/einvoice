import { fireEvent, screen } from '@testing-library/react';
import { QueryErrorCard } from './query-error-card';
import { renderUi } from './_test-utils';

describe('QueryErrorCard', () => {
  it('exposes the error and retries', () => {
    const onRetry = jest.fn();
    renderUi(
      <QueryErrorCard message="Request failed" retryLabel="Retry" onRetry={onRetry} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Request failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
