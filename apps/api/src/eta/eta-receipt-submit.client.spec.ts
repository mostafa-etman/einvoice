import { EtaReceiptSubmitClient } from './eta-receipt-submit.client';

describe('EtaReceiptSubmitClient', () => {
  it('POSTs { receipts, signatures } and parses 202 accepted/rejected', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          submissionUUID: 'SUB-1',
          acceptedDocuments: [
            { uuid: 'aaa', longId: 'LONG-1', receiptNumber: 'R-1' },
          ],
          rejectedDocuments: [],
        }),
        { status: 202 },
      );
    };
    const client = new EtaReceiptSubmitClient(
      'https://api.preprod.invoicing.eta.gov.eg',
      fetchImpl,
    );
    const parsed = await client.postReceiptSubmissions('tok', {
      receipts: [{ header: { uuid: 'aaa' } }],
      signatures: [{ signatureType: 'I', value: '' }],
    });
    expect(calls[0]!.url).toBe(
      'https://api.preprod.invoicing.eta.gov.eg/api/v1/receiptsubmissions',
    );
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers['Content-Type']).toBe('application/json');
    const sent = JSON.parse(String(calls[0]!.init.body)) as {
      receipts: unknown[];
      signatures: Array<{ signatureType: string; value: string }>;
    };
    expect(sent.receipts).toHaveLength(1);
    expect(sent.signatures[0]).toEqual({ signatureType: 'I', value: '' });
    expect(parsed.submissionUUID).toBe('SUB-1');
    expect(parsed.acceptedDocuments[0]?.longId).toBe('LONG-1');
    expect(parsed.rejectedDocuments).toEqual([]);
  });

  it('maps DuplicateSubmission 422 with Retry-After', async () => {
    const client = new EtaReceiptSubmitClient(
      'https://api.example.test',
      (async () =>
        new Response(
          JSON.stringify({ error: 'DuplicateSubmission' }),
          { status: 422, headers: { 'Retry-After': '12' } },
        )) as unknown as typeof fetch,
    );
    await expect(
      client.postReceiptSubmissions('tok', { receipts: [], signatures: [] }),
    ).rejects.toMatchObject({
      isDuplicate: true,
      retryAfterSeconds: 12,
      code: 'ETA_DUPLICATE_SUBMISSION',
    });
  });

  it('maps MaximumSizeExceeded 400', async () => {
    const client = new EtaReceiptSubmitClient(
      'https://api.example.test',
      (async () =>
        new Response(JSON.stringify({ error: 'MaximumSizeExceeded' }), {
          status: 400,
        })) as unknown as typeof fetch,
    );
    await expect(
      client.postReceiptSubmissions('tok', { receipts: [{}], signatures: [] }),
    ).rejects.toMatchObject({ code: 'ETA_MAXIMUM_SIZE_EXCEEDED' });
  });
});
