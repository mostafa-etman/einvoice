import { receiptBranchGaps } from './receipt-readiness';

const completeAddress = {
  country: 'EG',
  governate: 'Cairo',
  regionCity: 'Nasr City',
  street: 'Main',
  buildingNumber: '1',
};

describe('receiptBranchGaps', () => {
  it('does not block invoice-only branches', () => {
    expect(
      receiptBranchGaps({
        receiptsEnabled: false,
        issuerType: 'B',
        address: {},
      }),
    ).toEqual([]);
  });

  it('requires portal branch code, activity, and address when receipts are on', () => {
    expect(
      receiptBranchGaps({
        receiptsEnabled: true,
        issuerType: 'B',
        address: {},
      }),
    ).toEqual([
      'MISSING_ETA_BRANCH_CODE',
      'MISSING_ACTIVITY_CODE',
      'INCOMPLETE_ADDRESS',
    ]);
  });

  it('is ready when company fields are complete', () => {
    expect(
      receiptBranchGaps({
        receiptsEnabled: true,
        etaBranchCode: '0',
        activityCode: '6201',
        address: completeAddress,
        issuerType: 'B',
      }),
    ).toEqual([]);
  });

  it('requires syndicate license for person issuers', () => {
    expect(
      receiptBranchGaps({
        receiptsEnabled: true,
        etaBranchCode: '0',
        activityCode: '6201',
        address: completeAddress,
        issuerType: 'P',
      }),
    ).toEqual(['MISSING_SYNDICATE_LICENSE']);
  });
});
