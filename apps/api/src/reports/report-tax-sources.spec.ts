import {
  extractIssuedDocumentTaxes,
  extractReceivedDocumentTaxes,
} from './report-tax-sources';

describe('report-tax-sources', () => {
  it('reads purchase line taxes from rawJson.lineTaxableItems when taxesJson is empty', () => {
    const taxes = extractReceivedDocumentTaxes({
      rawSummaryJson: {},
      rawDetailsJson: null,
      lines: [
        {
          taxesJson: [],
          rawJson: {
            lineTaxableItems: [
              {
                taxType: 'T1',
                subType: 'V009',
                rate: 14,
                amount: 140,
              },
              {
                taxType: 'T4',
                subType: 'W001',
                rate: 5,
                amount: 50,
              },
            ],
          },
        },
      ],
    });
    expect(taxes.map((t) => t.taxType).sort()).toEqual(['T1', 'T4']);
    expect(taxes.find((t) => t.taxType === 'T1')?.amount).toBe('140');
  });

  it('reads purchase taxes from rawDetailsJson.taxTotals when lines are empty', () => {
    const taxes = extractReceivedDocumentTaxes({
      rawSummaryJson: { uuid: 'x' },
      rawDetailsJson: {
        taxTotals: [{ taxType: 'T1', amount: 70, rate: 14, subType: 'V009' }],
      },
      lines: [],
    });
    expect(taxes).toHaveLength(1);
    expect(taxes[0]?.taxType).toBe('T1');
    expect(taxes[0]?.amount).toBe('70');
  });

  it('hydrates purchase lines from rawDetailsJson invoiceLines when DB lines missing', () => {
    const taxes = extractReceivedDocumentTaxes({
      rawSummaryJson: {},
      rawDetailsJson: {
        invoiceLines: [
          {
            description: 'Item',
            taxableItems: null,
            lineTaxableItems: [
              { taxType: 'T1', subType: 'V009', rate: 14, amount: 14 },
            ],
          },
        ],
      },
      lines: [],
    });
    expect(taxes).toHaveLength(1);
    expect(taxes[0]?.amount).toBe('14');
  });

  it('does not treat empty summary taxTotals as the source of truth', () => {
    const taxes = extractReceivedDocumentTaxes({
      rawSummaryJson: { taxTotals: [] },
      rawDetailsJson: null,
      lines: [
        {
          taxesJson: [{ taxType: 'T1', rate: '14', amount: '7', subType: 'V009' }],
        },
      ],
    });
    expect(taxes[0]?.amount).toBe('7');
  });

  it('prefers issued line taxes over taxTotalsJson (keeps rate/subtype)', () => {
    const taxes = extractIssuedDocumentTaxes({
      taxTotalsJson: [{ taxType: 'T1', amount: '14' }],
      lines: [
        {
          taxes: [
            { taxType: 'T1', subType: 'V009', rate: '14', amount: '14' },
          ],
        },
      ],
    });
    expect(taxes[0]?.subType).toBe('V009');
    expect(taxes[0]?.rate).toBe('14');
  });

  it('falls back to issued taxTotalsJson when lines have no taxes', () => {
    const taxes = extractIssuedDocumentTaxes({
      taxTotalsJson: [{ taxType: 'T1', amount: '99' }],
      lines: [{ taxes: [] }],
    });
    expect(taxes[0]?.amount).toBe('99');
  });
});
