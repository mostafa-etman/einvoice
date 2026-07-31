import { EtaSubmitClient } from './eta-submit.client';

describe('EtaSubmitClient 202 parsing', () => {
  it('accepts null submissionId when documents are refused at intake', async () => {
    const body = {
      submissionId: null,
      acceptedDocuments: [],
      rejectedDocuments: [
        {
          internalId: 'VAL-1',
          error: { code: '2', message: 'Validation Error' },
        },
      ],
    };
    const client = new EtaSubmitClient('https://api.example.test', (async () =>
      new Response(JSON.stringify(body), { status: 202 })) as unknown as typeof fetch);

    const parsed = await client.postDocumentSubmissions('token', [{ internalID: 'VAL-1' }]);
    expect(parsed.submissionUUID).toMatch(/^intake-refused-/);
    expect(parsed.rejectedDocuments).toHaveLength(1);
    expect(parsed.acceptedDocuments).toEqual([]);
  });
});
