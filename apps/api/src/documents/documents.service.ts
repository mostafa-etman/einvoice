import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  buildByKind,
  canonicalSerialize,
  formatEtaDateTimeIssued,
  isSubtypeOfTaxType,
  KIND_TO_ETA_TYPE,
  serializeEtaDocument,
  validateDocument,
  type DocumentKind as EtaDocumentKind,
  type JsonObject,
  type LineInput,
} from '@einvoice/eta-core';
import type { DocumentKind, DocumentStatus, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';

export type AddressDto = {
  branchId?: string;
  country?: string;
  governate?: string;
  regionCity?: string;
  street?: string;
  buildingNumber?: string;
  postalCode?: string;
  floor?: string;
  room?: string;
  landmark?: string;
  additionalInformation?: string;
};

export type DocumentUpsertDto = {
  kind: DocumentKind;
  branchId: string;
  currencyCode: string;
  issueDateTime: string;
  internalId: string;
  version: number;
  taxpayerActivityCode?: string;
  purchaseOrderReference?: string;
  purchaseOrderDescription?: string;
  salesOrderReference?: string;
  salesOrderDescription?: string;
  proformaInvoiceNumber?: string;
  serviceDeliveryDate?: string;
  issuer?: {
    type?: string;
    id?: string;
    name?: string;
    address?: AddressDto;
  };
  receiver?: {
    type?: string;
    id?: string;
    name?: string;
    address?: AddressDto;
  };
  payment?: {
    bankName?: string;
    bankAddress?: string;
    bankAccountNo?: string;
    bankAccountIBAN?: string;
    swiftCode?: string;
    terms?: string;
  } | null;
  delivery?: {
    approach?: string;
    packaging?: string;
    dateValidity?: string;
    exportPort?: string;
    countryOfOrigin?: string;
    grossWeight?: string;
    netWeight?: string;
    terms?: string;
  } | null;
  /** ETA UUID string[] preferred; legacy { internalID } still accepted */
  references?: string[] | Record<string, unknown> | null;
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
    currencySold?: string;
    amountEGP?: string;
    amountSold?: string;
    currencyExchangeRate?: string;
    internalCode?: string;
    weightUnitType?: string;
    weightQuantity?: string;
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
      currencySold: l.currencySold,
      amountEGP: l.amountEGP,
      amountSold: l.amountSold,
      currencyExchangeRate: l.currencyExchangeRate,
      internalCode: l.internalCode,
      weightUnitType: l.weightUnitType,
      weightQuantity: l.weightQuantity,
    }));
  }

  private async resolveBinding(
    tx: Prisma.TransactionClient,
    tenantId: string,
    kind: DocumentKind,
    branchId: string,
    currencyCode: string,
    issueDateTime: Date,
    dto: DocumentUpsertDto,
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

    const branchCred = await tx.tenantEtaCredential.findFirst({
      where: { tenantId, branchId },
    });
    const tenantCred =
      branchCred ??
      (await tx.tenantEtaCredential.findFirst({
        where: { tenantId, branchId: null },
      }));

    const defaultAddress: JsonObject = {
      branchId: branch.etaBranchCode ?? '0',
      country: 'EG',
      ...(dto.issuer?.address
        ? (dto.issuer.address as JsonObject)
        : {}),
    };
    // Prefer explicit DTO values, but treat blank strings as unset so credentials/branch apply.
    const addr = defaultAddress;
    if (!String(addr.branchId ?? '').trim()) {
      addr.branchId = branch.etaBranchCode ?? '0';
    }
    if (!String(addr.country ?? '').trim()) {
      addr.country = 'EG';
    }

    const issuerSnapshot: JsonObject = {
      type: dto.issuer?.type?.trim() || 'B',
      id:
        dto.issuer?.id?.trim() ||
        tenantCred?.registrationNumber?.trim() ||
        '',
      name: dto.issuer?.name?.trim() || branch.name,
      address: addr,
    };

    const taxpayerActivityCode =
      dto.taxpayerActivityCode?.trim() ||
      branch.activityCode?.trim() ||
      tenantCred?.activityCode?.trim() ||
      '';

    const etaDocumentType = KIND_TO_ETA_TYPE[kind as EtaDocumentKind];
    const etaDocumentTypeVersion = '1.0';

    return {
      branch,
      exchangeRate,
      issuerSnapshot,
      taxpayerActivityCode,
      etaDocumentType,
      etaDocumentTypeVersion,
      typeVersionFetchedAt: new Date(),
    };
  }

  private buildFromDto(
    dto: DocumentUpsertDto,
    issuerSnapshot: JsonObject,
    documentTypeVersion: string,
    taxpayerActivityCode: string,
  ) {
    const lines = this.lineInputs(dto);
    const isExport = dto.kind.startsWith('EXPORT');
    const receiverType =
      dto.receiver?.type ?? (isExport ? 'F' : 'B');

    return buildByKind(dto.kind as EtaDocumentKind, {
      documentTypeVersion,
      dateTimeIssued: formatEtaDateTimeIssued(dto.issueDateTime),
      internalID: dto.internalId,
      issuer: issuerSnapshot,
      receiver: {
        type: receiverType,
        id: dto.receiver?.id ?? '',
        name: dto.receiver?.name ?? '',
        ...(dto.receiver?.address
          ? { address: dto.receiver.address as JsonObject }
          : {}),
      },
      lines,
      extraDiscountAmount: dto.extraDiscountAmount ?? '0.00',
      references: (dto.references as string[] | JsonObject | null | undefined) ?? null,
      taxpayerActivityCode,
      purchaseOrderReference: dto.purchaseOrderReference,
      purchaseOrderDescription: dto.purchaseOrderDescription,
      salesOrderReference: dto.salesOrderReference,
      salesOrderDescription: dto.salesOrderDescription,
      proformaInvoiceNumber: dto.proformaInvoiceNumber,
      serviceDeliveryDate: dto.serviceDeliveryDate,
      payment: (dto.payment as JsonObject | null | undefined) ?? null,
      delivery: (dto.delivery as JsonObject | null | undefined) ?? null,
    });
  }

  private lineCreateData(
    tenantId: string,
    dto: DocumentUpsertDto,
    built: ReturnType<DocumentsService['buildFromDto']>,
  ) {
    return built.lineComputed.map((c, i) => {
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
        currencySold: src.currencySold ?? dto.currencyCode,
        amountSold: src.amountSold,
        amountEgp: src.amountEGP ?? src.unitPrice,
        currencyExchangeRate: src.currencyExchangeRate,
        discountRate: src.discountRate,
        discountAmount: c.discount,
        salesTotal: c.salesTotal,
        netTotal: c.netTotal,
        total: c.total,
        valueDifference: c.valueDifference,
        totalTaxableFees: c.totalTaxableFees,
        itemsDiscount: c.itemsDiscount,
        internalCode: src.internalCode,
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
    needsAttention?: boolean;
    needsAttentionReason?: string | null;
    etaStatus?: string | null;
    etaUuid?: string | null;
    etaLongId?: string | null;
    submissionUuid?: string | null;
    etaStatusRaw?: Prisma.JsonValue | null;
    submitCooldownUntil?: Date | null;
    submitInFlight?: boolean;
    submitAttemptCount?: number;
    submitDuplicateRetryCount?: number;
    submitAttemptLog?: Prisma.JsonValue | null;
    lines: Array<Record<string, unknown>>;
  }) {
    const etaPayload = doc.etaPayloadJson as JsonObject;
    const canonicalString =
      doc.canonicalPreview ?? canonicalSerialize(etaPayload);
    const cooldownUntil = doc.submitCooldownUntil?.toISOString() ?? null;
    const cooldownActive = Boolean(
      doc.submitCooldownUntil && doc.submitCooldownUntil.getTime() > Date.now(),
    );
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
      needsAttention: doc.needsAttention ?? false,
      needsAttentionReason: doc.needsAttentionReason ?? null,
      etaStatus: doc.etaStatus ?? null,
      etaUuid: doc.etaUuid ?? null,
      etaLongId: doc.etaLongId ?? null,
      submissionUuid: doc.submissionUuid ?? null,
      etaStatusRaw: doc.etaStatusRaw ?? null,
      submitCooldownUntil: cooldownUntil,
      submitCooldownActive: cooldownActive,
      submitInFlight: doc.submitInFlight ?? false,
      submitAttemptCount: doc.submitAttemptCount ?? 0,
      submitDuplicateRetryCount: doc.submitDuplicateRetryCount ?? 0,
      submitAttemptLog: doc.submitAttemptLog ?? [],
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
          needsAttention: true,
          needsAttentionReason: true,
          submissionUuid: true,
          etaUuid: true,
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
        dto,
      );
      const built = this.buildFromDto(
        dto,
        binding.issuerSnapshot,
        binding.etaDocumentTypeVersion,
        binding.taxpayerActivityCode,
      );
      const payloadText = serializeEtaDocument(built.etaPayload);
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
          etaPayloadText: payloadText,
          canonicalPreview: canonical,
          version: 1,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
          lines: {
            create: this.lineCreateData(tenantId, dto, built),
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
        dto,
      );
      const built = this.buildFromDto(
        dto,
        binding.issuerSnapshot,
        binding.etaDocumentTypeVersion,
        binding.taxpayerActivityCode,
      );
      const payloadText = serializeEtaDocument(built.etaPayload);
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
          etaPayloadText: payloadText,
          canonicalPreview: canonical,
          version: { increment: 1 },
          // New bytes are not the payload ETA flagged as duplicate, so any
          // pending duplicate cooldown no longer applies to this document.
          submitCooldownUntil: null,
          submitCooldownPayloadHash: null,
          submitPendingRetrySubmissionId: null,
          updatedByUserId: actorUserId,
          lines: {
            create: this.lineCreateData(tenantId, dto, built),
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
        dto,
      );
      const built = this.buildFromDto(
        dto,
        binding.issuerSnapshot,
        binding.etaDocumentTypeVersion,
        binding.taxpayerActivityCode,
      );
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
        const refs = (detail.etaPayload as JsonObject).references;
        if (!refs) {
          originalDocumentOk = false;
        } else if (Array.isArray(refs)) {
          originalDocumentOk = refs.length > 0;
        } else {
          const refObj = refs as JsonObject;
          const refInternal = String(refObj.internalID ?? refObj.internalId ?? '');
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

      // Each taxableItem's subType must be a seeded child of its taxType, so a
      // mismatched pair (e.g. T3 + Mn01) can never reach ETA.
      const taxSubtypes = await tx.etaCodeEntry.findMany({
        where: { catalogKind: 'TAX_SUBTYPE', isActive: true },
        select: { code: true, parentCode: true },
      });
      const taxPairIssues: Array<{ line: number; taxType: string; subType: string }> =
        [];
      detail.lines.forEach((l, i) => {
        const taxes =
          (l as { taxes?: Array<{ taxType: string; subType: string }> }).taxes ?? [];
        for (const tax of taxes) {
          if (!isSubtypeOfTaxType(taxSubtypes, tax.taxType, tax.subType)) {
            taxPairIssues.push({
              line: i + 1,
              taxType: tax.taxType,
              subType: tax.subType,
            });
          }
        }
      });

      const requiredPaths = [
        'issuer',
        'issuer.id',
        'issuer.name',
        'issuer.address.branchId',
        'issuer.address.country',
        'issuer.address.governate',
        'issuer.address.regionCity',
        'issuer.address.street',
        'issuer.address.buildingNumber',
        'receiver',
        'invoiceLines',
        'internalID',
        'taxpayerActivityCode',
      ];
      if (detail.kind === 'EXPORT_INVOICE') {
        requiredPaths.push('serviceDeliveryDate');
      }
      if (detail.kind.startsWith('EXPORT')) {
        // Export notes/invoices require foreign receiver
        requiredPaths.push('receiver.id', 'receiver.name', 'receiver.address.country');
      }

      const issues = validateDocument({
        kind: detail.kind as EtaDocumentKind,
        document: detail.etaPayload as JsonObject,
        typeVersionSchema: {
          documentType: detail.etaDocumentType,
          documentTypeVersion: detail.etaDocumentTypeVersion,
          requiredPaths,
        },
        refs: {
          branchOk: Boolean(branch?.isActive),
          currencyOk: Boolean(currency),
          itemCodesOk,
          originalDocumentOk,
          exchangeRateOk,
        },
        lines: detail.lines.map((l) => {
          const taxesRaw = (l as { taxes?: Array<Record<string, string>> }).taxes;
          return {
            description: String((l as { description: string }).description),
            itemType: String((l as { itemType: string }).itemType),
            itemCode: String((l as { itemCode: string }).itemCode),
            unitType: String((l as { unitType: string }).unitType),
            quantity: String((l as { quantity: string }).quantity),
            unitPrice: String((l as { unitPrice: string }).unitPrice),
            taxes: Array.isArray(taxesRaw)
              ? taxesRaw.map((t) => ({
                  taxType: String(t.taxType),
                  subType: String(t.subType),
                  rate: String(t.rate),
                }))
              : [],
          };
        }),
      });

      for (const bad of taxPairIssues) {
        issues.push({
          code: 'TAX_SUBTYPE_PARENT_MISMATCH',
          path: `lines[${bad.line - 1}].taxes`,
          severity: 'error',
          messageKey: 'documents.validation.taxSubtypeParent',
          params: { taxType: bad.taxType, subType: bad.subType },
        });
      }

      const errors = issues.filter((i) => i.severity === 'error');
      return {
        ok: errors.length === 0,
        issues: issues.map((i) => ({
          code: i.code,
          path: i.path,
          severity: i.severity,
          messageKey: i.messageKey,
          message:
            i.code === 'REQUIRED_FIELD'
              ? `Missing required field: ${i.path}`
              : i.code === 'DUPLICATE_TAX_TYPE'
                ? `TaxType must be unique per line: ${i.params?.taxTypes ?? ''}`
                : i.code === 'TAX_TYPICALLY_REQUIRED'
                  ? 'This document type typically requires VAT. A fully tax-free invoice may be refused by ETA. You can still proceed if the supply is truly not taxable.'
                  : i.code === 'TAX_SUBTYPE_PARENT_MISMATCH'
                    ? `Tax subtype ${i.params?.subType ?? ''} does not belong to tax type ${i.params?.taxType ?? ''}`
                    : i.params?.path
                    ? `${i.messageKey} (${i.params.path})`
                    : `${i.code}: ${i.path}`,
          params: i.params,
        })),
      };
    });
  }
}
