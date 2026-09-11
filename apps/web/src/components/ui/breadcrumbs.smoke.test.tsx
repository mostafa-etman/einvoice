import type { ReactNode } from 'react';
import { screen } from '@testing-library/react';
import { Breadcrumbs } from './breadcrumbs';
import { renderUi } from './_test-utils';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('Breadcrumbs', () => {
  it('marks the current page', () => {
    renderUi(
      <Breadcrumbs items={[{ label: 'Home', href: '/ar' }, { label: 'Documents' }]} />,
    );
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    expect(screen.getByText('Documents')).toHaveAttribute('aria-current', 'page');
  });
});
