import { fireEvent, render, screen } from '@testing-library/react';
import { defaultTaxableTax } from '@einvoice/eta-core';
import en from '@/messages/en.json';
import { LineTaxesEditor } from './line-taxes-editor';
import type { DocumentUpsert } from '@/lib/api/documents';

const line: DocumentUpsert['lines'][number] = {
  description: 'Item',
  itemType: 'EGS',
  itemCode: 'EG-1',
  unitType: 'EA',
  quantity: '1',
  unitPrice: '100.00',
  taxes: [defaultTaxableTax()],
};

const taxTypes = [
  { code: 'T1', nameEn: 'VAT', nameAr: 'ضريبة', parentCode: null, meta: null },
];
const taxSubtypes = [
  { code: 'V009', nameEn: 'Standard', nameAr: 'قياسي', parentCode: 'T1', meta: null },
];

describe('line taxes editor', () => {
  it('keeps tax-mode radios and does not invent a new calculation path', () => {
    const updateLine = jest.fn();
    const setLineTaxMode = jest.fn();
    const setLineZeroExemptKind = jest.fn();
    const t = ((key: string) => {
      const dict = en.documents as Record<string, string>;
      return dict[key] ?? key;
    }) as unknown as Parameters<typeof LineTaxesEditor>[0]['t'];

    render(
      <LineTaxesEditor
          line={line}
          lineIndex={0}
          locale="en"
          taxTypes={taxTypes}
          taxSubtypes={taxSubtypes}
          taxTypeOptions={taxTypes}
          zeroRatedSubtypeOptions={[]}
          exemptSubtypeOptions={[]}
          subtypeOptionsFor={() => taxSubtypes}
          updateLine={updateLine}
          setLineTaxMode={setLineTaxMode}
          setLineZeroExemptKind={setLineZeroExemptKind}
          t={t}
        />
    );

    expect(screen.getByTestId('line-taxes-editor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: en.documents.taxModeNone }));
    expect(setLineTaxMode).toHaveBeenCalledWith(0, 'none');
    expect(updateLine).not.toHaveBeenCalled();
  });
});
