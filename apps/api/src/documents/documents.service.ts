import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  buildByKind,
  canonicalSerialize,
  formatEtaDateTimeIssued,
  isFixedAmountTaxType,
  isSubtypeOfTaxType,
  isValidEtaInternalId,
  KIND_TO_ETA_TYPE,
  resolveIssuerAddress,
  resolveIssuerId,
  resolveIssuerName,
  resolveIssuerType,
  isIssuerNameComplete,
  serializeEtaDocument,
  validateDocument,
  type DocumentKind as EtaDocumentKind,
  type IssuerAddress,
  type JsonObject,
  type LineInput,
} from '@einvoice/eta-core';
import type { DocumentKind, DocumentOrigin, DocumentStatus, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { QuotaService } from '../billing/quota.service';
import { EtaService } from '../eta/eta.service';
import { branchAddressToIssuerAddress } from '../settings/branches/branches.service';
import type { ArtifactStorage } from '../storage/storage.module';
import {
  normalizeLineTaxes,
  renderLocalInvoicePdf,
  type LocalInvoicePdfLocale,
} from './local-invoice-pdf';
import { assertDocumentMutable } from './documents-mutability';

export { assertDocumentMutable } from './documents-mutability';

/** Issuer identity/address is company-level, so it is fixed in Settings. */
function isIssuerSettingsPath(path: string): boolean {
  return path === 'issuer' || path.startsWith('issuer.');
}

/** Company identity → ETA credentials; address → Branches. */
function issuerSettingsArea(
  path: string,
): 'branches' | 'eta-credentials' {
  if (
    path === 'issuer.name' ||
    path === 'issuer.id' ||
    path === 'issuer.type' ||
    path === 'issuer'
  ) {
    return 'eta-credentials';
  }
  return 'branches';
}

const ISSUER_FIELD_LABELS: Record<string, string> = {
  governate: 'address governate',
  regionCity: 'address region/city',
  street: 'address street',
  buildingNumber: 'address building number',
  country: 'address country',
  branchId: 'ETA branch code',
  id: 'ETA registration number',
  name: 'taxpayer legal name',
  type: 'registration type (B/P/F)',
};

function issuerFixMessage(path: string, code?: string): string {
  const field = path.split('.').pop() ?? path;
  const label = ISSUER_FIELD_LABELS[field] ?? field;
  const where =
    issuerSettingsArea(path) === 'eta-credentials'
      ? 'Settings → ETA connection'
      : 'Settings → Branches';
  if (code === 'ISSUER_NAME_PLACEHOLDER') {
    return `Issuer name is still the branch label (e.g. "Main"), not your company name. Set the taxpayer legal name in ${where}, then reopen this invoice.`;
  }
  return `Missing issuer (your company) ${label}. Issuer details are company-level — fix this in ${where}, then reopen this invoice.`;
}

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

type LocalInvoiceParty = {
  type?: string;
  id?: string;
  name?: string;
  address?: Record<string, unknown> | null;
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
    itemsDiscount?: string;
    valueDifference?: string;
    taxes?: Array<{ taxType: string; subType: string; rate: string; amount?: string }>;
  }>;
};

@Injectable()
export class DocumentsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly quota: QuotaService,
    private readonly eta: EtaService,
    @Inject('ArtifactStorage') private readonly artifacts: ArtifactStorage,
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
      taxes: (l.taxes ?? []).map((t) => ({
        taxType: t.taxType,
        subType: t.subType,
        rate: t.rate,
        ...(t.amount != null && t.amount !== '' ? { amount: t.amount } : {}),
      })),
      currencySold: l.currencySold,
      amountEGP: l.amountEGP,
      amountSold: l.amountSold,
      currencyExchangeRate: l.currencyExchangeRate,
      internalCode: l.internalCode,
      weightUnitType: l.weightUnitType,
      weightQuantity: l.weightQuantity,
      itemsDiscount: l.itemsDiscount,
      valueDifference: l.valueDifference,
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
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });

    // The issuer is our own company: the address comes from branch settings and
    // a document may only override individual fields. Blank overrides fall back
    // to settings so an invoice can never ship an emptied issuer address.
    const addr = resolveIssuerAddress(
      branchAddressToIssuerAddress(branch),
      dto.issuer?.address as IssuerAddress | undefined,
      { branchId: branch.etaBranchCode, country: 'EG' },
    ) as JsonObject;

    // issuer.name is the taxpayer LEGAL name (tenant.legalName) — never branch.name
    // ("Main"). Blank per-invoice overrides fall back to settings.
    const issuerSnapshot: JsonObject = {
      type: resolveIssuerType(tenant?.issuerType, dto.issuer?.type),
      id: resolveIssuerId(
        tenantCred?.registrationNumber,
        dto.issuer?.id,
      ),
      name: resolveIssuerName(
        tenant?.legalName,
        dto.issuer?.name,
        branch.name,
      ),
      address: addr,
    };

    const taxpayerActivityCode =
      dto.taxpayerActivityCode?.trim() ||
      branch.activityCode?.trim() ||
      tenantCred?.activityCode?.trim() ||
      '';

    return {
      branch,
      exchangeRate,
      issuerSnapshot,
      taxpayerActivityCode,
      etaDocumentType: KIND_TO_ETA_TYPE[kind as EtaDocumentKind],
      etaDocumentTypeVersion: '1.0',
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
    origin?: DocumentOrigin | string;
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
    clientIdempotencyKey?: string | null;
    syncRevision?: number;
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
      origin: doc.origin ?? 'LOCAL',
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
      clientIdempotencyKey: doc.clientIdempotencyKey ?? null,
      syncRevision: doc.syncRevision ?? 0,
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

  list(
    tenantId: string,
    query: {
      status?: DocumentStatus;
      kind?: DocumentKind;
      from?: string;
      to?: string;
      receiver?: string;
      q?: string;
      cursor?: string;
      limit?: number;
      sortBy?:
        | 'issueDateTime'
        | 'totalAmount'
        | 'internalId'
        | 'receiverName'
        | 'updatedAt';
      sortDir?: 'asc' | 'desc';
    } = {},
  ) {
    const take = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const where: Prisma.DocumentWhereInput = { tenantId };

    if (query.status) where.status = query.status;
    if (query.kind) where.kind = query.kind;
    if (query.from || query.to) {
      where.issueDateTime = {};
      if (query.from) where.issueDateTime.gte = new Date(query.from);
      if (query.to) where.issueDateTime.lte = new Date(query.to);
    }
    if (query.receiver?.trim()) {
      where.receiverName = {
        contains: query.receiver.trim(),
        mode: 'insensitive',
      };
    }
    if (query.q?.trim()) {
      const q = query.q.trim();
      where.OR = [
        { internalId: { contains: q, mode: 'insensitive' } },
        { receiverName: { contains: q, mode: 'insensitive' } },
        { receiverId: { contains: q, mode: 'insensitive' } },
        { etaUuid: { contains: q, mode: 'insensitive' } },
        { etaLongId: { contains: q, mode: 'insensitive' } },
      ];
    }

    const sortBy = query.sortBy ?? 'issueDateTime';
    const sortDir = query.sortDir === 'asc' ? 'asc' : 'desc';
    const orderBy: Prisma.DocumentOrderByWithRelationInput[] = [
      { [sortBy]: sortDir },
      { updatedAt: 'desc' },
    ];

    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.document.findMany({
        where,
        orderBy,
        take: take + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          kind: true,
          status: true,
          origin: true,
          internalId: true,
          issueDateTime: true,
          currencyCode: true,
          totalAmount: true,
          receiverName: true,
          receiverId: true,
          updatedAt: true,
          needsAttention: true,
          needsAttentionReason: true,
          submissionUuid: true,
          etaUuid: true,
          etaLongId: true,
          etaStatus: true,
          etaStatusUpdatedAt: true,
          submitInFlight: true,
          submitCooldownUntil: true,
        },
      });

      const hasMore = rows.length > take;
      const page = hasMore ? rows.slice(0, take) : rows;
      const items = page.map((doc) => ({
        id: doc.id,
        kind: doc.kind,
        status: doc.status,
        origin: doc.origin,
        internalId: doc.internalId,
        issueDateTime: doc.issueDateTime.toISOString(),
        currencyCode: doc.currencyCode,
        totalAmount: doc.totalAmount,
        receiverName: doc.receiverName,
        receiverId: doc.receiverId,
        updatedAt: doc.updatedAt.toISOString(),
        needsAttention: doc.needsAttention,
        needsAttentionReason: doc.needsAttentionReason,
        submissionUuid: doc.submissionUuid,
        etaUuid: doc.etaUuid,
        etaLongId: doc.etaLongId,
        etaStatus: doc.etaStatus,
        etaStatusUpdatedAt: doc.etaStatusUpdatedAt?.toISOString() ?? null,
        submitInFlight: doc.submitInFlight,
        submitCooldownUntil: doc.submitCooldownUntil?.toISOString() ?? null,
      }));

      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
      };
    });
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

  async create(
    tenantId: string,
    actorUserId: string,
    dto: DocumentUpsertDto,
    opts?: { clientIdempotencyKey?: string },
  ) {
    if (!dto.lines?.length) throw new BadRequestException('At least one line required');
    this.assertInternalId(dto.internalId);

    await this.quota.checkTenantWritable(tenantId);

    const etaEnvironment = await this.eta.getActiveEnvironment(tenantId);

    try {
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
          etaEnvironment,
          clientIdempotencyKey: opts?.clientIdempotencyKey,
          syncRevision: opts?.clientIdempotencyKey ? 1 : 0,
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
      metadata: {
        kind: created.kind,
        internalId: created.internalId,
        clientIdempotencyKey: opts?.clientIdempotencyKey ?? null,
      },
    });

    return this.toDetail(created);
    } catch (err) {
      this.rethrowInternalIdConflict(err);
    }
  }

  private assertInternalId(internalId: string) {
    if (!isValidEtaInternalId(internalId)) {
      throw new BadRequestException({
        code: 'INVALID_INTERNAL_ID',
        message:
          'internalId must be 1–50 Latin alphanumeric characters (may include . _ -) and start with a letter or digit',
      });
    }
  }

  private rethrowInternalIdConflict(err: unknown): never {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      throw new ConflictException({
        code: 'DUPLICATE_INTERNAL_ID',
        message: 'A document with this internalId already exists for this tenant',
      });
    }
    throw err;
  }

  async update(tenantId: string, actorUserId: string, id: string, dto: DocumentUpsertDto) {
    if (!dto.lines?.length) throw new BadRequestException('At least one line required');
    this.assertInternalId(dto.internalId);

    try {
    const updated = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.document.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Document not found');
      assertDocumentMutable(existing.origin);
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
    } catch (err) {
      this.rethrowInternalIdConflict(err);
    }
  }

  async remove(tenantId: string, actorUserId: string, id: string) {
    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.document.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Document not found');
      assertDocumentMutable(existing.origin);
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

  private async loadTenantLogo(
    tenantId: string,
  ): Promise<{ buffer: Buffer; contentType?: string } | null> {
    const tenant = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { logoObjectKey: true, logoContentType: true },
      }),
    );
    if (!tenant?.logoObjectKey) return null;
    try {
      const buffer = await this.artifacts.getByKey(tenant.logoObjectKey);
      return { buffer, contentType: tenant.logoContentType ?? undefined };
    } catch {
      return null;
    }
  }

  private normalizePrintLocale(locale?: string): LocalInvoicePdfLocale {
    return locale?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
  }

  /** Local printable PDF (display-only). Distinct from ETA official printout. */
  async localPrintoutById(
    tenantId: string,
    id: string,
    locale?: string,
  ): Promise<{ pdf: Buffer; filename: string }> {
    const detail = await this.get(tenantId, id);
    const payload = detail.etaPayload as JsonObject;
    const logo = await this.loadTenantLogo(tenantId);
    const pdf = await renderLocalInvoicePdf({
      locale: this.normalizePrintLocale(locale),
      kind: detail.kind,
      internalId: detail.internalId,
      issueDateTime: detail.issueDateTime,
      currencyCode: detail.currencyCode,
      taxpayerActivityCode: String(payload.taxpayerActivityCode ?? ''),
      issuer: (payload.issuer as LocalInvoiceParty) ?? {},
      receiver: (payload.receiver as LocalInvoiceParty) ?? null,
      lines: (detail.lines as Array<Record<string, unknown>>).map((l) => {
        const fromRelation = Array.isArray(l.taxes) ? l.taxes : [];
        const payloadLines = Array.isArray(
          (payload as { invoiceLines?: unknown }).invoiceLines,
        )
          ? ((payload as { invoiceLines: Array<Record<string, unknown>> })
              .invoiceLines)
          : [];
        const lineNo = Number(l.lineNumber ?? 0);
        const payloadLine =
          payloadLines.find(
            (pl) => Number(pl.lineNumber ?? pl.LineNumber ?? 0) === lineNo,
          ) ?? payloadLines[Math.max(0, lineNo - 1)];
        const taxes =
          fromRelation.length > 0
            ? fromRelation
            : (payloadLine?.taxableItems ??
              payloadLine?.TaxableItems ??
              []);
        return {
          description: String(l.description ?? ''),
          itemType: String(l.itemType ?? ''),
          itemCode: String(l.itemCode ?? ''),
          unitType: String(l.unitType ?? ''),
          quantity: String(l.quantity ?? ''),
          unitPrice: String(l.unitPrice ?? ''),
          discountAmount: String(l.discountAmount ?? '0'),
          taxes: normalizeLineTaxes(taxes),
        };
      }),
      totals: {
        totalSalesAmount: String(detail.totals.totalSalesAmount),
        totalDiscountAmount: String(detail.totals.totalDiscountAmount),
        netAmount: String(detail.totals.netAmount),
        totalAmount: String(detail.totals.totalAmount),
        extraDiscountAmount: String(detail.totals.extraDiscountAmount ?? '0'),
        taxTotals: detail.totals.taxTotals,
      },
      logo,
    });
    return {
      pdf,
      filename: `invoice-${detail.internalId}-preview.pdf`,
    };
  }

  /** Local PDF from current (possibly unsaved) form data. */
  async localPrintoutFromDto(
    tenantId: string,
    dto: DocumentUpsertDto,
    locale?: string,
  ): Promise<{ pdf: Buffer; filename: string }> {
    const preview = await this.preview(tenantId, dto);
    const payload = preview.etaPayload as JsonObject;
    const logo = await this.loadTenantLogo(tenantId);
    const lines = Array.isArray(payload.invoiceLines)
      ? (payload.invoiceLines as Array<Record<string, unknown>>)
      : [];
    const pdf = await renderLocalInvoicePdf({
      locale: this.normalizePrintLocale(locale),
      kind: dto.kind,
      internalId: dto.internalId,
      issueDateTime: dto.issueDateTime,
      currencyCode: dto.currencyCode,
      taxpayerActivityCode: String(payload.taxpayerActivityCode ?? ''),
      issuer: (payload.issuer as LocalInvoiceParty) ?? {},
      receiver: (payload.receiver as LocalInvoiceParty) ?? null,
      lines: lines.map((l) => {
        const unitValue = (l.unitValue as Record<string, unknown>) ?? {};
        const discount = (l.discount as Record<string, unknown>) ?? {};
        const taxes = Array.isArray(l.taxableItems)
          ? (l.taxableItems as Array<Record<string, unknown>>)
          : [];
        return {
          description: String(l.description ?? ''),
          itemType: String(l.itemType ?? ''),
          itemCode: String(l.itemCode ?? ''),
          unitType: String(l.unitType ?? ''),
          quantity: String(l.quantity ?? ''),
          unitPrice: String(unitValue.amountEGP ?? unitValue.amountSold ?? '0'),
          discountAmount: String(discount.amount ?? '0'),
          taxes: normalizeLineTaxes(taxes),
        };
      }),
      totals: {
        totalSalesAmount: String(preview.totals.totalSalesAmount),
        totalDiscountAmount: String(preview.totals.totalDiscountAmount),
        netAmount: String(preview.totals.netAmount),
        totalAmount: String(preview.totals.totalAmount),
        extraDiscountAmount: String(
          (preview.totals as { extraDiscountAmount?: string }).extraDiscountAmount ??
            dto.extraDiscountAmount ??
            '0',
        ),
        taxTotals: (preview.totals as { taxTotals?: unknown }).taxTotals,
      },
      logo,
    });
    return {
      pdf,
      filename: `invoice-${dto.internalId || 'draft'}-preview.pdf`,
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
    assertDocumentMutable(detail.origin);
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

  /**
   * Statuses that may be recalculated. Signed/submitted payloads must not be
   * mutated — their digests are already bound to the stored totals.
   */
  private static readonly RECALCULABLE_STATUSES: DocumentStatus[] = [
    'DRAFT',
    'READY',
  ];

  async recalculateTotals(tenantId: string, actorUserId: string, id: string) {
    const updated = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.document.findFirst({
        where: { id, tenantId },
        include: {
          lines: { include: { taxes: true }, orderBy: { lineNumber: 'asc' } },
        },
      });
      if (!existing) throw new NotFoundException('Document not found');
      assertDocumentMutable(existing.origin);

      if (
        !DocumentsService.RECALCULABLE_STATUSES.includes(existing.status) ||
        existing.signedAt ||
        (Array.isArray(existing.signaturesJson) &&
          (existing.signaturesJson as unknown[]).length > 0)
      ) {
        throw new BadRequestException(
          'Only draft/ready unsigned documents can have totals recalculated',
        );
      }

      const dto = this.upsertDtoFromStored(existing);
      const binding = await this.resolveBinding(
        tx,
        tenantId,
        dto.kind,
        dto.branchId,
        dto.currencyCode,
        new Date(dto.issueDateTime),
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
          exchangeRate: binding.exchangeRate,
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
          updatedByUserId: actorUserId,
          lines: {
            create: this.lineCreateData(tenantId, dto, built),
          },
        },
        include: {
          lines: { include: { taxes: true }, orderBy: { lineNumber: 'asc' } },
        },
      });
    });

    await this.audit.write({
      action: 'documents.recalculate_totals',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'document',
      resourceId: id,
      metadata: {
        status: updated.status,
        totalAmount: updated.totalAmount,
        netAmount: updated.netAmount,
      },
    });

    return this.toDetail(updated);
  }

  async recalculateTotalsBatch(tenantId: string, actorUserId: string) {
    const ids = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.document.findMany({
        where: {
          tenantId,
          status: { in: DocumentsService.RECALCULABLE_STATUSES },
          signedAt: null,
        },
        select: { id: true },
        orderBy: { updatedAt: 'asc' },
      }),
    );

    const results: Array<{
      id: string;
      ok: boolean;
      totalAmount?: string;
      error?: string;
    }> = [];

    for (const { id } of ids) {
      try {
        const detail = await this.recalculateTotals(tenantId, actorUserId, id);
        results.push({
          id,
          ok: true,
          totalAmount: String(
            (detail.totals as { totalAmount?: string }).totalAmount ?? '',
          ),
        });
      } catch (e) {
        results.push({
          id,
          ok: false,
          error: e instanceof Error ? e.message : 'recalculate failed',
        });
      }
    }

    await this.audit.write({
      action: 'documents.recalculate_totals.batch',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'document',
      metadata: {
        attempted: results.length,
        succeeded: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
      },
    });

    return {
      attempted: results.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  /** Rebuild an upsert DTO from a stored draft so totals can be recomputed. */
  private upsertDtoFromStored(doc: {
    kind: DocumentKind;
    branchId: string;
    currencyCode: string;
    issueDateTime: Date;
    internalId: string;
    version: number;
    receiverType: string | null;
    receiverId: string | null;
    receiverName: string | null;
    receiverAddressJson: Prisma.JsonValue | null;
    referencesJson: Prisma.JsonValue | null;
    extraDiscountAmount: string;
    etaPayloadJson: Prisma.JsonValue;
    lines: Array<{
      description: string;
      itemType: string;
      itemCode: string;
      unitType: string;
      quantity: string;
      unitPrice: string;
      discountRate: string | null;
      discountAmount: string;
      currencySold: string | null;
      amountSold: string | null;
      amountEgp: string | null;
      currencyExchangeRate: string | null;
      internalCode: string | null;
      itemsDiscount: string;
      valueDifference: string;
      taxes: Array<{
        taxType: string;
        subType: string;
        rate: string;
        amount: string;
      }>;
    }>;
  }): DocumentUpsertDto {
    const payload = doc.etaPayloadJson as JsonObject;
    return {
      kind: doc.kind,
      branchId: doc.branchId,
      currencyCode: doc.currencyCode,
      issueDateTime: doc.issueDateTime.toISOString(),
      internalId: doc.internalId,
      version: doc.version,
      taxpayerActivityCode: String(payload.taxpayerActivityCode ?? ''),
      purchaseOrderReference:
        typeof payload.purchaseOrderReference === 'string'
          ? payload.purchaseOrderReference
          : undefined,
      purchaseOrderDescription:
        typeof payload.purchaseOrderDescription === 'string'
          ? payload.purchaseOrderDescription
          : undefined,
      salesOrderReference:
        typeof payload.salesOrderReference === 'string'
          ? payload.salesOrderReference
          : undefined,
      salesOrderDescription:
        typeof payload.salesOrderDescription === 'string'
          ? payload.salesOrderDescription
          : undefined,
      proformaInvoiceNumber:
        typeof payload.proformaInvoiceNumber === 'string'
          ? payload.proformaInvoiceNumber
          : undefined,
      serviceDeliveryDate:
        typeof payload.serviceDeliveryDate === 'string'
          ? payload.serviceDeliveryDate
          : undefined,
      receiver: {
        type: doc.receiverType ?? undefined,
        id: doc.receiverId ?? undefined,
        name: doc.receiverName ?? undefined,
        address: (doc.receiverAddressJson as AddressDto | null) ?? undefined,
      },
      payment: (payload.payment as DocumentUpsertDto['payment']) ?? null,
      delivery: (payload.delivery as DocumentUpsertDto['delivery']) ?? null,
      references:
        (doc.referencesJson as DocumentUpsertDto['references']) ??
        (payload.references as DocumentUpsertDto['references']) ??
        null,
      extraDiscountAmount: doc.extraDiscountAmount,
      lines: doc.lines.map((l, lineIdx) => {
        const pl = (
          Array.isArray(payload.invoiceLines) ? payload.invoiceLines : []
        )[lineIdx] as JsonObject | undefined;
        return {
          description: l.description,
          itemType: l.itemType,
          itemCode: l.itemCode,
          unitType: l.unitType,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountRate: l.discountRate ?? undefined,
          discountAmount: l.discountAmount,
          currencySold: l.currencySold ?? undefined,
          amountEGP: l.amountEgp ?? undefined,
          amountSold: l.amountSold ?? undefined,
          currencyExchangeRate: l.currencyExchangeRate ?? undefined,
          internalCode: l.internalCode ?? undefined,
          weightUnitType:
            typeof pl?.weightUnitType === 'string' ? pl.weightUnitType : undefined,
          weightQuantity:
            pl?.weightQuantity != null ? String(pl.weightQuantity) : undefined,
          itemsDiscount: l.itemsDiscount,
          valueDifference: l.valueDifference,
          taxes: l.taxes.map((t) => ({
            taxType: t.taxType,
            subType: t.subType,
            rate: isFixedAmountTaxType(t.taxType) ? '0' : t.rate,
            ...(isFixedAmountTaxType(t.taxType) ? { amount: t.amount } : {}),
          })),
        };
      }),
    };
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
                  rate: String(t.rate ?? '0'),
                  ...(t.amount != null && String(t.amount) !== ''
                    ? { amount: String(t.amount) }
                    : {}),
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

      // Catch leftover "Main"/branch labels that slipped into signed drafts.
      const payloadIssuer = (detail.etaPayload as JsonObject).issuer;
      const issuerName =
        payloadIssuer && typeof payloadIssuer === 'object' && !Array.isArray(payloadIssuer)
          ? String((payloadIssuer as JsonObject).name ?? '')
          : '';
      if (
        issuerName &&
        branch &&
        !isIssuerNameComplete(issuerName, branch.name)
      ) {
        issues.push({
          code: 'ISSUER_NAME_PLACEHOLDER',
          path: 'issuer.name',
          severity: 'error',
          messageKey: 'documents.validation.issuerNamePlaceholder',
          params: { path: 'issuer.name', branchName: branch.name },
        });
      }

      const errors = issues.filter((i) => i.severity === 'error');
      return {
        ok: errors.length === 0,
        issues: issues.map((i) => ({
          code: i.code,
          path: i.path,
          severity: i.severity,
          messageKey: isIssuerSettingsPath(i.path)
            ? 'documents.validation.issuerFromSettings'
            : i.messageKey,
          // Company-level fields are fixed in Settings, not on the invoice.
          fixIn: isIssuerSettingsPath(i.path) ? ('settings' as const) : undefined,
          settingsArea: isIssuerSettingsPath(i.path)
            ? issuerSettingsArea(i.path)
            : undefined,
          message:
            (i.code === 'REQUIRED_FIELD' || i.code === 'ISSUER_NAME_PLACEHOLDER') &&
            isIssuerSettingsPath(i.path)
              ? issuerFixMessage(i.path, i.code)
              : i.code === 'REQUIRED_FIELD'
              ? `Missing required field: ${i.path}`
              : i.code === 'DUPLICATE_TAX_TYPE'
                ? `TaxType must be unique per line: ${i.params?.taxTypes ?? ''}`
                : i.code === 'TAX_TYPICALLY_REQUIRED'
                  ? 'This document type typically requires VAT. A fully tax-free invoice may be refused by ETA. You can still proceed if the supply is truly not taxable.'
                    : i.code === 'TAX_SUBTYPE_PARENT_MISMATCH'
                    ? `Tax subtype ${i.params?.subType ?? ''} does not belong to tax type ${i.params?.taxType ?? ''}`
                    : i.code === 'ETA_ITEM_TOTAL_MISMATCH'
                    ? `Line ${i.params?.line ?? ''} total must be ${i.params?.expected ?? ''} but is ${i.params?.actual ?? ''} (net ${i.params?.netTotal ?? ''} + taxes ${i.params?.additiveTaxes ?? ''} − withholding ${i.params?.withholdingTaxes ?? ''} − items discount ${i.params?.itemsDiscount ?? ''})`
                    : i.code === 'ETA_TOTAL_AMOUNT_MISMATCH' ||
                        i.code === 'ETA_NET_AMOUNT_MISMATCH'
                    ? `${i.path} must be ${i.params?.expected ?? ''} but is ${i.params?.actual ?? ''}`
                    : i.code === 'FIXED_TAX_AMOUNT_REQUIRED'
                    ? `Fixed-amount tax ${i.params?.taxType ?? ''} requires an explicit amount`
                    : i.code === 'FIXED_TAX_RATE_MUST_BE_ZERO'
                    ? `Fixed-amount tax ${i.params?.taxType ?? ''} must use rate 0`
                    : i.params?.path
                    ? `${i.messageKey} (${i.params.path})`
                    : `${i.code}: ${i.path}`,
          params: i.params,
        })),
      };
    });
  }
}
