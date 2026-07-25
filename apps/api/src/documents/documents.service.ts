import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  buildByKind,
  canonicalSerialize,
  KIND_TO_ETA_TYPE,
  validateDocument,
  type DocumentKind as EtaDocumentKind,
  type JsonObject,
  type LineInput,
} from '@einvoice/eta-core';
import type { DocumentKind, DocumentStatus, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';

export type DocumentUpsertDto = {
  kind: DocumentKind;
  branchId: string;
  currencyCode: string;
  issueDateTime: string;
  internalId: string;
  version: number;
  receiver?: {
    type?: string;
    id?: string;
    name?: string;
    address?: Record<string, unknown>;
  };
  references?: Record<string, unknown> | null;
  extraDiscountAmount?: string;
  lines: Array<{
    description: string;
    itemType: string;
    itemCode: string;
    unitType: string;
    quantity: string;
    unitPrice: string;
    discountRate?: string;
    discountAmount?: string;
    taxes?: Array<{ taxType: string; subType: string; rate: string }>;
  }>;
};

@Injectable()
export class DocumentsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  private lineInputs(dto: DocumentUpsertDto): LineInput[] {
    return dto.lines.map((l) => ({
      description: l.description,
      itemType: l.itemType,
      itemCode: l.itemCode,
      unitType: l.unitType,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountRate: l.discountRate,
      discountAmount: l.discountAmount,
      taxes: l.taxes,
    }));
  }

  private async resolveBinding(
    tx: Prisma.TransactionClient,
    tenantId: string,
    kind: DocumentKind,
    branchId: string,
    currencyCode: string,
    issueDateTime: Date,
  ) {
    const branch = await tx.branch.findFirst({ where: { id: branchId, tenantId } });
    if (!branch || !branch.isActive) {
      throw new BadRequestException('Branch inactive or missing');
    }

    const currency = await tx.tenantCurrency.findFirst({
      where: { tenantId, currencyCode },
    });
    if (!currency) {
      throw new BadRequestException('Currency not enabled for tenant');
    }

    let exchangeRate: string | null = null;
    if (currencyCode !== 'EGP') {
      const rate = await tx.exchangeRate.findFirst({
        where: {
          tenantId,
          baseCurrencyCode: 'EGP',
          quoteCurrencyCode: currencyCode,
          effectiveFrom: { lte: issueDateTime },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: issueDateTime } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (!rate) {
        throw new BadRequestException('Exchange rate missing for issue date');
      }
      exchangeRate = rate.rate.toFixed(8);
    }

    const issuerSnapshot: JsonObject = {
      type: 'B',
      id: '',
      name: branch.name,
      address: {
        branchId: branch.etaBranchCode ?? '0',
      },
    };

    const etaDocumentType = KIND_TO_ETA_TYPE[kind as EtaDocumentKind];
    const etaDocumentTypeVersion = '1.0';

    return {
      branch,
      exchangeRate,
      issuerSnapshot,
      etaDocumentType,
      etaDocumentTypeVersion,
      typeVersionFetchedAt: new Date(),
    };
  }

  private buildFromDto(
    dto: DocumentUpsertDto,
    issuerSnapshot: JsonObject,
    documentTypeVersion: string,
  ) {
    const lines = this.lineInputs(dto);
    return buildByKind(dto.kind as EtaDocumentKind, {
      documentTypeVersion,
      dateTimeIssued: new Date(dto.issueDateTime).toISOString(),
      internalID: dto.internalId,
      issuer: issuerSnapshot,
      receiver: {
        type: dto.receiver?.type ?? 'B',
        id: dto.receiver?.id ?? '',
        name: dto.receiver?.name ?? '',
        ...(dto.receiver?.address
          ? { address: dto.receiver.address as JsonObject }
          : {}),
      },
      lines,
      extraDiscountAmount: dto.extraDiscountAmount ?? '0.00',
      references: (dto.references as JsonObject | undefined) ?? null,
      taxpayerActivityCode: '',
    });
  }

  private toDetail(doc: {
    id: string;
    kind: DocumentKind;
    status: DocumentStatus;
    branchId: string;
    currencyCode: string;
    exchangeRate: string | null;
    issueDateTime: Date;
    internalId: string;
    etaDocumentType: string;
    etaDocumentTypeVersion: string;
    totalSalesAmount: string;
    totalDiscountAmount: string;
    netAmount: string;
    totalAmount: string;
    extraDiscountAmount: string;
    taxTotalsJson: Prisma.JsonValue;
    etaPayloadJson: Prisma.JsonValue;
    canonicalPreview: string | null;
    version: number;
    signaturesJson?: Prisma.JsonValue | null;
    signedAt?: Date | null;
    lines: Array<Record<string, unknown>>;
  }) {
    const etaPayload = doc.etaPayloadJson as JsonObject;
    const canonicalString =
      doc.canonicalPreview ?? canonicalSerialize(etaPayload);
    return {
      id: doc.id,
      kind: doc.kind,
      status: doc.status,
      branchId: doc.branchId,
      currencyCode: doc.currencyCode,
      exchangeRate: doc.exchangeRate,
      issueDateTime: doc.issueDateTime.toISOString(),
      internalId: doc.internalId,
      etaDocumentType: doc.etaDocumentType,
      etaDocumentTypeVersion: doc.etaDocumentTypeVersion,
      lines: doc.lines,
      totals: {
        totalSalesAmount: doc.totalSalesAmount,
        totalDiscountAmount: doc.totalDiscountAmount,
        netAmount: doc.netAmount,
        totalAmount: doc.totalAmount,
        extraDiscountAmount: doc.extraDiscountAmount,
        taxTotals: doc.taxTotalsJson,
      },
      etaPayload,
      canonicalString,
      version: doc.version,
      signaturesJson: doc.signaturesJson ?? null,
      signedAt: doc.signedAt?.toISOString() ?? null,
    };
  }

  list(tenantId: string, filters?: { status?: DocumentStatus; kind?: DocumentKind }) {
    return this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.document.findMany({
        where: {
          ...(filters?.status ? { status: filters.status } : {}),
          ...(filters?.kind ? { kind: filters.kind } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          kind: true,
          status: true,
          internalId: true,
          issueDateTime: true,
          currencyCode: true,
          totalAmount: true,
          updatedAt: true,
        },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const doc = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.document.findFirst({
        where: { id, tenantId },
        include: { lines: { include: { taxes: true }, orderBy: { lineNumber: 'asc' } } },
      }),
    );
    if (!doc) throw new NotFoundException('Document not found');
    return this.toDetail(doc);
  }

  async create(tenantId: string, actorUserId: string, dto: DocumentUpsertDto) {
    if (!dto.lines?.length) throw new BadRequestException('At least one line required');

    const created = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const issueDateTime = new Date(dto.issueDateTime);
      const binding = await this.resolveBinding(
        tx,
        tenantId,
        dto.kind,
        dto.branchId,
        dto.currencyCode,
        issueDateTime,
      );
      const built = this.buildFromDto(dto, binding.issuerSnapshot, binding.etaDocumentTypeVersion);
      const canonical = canonicalSerialize(built.etaPayload);

      const doc = await tx.document.create({
        data: {
          tenantId,
          kind: dto.kind,
          status: 'DRAFT',
          branchId: dto.branchId,
          currencyCode: dto.currencyCode,
          exchangeRate: binding.exchangeRate,
          issueDateTime,
          internalId: dto.internalId,
          etaDocumentType: binding.etaDocumentType,
          etaDocumentTypeVersion: binding.etaDocumentTypeVersion,
          typeVersionFetchedAt: binding.typeVersionFetchedAt,
          receiverType: dto.receiver?.type,
          receiverId: dto.receiver?.id,
          receiverName: dto.receiver?.name,
          receiverAddressJson: dto.receiver?.address as Prisma.InputJsonValue | undefined,
          issuerSnapshotJson: binding.issuerSnapshot as Prisma.InputJsonValue,
          referencesJson: (dto.references as Prisma.InputJsonValue) ?? undefined,
          extraDiscountAmount: built.totals.extraDiscountAmount,
          totalSalesAmount: built.totals.totalSalesAmount,
          totalDiscountAmount: built.totals.totalDiscountAmount,
          netAmount: built.totals.netAmount,
          totalAmount: built.totals.totalAmount,
          totalItemsDiscountAmount: built.totals.totalItemsDiscountAmount,
          taxTotalsJson: built.totals.taxTotals as unknown as Prisma.InputJsonValue,
          etaPayloadJson: built.etaPayload as Prisma.InputJsonValue,
          canonicalPreview: canonical,
          version: 1,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
          lines: {
            create: built.lineComputed.map((c, i) => {
              const src = dto.lines[i]!;
              return {
                tenantId,
                lineNumber: i + 1,
                description: src.description,
                itemType: src.itemType,
                itemCode: src.itemCode,
                unitType: src.unitType,
                quantity: src.quantity,
                unitPrice: src.unitPrice,
                discountRate: src.discountRate,
                discountAmount: c.discount,
                salesTotal: c.salesTotal,
                netTotal: c.netTotal,
                total: c.total,
                valueDifference: c.valueDifference,
                totalTaxableFees: c.totalTaxableFees,
                itemsDiscount: c.itemsDiscount,
                taxes: {
                  create: c.taxAmounts.map((t) => ({
                    tenantId,
                    taxType: t.taxType,
                    subType: t.subType,
                    rate: t.rate,
                    amount: t.amount,
                  })),
                },
              };
            }),
          },
        },
        include: { lines: { include: { taxes: true }, orderBy: { lineNumber: 'asc' } } },
      });
      return doc;
    });

    await this.audit.write({
      action: 'documents.draft.create',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'document',
      resourceId: created.id,
      metadata: { kind: created.kind, internalId: created.internalId },
    });

    return this.toDetail(created);
  }

  async update(tenantId: string, actorUserId: string, id: string, dto: DocumentUpsertDto) {
    if (!dto.lines?.length) throw new BadRequestException('At least one line required');

    const updated = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.document.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Document not found');
      if (existing.version !== dto.version) {
        throw new ConflictException('Stale version');
      }

      const issueDateTime = new Date(dto.issueDateTime);
      const binding = await this.resolveBinding(
        tx,
        tenantId,
        dto.kind,
        dto.branchId,
        dto.currencyCode,
        issueDateTime,
      );
      const built = this.buildFromDto(dto, binding.issuerSnapshot, binding.etaDocumentTypeVersion);
      const canonical = canonicalSerialize(built.etaPayload);

      await tx.documentLineTax.deleteMany({
        where: { line: { documentId: id } },
      });
      await tx.documentLine.deleteMany({ where: { documentId: id } });

      return tx.document.update({
        where: { id },
        data: {
          kind: dto.kind,
          status: 'DRAFT',
          branchId: dto.branchId,
          currencyCode: dto.currencyCode,
          exchangeRate: binding.exchangeRate,
          issueDateTime,
          internalId: dto.internalId,
          etaDocumentType: binding.etaDocumentType,
          etaDocumentTypeVersion: binding.etaDocumentTypeVersion,
          typeVersionFetchedAt: binding.typeVersionFetchedAt,
          receiverType: dto.receiver?.type,
          receiverId: dto.receiver?.id,
          receiverName: dto.receiver?.name,
          receiverAddressJson: dto.receiver?.address as Prisma.InputJsonValue | undefined,
          issuerSnapshotJson: binding.issuerSnapshot as Prisma.InputJsonValue,
          referencesJson: (dto.references as Prisma.InputJsonValue) ?? undefined,
          extraDiscountAmount: built.totals.extraDiscountAmount,
          totalSalesAmount: built.totals.totalSalesAmount,
          totalDiscountAmount: built.totals.totalDiscountAmount,
          netAmount: built.totals.netAmount,
          totalAmount: built.totals.totalAmount,
          totalItemsDiscountAmount: built.totals.totalItemsDiscountAmount,
          taxTotalsJson: built.totals.taxTotals as unknown as Prisma.InputJsonValue,
          etaPayloadJson: built.etaPayload as Prisma.InputJsonValue,
          canonicalPreview: canonical,
          version: { increment: 1 },
          updatedByUserId: actorUserId,
          lines: {
            create: built.lineComputed.map((c, i) => {
              const src = dto.lines[i]!;
              return {
                tenantId,
                lineNumber: i + 1,
                description: src.description,
                itemType: src.itemType,
                itemCode: src.itemCode,
                unitType: src.unitType,
                quantity: src.quantity,
                unitPrice: src.unitPrice,
                discountRate: src.discountRate,
                discountAmount: c.discount,
                salesTotal: c.salesTotal,
                netTotal: c.netTotal,
                total: c.total,
                valueDifference: c.valueDifference,
                totalTaxableFees: c.totalTaxableFees,
                itemsDiscount: c.itemsDiscount,
                taxes: {
                  create: c.taxAmounts.map((t) => ({
                    tenantId,
                    taxType: t.taxType,
                    subType: t.subType,
                    rate: t.rate,
                    amount: t.amount,
                  })),
                },
              };
            }),
          },
        },
        include: { lines: { include: { taxes: true }, orderBy: { lineNumber: 'asc' } } },
      });
    });

    await this.audit.write({
      action: 'documents.draft.update',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'document',
      resourceId: id,
      metadata: { kind: updated.kind },
    });

    return this.toDetail(updated);
  }

  async remove(tenantId: string, actorUserId: string, id: string) {
    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.document.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Document not found');
      await tx.document.delete({ where: { id } });
    });
    await this.audit.write({
      action: 'documents.draft.delete',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'document',
      resourceId: id,
      metadata: {},
    });
  }

  async preview(tenantId: string, dto: DocumentUpsertDto) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const issueDateTime = new Date(dto.issueDateTime);
      const binding = await this.resolveBinding(
        tx,
        tenantId,
        dto.kind,
        dto.branchId,
        dto.currencyCode,
        issueDateTime,
      );
      const built = this.buildFromDto(dto, binding.issuerSnapshot, binding.etaDocumentTypeVersion);
      return {
        etaPayload: built.etaPayload,
        canonicalString: canonicalSerialize(built.etaPayload),
        totals: built.totals,
      };
    });
  }

  async previewById(tenantId: string, id: string, dto?: DocumentUpsertDto) {
    if (dto) return this.preview(tenantId, dto);
    const detail = await this.get(tenantId, id);
    return {
      etaPayload: detail.etaPayload,
      canonicalString: detail.canonicalString,
      totals: detail.totals,
    };
  }

  async validate(tenantId: string, actorUserId: string, id: string) {
    const detail = await this.get(tenantId, id);
    const result = await this.runValidation(tenantId, detail);
    await this.audit.write({
      action: result.ok ? 'documents.validate.success' : 'documents.validate.failure',
      outcome: result.ok ? 'success' : 'failure',
      actorUserId,
      tenantId,
      resourceType: 'document',
      resourceId: id,
      metadata: { codes: result.issues.map((i) => i.code) },
    });
    return result;
  }

  async markReady(tenantId: string, actorUserId: string, id: string) {
    const detail = await this.get(tenantId, id);
    const result = await this.runValidation(tenantId, detail);
    if (!result.ok) {
      await this.audit.write({
        action: 'documents.mark_ready.failure',
        outcome: 'failure',
        actorUserId,
        tenantId,
        resourceType: 'document',
        resourceId: id,
        metadata: { codes: result.issues.map((i) => i.code) },
      });
      throw new BadRequestException({ ok: false, issues: result.issues });
    }

    const updated = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.document.update({
        where: { id },
        data: { status: 'READY', updatedByUserId: actorUserId },
        include: { lines: { include: { taxes: true }, orderBy: { lineNumber: 'asc' } } },
      }),
    );

    await this.audit.write({
      action: 'documents.mark_ready.success',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'document',
      resourceId: id,
      metadata: {},
    });
    return this.toDetail(updated);
  }

  private async runValidation(
    tenantId: string,
    detail: Awaited<ReturnType<DocumentsService['get']>>,
  ) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const branch = await tx.branch.findFirst({
        where: { id: detail.branchId, tenantId },
      });
      const currency = await tx.tenantCurrency.findFirst({
        where: { tenantId, currencyCode: detail.currencyCode },
      });

      const codes = detail.lines.map((l) => (l as { itemCode: string }).itemCode);
      const found = await tx.itemCode.findMany({
        where: { tenantId, code: { in: codes }, isActive: true },
      });
      const itemCodesOk =
        codes.length === 0 || codes.every((c) => found.some((f) => f.code === c));

      let originalDocumentOk: boolean | undefined;
      const isNote =
        detail.kind.includes('CREDIT') || detail.kind.includes('DEBIT');
      if (isNote) {
        const refs = (detail.etaPayload as JsonObject).references as
          | JsonObject
          | undefined;
        if (!refs) {
          originalDocumentOk = false;
        } else {
          const refInternal = String(refs.internalID ?? refs.internalId ?? '');
          if (!refInternal) originalDocumentOk = false;
          else {
            const orig = await tx.document.findFirst({
              where: { tenantId, internalId: refInternal },
            });
            originalDocumentOk = Boolean(orig);
          }
        }
      }

      let exchangeRateOk: boolean | undefined;
      if (detail.currencyCode !== 'EGP') {
        exchangeRateOk = Boolean(detail.exchangeRate);
      }

      const issues = validateDocument({
        kind: detail.kind as EtaDocumentKind,
        document: detail.etaPayload as JsonObject,
        typeVersionSchema: {
          documentType: detail.etaDocumentType,
          documentTypeVersion: detail.etaDocumentTypeVersion,
          requiredPaths: ['issuer', 'receiver', 'invoiceLines', 'internalID'],
        },
        refs: {
          branchOk: Boolean(branch?.isActive),
          currencyOk: Boolean(currency),
          itemCodesOk,
          originalDocumentOk,
          exchangeRateOk,
        },
        lines: detail.lines.map((l) => ({
          description: String((l as { description: string }).description),
          itemType: String((l as { itemType: string }).itemType),
          itemCode: String((l as { itemCode: string }).itemCode),
          unitType: String((l as { unitType: string }).unitType),
          quantity: String((l as { quantity: string }).quantity),
          unitPrice: String((l as { unitPrice: string }).unitPrice),
        })),
      });

      return {
        ok: issues.length === 0,
        issues: issues.map((i) => ({
          code: i.code,
          path: i.path,
          severity: i.severity,
          message: i.messageKey,
        })),
      };
    });
  }
}
