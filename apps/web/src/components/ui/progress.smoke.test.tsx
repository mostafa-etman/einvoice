import { screen } from '@testing-library/react';
import { Progress } from './progress';
import { renderUi } from './_test-utils';

describe('Progress', () => {
  it('exposes progressbar semantics', () => {
    renderUi(<Progress value={40} max={100} label="Upload" />);
    const bar = screen.getByRole('progressbar', { name: 'Upload' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
  });
});
