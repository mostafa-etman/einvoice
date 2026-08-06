import {
  isIssuerAddressComplete,
  missingIssuerAddressFields,
  normalizeIssuerAddress,
  resolveIssuerAddress,
} from './issuer-address.js';

const settings = {
  governate: 'Cairo',
  regionCity: 'Nasr City',
  street: 'Abbas El Akkad',
  buildingNumber: '12',
  postalCode: '11765',
};

describe('issuer address resolution', () => {
  it('inherits the full settings address when the document overrides nothing', () => {
    const resolved = resolveIssuerAddress(settings, undefined, {
      branchId: '3',
      country: 'EG',
    });
    expect(resolved).toMatchObject({ ...settings, branchId: '3', country: 'EG' });
    expect(isIssuerAddressComplete(resolved)).toBe(true);
  });

  it('keeps per-document overrides that carry a value', () => {
    const resolved = resolveIssuerAddress(settings, { street: 'Tahrir' });
    expect(resolved.street).toBe('Tahrir');
    expect(resolved.governate).toBe('Cairo');
  });

  it('never lets a blank override erase a settings value', () => {
    const resolved = resolveIssuerAddress(settings, {
      governate: '',
      regionCity: '   ',
      street: '',
      buildingNumber: '',
    });
    expect(resolved).toMatchObject(settings);
    expect(missingIssuerAddressFields(resolved)).toEqual([]);
  });

  it('defaults branchId and country when neither side supplies them', () => {
    const resolved = resolveIssuerAddress(settings, {});
    expect(resolved.branchId).toBe('0');
    expect(resolved.country).toBe('EG');
  });

  it('reports the exact missing fields when settings are incomplete', () => {
    const resolved = resolveIssuerAddress(
      { governate: 'Cairo' },
      { street: 'Tahrir' },
    );
    expect(missingIssuerAddressFields(resolved)).toEqual([
      'regionCity',
      'buildingNumber',
    ]);
    expect(isIssuerAddressComplete(resolved)).toBe(false);
  });

  it('trims values and drops blanks when normalizing', () => {
    expect(normalizeIssuerAddress({ street: '  Tahrir  ', floor: '' })).toEqual({
      street: 'Tahrir',
    });
  });
});
