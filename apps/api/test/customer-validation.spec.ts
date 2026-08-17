import { BadRequestException } from '@nestjs/common';
import {
  customerToEtaReceiver,
  normalizeCustomerWrite,
} from '../src/customers/customer-validation';

describe('customer-validation', () => {
  const baseAddress = {
    country: 'EG',
    governate: 'Cairo',
    regionCity: 'Nasr City',
    street: 'Abbas El Akkad',
    buildingNumber: '12',
  };

  it('accepts a valid Egyptian company (B)', () => {
    const row = normalizeCustomerWrite({
      type: 'B',
      registrationId: '123456789',
      name: 'شركة الاختبار',
      nameEn: 'Test Co',
      address: baseAddress,
    });
    expect(row.type).toBe('B');
    expect(row.registrationId).toBe('123456789');
  });

  it('rejects company registration that is not 9 digits', () => {
    expect(() =>
      normalizeCustomerWrite({
        type: 'B',
        registrationId: '12345',
        name: 'Co',
        address: baseAddress,
      }),
    ).toThrow(BadRequestException);
  });

  it('accepts a 14-digit person national ID', () => {
    const row = normalizeCustomerWrite({
      type: 'P',
      registrationId: '29801011234567',
      name: 'أحمد',
      address: baseAddress,
    });
    expect(row.type).toBe('P');
  });

  it('maps customer to ETA receiver shape (type/id/name/address)', () => {
    const receiver = customerToEtaReceiver({
      type: 'B',
      registrationId: '123456789',
      name: 'Buyer Co',
      addressJson: baseAddress,
    });
    expect(receiver).toEqual({
      type: 'B',
      id: '123456789',
      name: 'Buyer Co',
      address: baseAddress,
    });
  });
});
