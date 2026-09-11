import { screen } from '@testing-library/react';
import { XiraLogo } from '@/components/brand/xira-logo';
import { renderUi } from '@/components/ui/_test-utils';

describe('XiraLogo', () => {
  it('renders the wordmark for both variants', () => {
    renderUi(
      <>
        <XiraLogo variant="on-dark" />
        <XiraLogo variant="on-light" />
      </>,
    );
    expect(screen.getAllByText('XIRA').length).toBe(2);
    expect(screen.getAllByText('SMART TAX & BUSINESS SUITE').length).toBe(2);
  });
});
