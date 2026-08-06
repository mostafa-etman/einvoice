/**
 * Bulk-import column catalog.
 *
 * Convention: one spreadsheet row = one invoice line. Rows sharing the same
 * `internalID` form one invoice. Issuer identity/address come from tenant
 * settings (not columns). Up to IMPORT_TAX_SLOTS taxes per line.
 */

export const IMPORT_TAX_SLOTS = 5 as const;

export type ImportColumnDef = {
  key: string;
  required: boolean;
  /** Row-level required (must be present on every line row). */
  requiredPerRow?: boolean;
  group: 'header' | 'receiver' | 'line' | 'tax' | 'payment' | 'delivery';
  description: string;
  allowedValues?: string;
  example?: string;
};

function taxSlotColumns(n: number): ImportColumnDef[] {
  return [
    {
      key: `taxType${n}`,
      required: false,
      group: 'tax',
      description: `Tax type slot ${n} (T1–T4, T6, …). Empty slots are ignored.`,
      allowedValues: 'T1, T2, T3, T4, T5, T6, … (ETA tax catalog)',
      example: n === 1 ? 'T1' : n === 2 ? 'T4' : '',
    },
    {
      key: `taxSubType${n}`,
      required: false,
      group: 'tax',
      description: `Tax subtype for slot ${n} (must belong to taxType${n}).`,
      allowedValues: 'V009 (standard VAT), V001/V002 (zero-rated), W… (withholding), …',
      example: n === 1 ? 'V009' : n === 2 ? 'W001' : '',
    },
    {
      key: `taxRate${n}`,
      required: false,
      group: 'tax',
      description: `Tax rate % for slot ${n}. Use 0 for fixed-amount types (T3/T6).`,
      example: n === 1 ? '14' : n === 2 ? '1' : '',
    },
    {
      key: `taxAmount${n}`,
      required: false,
      group: 'tax',
      description: `Fixed tax amount for slot ${n}. Required when taxType${n} is T3 or T6; ignored for rate-based taxes.`,
      example: '',
    },
  ];
}

export const IMPORT_COLUMNS: ImportColumnDef[] = [
  // --- Header / grouping ---
  {
    key: 'internalID',
    required: true,
    requiredPerRow: true,
    group: 'header',
    description:
      'Invoice key. Rows with the same value become one multi-line invoice. Must be unique across invoices in the file and in the tenant.',
    example: 'INV-SAMPLE-001',
  },
  {
    key: 'dateTimeIssued',
    required: true,
    requiredPerRow: true,
    group: 'header',
    description: 'Issue date/time (ISO-8601). Repeated on each line of the invoice; first row wins.',
    example: '2026-08-01T10:00:00.000Z',
  },
  {
    key: 'documentType',
    required: false,
    group: 'header',
    description: 'Document type override. Blank → job-level type.',
    allowedValues: 'I, C, D, EI, EC, ED',
    example: 'I',
  },
  {
    key: 'branchCode',
    required: false,
    group: 'header',
    description: 'Branch ETA code. Blank → job branch or tenant default branch.',
    example: '0',
  },
  {
    key: 'currencyCode',
    required: false,
    group: 'header',
    description: 'Invoice currency. Blank → EGP.',
    allowedValues: 'ISO currency codes enabled for the tenant (usually EGP)',
    example: 'EGP',
  },
  {
    key: 'taxpayerActivityCode',
    required: false,
    group: 'header',
    description: 'Activity code. Blank → ETA credentials / branch setting.',
    example: '',
  },
  {
    key: 'serviceDeliveryDate',
    required: false,
    group: 'header',
    description: 'Service delivery date (YYYY-MM-DD), when applicable.',
    example: '',
  },
  {
    key: 'purchaseOrderReference',
    required: false,
    group: 'header',
    description: 'Purchase order reference.',
    example: '',
  },
  {
    key: 'purchaseOrderDescription',
    required: false,
    group: 'header',
    description: 'Purchase order description.',
    example: '',
  },
  {
    key: 'salesOrderReference',
    required: false,
    group: 'header',
    description: 'Sales order reference.',
    example: '',
  },
  {
    key: 'salesOrderDescription',
    required: false,
    group: 'header',
    description: 'Sales order description.',
    example: '',
  },
  {
    key: 'proformaInvoiceNumber',
    required: false,
    group: 'header',
    description: 'Proforma invoice number.',
    example: '',
  },
  {
    key: 'extraDiscountAmount',
    required: false,
    group: 'header',
    description: 'Document-level extra discount amount. Default 0.00.',
    example: '0.00',
  },
  {
    key: 'references',
    required: false,
    group: 'header',
    description:
      'Original document ETA UUID(s) for credit/debit notes. Separate with | or ;. Required for C/D/EC/ED.',
    example: '',
  },

  // --- Receiver ---
  {
    key: 'receiverType',
    required: false,
    group: 'receiver',
    description: 'Buyer type. Default B.',
    allowedValues: 'B (Business), P (Natural person), F (Foreign)',
    example: 'B',
  },
  {
    key: 'receiverId',
    required: true,
    requiredPerRow: true,
    group: 'receiver',
    description: 'Buyer registration / national ID.',
    example: '123456789',
  },
  {
    key: 'receiverName',
    required: true,
    requiredPerRow: true,
    group: 'receiver',
    description: 'Buyer legal name.',
    example: 'Sample Buyer LLC',
  },
  {
    key: 'receiverCountry',
    required: false,
    group: 'receiver',
    description: 'Buyer country code. Default EG.',
    example: 'EG',
  },
  {
    key: 'receiverGovernate',
    required: false,
    group: 'receiver',
    description: 'Buyer governate (recommended for domestic B2B).',
    example: 'Cairo',
  },
  {
    key: 'receiverRegionCity',
    required: false,
    group: 'receiver',
    description: 'Buyer region/city (recommended).',
    example: 'Nasr City',
  },
  {
    key: 'receiverStreet',
    required: false,
    group: 'receiver',
    description: 'Buyer street (recommended).',
    example: 'Abbas El Akkad',
  },
  {
    key: 'receiverBuildingNumber',
    required: false,
    group: 'receiver',
    description: 'Buyer building number (recommended).',
    example: '12',
  },
  {
    key: 'receiverPostalCode',
    required: false,
    group: 'receiver',
    description: 'Buyer postal code.',
    example: '',
  },
  {
    key: 'receiverFloor',
    required: false,
    group: 'receiver',
    description: 'Buyer floor.',
    example: '',
  },
  {
    key: 'receiverRoom',
    required: false,
    group: 'receiver',
    description: 'Buyer room.',
    example: '',
  },
  {
    key: 'receiverLandmark',
    required: false,
    group: 'receiver',
    description: 'Buyer landmark.',
    example: '',
  },
  {
    key: 'receiverAdditionalInformation',
    required: false,
    group: 'receiver',
    description: 'Buyer address additional information.',
    example: '',
  },

  // --- Line ---
  {
    key: 'description',
    required: true,
    requiredPerRow: true,
    group: 'line',
    description: 'Line item description.',
    example: 'Consulting services',
  },
  {
    key: 'itemType',
    required: false,
    group: 'line',
    description: 'Item code type. Default EGS.',
    allowedValues: 'EGS, GS1',
    example: 'EGS',
  },
  {
    key: 'itemCode',
    required: true,
    requiredPerRow: true,
    group: 'line',
    description: 'Item code from the tenant item-code catalog.',
    example: 'EGS-1',
  },
  {
    key: 'unitType',
    required: false,
    group: 'line',
    description: 'Unit of measure (ETA UNIT_TYPE catalog). Default EA.',
    example: 'EA',
  },
  {
    key: 'quantity',
    required: true,
    requiredPerRow: true,
    group: 'line',
    description: 'Quantity (> 0).',
    example: '1',
  },
  {
    key: 'unitPrice',
    required: true,
    requiredPerRow: true,
    group: 'line',
    description: 'Unit price (≥ 0).',
    example: '100.00',
  },
  {
    key: 'discountAmount',
    required: false,
    group: 'line',
    description: 'Line discount amount. Default 0.00.',
    example: '0.00',
  },
  {
    key: 'discountRate',
    required: false,
    group: 'line',
    description: 'Line discount rate %. Default 0.',
    example: '0',
  },
  {
    key: 'internalCode',
    required: false,
    group: 'line',
    description: 'Seller internal item code.',
    example: '',
  },
  {
    key: 'amountSold',
    required: false,
    group: 'line',
    description: 'Amount in sold currency (non-EGP invoices).',
    example: '',
  },
  {
    key: 'currencyExchangeRate',
    required: false,
    group: 'line',
    description: 'FX rate to EGP (non-EGP invoices).',
    example: '',
  },
  {
    key: 'weightUnitType',
    required: false,
    group: 'line',
    description: 'Export weight unit.',
    example: '',
  },
  {
    key: 'weightQuantity',
    required: false,
    group: 'line',
    description: 'Export weight quantity.',
    example: '',
  },

  // --- Taxes ---
  ...Array.from({ length: IMPORT_TAX_SLOTS }, (_, i) => taxSlotColumns(i + 1)).flat(),

  // --- Payment ---
  {
    key: 'paymentBankName',
    required: false,
    group: 'payment',
    description: 'Payment bank name. Any payment column non-empty enables payment block.',
    example: '',
  },
  {
    key: 'paymentBankAddress',
    required: false,
    group: 'payment',
    description: 'Payment bank address.',
    example: '',
  },
  {
    key: 'paymentBankAccountNo',
    required: false,
    group: 'payment',
    description: 'Payment bank account number.',
    example: '',
  },
  {
    key: 'paymentBankAccountIBAN',
    required: false,
    group: 'payment',
    description: 'Payment IBAN.',
    example: '',
  },
  {
    key: 'paymentSwiftCode',
    required: false,
    group: 'payment',
    description: 'Payment SWIFT/BIC.',
    example: '',
  },
  {
    key: 'paymentTerms',
    required: false,
    group: 'payment',
    description: 'Payment terms.',
    example: '',
  },

  // --- Delivery ---
  {
    key: 'deliveryApproach',
    required: false,
    group: 'delivery',
    description: 'Delivery approach. Any delivery column non-empty enables delivery block.',
    example: '',
  },
  {
    key: 'deliveryPackaging',
    required: false,
    group: 'delivery',
    description: 'Packaging.',
    example: '',
  },
  {
    key: 'deliveryDateValidity',
    required: false,
    group: 'delivery',
    description: 'Delivery date validity.',
    example: '',
  },
  {
    key: 'deliveryExportPort',
    required: false,
    group: 'delivery',
    description: 'Export port.',
    example: '',
  },
  {
    key: 'deliveryCountryOfOrigin',
    required: false,
    group: 'delivery',
    description: 'Country of origin.',
    example: '',
  },
  {
    key: 'deliveryGrossWeight',
    required: false,
    group: 'delivery',
    description: 'Gross weight.',
    example: '',
  },
  {
    key: 'deliveryNetWeight',
    required: false,
    group: 'delivery',
    description: 'Net weight.',
    example: '',
  },
  {
    key: 'deliveryTerms',
    required: false,
    group: 'delivery',
    description: 'Delivery terms.',
    example: '',
  },
];

/** Fields that must be mapped (and present on every line row). */
export const IMPORT_REQUIRED_FIELDS = IMPORT_COLUMNS.filter(
  (c) => c.required,
).map((c) => c.key);

/** All known target field keys (for auto-mapping). */
export const IMPORT_ALL_FIELD_KEYS = IMPORT_COLUMNS.map((c) => c.key);

/** Auto-filled from tenant settings — never required in the file. */
export const IMPORT_AUTO_FILLED_NOTES = [
  'issuer.type / issuer.id / issuer.name ← Settings → ETA connection (taxpayer legal name, registration, type)',
  'issuer.address.* ← Settings → Branches (issuer address on the issuing branch)',
  'taxpayerActivityCode fallback ← ETA credentials / branch when column blank',
  'Totals, tax signs, withholding (T4) direction ← shared eta-core money utilities (same as invoice screen)',
] as const;

export const DOC_TYPE_TO_KIND: Record<string, string> = {
  I: 'INVOICE',
  C: 'CREDIT_NOTE',
  D: 'DEBIT_NOTE',
  EI: 'EXPORT_INVOICE',
  EC: 'EXPORT_CREDIT_NOTE',
  ED: 'EXPORT_DEBIT_NOTE',
};

export function notesRows(): string[][] {
  const header = [
    'column',
    'required',
    'group',
    'description',
    'allowedValues',
    'example',
  ];
  const rows = IMPORT_COLUMNS.map((c) => [
    c.key,
    c.required ? 'required' : 'optional',
    c.group,
    c.description,
    c.allowedValues ?? '',
    c.example ?? '',
  ]);
  const auto = IMPORT_AUTO_FILLED_NOTES.map((n) => [
    '(auto)',
    'n/a',
    'settings',
    n,
    '',
    '',
  ]);
  return [header, ...rows, ...auto];
}

export function sampleImportRows(issuedIso: string): string[][] {
  const headers = IMPORT_ALL_FIELD_KEYS;
  const blank: Record<string, string> = Object.fromEntries(
    headers.map((h) => [h, '']),
  );

  const line1: Record<string, string> = {
    ...blank,
    internalID: 'INV-SAMPLE-001',
    dateTimeIssued: issuedIso,
    documentType: 'I',
    currencyCode: 'EGP',
    extraDiscountAmount: '0.00',
    receiverType: 'B',
    receiverId: '123456789',
    receiverName: 'Sample Buyer LLC',
    receiverCountry: 'EG',
    receiverGovernate: 'Cairo',
    receiverRegionCity: 'Nasr City',
    receiverStreet: 'Abbas El Akkad',
    receiverBuildingNumber: '12',
    description: 'Consulting services',
    itemType: 'EGS',
    itemCode: 'EGS-1',
    unitType: 'EA',
    quantity: '1',
    unitPrice: '100.00',
    discountAmount: '0.00',
    discountRate: '0',
    taxType1: 'T1',
    taxSubType1: 'V009',
    taxRate1: '14',
  };

  const line2: Record<string, string> = {
    ...blank,
    internalID: 'INV-SAMPLE-001',
    dateTimeIssued: issuedIso,
    documentType: 'I',
    currencyCode: 'EGP',
    extraDiscountAmount: '0.00',
    receiverType: 'B',
    receiverId: '123456789',
    receiverName: 'Sample Buyer LLC',
    receiverCountry: 'EG',
    receiverGovernate: 'Cairo',
    receiverRegionCity: 'Nasr City',
    receiverStreet: 'Abbas El Akkad',
    receiverBuildingNumber: '12',
    description: 'Support retainer',
    itemType: 'EGS',
    itemCode: 'EGS-1',
    unitType: 'EA',
    quantity: '2',
    unitPrice: '50.00',
    discountAmount: '0.00',
    discountRate: '0',
    taxType1: 'T1',
    taxSubType1: 'V009',
    taxRate1: '14',
    taxType2: 'T4',
    taxSubType2: 'W001',
    taxRate2: '1',
  };

  return [
    headers,
    headers.map((h) => line1[h] ?? ''),
    headers.map((h) => line2[h] ?? ''),
  ];
}
