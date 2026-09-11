import { screen } from '@testing-library/react';
import { StatCard } from './stat-card';
import { renderUi } from './_test-utils';

describe('StatCard', () => {
  it('renders label, value, and delta', () => {
    renderUi(
      <StatCard label="Documents" value="1,284" delta={{ direction: 'up', label: '12.4%' }} />,
    );
    expect(screen.getByText('Documents')).toBeInTheDocument();
    expect(screen.getByText('1,284')).toBeInTheDocument();
    expect(screen.getByText('12.4%')).toBeInTheDocument();
  });
});
