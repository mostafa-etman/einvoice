import {
  BadRequestException,
  ConflictException,
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
import { branchAddressToIssuerAddress } from '../settings/branches/branches.service';
import { isReceiptBranchReady, receiptBranchGaps } from '../settings/receipts/receipt-readiness';
import { resolveSyndicateLicenseNumber } from '../settings/receipts/syndicate-license';
import { resolveReceiptType } from '../settings/receipts/receipt-type';

export type ReceiptLineDto = ReceiptLineInput;

export type ReceiptUpsertDto = {
  branchId: string;
  posDeviceId: string;
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
  ) {}

  async list(tenantId: string, opts?: { posDeviceId?: string; branchId?: string }) {
    const rows = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receipt.findMany({
        where: {
          tenantId,
          ...(opts?.posDeviceId ? { posDeviceId: opts.posDeviceId } : {}),
          ...(opts?.branchId ? { branchId: opts.branchId } : {}),
        },
        orderBy: { dateTimeIssued: 'desc' },
        take: 100,
      }),
    );
    return rows.map((row) => this.toListItem(row));
  }

  async get(tenantId: string, id: string) {
    const row = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receipt.findFirst({ where: { id, tenantId } }),
    );
    if (!row) throw new NotFoundException('Receipt not found');
    return this.toDetail(row);
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
    return this.toDetail(row);
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
    return this.toDetail(row);
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
    const posDeviceId = opts.posDeviceId ?? dto.posDeviceId;
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
    if (dto.branchId && dto.branchId !== pos.branchId) {
      throw new BadRequestException({
        code: 'POS_BRANCH_MISMATCH',
        message: 'The POS does not belong to the selected branch.',
      });
    }

    const branch = await tx.branch.findFirst({
      where: { id: pos.branchId, tenantId },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

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

  private toListItem(row: {
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
  }) {
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
    };
  }

  private toDetail(row: {
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
  }) {
    return {
      ...this.toListItem(row),
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
    };
  }
}
