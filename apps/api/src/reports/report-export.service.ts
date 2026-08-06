import { BadRequestException, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';
import { AuditService } from '../audit/audit.service';
import {
  PDF_REPORT_IDS,
  type ReportFilters,
  type ReportId,
} from './report-filters';
import { ReportsService } from './reports.service';

export type ExportFormat = 'CSV' | 'XLSX' | 'PDF';

@Injectable()
export class ReportExportService {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
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
      filters: input.filters,
    });

    let buffer: Buffer;
    let contentType: string;
    let ext: string;
    if (input.format === 'CSV') {
      buffer = Buffer.from(this.toCsv(data), 'utf8');
      contentType = 'text/csv; charset=utf-8';
      ext = 'csv';
    } else if (input.format === 'XLSX') {
      buffer = this.toXlsx(data);
      contentType =
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      ext = 'xlsx';
    } else {
      buffer = await this.toPdf(data, input.reportId);
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

  private toCsv(data: Record<string, unknown>): string {
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

  private toXlsx(data: Record<string, unknown>): Buffer {
    const rows = this.flattenRows(data);
    const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ empty: true }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Report');
    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }

  private toPdf(
    data: Record<string, unknown>,
    reportId: ReportId,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c as Buffer));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(16).text(`Report ${reportId}`, { underline: true });
      doc.moveDown();
      const filters = data.filters as Record<string, unknown> | undefined;
      if (filters) {
        doc.fontSize(10).text(`Period: ${filters.from} → ${filters.to}`);
      }
      doc.moveDown();
      const summary = data.summary as Record<string, unknown> | undefined;
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
