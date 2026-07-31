import { applyUpsertCounters } from '../settings/item-codes/item-codes-sync.service';
import {
  EtaItemCodesClient,
  mapEtaPublishedCode,
} from './eta-item-codes.client';

describe('mapEtaPublishedCode', () => {
  it('maps published-code fields', () => {
    const mapped = mapEtaPublishedCode({
      CodeLookupValue: 'EG-123-1',
      codeNamePrimaryLang: 'Widget',
      active: true,
    });
    expect(mapped).toEqual({
      code: 'EG-123-1',
      description: 'Widget',
      isActive: true,
      raw: expect.any(Object),
    });
  });

  it('returns null without code', () => {
    expect(mapEtaPublishedCode({ codeNamePrimaryLang: 'x' })).toBeNull();
  });
});

describe('applyUpsertCounters', () => {
  it('counts added for new codes', () => {
    expect(
      applyUpsertCounters(null, {
        code: 'A',
        description: 'd',
        isActive: true,
        raw: {},
      }).action,
    ).toBe('added');
  });

  it('upgrades LOCAL to ETA as updated', () => {
    expect(
      applyUpsertCounters(
        { description: 'd', isActive: true, source: 'LOCAL' },
        { code: 'A', description: 'd', isActive: true, raw: {} },
      ).action,
    ).toBe('updated');
  });

  it('marks identical ETA rows unchanged (idempotent page)', () => {
    expect(
      applyUpsertCounters(
        { description: 'd', isActive: true, source: 'ETA' },
        { code: 'A', description: 'd', isActive: true, raw: {} },
      ).action,
    ).toBe('unchanged');
  });

  it('never returns a delete action for LOCAL-only codes', () => {
    const decision = applyUpsertCounters(
      { description: 'local-only', isActive: true, source: 'LOCAL' },
      { code: 'LOCAL1', description: 'from-eta', isActive: true, raw: {} },
    );
    expect(['added', 'updated', 'unchanged']).toContain(decision.action);
    expect(decision.nextSource).toBe('ETA');
  });
});

describe('EtaItemCodesClient pagination', () => {
  it('paginates until totalPages', async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      urls.push(String(input));
      const u = new URL(String(input));
      const pn = Number(u.searchParams.get('Pn'));
      if (pn === 1) {
        return new Response(
          JSON.stringify({
            result: [
              {
                CodeLookupValue: 'C1',
                codeNamePrimaryLang: 'One',
                active: true,
              },
              {
                CodeLookupValue: 'C2',
                codeNamePrimaryLang: 'Two',
                active: true,
              },
            ],
            metadata: { totalPages: 2, totalCount: 3 },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          result: [
            {
              CodeLookupValue: 'C3',
              codeNamePrimaryLang: 'Three',
              active: false,
            },
          ],
          metadata: { totalPages: 2, totalCount: 3 },
        }),
        { status: 200 },
      );
    };

    const client = new EtaItemCodesClient('https://api.eta.test', fetchImpl);
    const pages = [];
    for await (const page of client.paginateAll('tok', 'EGS', {
      pageSize: 2,
      taxpayerRin: '123',
    })) {
      pages.push(page);
    }
    expect(pages).toHaveLength(2);
    expect(pages[0]!.items.map((i) => i.code)).toEqual(['C1', 'C2']);
    expect(pages[1]!.items[0]!.code).toBe('C3');
    expect(urls[0]).toContain('TaxpayerRIN=123');
    expect(urls[0]).toContain('codetypes/EGS/codes');
  });

  it('respects Retry-After on 429 then succeeds', async () => {
    let n = 0;
    const fetchImpl: typeof fetch = async () => {
      n += 1;
      if (n === 1) {
        return new Response('rate', {
          status: 429,
          headers: { 'Retry-After': '0' },
        });
      }
      return new Response(
        JSON.stringify({
          result: [
            { CodeLookupValue: 'Z', codeNamePrimaryLang: 'Z', active: true },
          ],
        }),
        { status: 200 },
      );
    };
    const client = new EtaItemCodesClient('https://api.eta.test', fetchImpl);
    const page = await client.fetchPage('tok', 'GS1', {
      pageNumber: 1,
      pageSize: 10,
    });
    expect(page.items[0]!.code).toBe('Z');
    expect(n).toBe(2);
  });
});
