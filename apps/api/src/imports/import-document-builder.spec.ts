import { calculateDocumentTotals, calculateLine } from '@einvoice/eta-core';
import {
  buildDocumentUpsert,
  groupRowsByInternalId,
  headerConflicts,
} from './import-document-builder';
import { IMPORT_REQUIRED_FIELDS, sampleImportRows } from './import-schema';
import { validateMappedRow } from './import-validate.service';

function row(
  rowNumber: number,
  mapped: Record<string, string>,
) {
  return { rowNumber, mapped };
}

describe('import-document-builder', () => {
  it('groups multiple lines with the same internalID into one invoice', () => {
    const groups = groupRowsByInternalId([
      row(1, {
        internalID: 'INV-1',
        description: 'A',
        itemCode: 'EGS-1',
        quantity: '1',
        unitPrice: '100',
      }),
      row(2, {
        internalID: 'INV-1',
        description: 'B',
        itemCode: 'EGS-1',
        quantity: '2',
        unitPrice: '50',
      }),
      row(3, {
        internalID: 'INV-2',
        description: 'C',
        itemCode: 'EGS-1',
        quantity: '1',
        unitPrice: '10',
      }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.internalId).toBe('INV-1');
    expect(groups[0]!.rows).toHaveLength(2);
    expect(groups[1]!.rows).toHaveLength(1);
  });

  it('builds DocumentUpsert with multi-tax including withholding T4 and fixed T3', () => {
    const group = groupRowsByInternalId([
      row(1, {
        internalID: 'INV-TAX',
        dateTimeIssued: '2026-08-01T10:00:00.000Z',
        documentType: 'I',
        currencyCode: 'EGP',
        receiverType: 'B',
        receiverId: '123',
        receiverName: 'Buyer',
        receiverGovernate: 'Cairo',
        receiverRegionCity: 'Nasr City',
        receiverStreet: 'Street 1',
        receiverBuildingNumber: '9',
        description: 'Goods',
        itemType: 'EGS',
        itemCode: 'EGS-1',
        unitType: 'EA',
        quantity: '1',
        unitPrice: '100.00',
        taxType1: 'T1',
        taxSubType1: 'V009',
        taxRate1: '14',
        taxType2: 'T4',
        taxSubType2: 'W001',
        taxRate2: '1',
        taxType3: 'T3',
        taxSubType3: 'Tbl02',
        taxRate3: '0',
        taxAmount3: '5.00',
      }),
    ])[0]!;

    const dto = buildDocumentUpsert(group, {
      defaultBranchId: 'branch-uuid',
      jobDocumentType: 'I',
    });

    expect(dto.issuer).toBeUndefined();
    expect(dto.internalId).toBe('INV-TAX');
    expect(dto.lines).toHaveLength(1);
    expect(dto.lines[0]!.taxes).toEqual([
      { taxType: 'T1', subType: 'V009', rate: '14' },
      { taxType: 'T4', subType: 'W001', rate: '1' },
      { taxType: 'T3', subType: 'Tbl02', rate: '0', amount: '5.00' },
    ]);

    const computed = calculateLine({
      description: dto.lines[0]!.description,
      itemType: dto.lines[0]!.itemType,
      itemCode: dto.lines[0]!.itemCode,
      unitType: dto.lines[0]!.unitType,
      quantity: dto.lines[0]!.quantity,
      unitPrice: dto.lines[0]!.unitPrice,
      taxes: dto.lines[0]!.taxes,
    });
    const totals = calculateDocumentTotals([computed]);
    // VAT base includes fixed table tax T3: 14% of (100 + 5) = 14.70
    expect(totals.taxTotals.find((t) => t.taxType === 'T1')?.amount).toBe(
      '14.70',
    );
    expect(totals.taxTotals.find((t) => t.taxType === 'T4')?.amount).toBe(
      '1.00',
    );
    expect(totals.taxTotals.find((t) => t.taxType === 'T3')?.amount).toBe(
      '5.00',
    );
  });

  it('allows empty tax slots (tax-free line) like the invoice screen', () => {
    const group = groupRowsByInternalId([
      row(1, {
        internalID: 'INV-NONE',
        dateTimeIssued: '2026-08-01T10:00:00.000Z',
        receiverId: '1',
        receiverName: 'B',
        description: 'X',
        itemCode: 'EGS-1',
        quantity: '1',
        unitPrice: '10',
      }),
    ])[0]!;
    const dto = buildDocumentUpsert(group, {
      defaultBranchId: 'b',
      jobDocumentType: 'I',
    });
    expect(dto.lines[0]!.taxes).toEqual([]);
  });

  it('sample template rows share one invoice key and validate as multi-line', () => {
    const [, ...data] = sampleImportRows('2026-08-01T10:00:00.000Z');
    const headers = sampleImportRows('2026-08-01T10:00:00.000Z')[0]!;
    const mappedRows = data.map((cells, i) => {
      const mapped: Record<string, string> = {};
      headers.forEach((h, idx) => {
        mapped[h] = cells[idx] ?? '';
      });
      return row(i + 1, mapped);
    });
    expect(mappedRows).toHaveLength(2);
    for (const r of mappedRows) {
      const v = validateMappedRow(r.rowNumber, r.mapped);
      expect(v.status).toBe('VALID');
    }
    const groups = groupRowsByInternalId(mappedRows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows).toHaveLength(2);
    const dto = buildDocumentUpsert(groups[0]!, {
      defaultBranchId: 'b',
      jobDocumentType: 'I',
    });
    expect(dto.lines).toHaveLength(2);
    expect(dto.lines[0]!.taxes?.[0]).toMatchObject({
      taxType: 'T1',
      subType: 'V009',
      rate: '14',
    });
    expect(dto.lines[1]!.taxes).toHaveLength(2);
  });

  it('detects header conflicts across lines of the same invoice', () => {
    const group = groupRowsByInternalId([
      row(1, {
        internalID: 'INV-X',
        receiverName: 'A',
        dateTimeIssued: '2026-01-01T00:00:00Z',
      }),
      row(2, {
        internalID: 'INV-X',
        receiverName: 'B',
        dateTimeIssued: '2026-01-01T00:00:00Z',
      }),
    ])[0]!;
    expect(headerConflicts(group)).toContain('receiverName');
  });

  it('required field list includes description (full template)', () => {
    expect(IMPORT_REQUIRED_FIELDS).toContain('description');
    expect(IMPORT_REQUIRED_FIELDS).toContain('internalID');
  });
});
