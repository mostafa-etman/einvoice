import { ALL_PERMISSION_CODES } from '@einvoice/shared';
import { getPermissionLabels } from './permission-labels';

describe('permission display labels', () => {
  it('covers every permission code in English and Arabic', () => {
    const en = getPermissionLabels('en');
    const ar = getPermissionLabels('ar');

    expect(ALL_PERMISSION_CODES.length).toBeGreaterThan(0);

    for (const code of ALL_PERMISSION_CODES) {
      expect(en[code]?.trim()).toBeTruthy();
      expect(ar[code]?.trim()).toBeTruthy();
    }
  });

  it('falls back to the default locale for unknown locales', () => {
    expect(getPermissionLabels('fr')).toEqual(getPermissionLabels('ar'));
  });
});
