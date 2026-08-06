import {
  ETA_INTERNAL_ID_MAX_LENGTH,
  formatInternalId,
  isPlausibleEtaDocumentReference,
  isValidEtaInternalId,
  validateInternalIdScheme,
} from './internal-id.js';

describe('ETA internalId validation', () => {
  it('accepts ETA-style examples', () => {
    expect(isValidEtaInternalId('AZ-24883')).toBe(true);
    expect(isValidEtaInternalId('PZ-234-A')).toBe(true);
    expect(isValidEtaInternalId('INV-000001')).toBe(true);
  });

  it('rejects empty, too long, and illegal chars', () => {
    expect(isValidEtaInternalId('')).toBe(false);
    expect(isValidEtaInternalId('-INV-1')).toBe(false);
    expect(isValidEtaInternalId('INV 1')).toBe(false);
    expect(isValidEtaInternalId('أ')).toBe(false);
    expect(isValidEtaInternalId('X'.repeat(ETA_INTERNAL_ID_MAX_LENGTH + 1))).toBe(
      false,
    );
  });

  it('rejects schemes that would exceed max length', () => {
    const issues = validateInternalIdScheme({
      prefix: 'VERY-LONG-PREFIX-XXXXXXXXXXXXXXXXXXXX-',
      padWidth: 12,
      startingNumber: 1,
      charset: 'NUMERIC',
    });
    expect(
      issues.some(
        (i) => i.code === 'SCHEME_TOO_LONG' || i.code === 'PREFIX_TOO_LONG',
      ),
    ).toBe(true);
  });

  it('accepts default INV- scheme', () => {
    const issues = validateInternalIdScheme({
      prefix: 'INV-',
      padWidth: 6,
      startingNumber: 1,
      charset: 'NUMERIC',
    });
    expect(issues).toEqual([]);
    expect(formatInternalId('INV-', 1, 6)).toBe('INV-000001');
  });

  it('accepts plausible ETA uuid / longId references', () => {
    expect(
      isPlausibleEtaDocumentReference('TZRKK8MFZCPSTW9XCYWBMKME11'),
    ).toBe(true);
    expect(
      isPlausibleEtaDocumentReference(
        'TZRKK8MFZCPSTW9XCYWBMKME10ABC1231602681697',
      ),
    ).toBe(true);
    expect(isPlausibleEtaDocumentReference('short')).toBe(false);
  });
});
