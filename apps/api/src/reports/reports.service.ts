import { Injectable } from '@nestjs/common';
import {
  DocumentKind,
  DocumentStatus,
  Prisma,
  ReceivedBuyerDecision,
  ReceivedDocumentKind,
} from '@prisma/client';
import { add, formatMoney, mul, sub } from '@einvoice/eta-core';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  bucketKey,
  type ReportFilters,
  type ReportId,
} from './report-filters';
import {
  issuedDocumentSign,
  receivedDocumentSign,
  isCreditLikeIssued,
  isCreditLikeReceived,
} from './report-netting';
import {
  accumulateTaxRows,
  parseTaxTotalsJson,
  splitVatBreakdown,
  type VatBreakdownRow,
} from './report-vat';

type Tx = Prisma.TransactionClient;

type IssuedRow = {
  id: string;
  kind: DocumentKind;
  status: DocumentStatus;
  branchId: string;
  currencyCode: string;
  issueDateTime: Date;
  totalAmount: string;
  taxTotalsJson: Prisma.JsonValue;
  receiverId: string | null;
  receiverName: string | null;
  lines: Array<{
    itemCode: string;
    description: string;
    quantity: string;
    total: string;
    taxes: Array<{ taxType: string; rate: string; amount: string }>;
  }>;
};

type ReceivedRow = {
  id: string;
  kind: ReceivedDocumentKind;
  etaDocumentType: string;
  etaStatus: string | null;
  buyerDecision: ReceivedBuyerDecision;
  branchId: string | null;
  currency: string | null;
  dateTimeIssued: Date | null;
  totalAmount: string | null;
  issuerId: string | null;
  issuerName: string | null;
  rawSummaryJson: Prisma.JsonValue;
  lines: Array<{
    itemCode: string | null;
    description: string | null;
    quantity: string | null;
    total: string | null;
    taxesJson: Prisma.JsonValue;
  }>;
};

function moneyParts(sign: 1 | -1, amount: string, showGross: boolean) {
  const abs = formatMoney(amount || '0');
  const signed = sign === 1 ? abs : mul(abs, -1);
  return {
    signed,
    grossPositive: showGross && sign === 1 ? abs : '0.00',
    creditReduction: showGross && sign === -1 ? abs : '0.00',
  };
}

@Injectable()
export class ReportsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async run(input: {
    tenantId: string;
    reportId: ReportId;
    filters: ReportFilters;
  }) {
    return this.tenantPrisma.withTenant(input.tenantId, (tx) =>
      this.runInTx(tx, input.reportId, input.filters),
    );
  }

  private async runInTx(tx: Tx, reportId: ReportId, f: ReportFilters) {
    switch (reportId) {
      case 'S1':
        return this.salesTotal(tx, f);
      case 'S2':
        return this.salesByCustomer(tx, f);
      case 'S3':
        return this.salesByItem(tx, f);
      case 'S4':
        return this.outputVat(tx, f);
      case 'P1':
        return this.purchasesTotal(tx, f);
      case 'P2':
        return this.purchasesBySupplier(tx, f);
      case 'P3':
        return this.inputVat(tx, f);
      case 'C1':
        return this.netVat(tx, f);
      case 'C2':
        return this.salesVsPurchases(tx, f);
      case 'C3':
        return this.statusOverview(tx, f);
      default:
        return { reportId, filters: this.publicFilters(f), summary: {} };
    }
  }

  private publicFilters(f: ReportFilters) {
    return {
      from: f.from,
      to: f.to,
      branchId: f.branchId ?? null,
      currencyCode: f.currencyCode ?? null,
      perCurrency: f.perCurrency,
      includeNonFinancialStatuses: f.includeNonFinancialStatuses,
      showGross: f.showGross,
      grain: f.grain,
      perBranch: f.perBranch,
      limit: f.limit,
      documentKinds: f.documentKinds ?? null,
    };
  }

  private async loadIssued(tx: Tx, f: ReportFilters): Promise<IssuedRow[]> {
    const where: Prisma.DocumentWhereInput = {
      issueDateTime: { gte: f.rangeStart, lte: f.rangeEnd },
    };
    if (f.branchId) where.branchId = f.branchId;
    if (f.currencyCode) where.currencyCode = f.currencyCode;
    if (!f.includeNonFinancialStatuses) where.status = DocumentStatus.VALID;
    if (f.documentKinds?.length) {
      where.kind = { in: f.documentKinds as DocumentKind[] };
    }
    return tx.document.findMany({
      where,
      select: {
        id: true,
        kind: true,
        status: true,
        branchId: true,
        currencyCode: true,
        issueDateTime: true,
        totalAmount: true,
        taxTotalsJson: true,
        receiverId: true,
        receiverName: true,
        lines: {
          select: {
            itemCode: true,
            description: true,
            quantity: true,
            total: true,
            taxes: { select: { taxType: true, rate: true, amount: true } },
          },
        },
      },
    });
  }

  private async loadReceived(tx: Tx, f: ReportFilters): Promise<ReceivedRow[]> {
    const where: Prisma.ReceivedDocumentWhereInput = {
      dateTimeIssued: { gte: f.rangeStart, lte: f.rangeEnd },
    };
    if (f.branchId) where.branchId = f.branchId;
    if (f.currencyCode) where.currency = f.currencyCode;
    if (!f.includeNonFinancialStatuses) {
      where.AND = [
        { etaStatus: { equals: 'Valid', mode: 'insensitive' } },
        { buyerDecision: { not: ReceivedBuyerDecision.REJECTED } },
      ];
    }
    if (f.documentKinds?.length) {
      where.kind = { in: f.documentKinds as ReceivedDocumentKind[] };
    }
    return tx.receivedDocument.findMany({
      where,
      select: {
        id: true,
        kind: true,
        etaDocumentType: true,
        etaStatus: true,
        buyerDecision: true,
        branchId: true,
        currency: true,
        dateTimeIssued: true,
        totalAmount: true,
        issuerId: true,
        issuerName: true,
        rawSummaryJson: true,
        lines: {
          select: {
            itemCode: true,
            description: true,
            quantity: true,
            total: true,
            taxesJson: true,
          },
        },
      },
    });
  }

  private currencyKey(code: string | null | undefined, perCurrency: boolean) {
    if (perCurrency) return (code || 'UNKNOWN').toUpperCase();
    return code || 'EGP';
  }

  private async salesTotal(tx: Tx, f: ReportFilters) {
    const docs = await this.loadIssued(tx, f);
    const seriesMap = new Map<
      string,
      { bucket: string; currencyCode: string; net: string; grossPositive: string; creditReduction: string }
    >();
    let net = '0.00';
    let grossPositive = '0.00';
    let creditReduction = '0.00';
    for (const d of docs) {
      const sign = issuedDocumentSign(d.kind);
      const parts = moneyParts(sign, d.totalAmount, true);
      net = add(net, parts.signed);
      grossPositive = add(grossPositive, parts.grossPositive);
      creditReduction = add(creditReduction, parts.creditReduction);
      const cur = this.currencyKey(d.currencyCode, f.perCurrency);
      const bucket = bucketKey(d.issueDateTime, f.grain);
      const key = `${bucket}|${cur}`;
      const prev = seriesMap.get(key) ?? {
        bucket,
        currencyCode: cur,
        net: '0.00',
        grossPositive: '0.00',
        creditReduction: '0.00',
      };
      prev.net = add(prev.net, parts.signed);
      prev.grossPositive = add(prev.grossPositive, parts.grossPositive);
      prev.creditReduction = add(prev.creditReduction, parts.creditReduction);
      seriesMap.set(key, prev);
    }
    const series = [...seriesMap.values()].sort((a, b) =>
      a.bucket.localeCompare(b.bucket),
    );
    return {
      reportId: 'S1' as const,
      filters: this.publicFilters(f),
      summary: {
        net,
        ...(f.showGross ? { grossPositive, creditReduction } : {}),
        documentCount: docs.length,
      },
      series,
      rows: series,
      chart: { type: 'line', dataKey: 'net', xKey: 'bucket' },
    };
  }

  private async salesByCustomer(tx: Tx, f: ReportFilters) {
    const docs = await this.loadIssued(tx, f);
    const map = new Map<
      string,
      { customerKey: string; customerName: string; net: string; documentCount: number }
    >();
    for (const d of docs) {
      const sign = issuedDocumentSign(d.kind);
      const parts = moneyParts(sign, d.totalAmount, false);
      const customerKey = d.receiverId || d.receiverName || 'unknown';
      const customerName = d.receiverName || d.receiverId || 'Unknown';
      const prev = map.get(customerKey) ?? {
        customerKey,
        customerName,
        net: '0.00',
        documentCount: 0,
      };
      prev.net = add(prev.net, parts.signed);
      prev.documentCount += 1;
      map.set(customerKey, prev);
    }
    const rows = [...map.values()]
      .sort((a, b) => Number(b.net) - Number(a.net))
      .slice(0, f.limit);
    return {
      reportId: 'S2' as const,
      filters: this.publicFilters(f),
      summary: { rowCount: rows.length },
      rows,
      chart: { type: 'bar', dataKey: 'net', xKey: 'customerName' },
    };
  }

  private async salesByItem(tx: Tx, f: ReportFilters) {
    const docs = await this.loadIssued(tx, f);
    const map = new Map<
      string,
      { itemCode: string; description: string; quantity: string; net: string }
    >();
    for (const d of docs) {
      const sign = issuedDocumentSign(d.kind);
      for (const line of d.lines) {
        const parts = moneyParts(sign, line.total, false);
        const qtySigned =
          sign === 1
            ? formatMoney(line.quantity || '0')
            : mul(line.quantity || '0', -1);
        const key = line.itemCode || line.description || 'unknown';
        const prev = map.get(key) ?? {
          itemCode: line.itemCode,
          description: line.description,
          quantity: '0.00',
          net: '0.00',
        };
        prev.net = add(prev.net, parts.signed);
        prev.quantity = add(prev.quantity, qtySigned);
        map.set(key, prev);
      }
    }
    const rows = [...map.values()]
      .sort((a, b) => Number(b.net) - Number(a.net))
      .slice(0, f.limit);
    return {
      reportId: 'S3' as const,
      filters: this.publicFilters(f),
      summary: { rowCount: rows.length },
      rows,
      chart: { type: 'bar', dataKey: 'net', xKey: 'itemCode' },
    };
  }

  private taxBundleFromIssued(docs: IssuedRow[]) {
    const rows = new Map<string, VatBreakdownRow>();
    for (const d of docs) {
      const sign = issuedDocumentSign(d.kind);
      const fromTotals = parseTaxTotalsJson(d.taxTotalsJson);
      if (fromTotals.length) {
        accumulateTaxRows(rows, fromTotals, sign);
      } else {
        for (const line of d.lines) {
          accumulateTaxRows(rows, line.taxes, sign);
        }
      }
    }
    return splitVatBreakdown(rows.values());
  }

  private taxBundleFromReceived(docs: ReceivedRow[]) {
    const rows = new Map<string, VatBreakdownRow>();
    for (const d of docs) {
      const sign = receivedDocumentSign(d.kind, d.etaDocumentType);
      const summaryTaxes = parseTaxTotalsJson(
        (d.rawSummaryJson as { taxTotals?: unknown } | null)?.taxTotals ??
          (d.rawSummaryJson as { TaxTotals?: unknown } | null)?.TaxTotals,
      );
      if (summaryTaxes.length) {
        accumulateTaxRows(rows, summaryTaxes, sign);
      } else {
        for (const line of d.lines) {
          accumulateTaxRows(rows, parseTaxTotalsJson(line.taxesJson), sign);
        }
      }
    }
    return splitVatBreakdown(rows.values());
  }

  private async outputVat(tx: Tx, f: ReportFilters) {
    const docs = await this.loadIssued(tx, f);
    const split = this.taxBundleFromIssued(docs);
    return {
      reportId: 'S4' as const,
      filters: this.publicFilters(f),
      summary: {
        outputVat: split.vatTotal,
        withholding: split.withholdingTotal,
        otherTaxes: split.otherTotal,
      },
      vat: split,
      rows: split.vat,
      chart: { type: 'bar', dataKey: 'amount', xKey: 'rate' },
    };
  }

  private async purchasesTotal(tx: Tx, f: ReportFilters) {
    const docs = await this.loadReceived(tx, f);
    const seriesMap = new Map<
      string,
      { bucket: string; currencyCode: string; net: string; grossPositive: string; creditReduction: string }
    >();
    let net = '0.00';
    let grossPositive = '0.00';
    let creditReduction = '0.00';
    for (const d of docs) {
      const sign = receivedDocumentSign(d.kind, d.etaDocumentType);
      const parts = moneyParts(sign, d.totalAmount ?? '0', true);
      net = add(net, parts.signed);
      grossPositive = add(grossPositive, parts.grossPositive);
      creditReduction = add(creditReduction, parts.creditReduction);
      const cur = this.currencyKey(d.currency, f.perCurrency);
      const when = d.dateTimeIssued ?? f.rangeStart;
      const bucket = bucketKey(when, f.grain);
      const key = `${bucket}|${cur}`;
      const prev = seriesMap.get(key) ?? {
        bucket,
        currencyCode: cur,
        net: '0.00',
        grossPositive: '0.00',
        creditReduction: '0.00',
      };
      prev.net = add(prev.net, parts.signed);
      prev.grossPositive = add(prev.grossPositive, parts.grossPositive);
      prev.creditReduction = add(prev.creditReduction, parts.creditReduction);
      seriesMap.set(key, prev);
    }
    const series = [...seriesMap.values()].sort((a, b) =>
      a.bucket.localeCompare(b.bucket),
    );
    return {
      reportId: 'P1' as const,
      filters: this.publicFilters(f),
      summary: {
        net,
        ...(f.showGross ? { grossPositive, creditReduction } : {}),
        documentCount: docs.length,
      },
      series,
      rows: series,
      chart: { type: 'line', dataKey: 'net', xKey: 'bucket' },
    };
  }

  private async purchasesBySupplier(tx: Tx, f: ReportFilters) {
    const docs = await this.loadReceived(tx, f);
    const map = new Map<
      string,
      { supplierKey: string; supplierName: string; net: string; documentCount: number }
    >();
    for (const d of docs) {
      const sign = receivedDocumentSign(d.kind, d.etaDocumentType);
      const parts = moneyParts(sign, d.totalAmount ?? '0', false);
      const supplierKey = d.issuerId || d.issuerName || 'unknown';
      const supplierName = d.issuerName || d.issuerId || 'Unknown';
      const prev = map.get(supplierKey) ?? {
        supplierKey,
        supplierName,
        net: '0.00',
        documentCount: 0,
      };
      prev.net = add(prev.net, parts.signed);
      prev.documentCount += 1;
      map.set(supplierKey, prev);
    }
    const rows = [...map.values()]
      .sort((a, b) => Number(b.net) - Number(a.net))
      .slice(0, f.limit);
    return {
      reportId: 'P2' as const,
      filters: this.publicFilters(f),
      summary: { rowCount: rows.length },
      rows,
      chart: { type: 'bar', dataKey: 'net', xKey: 'supplierName' },
    };
  }

  private async inputVat(tx: Tx, f: ReportFilters) {
    const docs = await this.loadReceived(tx, f);
    const split = this.taxBundleFromReceived(docs);
    return {
      reportId: 'P3' as const,
      filters: this.publicFilters(f),
      summary: {
        inputVat: split.vatTotal,
        withholding: split.withholdingTotal,
        otherTaxes: split.otherTotal,
      },
      vat: split,
      rows: split.vat,
      chart: { type: 'bar', dataKey: 'amount', xKey: 'rate' },
    };
  }

  private positionLabel(netVat: string): 'payable' | 'refundable' | 'settled' {
    const n = Number(netVat);
    if (n > 0) return 'payable';
    if (n < 0) return 'refundable';
    return 'settled';
  }

  private async netVat(tx: Tx, f: ReportFilters) {
    const issued = await this.loadIssued(tx, f);
    const received = await this.loadReceived(tx, f);
    const out = this.taxBundleFromIssued(issued);
    const inn = this.taxBundleFromReceived(received);
    const outputVat = out.vatTotal;
    const inputVat = inn.vatTotal;
    const netVat = sub(outputVat, inputVat);
    const total = {
      branchId: null as string | null,
      branchName: 'Total',
      outputVat,
      inputVat,
      netVat,
      position: this.positionLabel(netVat),
      withholdingOutput: out.withholdingTotal,
      withholdingInput: inn.withholdingTotal,
    };

    let branches: typeof total[] | undefined;
    if (f.perBranch) {
      const branchIds = new Set<string>();
      for (const d of issued) branchIds.add(d.branchId);
      for (const d of received) if (d.branchId) branchIds.add(d.branchId);
      const branchRows = await tx.branch.findMany({
        where: { id: { in: [...branchIds] } },
        select: { id: true, name: true },
      });
      const nameById = new Map(branchRows.map((b) => [b.id, b.name]));
      const keys = [...branchIds];
      if (received.some((d) => !d.branchId)) keys.push('__unassigned__');
      branches = keys.map((bid) => {
        const isUn = bid === '__unassigned__';
        const iss = issued.filter((d) => d.branchId === bid);
        const rec = received.filter((d) =>
          isUn ? !d.branchId : d.branchId === bid,
        );
        const o = this.taxBundleFromIssued(iss);
        const i = this.taxBundleFromReceived(rec);
        const nv = sub(o.vatTotal, i.vatTotal);
        return {
          branchId: isUn ? null : bid,
          branchName: isUn ? 'Unassigned' : nameById.get(bid) || bid,
          outputVat: o.vatTotal,
          inputVat: i.vatTotal,
          netVat: nv,
          position: this.positionLabel(nv),
          withholdingOutput: o.withholdingTotal,
          withholdingInput: i.withholdingTotal,
        };
      });
    }

    return {
      reportId: 'C1' as const,
      filters: this.publicFilters(f),
      summary: {
        period: { from: f.from, to: f.to },
        outputVat,
        inputVat,
        netVat,
        position: total.position,
        withholdingSeparate: {
          output: out.withholdingTotal,
          input: inn.withholdingTotal,
          otherOutput: out.otherTotal,
          otherInput: inn.otherTotal,
        },
      },
      vat: {
        output: out,
        input: inn,
      },
      rows: branches ?? [total],
      total,
      chart: {
        type: 'bar',
        data: [
          { name: 'outputVat', amount: outputVat },
          { name: 'inputVat', amount: inputVat },
          { name: 'netVat', amount: netVat },
        ],
      },
    };
  }

  private async salesVsPurchases(tx: Tx, f: ReportFilters) {
    const s1 = await this.salesTotal(tx, f);
    const p1 = await this.purchasesTotal(tx, f);
    const map = new Map<
      string,
      { bucket: string; sales: string; purchases: string }
    >();
    for (const row of s1.series) {
      const prev = map.get(row.bucket) ?? {
        bucket: row.bucket,
        sales: '0.00',
        purchases: '0.00',
      };
      prev.sales = add(prev.sales, row.net);
      map.set(row.bucket, prev);
    }
    for (const row of p1.series) {
      const prev = map.get(row.bucket) ?? {
        bucket: row.bucket,
        sales: '0.00',
        purchases: '0.00',
      };
      prev.purchases = add(prev.purchases, row.net);
      map.set(row.bucket, prev);
    }
    const series = [...map.values()].sort((a, b) =>
      a.bucket.localeCompare(b.bucket),
    );
    return {
      reportId: 'C2' as const,
      filters: this.publicFilters(f),
      summary: {
        salesNet: s1.summary.net,
        purchasesNet: p1.summary.net,
      },
      series,
      rows: series,
      chart: { type: 'dual-line', xKey: 'bucket' },
    };
  }

  private async statusOverview(tx: Tx, f: ReportFilters) {
    const issuedWhere: Prisma.DocumentWhereInput = {
      issueDateTime: { gte: f.rangeStart, lte: f.rangeEnd },
    };
    if (f.branchId) issuedWhere.branchId = f.branchId;
    if (f.currencyCode) issuedWhere.currencyCode = f.currencyCode;

    const receivedWhere: Prisma.ReceivedDocumentWhereInput = {
      dateTimeIssued: { gte: f.rangeStart, lte: f.rangeEnd },
    };
    if (f.branchId) receivedWhere.branchId = f.branchId;
    if (f.currencyCode) receivedWhere.currency = f.currencyCode;

    const [issued, received] = await Promise.all([
      tx.document.groupBy({
        by: ['status'],
        where: issuedWhere,
        _count: { _all: true },
      }),
      tx.receivedDocument.findMany({
        where: receivedWhere,
        select: { buyerDecision: true, etaStatus: true },
      }),
    ]);

    const issuedCounts = {
      valid: 0,
      invalid: 0,
      cancelled: 0,
      other: 0,
    };
    for (const row of issued) {
      const c = row._count._all;
      if (row.status === DocumentStatus.VALID) issuedCounts.valid += c;
      else if (row.status === DocumentStatus.INVALID) issuedCounts.invalid += c;
      else if (row.status === DocumentStatus.CANCELLED) issuedCounts.cancelled += c;
      else issuedCounts.other += c;
    }

    const receivedCounts = { accepted: 0, rejected: 0, other: 0 };
    for (const r of received) {
      if (r.buyerDecision === ReceivedBuyerDecision.ACCEPTED) {
        receivedCounts.accepted += 1;
      } else if (r.buyerDecision === ReceivedBuyerDecision.REJECTED) {
        receivedCounts.rejected += 1;
      } else if ((r.etaStatus ?? '').toLowerCase() === 'valid') {
        receivedCounts.accepted += 1;
      } else {
        receivedCounts.other += 1;
      }
    }

    const rows = [
      { side: 'issued', status: 'valid', count: issuedCounts.valid },
      { side: 'issued', status: 'invalid', count: issuedCounts.invalid },
      { side: 'issued', status: 'cancelled', count: issuedCounts.cancelled },
      { side: 'received', status: 'accepted', count: receivedCounts.accepted },
      { side: 'received', status: 'rejected', count: receivedCounts.rejected },
    ];

    return {
      reportId: 'C3' as const,
      filters: this.publicFilters(f),
      summary: { issued: issuedCounts, received: receivedCounts },
      rows,
      chart: { type: 'bar', dataKey: 'count', xKey: 'status' },
    };
  }

  /** Exposed for tests / export identity checks. */
  issuedSign = issuedDocumentSign;
  receivedSign = receivedDocumentSign;
  isCreditIssued = isCreditLikeIssued;
  isCreditReceived = isCreditLikeReceived;
}
