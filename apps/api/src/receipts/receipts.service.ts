import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildReceipt,
  formatEtaDateTimeIssued,
  isReceiptBuyerType,
  isReceiptPaymentMethod,
  previousUuidForPos,
  validateReceipt,
  type ReceiptBuildInput,
  type ReceiptBuyerInput,
  type ReceiptLineInput,
  type ReceiptPaymentMethod,
  type ReceiptType,
  type ValidationIssue,
} from '@einvoice/eta-core';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import type { ArtifactStorage } from '../storage/storage.module';
import { branchAddressToIssuerAddress } from '../settings/branches/branches.service';
import { isReceiptBranchReady, receiptBranchGaps } from '../settings/receipts/receipt-readiness';
import { resolveSyndicateLicenseNumber } from '../settings/receipts/syndicate-license';
import { resolveReceiptType } from '../settings/receipts/receipt-type';
import { parsePosSerialScope } from '../settings/receipts/pos-serial-scope';
import { renderLocalInvoicePdf } from '../documents/local-invoice-pdf';
import {
  receiptPayloadToPdfInput,
  type ReceiptPdfPayload,
} from './local-receipt-pdf';

export type ReceiptLineDto = ReceiptLineInput;

export type ReceiptUpsertDto = {
  branchId: string;
  posDeviceId?: string;
  receiptType?: string;
  receiptNumber?: string;
  dateTimeIssued: string;
  currencyCode?: string;
  exchangeRate?: string | number;
  referenceUUID?: string;
  sOrderNameCode?: string;
  orderdeliveryMode?: string;
  paymentMethod: string;
  buyer: ReceiptBuyerInput;
  lines: ReceiptLineDto[];
  extraReceiptDiscountData?: ReceiptBuildInput['extraReceiptDiscountData'];
};

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    @Inject('ArtifactStorage') private readonly artifacts: ArtifactStorage,
  ) {}

  async list(tenantId: string, opts?: { posDeviceId?: string; branchId?: string }) {
    const rows = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receipt.findMany({
        where: {
          tenantId,
          ...(opts?.posDeviceId ? { posDeviceId: opts.posDeviceId } : {}),
          ...(opts?.branchId ? { branchId: opts.branchId } : {}),
        },
        include: { posDevice: { select: { lastReceiptUuid: true } } },
        orderBy: { dateTimeIssued: 'desc' },
        take: 100,
      }),
    );
    const previousOf = new Set(rows.map((r) => r.previousUuid).filter(Boolean));
    return rows.map((row) =>
      this.toListItem(row, previousOf.has(row.uuid) ? false : undefined),
    );
  }

  async get(tenantId: string, id: string) {
    const row = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receipt.findFirst({
        where: { id, tenantId },
        include: { posDevice: { select: { lastReceiptUuid: true } } },
      }),
    );
    if (!row) throw new NotFoundException('Receipt not found');
    const child = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receipt.findFirst({
        where: { tenantId, posDeviceId: row.posDeviceId, previousUuid: row.uuid },
        select: { id: true },
      }),
    );
    return this.toDetail(row, !child);
  }

  async preview(tenantId: string, dto: ReceiptUpsertDto) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const built = await this.buildForTenant(tx, tenantId, dto, {
        previousUUID: undefined,
      });
      return {
        etaPayload: built.etaPayload,
        uuid: built.uuid,
        previousUUID: built.previousUUID,
        uuidCanonicalString: built.uuidCanonicalString,
        canonicalString: built.canonicalString,
        totals: built.totals,
        issues: built.issues,
      };
    });
  }

  async create(tenantId: string, actorUserId: string, dto: ReceiptUpsertDto) {
    const row = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const built = await this.buildForTenant(tx, tenantId, dto, {});
      this.assertNoErrors(built.issues);

      const created = await tx.receipt.create({
        data: this.toRow(tenantId, actorUserId, built),
      });

      const advanced = await tx.posDevice.updateMany({
        where: {
          id: built.posDeviceId,
          tenantId,
          lastReceiptUuid: built.previousUUID,
        },
        data: { lastReceiptUuid: built.uuid },
      });
      if (advanced.count !== 1) {
        throw new ConflictException({
          code: 'RECEIPT_CHAIN_CONFLICT',
          message:
            'Another receipt was saved on this POS at the same time. Reload and try again so previousUUID stays a single chain.',
        });
      }
      return created;
    });

    await this.audit.write({
      action: 'receipt.create',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'receipt',
      resourceId: row.id,
      metadata: {
        uuid: row.uuid,
        receiptType: row.receiptType,
        posDeviceId: row.posDeviceId,
      },
    });
    return this.toDetail(row, true);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    dto: ReceiptUpsertDto,
  ) {
    const row = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.receipt.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Receipt not found');

      const pos = await tx.posDevice.findFirst({
        where: { id: existing.posDeviceId, tenantId },
      });
      if (!pos || pos.lastReceiptUuid !== existing.uuid) {
        throw new BadRequestException({
          code: 'RECEIPT_NOT_CHAIN_TIP',
          message:
            'Only the latest receipt on this POS can be edited. Delete newer receipts first so the previousUUID chain stays valid.',
        });
      }
      if (existing.status === 'VALID' || existing.status === 'SUBMITTED') {
        throw new BadRequestException({
          code: 'RECEIPT_LOCKED',
          message: 'This receipt has already been sent to ETA and cannot be edited.',
        });
      }

      const built = await this.buildForTenant(tx, tenantId, dto, {
        posDeviceId: existing.posDeviceId,
        previousUUID: existing.previousUuid,
        receiptNumber: dto.receiptNumber?.trim() || existing.receiptNumber,
      });
      this.assertNoErrors(built.issues);

      const updated = await tx.receipt.update({
        where: { id },
        data: this.toRow(tenantId, actorUserId, built, existing.createdByUserId),
      });

      const advanced = await tx.posDevice.updateMany({
        where: {
          id: existing.posDeviceId,
          tenantId,
          lastReceiptUuid: existing.uuid,
        },
        data: { lastReceiptUuid: built.uuid },
      });
      if (advanced.count !== 1) {
        throw new ConflictException({
          code: 'RECEIPT_CHAIN_CONFLICT',
          message:
            'The POS receipt chain moved while this receipt was being edited. Reload and try again.',
        });
      }
      return updated;
    });

    await this.audit.write({
      action: 'receipt.update',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'receipt',
      resourceId: row.id,
      metadata: { uuid: row.uuid },
    });
    return this.toDetail(row, true);
  }

  async remove(tenantId: string, actorUserId: string, id: string) {
    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.receipt.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Receipt not found');
      const pos = await tx.posDevice.findFirst({
        where: { id: existing.posDeviceId, tenantId },
      });
      if (!pos || pos.lastReceiptUuid !== existing.uuid) {
        throw new BadRequestException({
          code: 'RECEIPT_NOT_CHAIN_TIP',
          message:
            'Only the latest receipt on this POS can be deleted, otherwise the previousUUID chain would break.',
        });
      }
      if (existing.status === 'VALID' || existing.status === 'SUBMITTED') {
        throw new BadRequestException({
          code: 'RECEIPT_LOCKED',
          message: 'This receipt has already been sent to ETA and cannot be deleted.',
        });
      }
      await tx.receipt.delete({ where: { id } });
      await tx.posDevice.update({
        where: { id: existing.posDeviceId },
        data: { lastReceiptUuid: existing.previousUuid },
      });
    });
    await this.audit.write({
      action: 'receipt.delete',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'receipt',
      resourceId: id,
      metadata: {},
    });
    return { ok: true };
  }

  async createReturn(tenantId: string, actorUserId: string, sourceId: string) {
    const source = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receipt.findFirst({
        where: { id: sourceId, tenantId },
        include: { posDevice: { select: { lastReceiptUuid: true } } },
      }),
    );
    if (!source) throw new NotFoundException('Receipt not found');
    if (source.receiptType === 'r') {
      throw new BadRequestException({
        code: 'RETURN_REQUIRES_SALE',
        message: 'Return is only available for a sale or retail receipt, not another return.',
      });
    }
    if (!source.uuid?.trim()) {
      throw new BadRequestException({
        code: 'RETURN_REQUIRES_UUID',
        message: 'Original receipt has no uuid to reference.',
      });
    }
    const dto = this.upsertDtoFromStored(source);
    dto.receiptType = 'r';
    dto.referenceUUID = source.uuid;
    dto.dateTimeIssued = new Date().toISOString();
    dto.receiptNumber = undefined;
    const created = await this.create(tenantId, actorUserId, dto);
    await this.audit.write({
      action: 'receipt.return.create',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'receipt',
      resourceId: created.id,
      metadata: {
        sourceReceiptId: source.id,
        sourceUuid: source.uuid,
        sourceReceiptNumber: source.receiptNumber,
      },
    });
    return created;
  }

  async localPrintoutById(
    tenantId: string,
    id: string,
    locale?: string,
  ): Promise<{ pdf: Buffer; filename: string }> {
    const detail = await this.get(tenantId, id);
    const pdf = await this.renderPdf(tenantId, detail.etaPayload, locale);
    return { pdf, filename: `receipt-${detail.receiptNumber}-preview.pdf` };
  }

  async localPrintoutFromDto(
    tenantId: string,
    dto: ReceiptUpsertDto,
    locale?: string,
  ): Promise<{ pdf: Buffer; filename: string }> {
    const preview = await this.preview(tenantId, dto);
    const pdf = await this.renderPdf(tenantId, preview.etaPayload, locale);
    const header = (preview.etaPayload as { header?: { receiptNumber?: string } })
      .header?.receiptNumber;
    return { pdf, filename: `receipt-${header || 'draft'}-preview.pdf` };
  }

  private async renderPdf(tenantId: string, payload: unknown, locale?: string) {
    const loc = locale?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
    const logo = await this.loadTenantLogo(tenantId);
    const body = (payload ?? {}) as ReceiptPdfPayload;
    return renderLocalInvoicePdf(
      receiptPayloadToPdfInput({
        locale: loc,
        payload: body,
        logo,
      }),
    );
  }

  private async loadTenantLogo(tenantId: string) {
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

  private upsertDtoFromStored(row: {
    branchId: string;
    posDeviceId: string;
    receiptType: string;
    receiptNumber: string;
    dateTimeIssued: Date;
    currencyCode: string;
    exchangeRate: string;
    referenceUuid: string | null;
    paymentMethod: string;
    orderDeliveryMode: string | null;
    buyerType: string;
    buyerId: string | null;
    buyerName: string | null;
    etaPayloadJson: Prisma.JsonValue;
  }): ReceiptUpsertDto {
    const payload = (row.etaPayloadJson ?? {}) as Record<string, unknown>;
    const header = (payload.header ?? {}) as Record<string, unknown>;
    const buyer = (payload.buyer ?? {}) as Record<string, unknown>;
    const itemData = Array.isArray(payload.itemData)
      ? (payload.itemData as Array<Record<string, unknown>>)
      : [];
    return {
      branchId: row.branchId,
      posDeviceId: row.posDeviceId,
      receiptType: row.receiptType,
      receiptNumber: row.receiptNumber,
      dateTimeIssued: row.dateTimeIssued.toISOString(),
      currencyCode: row.currencyCode,
      exchangeRate: row.exchangeRate,
      referenceUUID: row.referenceUuid ?? undefined,
      orderdeliveryMode:
        row.orderDeliveryMode ||
        (typeof header.orderdeliveryMode === 'string'
          ? header.orderdeliveryMode
          : undefined),
      paymentMethod: row.paymentMethod,
      buyer: {
        type: isReceiptBuyerType(String(buyer.type ?? row.buyerType))
          ? (String(buyer.type ?? row.buyerType) as ReceiptBuyerInput['type'])
          : 'P',
        id: String(buyer.id ?? row.buyerId ?? '') || undefined,
        name: String(buyer.name ?? row.buyerName ?? '') || undefined,
        mobileNumber:
          typeof buyer.mobileNumber === 'string' ? buyer.mobileNumber : undefined,
        paymentNumber:
          typeof buyer.paymentNumber === 'string' ? buyer.paymentNumber : undefined,
      },
      lines: itemData.map((l) => {
        const taxes = Array.isArray(l.taxableItems)
          ? (l.taxableItems as Array<Record<string, unknown>>).map((t) => ({
              taxType: String(t.taxType ?? ''),
              subType: String(t.subType ?? ''),
              rate: String(t.rate ?? '0'),
              ...(t.amount != null ? { amount: String(t.amount) } : {}),
            }))
          : [];
        const commercial = Array.isArray(l.commercialDiscountData)
          ? (l.commercialDiscountData as Array<Record<string, unknown>>).map((d) => ({
              amount: String(d.amount ?? '0'),
              description: d.description != null ? String(d.description) : undefined,
              rate: d.rate != null ? String(d.rate) : undefined,
            }))
          : undefined;
        return {
          internalCode: String(l.internalCode ?? ''),
          description: String(l.description ?? ''),
          itemType: String(l.itemType ?? 'EGS'),
          itemCode: String(l.itemCode ?? ''),
          unitType: String(l.unitType ?? 'EA'),
          quantity: String(l.quantity ?? '1'),
          unitPrice: String(l.unitPrice ?? '0'),
          taxes,
          commercialDiscountData: commercial,
        };
      }),
    };
  }

  private assertNoErrors(issues: ValidationIssue[]) {
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length) {
      throw new BadRequestException({
        code: 'RECEIPT_INVALID',
        message: errors[0]?.messageKey ?? 'Receipt is not valid for ETA',
        issues: errors,
      });
    }
  }

  private parseIssueDateTime(raw: string): Date {
    const d = new Date(raw);
    const year = d.getUTCFullYear();
    if (Number.isNaN(d.getTime()) || year < 1 || year > 9999) {
      throw new BadRequestException({
        code: 'INVALID_ISSUE_DATE',
        message: 'dateTimeIssued must be a valid calendar date',
      });
    }
    return d;
  }

  private async buildForTenant(
    tx: Prisma.TransactionClient,
    tenantId: string,
    dto: ReceiptUpsertDto,
    opts: {
      posDeviceId?: string;
      previousUUID?: string;
      receiptNumber?: string;
    },
  ) {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const scope = parsePosSerialScope(tenant.posSerialScope);

    let posDeviceId = opts.posDeviceId ?? dto.posDeviceId ?? '';
    if (!opts.posDeviceId && scope === 'COMPANY') {
      const sharedId = tenant.sharedPosDeviceId;
      if (sharedId) {
        posDeviceId = sharedId;
      } else if (!posDeviceId) {
        const active = await tx.posDevice.findMany({
          where: { tenantId, status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          take: 2,
        });
        if (active.length === 1) {
          posDeviceId = active[0]!.id;
        } else {
          throw new BadRequestException({
            code: 'SHARED_POS_REQUIRED',
            message:
              'Choose the company POS serial in Settings → Company. previousUUID is one chain for that POS.',
          });
        }
      }
    }

    if (!posDeviceId) {
      throw new BadRequestException({
        code: 'POS_REQUIRED',
        message: 'Select a POS device.',
      });
    }

    const pos = await tx.posDevice.findFirst({
      where: { id: posDeviceId, tenantId },
    });
    if (!pos) throw new NotFoundException('POS device not found');
    if (pos.status !== 'ACTIVE') {
      throw new BadRequestException({
        code: 'POS_NOT_ACTIVE',
        message: 'This POS is not active. Register or reactivate it in Settings → POS devices.',
      });
    }

    const saleBranchId = dto.branchId || pos.branchId;
    if (scope === 'PER_BRANCH' && dto.branchId && dto.branchId !== pos.branchId) {
      throw new BadRequestException({
        code: 'POS_BRANCH_MISMATCH',
        message: 'The POS does not belong to the selected branch.',
      });
    }

    const branch = await tx.branch.findFirst({
      where: { id: saleBranchId, tenantId },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    const cred =
      (await tx.tenantEtaCredential.findFirst({
        where: { tenantId, branchId: branch.id },
      })) ??
      (await tx.tenantEtaCredential.findFirst({
        where: { tenantId, branchId: null },
      }));

    const address = branchAddressToIssuerAddress(branch);
    const gaps = receiptBranchGaps({
      receiptsEnabled: branch.receiptsEnabled,
      etaBranchCode: branch.etaBranchCode,
      activityCode: branch.activityCode,
      address,
      issuerType: tenant.issuerType,
      tenantSyndicateLicense: tenant.syndicateLicenseNumber,
      branchSyndicateLicense: branch.syndicateLicenseNumber,
    });
    if (!branch.receiptsEnabled || !isReceiptBranchReady({
      receiptsEnabled: branch.receiptsEnabled,
      etaBranchCode: branch.etaBranchCode,
      activityCode: branch.activityCode,
      address,
      issuerType: tenant.issuerType,
      tenantSyndicateLicense: tenant.syndicateLicenseNumber,
      branchSyndicateLicense: branch.syndicateLicenseNumber,
    })) {
      throw new BadRequestException({
        code: 'RECEIPT_BRANCH_INCOMPLETE',
        message:
          'This branch is not ready for e-receipts. Complete the missing fields in Settings → Branches.',
        gaps: branch.receiptsEnabled ? gaps : ['RECEIPTS_DISABLED', ...gaps],
      });
    }

    const rin = cred?.registrationNumber?.trim() ?? '';
    const legalName = tenant.legalName?.trim() ?? '';
    if (!rin || !legalName) {
      throw new BadRequestException({
        code: 'RECEIPT_SELLER_INCOMPLETE',
        message:
          'Set your ETA registration number and taxpayer legal name in Settings → ETA connection.',
      });
    }

    const syndicate = resolveSyndicateLicenseNumber({
      issuerType: tenant.issuerType,
      tenantDefault: tenant.syndicateLicenseNumber,
      branchOverride: branch.syndicateLicenseNumber,
    });
    if (syndicate.missing) {
      throw new BadRequestException({
        code: 'MISSING_SYNDICATE_LICENSE',
        message:
          'Persons must set a syndicate license in ETA credentials or this branch before issuing receipts.',
      });
    }

    const receiptType: ReceiptType = resolveReceiptType({
      requested: dto.receiptType,
      branchDefault: branch.defaultReceiptType,
      tenantDefault: tenant.defaultReceiptType,
    });

    if (!isReceiptPaymentMethod(dto.paymentMethod)) {
      throw new BadRequestException({
        code: 'PAYMENT_METHOD_REQUIRED',
        message: 'paymentMethod is required (C, V, CC, VC, VO, PR, GC, P, or O).',
      });
    }
    if (!isReceiptBuyerType(dto.buyer?.type ?? '')) {
      throw new BadRequestException({
        code: 'BUYER_TYPE_INVALID',
        message: 'buyer.type must be P (person), B (business), or F (foreign).',
      });
    }

    const currency = (dto.currencyCode || branch.defaultCurrencyCode || 'EGP')
      .trim()
      .toUpperCase();
    const issueDateTime = this.parseIssueDateTime(dto.dateTimeIssued);
    let exchangeRate: string | number = currency === 'EGP' ? 0 : dto.exchangeRate ?? '';
    if (currency !== 'EGP' && (exchangeRate === '' || exchangeRate == null)) {
      const rate = await tx.exchangeRate.findFirst({
        where: {
          tenantId,
          baseCurrencyCode: 'EGP',
          quoteCurrencyCode: currency,
          effectiveFrom: { lte: issueDateTime },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: issueDateTime } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (!rate) {
        throw new BadRequestException({
          code: 'EXCHANGE_RATE_MISSING',
          message: 'Exchange rate missing for the receipt issue date.',
        });
      }
      exchangeRate = rate.rate.toString();
    }

    const receiptNumber =
      opts.receiptNumber?.trim() ||
      dto.receiptNumber?.trim() ||
      (await this.nextReceiptNumber(tx, tenantId, pos.id, pos.serialNumber));

    const previousUUID =
      opts.previousUUID !== undefined
        ? opts.previousUUID
        : previousUuidForPos(pos.lastReceiptUuid);

    const input: ReceiptBuildInput = {
      receiptType,
      dateTimeIssued: formatEtaDateTimeIssued(issueDateTime),
      receiptNumber,
      previousUUID,
      referenceUUID: dto.referenceUUID,
      currency,
      exchangeRate,
      sOrderNameCode: dto.sOrderNameCode,
      orderdeliveryMode: dto.orderdeliveryMode,
      seller: {
        rin,
        companyTradeName: legalName,
        branchCode: branch.etaBranchCode!.trim(),
        branchAddress: address,
        deviceSerialNumber: pos.serialNumber,
        activityCode: (branch.activityCode || cred?.activityCode || '').trim(),
        syndicateLicenseNumber: syndicate.value,
      },
      buyer: dto.buyer,
      lines: dto.lines ?? [],
      extraReceiptDiscountData: dto.extraReceiptDiscountData,
      paymentMethod: dto.paymentMethod as ReceiptPaymentMethod,
    };

    const built = buildReceipt(input);
    const issues = validateReceipt({ document: built.etaPayload, input });
    return {
      ...built,
      issues,
      input,
      posDeviceId: pos.id,
      branchId: branch.id,
      issueDateTime,
      currency,
      exchangeRate: String(exchangeRate),
    };
  }

  private async nextReceiptNumber(
    tx: Prisma.TransactionClient,
    tenantId: string,
    posDeviceId: string,
    serialNumber: string,
  ): Promise<string> {
    const count = await tx.receipt.count({ where: { tenantId, posDeviceId } });
    const candidate = `${serialNumber}-${String(count + 1).padStart(4, '0')}`;
    const clash = await tx.receipt.findFirst({
      where: { tenantId, posDeviceId, receiptNumber: candidate },
    });
    if (!clash) return candidate;
    return `${serialNumber}-${Date.now()}`;
  }

  private toRow(
    tenantId: string,
    actorUserId: string,
    built: Awaited<ReturnType<ReceiptsService['buildForTenant']>>,
    createdByUserId?: string | null,
  ) {
    const header = built.etaPayload.header as Record<string, unknown>;
    const buyer = built.etaPayload.buyer as Record<string, unknown>;
    return {
      tenantId,
      branchId: built.branchId,
      posDeviceId: built.posDeviceId,
      status: 'DRAFT' as const,
      receiptType: built.input.receiptType,
      typeVersion: '1.2',
      receiptNumber: String(header.receiptNumber ?? built.input.receiptNumber),
      dateTimeIssued: built.issueDateTime,
      currencyCode: built.currency,
      exchangeRate: built.exchangeRate,
      uuid: built.uuid,
      previousUuid: built.previousUUID,
      referenceUuid:
        typeof header.referenceUUID === 'string' && header.referenceUUID
          ? header.referenceUUID
          : null,
      paymentMethod: String(built.etaPayload.paymentMethod ?? ''),
      orderDeliveryMode:
        typeof header.orderdeliveryMode === 'string'
          ? header.orderdeliveryMode
          : null,
      buyerType: String(buyer.type ?? ''),
      buyerId: String(buyer.id ?? '') || null,
      buyerName: String(buyer.name ?? '') || null,
      totalSales: built.totals.totalSales,
      netAmount: built.totals.netAmount,
      totalAmount: built.totals.totalAmount,
      etaPayloadJson: built.etaPayload as Prisma.InputJsonValue,
      etaPayloadText: JSON.stringify(built.etaPayload),
      uuidCanonical: built.uuidCanonicalString,
      canonicalPreview: built.canonicalString,
      createdByUserId: createdByUserId ?? actorUserId,
      updatedByUserId: actorUserId,
    };
  }

  private toListItem(
    row: {
      id: string;
      status: string;
      receiptType: string;
      receiptNumber: string;
      dateTimeIssued: Date;
      uuid: string;
      previousUuid: string;
      totalAmount: string;
      paymentMethod: string;
      branchId: string;
      posDeviceId: string;
      buyerType: string;
      buyerName: string | null;
      posDevice?: { lastReceiptUuid: string } | null;
      etaStatus?: string | null;
      etaLongId?: string | null;
      submissionUuid?: string | null;
      lastErrorMessage?: string | null;
      submitCooldownUntil?: Date | null;
    },
    chainTipOverride?: boolean,
  ) {
    const isChainTip =
      chainTipOverride ??
      (row.posDevice ? row.posDevice.lastReceiptUuid === row.uuid : true);
    return {
      id: row.id,
      status: row.status,
      receiptType: row.receiptType,
      receiptNumber: row.receiptNumber,
      dateTimeIssued: row.dateTimeIssued.toISOString(),
      uuid: row.uuid,
      previousUuid: row.previousUuid,
      totalAmount: row.totalAmount,
      paymentMethod: row.paymentMethod,
      branchId: row.branchId,
      posDeviceId: row.posDeviceId,
      buyerType: row.buyerType,
      buyerName: row.buyerName,
      isChainTip,
      canReturn: row.receiptType !== 'r' && Boolean(row.uuid?.trim()),
      etaStatus: row.etaStatus ?? null,
      etaLongId: row.etaLongId ?? null,
      submissionUuid: row.submissionUuid ?? null,
      lastErrorMessage: row.lastErrorMessage ?? null,
      submitCooldownUntil: row.submitCooldownUntil?.toISOString() ?? null,
    };
  }

  private toDetail(
    row: {
      id: string;
      status: string;
      receiptType: string;
      typeVersion: string;
      receiptNumber: string;
      dateTimeIssued: Date;
      currencyCode: string;
      exchangeRate: string;
      uuid: string;
      previousUuid: string;
      referenceUuid: string | null;
      paymentMethod: string;
      orderDeliveryMode: string | null;
      buyerType: string;
      buyerId: string | null;
      buyerName: string | null;
      totalSales: string;
      netAmount: string;
      totalAmount: string;
      etaPayloadJson: Prisma.JsonValue;
      etaPayloadText: string;
      uuidCanonical: string;
      canonicalPreview: string;
      branchId: string;
      posDeviceId: string;
      posDevice?: { lastReceiptUuid: string } | null;
      etaStatus?: string | null;
      etaLongId?: string | null;
      submissionUuid?: string | null;
      lastErrorMessage?: string | null;
      lastErrorCode?: string | null;
      submitCooldownUntil?: Date | null;
    },
    chainTipOverride?: boolean,
  ) {
    const form = this.upsertDtoFromStored(row);
    return {
      ...this.toListItem(row, chainTipOverride),
      typeVersion: row.typeVersion,
      currencyCode: row.currencyCode,
      exchangeRate: row.exchangeRate,
      referenceUuid: row.referenceUuid,
      orderDeliveryMode: row.orderDeliveryMode,
      buyerId: row.buyerId,
      totalSales: row.totalSales,
      netAmount: row.netAmount,
      etaPayload: row.etaPayloadJson,
      etaPayloadText: row.etaPayloadText,
      uuidCanonicalString: row.uuidCanonical,
      canonicalString: row.canonicalPreview,
      lastErrorCode: row.lastErrorCode ?? null,
      form,
    };
  }
}
