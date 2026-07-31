import { BadRequestException, ConflictException } from '@nestjs/common';
import { PurchasesBuyerActionsService } from '../src/purchases/purchases-buyer-actions.service';
import type {
  ReceivedDocBuyerRow,
  ReceivedDocumentBuyerStore,
} from '../src/purchases/purchases-buyer-actions.service';
import {
  EtaDocumentLifecycleClient,
  EtaDocumentLifecycleError,
} from '../src/eta/eta-document-lifecycle.client';
import type { ReceivedBuyerDecision } from '../src/purchases/buyer-decision';

function memoryStore(seed: ReceivedDocBuyerRow): ReceivedDocumentBuyerStore {
  let row = { ...seed };
  return {
    async findById(tenantId, id) {
      if (row.tenantId !== tenantId || row.id !== id) return null;
      return { ...row };
    },
    async saveDecision(tenantId, id, patch) {
      if (row.tenantId !== tenantId || row.id !== id) {
        throw new Error('not found');
      }
      row = {
        ...row,
        buyerDecision: patch.buyerDecision,
        buyerDecisionReason: patch.buyerDecisionReason,
      };
      return { ...row };
    },
  };
}

describe('Purchases buyer actions (accept/reject/decline)', () => {
  const tenantId = 'tenant-a';
  const userId = 'user-1';
  const docId = 'doc-1';

  function seed(decision: ReceivedBuyerDecision = 'NONE'): ReceivedDocBuyerRow {
    return {
      id: docId,
      tenantId,
      documentUuid: 'eta-uuid-1',
      buyerDecision: decision,
      buyerDecisionReason: null,
    };
  }

  function buildService(store: ReceivedDocumentBuyerStore, lifecycleFetch?: typeof fetch) {
    const eta = {
      getAccessToken: jest.fn(async () => 'access-token'),
    };
    const audit = {
      write: jest.fn(async () => undefined),
    };
    const svc = new PurchasesBuyerActionsService(
      eta as never,
      audit as never,
      store,
    );
    if (lifecycleFetch) {
      svc.setLifecycleForTests(
        new EtaDocumentLifecycleClient('https://eta.test', lifecycleFetch),
      );
    } else {
      svc.setLifecycleForTests(
        new EtaDocumentLifecycleClient(
          'https://eta.test',
          (async () => new Response('', { status: 200 })) as typeof fetch,
        ),
      );
    }
    return { svc, eta, audit };
  }

  it('accepts locally without requiring ETA reject body', async () => {
    const store = memoryStore(seed('NONE'));
    const { svc, audit } = buildService(store);
    const saved = await svc.accept(tenantId, userId, docId);
    expect(saved.buyerDecision).toBe('ACCEPTED');
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'purchases.accept', outcome: 'success' }),
    );
  });

  it('rejects via ETA state endpoint then persists REJECTED', async () => {
    const store = memoryStore(seed('NONE'));
    const calls: string[] = [];
    const { svc } = buildService(
      store,
      (async (url) => {
        calls.push(String(url));
        return new Response('', { status: 200 });
      }) as typeof fetch,
    );
    const saved = await svc.reject(tenantId, userId, docId, 'Duplicate delivery');
    expect(saved.buyerDecision).toBe('REJECTED');
    expect(saved.buyerDecisionReason).toBe('Duplicate delivery');
    expect(calls[0]).toContain('/documents/state/eta-uuid-1/state');
  });

  it('requires reject reason', async () => {
    const store = memoryStore(seed('NONE'));
    const { svc } = buildService(store);
    await expect(svc.reject(tenantId, userId, docId, '')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('conflicts when already accepted', async () => {
    const store = memoryStore(seed('ACCEPTED'));
    const { svc } = buildService(store);
    await expect(svc.accept(tenantId, userId, docId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      svc.reject(tenantId, userId, docId, 'nope'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('marks NEEDS_ATTENTION when ETA reject fails and allows retry', async () => {
    const store = memoryStore(seed('NONE'));
    const { svc } = buildService(
      store,
      (async () =>
        new Response(JSON.stringify({ message: 'not actionable' }), {
          status: 400,
        })) as typeof fetch,
    );
    await expect(
      svc.reject(tenantId, userId, docId, 'bad'),
    ).rejects.toBeInstanceOf(EtaDocumentLifecycleError);

    const after = await store.findById(tenantId, docId);
    expect(after?.buyerDecision).toBe('NEEDS_ATTENTION');

    // Retry path: swap lifecycle to success
    svc.setLifecycleForTests(
      new EtaDocumentLifecycleClient(
        'https://eta.test',
        (async () => new Response('', { status: 200 })) as typeof fetch,
      ),
    );
    const saved = await svc.reject(tenantId, userId, docId, 'bad');
    expect(saved.buyerDecision).toBe('REJECTED');
  });

  it('decline-cancelation uses Phase 6 decline path', async () => {
    const store = memoryStore(seed('NONE'));
    const calls: string[] = [];
    const { svc } = buildService(
      store,
      (async (url) => {
        calls.push(String(url));
        return new Response('', { status: 200 });
      }) as typeof fetch,
    );
    const saved = await svc.declineCancelation(tenantId, userId, docId);
    expect(saved.buyerDecision).toBe('DECLINED_CANCELATION');
    expect(calls[0]).toContain('/decline/cancelation');
  });
});
