/**
 * Must stay in sync with apps/api/src/imports/import-schema.ts
 * IMPORT_REQUIRED_FIELDS (row-level required for one-row-per-line template).
 */
export const IMPORT_REQUIRED_FIELDS = [
  'internalID',
  'dateTimeIssued',
  'receiverId',
  'receiverName',
  'description',
  'itemCode',
  'quantity',
  'unitPrice',
] as const;

/** Common optional columns shown in the mapping UI (full set auto-maps from template). */
export const IMPORT_COMMON_OPTIONAL_FIELDS = [
  'documentType',
  'branchCode',
  'currencyCode',
  'receiverType',
  'receiverGovernate',
  'receiverRegionCity',
  'receiverStreet',
  'receiverBuildingNumber',
  'itemType',
  'unitType',
  'discountAmount',
  'discountRate',
  'extraDiscountAmount',
  'references',
  'taxType1',
  'taxSubType1',
  'taxRate1',
  'taxAmount1',
  'taxType2',
  'taxSubType2',
  'taxRate2',
  'taxAmount2',
] as const;
