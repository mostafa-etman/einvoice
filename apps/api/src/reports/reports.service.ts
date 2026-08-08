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
  splitVatBreakdown,
  type VatBreakdownRow,
} from './report-vat';
import {
  VatReturnAccumulator,
  availableTaxTypes,
  sumVatReturn,
} from './report-egyptian-vat-return';
import {
  extractIssuedDocumentTaxes,
  extractReceivedDocumentTaxes,
  toTaxLineIn,
  toVatReturnLineIn,
} from './report-tax-sources';
import {
  attachTaxNames,
  loadItemNamesByCode,
  loadTaxCatalogNames,
  periodBucketLabels,
} from './report-catalog-labels';

type Tx = Prisma.TransactionClient;

type IssuedRow = {
  id: string;
  kind: DocumentKind;
  status: DocumentStatus;
  branchId: string;
  currencyCode: string;
  issueDateTime: Date;
  totalAmount: string;
  netAmount: string;
  taxTotalsJson: Prisma.JsonValue;
  receiverId: string | null;
  receiverName: string | null;
  lines: Array<{
    itemCode: string;
    itemType: string;
    description: string;
    quantity: string;
    total: string;
    netTotal?: string;
    taxes: Array<{
      taxType: string;
      subType: string;
      rate: string;
      amount: string;
    }>;
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
  netAmount: string | null;
  issuerId: string | null;
  issuerName: string | null;
  rawSummaryJson: Prisma.JsonValue;
  rawDetailsJson: Prisma.JsonValue | null;
  lines: Array<{
    itemCode: string | null;
    itemType: string | null;
    description: string | null;
    quantity: string | null;
    total: string | null;
    netTotal?: string | null;
    taxesJson: Prisma.JsonValue;
    rawJson: Prisma.JsonValue | null;
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
        // Total sales is always monthly for readable period labels.
        return this.salesTotal(tx, { ...f, grain: 'month' });
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
      case 'C4':
        return this.egyptianVatReturn(tx, f);
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
      taxType: f.taxType ?? null,
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
        netAmount: true,
        taxTotalsJson: true,
        receiverId: true,
        receiverName: true,
        lines: {
          select: {
            itemCode: true,
            itemType: true,
            description: true,
            quantity: true,
            total: true,
            netTotal: true,
            taxes: {
              select: {
                taxType: true,
                subType: true,
                rate: true,
                amount: true,
              },
            },
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
        netAmount: true,
        issuerId: true,
        issuerName: true,
        rawSummaryJson: true,
        rawDetailsJson: true,
        lines: {
          select: {
            itemCode: true,
            itemType: true,
            description: true,
            quantity: true,
            total: true,
            netTotal: true,
            taxesJson: true,
            rawJson: true,
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
      {
        bucket: string;
        bucketLabelEn: string;
        bucketLabelAr: string;
        currencyCode: string;
        net: string;
        grossPositive: string;
        creditReduction: string;
      }
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
      const labels = periodBucketLabels(bucket, f.grain);
      const key = `${bucket}|${cur}`;
      const prev = seriesMap.get(key) ?? {
        bucket,
        bucketLabelEn: labels.bucketLabelEn,
        bucketLabelAr: labels.bucketLabelAr,
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
      filters: this.publicFilters({ ...f, grain: 'month' }),
      summary: {
        net,
        ...(f.showGross ? { grossPositive, creditReduction } : {}),
        documentCount: docs.length,
      },
      series,
      rows: series,
      chart: { type: 'line', dataKey: 'net', xKey: 'bucketLabel' },
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
    const baseRows = [...map.values()]
      .sort((a, b) => Number(b.net) - Number(a.net))
      .slice(0, f.limit);
    const names = await loadItemNamesByCode(
      tx,
      baseRows.map((r) => r.itemCode).filter(Boolean),
    );
    const rows = baseRows.map((r) => ({
      itemName: names.get(r.itemCode) ?? null,
      itemCode: r.itemCode,
      description: r.description,
      quantity: r.quantity,
      net: r.net,
    }));
    return {
      reportId: 'S3' as const,
      filters: this.publicFilters(f),
      summary: { rowCount: rows.length },
      rows,
      chart: { type: 'bar', dataKey: 'net', xKey: 'itemName' },
    };
  }

  private taxBundleFromIssued(docs: IssuedRow[]) {
    const rows = new Map<string, VatBreakdownRow>();
    for (const d of docs) {
      const sign = issuedDocumentSign(d.kind);
      accumulateTaxRows(
        rows,
        toTaxLineIn(extractIssuedDocumentTaxes(d)),
        sign,
      );
    }
    return splitVatBreakdown(rows.values());
  }

  private taxBundleFromReceived(docs: ReceivedRow[]) {
    const rows = new Map<string, VatBreakdownRow>();
    for (const d of docs) {
      const sign = receivedDocumentSign(d.kind, d.etaDocumentType);
      accumulateTaxRows(
        rows,
        toTaxLineIn(extractReceivedDocumentTaxes(d)),
        sign,
      );
    }
    return splitVatBreakdown(rows.values());
  }

  private async outputVat(tx: Tx, f: ReportFilters) {
    const docs = await this.loadIssued(tx, f);
    const split = this.taxBundleFromIssued(docs);
    const catalogs = await loadTaxCatalogNames(tx);
    const vat = attachTaxNames(split.vat, catalogs);
    const withholding = attachTaxNames(split.withholding, catalogs);
    const other = attachTaxNames(split.other, catalogs);
    return {
      reportId: 'S4' as const,
      filters: this.publicFilters(f),
      summary: {
        outputVat: split.vatTotal,
        withholding: split.withholdingTotal,
        otherTaxes: split.otherTotal,
      },
      vat: { ...split, vat, withholding, other },
      rows: vat,
      chart: { type: 'bar', dataKey: 'amount', xKey: 'taxTypeNameEn' },
    };
  }

  private async purchasesTotal(tx: Tx, f: ReportFilters) {
    const docs = await this.loadReceived(tx, f);
    const seriesMap = new Map<
      string,
      {
        bucket: string;
        bucketLabelEn: string;
        bucketLabelAr: string;
        currencyCode: string;
        net: string;
        grossPositive: string;
        creditReduction: string;
      }
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
      const labels = periodBucketLabels(bucket, f.grain);
      const key = `${bucket}|${cur}`;
      const prev = seriesMap.get(key) ?? {
        bucket,
        bucketLabelEn: labels.bucketLabelEn,
        bucketLabelAr: labels.bucketLabelAr,
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
      chart: { type: 'line', dataKey: 'net', xKey: 'bucketLabel' },
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
    const catalogs = await loadTaxCatalogNames(tx);
    const vat = attachTaxNames(split.vat, catalogs);
    const withholding = attachTaxNames(split.withholding, catalogs);
    const other = attachTaxNames(split.other, catalogs);
    return {
      reportId: 'P3' as const,
      filters: this.publicFilters(f),
      summary: {
        inputVat: split.vatTotal,
        withholding: split.withholdingTotal,
        otherTaxes: split.otherTotal,
      },
      vat: { ...split, vat, withholding, other },
      rows: vat,
      chart: { type: 'bar', dataKey: 'amount', xKey: 'taxTypeNameEn' },
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
      branchName: '__TOTAL__',
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
          branchName: isUn ? '__UNASSIGNED__' : nameById.get(bid) || bid,
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

  /**
   * C4 — Egyptian VAT Return (إقرار القيمة المضافة).
   * Period declaration layout: sales value + output tax, purchases + input tax,
   * net VAT payable/refundable; T4 withholding shown separately (never in net).
   */
  private async egyptianVatReturn(tx: Tx, f: ReportFilters) {
    const issued = await this.loadIssued(tx, f);
    const received = await this.loadReceived(tx, f);
    const acc = new VatReturnAccumulator();

    let salesValue = '0.00';
    let purchasesValue = '0.00';
    for (const d of issued) {
      const sign = issuedDocumentSign(d.kind);
      const parts = moneyParts(sign, d.netAmount || d.totalAmount, false);
      salesValue = add(salesValue, parts.signed);
      acc.addTaxes(
        'output',
        toVatReturnLineIn(extractIssuedDocumentTaxes(d)),
        sign,
        d.netAmount || d.totalAmount,
      );
    }

    for (const d of received) {
      const sign = receivedDocumentSign(d.kind, d.etaDocumentType);
      const parts = moneyParts(sign, d.netAmount || d.totalAmount || '0', false);
      purchasesValue = add(purchasesValue, parts.signed);
      acc.addTaxes(
        'input',
        toVatReturnLineIn(extractReceivedDocumentTaxes(d)),
        sign,
        d.netAmount || d.totalAmount,
      );
    }

    const allRows = acc.rows();
    const filtered = acc.rows(f.taxType);
    const outputVat = sumVatReturn(
      allRows,
      (r) => r.side === 'output' && r.category === 'vat',
    );
    const inputVat = sumVatReturn(
      allRows,
      (r) => r.side === 'input' && r.category === 'vat',
    );
    const outputOther = sumVatReturn(
      allRows,
      (r) => r.side === 'output' && r.category === 'other',
    );
    const inputOther = sumVatReturn(
      allRows,
      (r) => r.side === 'input' && r.category === 'other',
    );
    const withholdingOut = sumVatReturn(
      allRows,
      (r) => r.side === 'output' && r.category === 'withholding',
    );
    const withholdingIn = sumVatReturn(
      allRows,
      (r) => r.side === 'input' && r.category === 'withholding',
    );
    const netVat = sub(outputVat.taxAmount, inputVat.taxAmount);
    const position = this.positionLabel(netVat);

    const outputRows = filtered.filter((r) => r.side === 'output');
    const inputRows = filtered.filter((r) => r.side === 'input');
    const withholdingRows = filtered.filter(
      (r) => r.category === 'withholding',
    );

    const catalogs = await loadTaxCatalogNames(tx);
    const namedOutput = attachTaxNames(outputRows, catalogs);
    const namedInput = attachTaxNames(inputRows, catalogs);
    const namedWithholding = attachTaxNames(withholdingRows, catalogs);
    const namedFiltered = attachTaxNames(filtered, catalogs);

    return {
      reportId: 'C4' as const,
      filters: this.publicFilters(f),
      summary: {
        period: { from: f.from, to: f.to },
        salesValue,
        purchasesValue,
        outputVat: outputVat.taxAmount,
        outputVatTaxable: outputVat.taxableValue,
        inputVat: inputVat.taxAmount,
        inputVatTaxable: inputVat.taxableValue,
        netVat,
        position,
        otherOutputTax: outputOther.taxAmount,
        otherInputTax: inputOther.taxAmount,
        withholdingOutput: withholdingOut.taxAmount,
        withholdingInput: withholdingIn.taxAmount,
        salesDocumentCount: issued.length,
        purchasesDocumentCount: received.length,
        taxTypeFilter: f.taxType ?? null,
      },
      taxTypes: availableTaxTypes(allRows),
      sections: {
        output: namedOutput,
        input: namedInput,
        withholding: namedWithholding,
      },
      rows: namedFiltered.map((r) => ({
        side: r.side,
        taxType: r.taxType,
        taxTypeNameEn: r.taxTypeNameEn,
        taxTypeNameAr: r.taxTypeNameAr,
        subType: r.subType,
        subTypeNameEn: r.subTypeNameEn,
        subTypeNameAr: r.subTypeNameAr,
        rate: r.rate,
        category: r.category,
        taxableValue: r.taxableValue,
        taxAmount: r.taxAmount,
        documentCount: r.documentCount,
      })),
      chart: {
        type: 'bar',
        data: [
          { name: 'outputVat', amount: outputVat.taxAmount },
          { name: 'inputVat', amount: inputVat.taxAmount },
          { name: 'netVat', amount: netVat },
          { name: 'withholding', amount: withholdingOut.taxAmount },
        ],
      },
    };
  }

  private async salesVsPurchases(tx: Tx, f: ReportFilters) {
    const s1 = await this.salesTotal(tx, f);
    const p1 = await this.purchasesTotal(tx, f);
    const map = new Map<
      string,
      {
        bucket: string;
        bucketLabelEn: string;
        bucketLabelAr: string;
        sales: string;
        purchases: string;
      }
    >();
    for (const row of s1.series) {
      const labels = periodBucketLabels(row.bucket, f.grain);
      const prev = map.get(row.bucket) ?? {
        bucket: row.bucket,
        bucketLabelEn: row.bucketLabelEn ?? labels.bucketLabelEn,
        bucketLabelAr: row.bucketLabelAr ?? labels.bucketLabelAr,
        sales: '0.00',
        purchases: '0.00',
      };
      prev.sales = add(prev.sales, row.net);
      map.set(row.bucket, prev);
    }
    for (const row of p1.series) {
      const labels = periodBucketLabels(row.bucket, f.grain);
      const prev = map.get(row.bucket) ?? {
        bucket: row.bucket,
        bucketLabelEn: row.bucketLabelEn ?? labels.bucketLabelEn,
        bucketLabelAr: row.bucketLabelAr ?? labels.bucketLabelAr,
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
      chart: { type: 'dual-line', xKey: 'bucketLabel' },
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
