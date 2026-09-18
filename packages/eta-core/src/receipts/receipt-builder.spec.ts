import { buildReceipt } from './receipt-builder.js';
import { computeReceiptUuid, previousUuidForPos, receiptWithEmptyUuid } from './receipt-uuid.js';
import { validateReceipt } from './receipt-validator.js';
import { goldenSaleInput } from './golden-sale.js';
import { RECEIPT_BUYER_ID_THRESHOLD_EGP } from './types.js';

describe('buildReceipt', () => {
  it('builds a v1.2 sale with scalar unitPrice, JSON numbers, and fees/adjustment 0', () => {
    const built = buildReceipt(goldenSaleInput());
    const header = built.etaPayload.header as Record<string, unknown>;
    const docType = built.etaPayload.documentType as Record<string, unknown>;
    const item = (built.etaPayload.itemData as Array<Record<string, unknown>>)[0]!;

    expect(docType).toEqual({ receiptType: 's', typeVersion: '1.2' });
    expect(header.previousUUID).toBe('');
    expect(header.uuid).toBe(built.uuid);
    expect(typeof item.unitPrice).toBe('number');
    expect(item.unitValue).toBeUndefined();
    expect(item.internalCode).toBe('SKU-1');
    expect(built.etaPayload.feesAmount).toBe(0);
    expect(built.etaPayload.adjustment).toBe(0);
    expect(built.etaPayload.paymentMethod).toBe('C');
    expect(built.etaPayload.totalAmount).toBe(114);
    expect(built.totals.totalSales).toBe('100.00');
    expect(built.totals.netAmount).toBe('100.00');
    expect(built.totals.totalAmount).toBe('114.00');
    expect(validateReceipt({ document: built.etaPayload, input: goldenSaleInput() })).toEqual([]);
  });

  it('allows anonymous person buyers under the v1.2 threshold', () => {
    const built = buildReceipt(goldenSaleInput());
    const buyer = built.etaPayload.buyer as Record<string, unknown>;
    expect(buyer.type).toBe('P');
    expect(buyer.id).toBe('');
    expect(buyer.name).toBe('');
    expect(validateReceipt({ document: built.etaPayload, input: goldenSaleInput() })).toEqual([]);
  });

  it('requires buyer id/name for companies always and persons at the threshold', () => {
    const company = buildReceipt(
      goldenSaleInput({ buyer: { type: 'B' } }),
    );
    expect(validateReceipt({ document: company.etaPayload }).some((i) => i.code === 'BUYER_ID_REQUIRED')).toBe(
      true,
    );

    const personHigh = buildReceipt(
      goldenSaleInput({
        lines: [
          {
            internalCode: 'SKU-1',
            description: 'High value',
            itemType: 'EGS',
            itemCode: 'EG-123456789-123456',
            unitType: 'EA',
            quantity: '1',
            unitPrice: String(RECEIPT_BUYER_ID_THRESHOLD_EGP),
            taxes: [],
          },
        ],
        buyer: { type: 'P' },
      }),
    );
    expect(personHigh.etaPayload.totalAmount).toBe(RECEIPT_BUYER_ID_THRESHOLD_EGP);
    expect(
      validateReceipt({ document: personHigh.etaPayload }).some((i) => i.code === 'BUYER_ID_REQUIRED'),
    ).toBe(true);

    const identified = buildReceipt(
      goldenSaleInput({
        buyer: { type: 'B', id: '200000000000003', name: 'Buyer Co' },
      }),
    );
    expect(validateReceipt({ document: identified.etaPayload, input: goldenSaleInput({
      buyer: { type: 'B', id: '200000000000003', name: 'Buyer Co' },
    }) })).toEqual([]);
  });

  it('requires orderdeliveryMode on retail SR and referenceUUID on returns', () => {
    const retail = buildReceipt(goldenSaleInput({ receiptType: 'SR' }));
    expect(
      validateReceipt({ document: retail.etaPayload }).some(
        (i) => i.code === 'ORDER_DELIVERY_MODE_REQUIRED',
      ),
    ).toBe(true);

    const retailOk = buildReceipt(
      goldenSaleInput({ receiptType: 'SR', orderdeliveryMode: 'FC' }),
    );
    expect(validateReceipt({ document: retailOk.etaPayload, input: goldenSaleInput({
      receiptType: 'SR',
      orderdeliveryMode: 'FC',
    }) })).toEqual([]);

    const ret = buildReceipt(
      goldenSaleInput({
        receiptType: 'r',
        referenceUUID: 'a'.repeat(64),
      }),
    );
    expect((ret.etaPayload.header as { referenceUUID: string }).referenceUUID).toHaveLength(64);
    expect(validateReceipt({ document: ret.etaPayload, input: goldenSaleInput({
      receiptType: 'r',
      referenceUUID: 'a'.repeat(64),
    }) })).toEqual([]);
  });

  it('chains previousUUID per POS and hashes uuid from the empty-uuid canonical form', () => {
    const first = buildReceipt(goldenSaleInput());
    expect(first.previousUUID).toBe('');
    expect(previousUuidForPos('')).toBe('');
    const second = buildReceipt(
      goldenSaleInput({
        receiptNumber: 'POS-1-0002',
        previousUUID: first.uuid,
      }),
    );
    expect(second.previousUUID).toBe(first.uuid);
    expect(second.uuid).not.toBe(first.uuid);

    const emptied = receiptWithEmptyUuid(first.etaPayload);
    expect((emptied.header as { uuid: string }).uuid).toBe('');
    expect(computeReceiptUuid(first.etaPayload)).toBe(first.uuid);
    expect(computeReceiptUuid(emptied)).toBe(first.uuid);
  });

  it('flags missing paymentMethod, internalCode, and non-zero fees/adjustment', () => {
    const built = buildReceipt(goldenSaleInput());
    const broken = {
      ...built.etaPayload,
      paymentMethod: '',
      feesAmount: 1,
      adjustment: 2,
      itemData: [
        {
          ...(built.etaPayload.itemData as Array<Record<string, unknown>>)[0]!,
          internalCode: '',
        },
      ],
    };
    const codes = validateReceipt({ document: broken }).map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'PAYMENT_METHOD_REQUIRED',
        'FEES_AMOUNT_ZERO',
        'ADJUSTMENT_ZERO',
        'INTERNAL_CODE_REQUIRED',
      ]),
    );
  });

  it('does not hardcode a single receipt type', () => {
    const types = ['s', 'r', 'SR'] as const;
    for (const receiptType of types) {
      const built = buildReceipt(
        goldenSaleInput({
          receiptType,
          orderdeliveryMode: receiptType === 'SR' ? 'FC' : undefined,
          referenceUUID: receiptType === 'r' ? 'b'.repeat(64) : undefined,
        }),
      );
      expect((built.etaPayload.documentType as { receiptType: string }).receiptType).toBe(
        receiptType,
      );
    }
  });
});
