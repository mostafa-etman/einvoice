import { resolveDocumentStatus } from './document-status-display';

describe('resolveDocumentStatus', () => {
  it('shows VALID when a sales-synced draft has ETA status Valid', () => {
    expect(resolveDocumentStatus('DRAFT', 'Valid')).toBe('VALID');
  });

  it('keeps CANCELLED when ETA says cancelled', () => {
    expect(resolveDocumentStatus('VALID', 'Cancelled')).toBe('CANCELLED');
  });

  it('does not upgrade a local draft without ETA status', () => {
    expect(resolveDocumentStatus('DRAFT', null)).toBe('DRAFT');
  });
});
