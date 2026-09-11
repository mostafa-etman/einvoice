import { CopyableTenantId as CopyableTenantIdFromLegacy } from '@/components/copyable-tenant-id';
import { fireEvent, screen } from '@testing-library/react';
import { CopyButton, CopyableTenantId } from './copy-button';
import { renderUi } from './_test-utils';

describe('CopyButton', () => {
  it('copies the value and shows copied state', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderUi(<CopyButton value="abc-123" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('abc-123');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});

describe('CopyableTenantId', () => {
  it('keeps the existing public API', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderUi(<CopyableTenantId id="tenant-1" />);
    expect(screen.getByText(/Tenant ID/)).toBeInTheDocument();
    expect(screen.getByText('tenant-1')).toHaveAttribute('dir', 'ltr');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('tenant-1');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('re-exports from the legacy module path', () => {
    expect(CopyableTenantIdFromLegacy).toBe(CopyableTenantId);
  });

  it('renders nothing without an id', () => {
    const { container } = renderUi(<CopyableTenantId id={null} />);
    expect(container).toHaveTextContent('');
  });
});
