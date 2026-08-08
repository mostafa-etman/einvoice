import { BadRequestException, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  PDF_REPORT_IDS,
  type ReportFilters,
  type ReportId,
} from './report-filters';
import { ReportsService } from './reports.service';
import { flattenDetailForExport } from './report-document-detail';
import { formatMoneyDisplay } from '@einvoice/eta-core';

export type ExportFormat = 'CSV' | 'XLSX' | 'PDF';

type TenantHeader = {
  legalName: string;
  registrationNumber: string;
};

@Injectable()
export class ReportExportService {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async export(input: {
    tenantId: string;
    userId: string;
    reportId: ReportId;
    format: ExportFormat;
    filters: ReportFilters;
  }): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    if (input.format === 'PDF' && !PDF_REPORT_IDS.includes(input.reportId)) {
      throw new BadRequestException(
        `PDF export is not available for ${input.reportId}`,
      );
    }

    const data = await this.reports.run({
      tenantId: input.tenantId,
      reportId: input.reportId,
      filters:
        input.reportId === 'S5' || input.reportId === 'P5'
          ? { ...input.filters, limit: Math.max(input.filters.limit, 2000), offset: 0 }
          : input.filters,
    });
    const header = await this.loadTenantHeader(input.tenantId);

    let buffer: Buffer;
    let contentType: string;
    let ext: string;
    if (input.format === 'CSV') {
      buffer = Buffer.from(this.toCsv(data, input.reportId, header), 'utf8');
      contentType = 'text/csv; charset=utf-8';
      ext = 'csv';
    } else if (input.format === 'XLSX') {
      buffer = this.toXlsx(data, input.reportId, header);
      contentType =
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      ext = 'xlsx';
    } else {
      buffer = await this.toPdf(data, input.reportId, header);
      contentType = 'application/pdf';
      ext = 'pdf';
    }

    await this.audit.write({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      action: 'reports.export',
      outcome: 'success',
      resourceType: 'report',
      resourceId: input.reportId,
      metadata: {
        format: input.format,
        from: input.filters.from,
        to: input.filters.to,
      },
    });

    return {
      buffer,
      contentType,
      filename: `report-${input.reportId}-${input.filters.from}_${input.filters.to}.${ext}`,
    };
  }

  private async loadTenantHeader(tenantId: string): Promise<TenantHeader> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        legalName: true,
        tenantEtaCredentials: {
          take: 1,
          select: { registrationNumber: true },
          orderBy: { updatedAt: 'desc' },
        },
      },
    });
    return {
      legalName: (tenant?.legalName || tenant?.name || '').trim() || '—',
      registrationNumber:
        tenant?.tenantEtaCredentials?.[0]?.registrationNumber?.trim() || '—',
    };
  }

  private flattenRows(data: Record<string, unknown>): Record<string, unknown>[] {
    const rows = data.rows;
    if (Array.isArray(rows) && rows.length) {
      return rows as Record<string, unknown>[];
    }
    const summary = data.summary;
    if (summary && typeof summary === 'object') {
      return [summary as Record<string, unknown>];
    }
    return [];
  }

  private c4SummaryRows(
    data: Record<string, unknown>,
    header: TenantHeader,
  ): Record<string, unknown>[] {
    const summary = (data.summary ?? {}) as Record<string, unknown>;
    const filters = (data.filters ?? {}) as Record<string, unknown>;
    return [
      { field: 'Company', value: header.legalName },
      { field: 'Tax registration number', value: header.registrationNumber },
      { field: 'Period from', value: filters.from ?? summary.period },
      { field: 'Period to', value: filters.to ?? '' },
      { field: 'Sales value (netted)', value: summary.salesValue },
      { field: 'Output VAT', value: summary.outputVat },
      { field: 'Purchases value (netted)', value: summary.purchasesValue },
      { field: 'Input VAT (deductible)', value: summary.inputVat },
      { field: 'Net VAT (output − input)', value: summary.netVat },
      { field: 'Position', value: summary.position },
      { field: 'Withholding output (T4)', value: summary.withholdingOutput },
      { field: 'Withholding input (T4)', value: summary.withholdingInput },
      { field: 'Other output tax', value: summary.otherOutputTax },
      { field: 'Other input tax', value: summary.otherInputTax },
      {
        field: 'Disclaimer',
        value:
          summary.disclaimer ??
          'Reporting aid only — verify with accountant/ETA before filing.',
      },
    ];
  }

  private toCsv(
    data: Record<string, unknown>,
    reportId: ReportId,
    header: TenantHeader,
  ): string {
    if (reportId === 'S5' || reportId === 'P5') {
      const rows = (data.rows ?? []) as Array<Record<string, unknown>>;
      const { documents, lines } = flattenDetailForExport(
        rows,
        reportId === 'S5' ? 'sales' : 'purchases',
      );
      const esc = (v: unknown) => {
        const s = v == null ? '' : String(v);
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const out: string[] = [
        `company,${esc(header.legalName)}`,
        `taxRegistration,${esc(header.registrationNumber)}`,
        '',
      ];
      if (documents.length) {
        const keys = [...new Set(documents.flatMap((r) => Object.keys(r)))].filter(
          (k) => k !== 'lines' && k !== 'taxes',
        );
        out.push(keys.join(','));
        for (const row of documents) {
          out.push(keys.map((k) => esc(row[k])).join(','));
        }
      }
      if (lines.length) {
        out.push('');
        const keys = [...new Set(lines.flatMap((r) => Object.keys(r)))];
        out.push(keys.join(','));
        for (const row of lines) {
          out.push(keys.map((k) => esc(row[k])).join(','));
        }
      }
      return out.join('\n') + '\n';
    }

    if (reportId === 'C4') {
      const summaryRows = this.c4SummaryRows(data, header);
      const detail = this.flattenRows(data);
      const esc = (v: unknown) => {
        const s = v == null ? '' : String(v);
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const lines = [
        'section,field,value',
        ...summaryRows.map(
          (r) => `summary,${esc(r.field)},${esc(r.value)}`,
        ),
      ];
      if (detail.length) {
        const keys = [
          'side',
          'taxType',
          'subType',
          'rate',
          'category',
          'taxableValue',
          'taxAmount',
          'documentCount',
        ];
        lines.push(keys.join(','));
        for (const row of detail) {
          lines.push(keys.map((k) => esc(row[k])).join(','));
        }
      }
      return lines.join('\n') + '\n';
    }

    const rows = this.flattenRows(data);
    if (!rows.length) return 'empty\n';
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [keys.join(',')];
    for (const row of rows) {
      lines.push(keys.map((k) => esc(row[k])).join(','));
    }
    return lines.join('\n') + '\n';
  }

  private toXlsx(
    data: Record<string, unknown>,
    reportId: ReportId,
    header: TenantHeader,
  ): Buffer {
    const wb = XLSX.utils.book_new();
    if (reportId === 'S5' || reportId === 'P5') {
      const meta = XLSX.utils.json_to_sheet([
        { field: 'Company', value: header.legalName },
        { field: 'Tax registration number', value: header.registrationNumber },
        {
          field: 'Period from',
          value: (data.filters as Record<string, unknown>)?.from,
        },
        {
          field: 'Period to',
          value: (data.filters as Record<string, unknown>)?.to,
        },
        {
          field: 'Documents',
          value: (data.summary as Record<string, unknown>)?.documentCount,
        },
      ]);
      XLSX.utils.book_append_sheet(wb, meta, 'Header');
      const rows = (data.rows ?? []) as Array<Record<string, unknown>>;
      const { documents, lines } = flattenDetailForExport(
        rows,
        reportId === 'S5' ? 'sales' : 'purchases',
      );
      const docSheet = XLSX.utils.json_to_sheet(
        documents.length
          ? documents.map(({ lines: _l, taxes: _t, ...rest }) => {
              void _l;
              void _t;
              return rest;
            })
          : [{ empty: true }],
      );
      XLSX.utils.book_append_sheet(wb, docSheet, 'Documents');
      const lineSheet = XLSX.utils.json_to_sheet(
        lines.length ? lines : [{ empty: true }],
      );
      XLSX.utils.book_append_sheet(wb, lineSheet, 'Line items');
      return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    }

    if (reportId === 'C4') {
      const summarySheet = XLSX.utils.json_to_sheet(
        this.c4SummaryRows(data, header),
      );
      XLSX.utils.book_append_sheet(wb, summarySheet, 'VAT Return');
      const detail = this.flattenRows(data);
      const detailSheet = XLSX.utils.json_to_sheet(
        detail.length
          ? detail
          : [{ side: '', taxType: '', taxAmount: '0.00' }],
      );
      XLSX.utils.book_append_sheet(wb, detailSheet, 'By tax type');
      return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    }

    const rows = this.flattenRows(data);
    const sheet = XLSX.utils.json_to_sheet(
      rows.length ? rows : [{ empty: true }],
    );
    XLSX.utils.book_append_sheet(wb, sheet, 'Report');
    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }

  private toPdf(
    data: Record<string, unknown>,
    reportId: ReportId,
    header: TenantHeader,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c as Buffer));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const filters = data.filters as Record<string, unknown> | undefined;
      const summary = data.summary as Record<string, unknown> | undefined;

      if (reportId === 'C4') {
        doc
          .fontSize(16)
          .text('Egyptian VAT Return / إقرار القيمة المضافة', {
            underline: true,
          });
        doc.moveDown(0.5);
        doc.fontSize(11).text(`Company: ${header.legalName}`);
        doc
          .fontSize(11)
          .text(`Tax registration number: ${header.registrationNumber}`, {
            features: [],
          });
        if (filters) {
          doc
            .fontSize(10)
            .text(`Period: ${filters.from} → ${filters.to}`);
        }
        doc.moveDown();
        doc.fontSize(12).text('Summary', { underline: true });
        const lines: Array<[string, unknown]> = [
          ['Sales value (netted)', summary?.salesValue],
          ['Output VAT', summary?.outputVat],
          ['Purchases value (netted)', summary?.purchasesValue],
          ['Input VAT (deductible)', summary?.inputVat],
          ['Net VAT (output − input)', summary?.netVat],
          ['Position', summary?.position],
          ['Withholding output (T4) — not in net VAT', summary?.withholdingOutput],
          ['Withholding input (T4) — not in net VAT', summary?.withholdingInput],
        ];
        for (const [label, value] of lines) {
          doc.fontSize(10).text(`${label}: ${String(value ?? '—')}`);
        }
        doc.moveDown();
        doc.fontSize(12).text('Detail by tax type / rate', { underline: true });
        const rows = this.flattenRows(data).slice(0, 80);
        for (const row of rows) {
          doc
            .fontSize(9)
            .text(
              `${row.side} | ${row.taxType}/${row.subType} @ ${row.rate}% | taxable ${row.taxableValue} | tax ${row.taxAmount}`,
            );
        }
        doc.moveDown();
        doc
          .fontSize(8)
          .fillColor('#555555')
          .text(
            String(
              summary?.disclaimer ??
                'Reporting aid only — verify figures with your accountant / ETA before filing.',
            ),
          );
        doc.end();
        return;
      }

      doc.fontSize(16).text(`Report ${reportId}`, { underline: true });
      doc.moveDown();
      doc.fontSize(10).text(`Company: ${header.legalName}`);
      doc
        .fontSize(10)
        .text(`Tax registration: ${header.registrationNumber}`);
      if (filters) {
        doc.fontSize(10).text(`Period: ${filters.from} → ${filters.to}`);
      }
      doc.moveDown();

      if (reportId === 'S5' || reportId === 'P5') {
        doc
          .fontSize(12)
          .text(
            reportId === 'S5' ? 'Sales Detail' : 'Purchases Detail',
            { underline: true },
          );
        doc
          .fontSize(10)
          .text(`Documents: ${String(summary?.documentCount ?? 0)}`);
        doc.moveDown(0.5);
        const rows = ((data.rows ?? []) as Array<Record<string, unknown>>).slice(
          0,
          200,
        );
        for (const row of rows) {
          const party =
            reportId === 'S5'
              ? `${row.receiverName ?? ''} (${row.receiverId ?? ''})`
              : `${row.issuerName ?? ''} (${row.issuerId ?? ''})`;
          doc
            .fontSize(9)
            .fillColor('#000000')
            .text(
              `${row.internalId ?? '—'} | ${row.kind} | ${row.issueDate ?? ''} | ${party}`,
            );
          doc
            .fontSize(8)
            .text(
              `Net ${formatMoneyDisplay(row.netAmount)}  Discount ${formatMoneyDisplay(row.totalDiscountAmount)}  Total ${formatMoneyDisplay(row.totalAmount)} ${row.currencyCode ?? ''}  Status ${row.status ?? ''}`,
            );
          const taxSum =
            String(row.taxesSummaryEn ?? row.taxesSummaryAr ?? '') || '—';
          doc.fontSize(8).text(`Taxes: ${taxSum}`);
          const lines = Array.isArray(row.lines)
            ? (row.lines as Array<Record<string, unknown>>)
            : [];
          for (const line of lines.slice(0, 40)) {
            doc
              .fontSize(7)
              .fillColor('#333333')
              .text(
                `  · ${line.itemName || line.itemCode || '—'} [${line.itemCode ?? ''}] qty ${line.quantity ?? ''} @ ${formatMoneyDisplay(line.unitPrice)} = ${formatMoneyDisplay(line.total)}`,
              );
          }
          doc.moveDown(0.3);
          if (doc.y > 750) doc.addPage();
        }
        doc.end();
        return;
      }

      if (summary) {
        doc.fontSize(12).text('Summary');
        for (const [k, v] of Object.entries(summary)) {
          if (v && typeof v === 'object') {
            doc.fontSize(10).text(`${k}: ${JSON.stringify(v)}`);
          } else {
            doc.fontSize(10).text(`${k}: ${String(v)}`);
          }
        }
      }
      doc.moveDown();
      const rows = this.flattenRows(data).slice(0, 40);
      if (rows.length) {
        doc.fontSize(12).text('Rows');
        for (const row of rows) {
          doc.fontSize(9).text(JSON.stringify(row));
        }
      }
      doc.end();
    });
  }
}
