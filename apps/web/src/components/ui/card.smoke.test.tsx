import { screen } from '@testing-library/react';
import { Card, CardBody, CardTitle } from './card';
import { renderUi } from './_test-utils';

describe('Card', () => {
  it('renders title and body', () => {
    renderUi(
      <Card>
        <CardTitle>ETA</CardTitle>
        <CardBody>Connected</CardBody>
      </Card>,
    );
    expect(screen.getByText('ETA')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });
});
