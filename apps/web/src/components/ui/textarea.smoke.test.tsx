import { screen } from '@testing-library/react';
import { Textarea } from './textarea';
import { renderUi } from './_test-utils';

describe('Textarea', () => {
  it('renders a labeled control', () => {
    renderUi(<Textarea label="Notes" />);
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
  });
});
