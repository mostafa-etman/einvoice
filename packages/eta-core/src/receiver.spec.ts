import {
  compactEtaReceiver,
  isEtaReceiverType,
  normalizeEtaReceiverType,
  receiverFromStoredDocument,
} from './receiver.js';

describe('normalizeEtaReceiverType', () => {
  it('accepts B/P/F in any case and Arabic aliases', () => {
    expect(normalizeEtaReceiverType('b')).toBe('B');
    expect(normalizeEtaReceiverType('P')).toBe('P');
    expect(normalizeEtaReceiverType('شركة')).toBe('B');
    expect(normalizeEtaReceiverType('شخصي')).toBe('P');
    expect(normalizeEtaReceiverType('أجنبي')).toBe('F');
  });

  it('does not treat document types as receiver types', () => {
    expect(normalizeEtaReceiverType('C')).toBe('B');
    expect(normalizeEtaReceiverType('I')).toBe('B');
    expect(normalizeEtaReceiverType('CREDIT_NOTE')).toBe('B');
    expect(normalizeEtaReceiverType('')).toBe('B');
    expect(normalizeEtaReceiverType('', 'F')).toBe('F');
  });
});

describe('compactEtaReceiver', () => {
  it('defaults type to B and omits blank id/name/null branch', () => {
    const receiver = compactEtaReceiver({
      type: '',
      id: '  ',
      name: 'Buyer Co',
      branch: null,
      address: {
        country: 'EG',
        governate: 'Cairo',
        regionCity: '',
        branchID: null,
        branch: null,
      },
    });
    expect(receiver.type).toBe('B');
    expect(receiver.name).toBe('Buyer Co');
    expect(receiver).not.toHaveProperty('id');
    expect(receiver).not.toHaveProperty('branch');
    expect(receiver.address).toEqual({ country: 'EG', governate: 'Cairo' });
  });

  it('keeps a non-empty branch copied from an original invoice', () => {
    const receiver = compactEtaReceiver({
      type: 'B',
      id: '123456789',
      name: 'Buyer',
      branch: '0',
    });
    expect(receiver.branch).toBe('0');
  });

  it('forces F on export documents', () => {
    expect(compactEtaReceiver({ type: 'B', name: 'X' }, { isExport: true }).type).toBe(
      'F',
    );
  });

  it('reads PascalCase Type from ETA-synced payloads', () => {
    const receiver = compactEtaReceiver({
      Type: 'P',
      Id: '14digitsxxxxx',
      Name: 'Person',
    });
    expect(receiver).toEqual({ type: 'P', id: '14digitsxxxxx', name: 'Person' });
  });
});

describe('receiverFromStoredDocument', () => {
  it('copies the original payload receiver and drops null branch', () => {
    const receiver = receiverFromStoredDocument({
      kind: 'INVOICE',
      receiverType: '',
      receiverId: null,
      receiverName: null,
      receiverAddressJson: { country: 'EG', branch: null },
      etaPayloadJson: {
        receiver: {
          Type: 'B',
          id: '987654321',
          name: 'Original Buyer',
          address: {
            country: 'EG',
            governate: 'Giza',
            regionCity: 'Dokki',
            street: 'Tahrir',
            buildingNumber: '5',
            branchID: null,
          },
          branch: null,
        },
      },
    });
    expect(isEtaReceiverType(receiver.type)).toBe(true);
    expect(receiver.type).toBe('B');
    expect(receiver.id).toBe('987654321');
    expect(receiver.name).toBe('Original Buyer');
    expect(receiver).not.toHaveProperty('branch');
    expect(receiver.address).toEqual({
      country: 'EG',
      governate: 'Giza',
      regionCity: 'Dokki',
      street: 'Tahrir',
      buildingNumber: '5',
    });
  });

  it('falls back to stored columns when payload has no receiver', () => {
    const receiver = receiverFromStoredDocument({
      kind: 'CREDIT_NOTE',
      receiverType: 'B',
      receiverId: '111111111',
      receiverName: 'From columns',
      receiverAddressJson: { country: 'EG', governate: 'Cairo' },
      etaPayloadJson: { documentType: 'C' },
    });
    expect(receiver).toEqual({
      type: 'B',
      id: '111111111',
      name: 'From columns',
      address: { country: 'EG', governate: 'Cairo' },
    });
  });
});
