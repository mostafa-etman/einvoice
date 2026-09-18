import type { ReceiptBuildInput } from './types.js';

/** Deterministic sale used as the receipt golden-vector oracle. */
export function goldenSaleInput(overrides?: Partial<ReceiptBuildInput>): ReceiptBuildInput {
  return {
    receiptType: 's',
    dateTimeIssued: '2026-02-13T14:00:00Z',
    receiptNumber: 'POS-1-0001',
    previousUUID: '',
    currency: 'EGP',
    seller: {
      rin: '200000000000003',
      companyTradeName: 'Demo Taxpayer LLC',
      branchCode: '0',
      branchAddress: {
        country: 'EG',
        governate: 'Cairo',
        regionCity: 'Nasr City',
        street: 'Street 1',
        buildingNumber: '10',
        postalCode: '11765',
      },
      deviceSerialNumber: 'POS-VERIFY-001',
      activityCode: '6201',
      syndicateLicenseNumber: 'C',
    },
    buyer: {
      type: 'P',
    },
    lines: [
      {
        internalCode: 'SKU-1',
        description: 'Service hour',
        itemType: 'EGS',
        itemCode: 'EG-123456789-123456',
        unitType: 'EA',
        quantity: '1',
        unitPrice: '100.00',
        taxes: [{ taxType: 'T1', subType: 'V009', rate: '14' }],
      },
    ],
    paymentMethod: 'C',
    ...overrides,
  };
}
