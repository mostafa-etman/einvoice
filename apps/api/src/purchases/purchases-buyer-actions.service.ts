import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { loadEnv } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { EtaService } from '../eta/eta.service';
import {
  EtaDocumentLifecycleClient,
  EtaDocumentLifecycleError,
} from '../eta/eta-document-lifecycle.client';
import {
  buyerDecisionAfterEtaFailure,
  evaluateBuyerDecision,
  type ReceivedBuyerDecision,
} from './buyer-decision';

export type ReceivedDocBuyerRow = {
  id: string;
  tenantId: string;
  documentUuid: string;
  buyerDecision: ReceivedBuyerDecision;
  buyerDecisionReason: string | null;
};

/** Persistence seam for buyer actions (real impl uses Prisma ReceivedDocument). */
export type ReceivedDocumentBuyerStore = {
  findById(tenantId: string, id: string): Promise<ReceivedDocBuyerRow | null>;
  saveDecision(
    tenantId: string,
    id: string,
    patch: {
      buyerDecision: ReceivedBuyerDecision;
      buyerDecisionReason: string | null;
      buyerDecisionAt: Date;
      buyerDecisionByUserId: string;
      needsAttention: boolean;
      needsAttentionReason: string | null;
    },
  ): Promise<ReceivedDocBuyerRow>;
};

/**
 * Accept / Reject / Decline-cancelation for received documents.
 * Accept is local; Reject and Decline-cancelation call shared Phase 6 ETA paths.
 */
@Injectable()
export class PurchasesBuyerActionsService {
  private lifecycle: EtaDocumentLifecycleClient | null = null;

  constructor(
    private readonly eta: EtaService,
    private readonly audit: AuditService,
    private readonly store: ReceivedDocumentBuyerStore,
  ) {}

  /** Test seam */
  setLifecycleForTests(client: EtaDocumentLifecycleClient) {
    this.lifecycle = client;
  }

  private getLifecycle(): EtaDocumentLifecycleClient {
    if (!this.lifecycle) {
      const env = loadEnv();
      this.lifecycle = new EtaDocumentLifecycleClient(env.ETA_API_BASE_URL);
    }
    return this.lifecycle;
  }

  async accept(tenantId: string, userId: string, id: string) {
    const doc = await this.requireDoc(tenantId, id);
    const decision = evaluateBuyerDecision(doc.buyerDecision, 'ACCEPT');
    if (!decision.ok) {
      throw new ConflictException({ code: decision.code, message: decision.message });
    }

    const saved = await this.store.saveDecision(tenantId, id, {
      buyerDecision: decision.next,
      buyerDecisionReason: null,
      buyerDecisionAt: new Date(),
      buyerDecisionByUserId: userId,
      needsAttention: false,
      needsAttentionReason: null,
    });

    await this.audit.write({
      action: 'purchases.accept',
      outcome: 'success',
      actorUserId: userId,
      tenantId,
      resourceType: 'received_document',
      resourceId: id,
      metadata: { documentUuid: doc.documentUuid },
    });

    return saved;
  }

  async reject(tenantId: string, userId: string, id: string, reason: string) {
    const doc = await this.requireDoc(tenantId, id);
    const decision = evaluateBuyerDecision(doc.buyerDecision, 'REJECT', reason);
    if (!decision.ok) {
      if (decision.code === 'REASON_REQUIRED') {
        throw new BadRequestException({
          code: decision.code,
          message: decision.message,
        });
      }
      throw new ConflictException({ code: decision.code, message: decision.message });
    }

    try {
      const token = await this.eta.getAccessToken(tenantId);
      await this.getLifecycle().rejectDocument(token, doc.documentUuid, reason.trim());
    } catch (err) {
      const message =
        err instanceof EtaDocumentLifecycleError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'ETA reject failed';
      await this.store.saveDecision(tenantId, id, {
        buyerDecision: buyerDecisionAfterEtaFailure(doc.buyerDecision),
        buyerDecisionReason: reason.trim(),
        buyerDecisionAt: new Date(),
        buyerDecisionByUserId: userId,
        needsAttention: true,
        needsAttentionReason: message,
      });
      await this.audit.write({
        action: 'purchases.reject',
        outcome: 'failure',
        actorUserId: userId,
        tenantId,
        resourceType: 'received_document',
        resourceId: id,
        metadata: { documentUuid: doc.documentUuid, error: message },
      });
      throw err;
    }

    const saved = await this.store.saveDecision(tenantId, id, {
      buyerDecision: decision.next,
      buyerDecisionReason: reason.trim(),
      buyerDecisionAt: new Date(),
      buyerDecisionByUserId: userId,
      needsAttention: false,
      needsAttentionReason: null,
    });

    await this.audit.write({
      action: 'purchases.reject',
      outcome: 'success',
      actorUserId: userId,
      tenantId,
      resourceType: 'received_document',
      resourceId: id,
      metadata: { documentUuid: doc.documentUuid },
    });

    return saved;
  }

  async declineCancelation(tenantId: string, userId: string, id: string) {
    const doc = await this.requireDoc(tenantId, id);
    const decision = evaluateBuyerDecision(
      doc.buyerDecision,
      'DECLINE_CANCELATION',
    );
    if (!decision.ok) {
      throw new ConflictException({ code: decision.code, message: decision.message });
    }

    try {
      const token = await this.eta.getAccessToken(tenantId);
      await this.getLifecycle().declineCancelation(token, doc.documentUuid);
    } catch (err) {
      const message =
        err instanceof EtaDocumentLifecycleError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'ETA decline cancelation failed';
      await this.store.saveDecision(tenantId, id, {
        buyerDecision: buyerDecisionAfterEtaFailure(doc.buyerDecision),
        buyerDecisionReason: doc.buyerDecisionReason,
        buyerDecisionAt: new Date(),
        buyerDecisionByUserId: userId,
        needsAttention: true,
        needsAttentionReason: message,
      });
      await this.audit.write({
        action: 'purchases.decline_cancelation',
        outcome: 'failure',
        actorUserId: userId,
        tenantId,
        resourceType: 'received_document',
        resourceId: id,
        metadata: { documentUuid: doc.documentUuid, error: message },
      });
      throw err;
    }

    const saved = await this.store.saveDecision(tenantId, id, {
      buyerDecision: decision.next,
      buyerDecisionReason: null,
      buyerDecisionAt: new Date(),
      buyerDecisionByUserId: userId,
      needsAttention: false,
      needsAttentionReason: null,
    });

    await this.audit.write({
      action: 'purchases.decline_cancelation',
      outcome: 'success',
      actorUserId: userId,
      tenantId,
      resourceType: 'received_document',
      resourceId: id,
      metadata: { documentUuid: doc.documentUuid },
    });

    return saved;
  }

  private async requireDoc(tenantId: string, id: string) {
    const doc = await this.store.findById(tenantId, id);
    if (!doc) throw new NotFoundException('Received document not found');
    return doc;
  }
}
