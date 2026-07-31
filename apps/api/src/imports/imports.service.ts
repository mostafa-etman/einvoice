import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Inject,
  Logger,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { DocumentKind, ImportJobStatus, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { SigningService } from '../signing/signing.service';
import { ImportParseService, detectImportFormat } from './import-parse.service';
import {
  ImportValidateService,
  IMPORT_REQUIRED_FIELDS,
  applyMapping,
  type ColumnMapping,
} from './import-validate.service';
import { ImportErrorReportService } from './import-error-report.service';
import { resolveImportTerminalStatus } from './import-partial-status';
import { QUEUE_IMPORT, type ImportJobData } from '../queues/queue-names';
import type { ArtifactStorage } from '../storage/storage.module';
import { loadEnv } from '../config/env';
import * as XLSX from 'xlsx';

const ETA_TYPE_TO_KIND: Record<string, DocumentKind> = {
  I: 'INVOICE',
  C: 'CREDIT_NOTE',
  D: 'DEBIT_NOTE',
};

@Injectable()
export class ImportsService {
  private readonly log = new Logger(ImportsService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    private readonly signing: SigningService,
    private readonly parseSvc: ImportParseService,
    private readonly validateSvc: ImportValidateService,
    private readonly errorReports: ImportErrorReportService,
    @Inject('ArtifactStorage') private readonly artifacts: ArtifactStorage,
    @InjectQueue(QUEUE_IMPORT) private readonly importQueue: Queue<ImportJobData>,
  ) {}

  templateCsv(_documentType = 'I'): Buffer {
    const headers = [...IMPORT_REQUIRED_FIELDS];
    const sample = [
      'INV-SAMPLE-001',
      new Date().toISOString(),
      'Sample Buyer',
      '123456789',
      'EGS-1',
      '1',
      '100.00',
    ];
    const body = `${headers.join(',')}\n${sample.join(',')}\n`;
    return Buffer.from(body, 'utf8');
  }

  templateXlsx(_documentType = 'I'): Buffer {
    const headers = [...IMPORT_REQUIRED_FIELDS];
    const sample = [
      'INV-SAMPLE-001',
      new Date().toISOString(),
      'Sample Buyer',
      '123456789',
      'EGS-1',
      '1',
      '100.00',
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, sample]);
    XLSX.utils.book_append_sheet(wb, ws, 'Import');
    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }

  async listJobs(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.importJob.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  }

  async getJob(tenantId: string, jobId: string) {
    const job = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.importJob.findFirst({ where: { id: jobId, tenantId } }),
    );
    if (!job) throw new NotFoundException('Import job not found');
    return {
      ...job,
      errorReportAvailable: Boolean(job.errorReportObjectKey),
    };
  }

  async listRows(tenantId: string, jobId: string, status?: string) {
    await this.getJob(tenantId, jobId);
    return this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.importRowResult.findMany({
        where: {
          tenantId,
          importJobId: jobId,
          ...(status ? { status: status as never } : {}),
        },
        orderBy: { rowNumber: 'asc' },
        take: 500,
      }),
    );
  }

  async createJob(args: {
    tenantId: string;
    userId: string;
    documentType: string;
    branchId?: string;
    fileName: string;
    contentType: string;
    buffer: Buffer;
  }) {
    const env = loadEnv();
    const format = detectImportFormat(args.fileName, args.contentType);
    if (format === 'unsupported') {
      throw new BadRequestException('Only CSV and XLSX are supported (.xls rejected)');
    }
    if (args.buffer.byteLength > env.IMPORT_MAX_BYTES) {
      throw new BadRequestException(`File exceeds IMPORT_MAX_BYTES (${env.IMPORT_MAX_BYTES})`);
    }
    if (this.parseSvc.isLegacyXls(args.buffer)) {
      throw new BadRequestException('Legacy .xls is not supported; use CSV or XLSX');
    }

    const checksum = createHash('sha256').update(args.buffer).digest('hex');
    const objectId = `${Date.now()}-${checksum.slice(0, 12)}.${format}`;
    const put = await this.artifacts.put({
      tenantId: args.tenantId,
      kind: 'imports',
      objectId,
      contentType: args.contentType || (format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      body: args.buffer,
    });

    // Auto-map when headers match template field names
    const mapping = await this.proposeMapping(args.buffer, format);

    const job = await this.tenantPrisma.withTenant(args.tenantId, (tx) =>
      tx.importJob.create({
        data: {
          tenantId: args.tenantId,
          createdByUserId: args.userId,
          documentType: args.documentType || 'I',
          branchId: args.branchId,
          status: 'UPLOADED',
          sourceFileName: args.fileName,
          sourceContentType: put.contentType,
          sourceByteSize: args.buffer.byteLength,
          sourceChecksum: checksum,
          sourceObjectKey: put.key,
          mappingJson: mapping as Prisma.InputJsonValue,
        },
      }),
    );

    await this.audit.write({
      action: 'imports.upload',
      outcome: 'success',
      actorUserId: args.userId,
      tenantId: args.tenantId,
      resourceType: 'import_job',
      resourceId: job.id,
      metadata: { fileName: args.fileName, bytes: args.buffer.byteLength },
    });

    return job;
  }

  private async proposeMapping(
    buffer: Buffer,
    format: 'csv' | 'xlsx',
  ): Promise<ColumnMapping> {
    const headers = new Set<string>();
    if (format === 'csv') {
      const text = buffer.toString('utf8').split(/\r?\n/)[0] ?? '';
      for (const h of text.split(',')) headers.add(h.trim());
    } else {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]!];
      if (sheet) {
        const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
        for (const h of rows[0] ?? []) headers.add(String(h ?? '').trim());
      }
    }
    const mapping: ColumnMapping = {};
    for (const field of IMPORT_REQUIRED_FIELDS) {
      if (headers.has(field)) mapping[field] = field;
    }
    return mapping;
  }

  async putMapping(tenantId: string, userId: string, jobId: string, mapping: ColumnMapping) {
    const job = await this.getJob(tenantId, jobId);
    const missing = IMPORT_REQUIRED_FIELDS.filter((f) => !mapping[f]?.trim());
    if (missing.length) {
      throw new BadRequestException(`Required fields unmapped: ${missing.join(', ')}`);
    }
    const updated = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.importJob.update({
        where: { id: job.id },
        data: {
          mappingJson: mapping as Prisma.InputJsonValue,
          status: 'MAPPING',
        },
      }),
    );
    await this.audit.write({
      action: 'imports.mapping',
      outcome: 'success',
      actorUserId: userId,
      tenantId,
      resourceType: 'import_job',
      resourceId: jobId,
    });
    return updated;
  }

  async enqueueValidate(tenantId: string, userId: string, jobId: string) {
    const job = await this.getJob(tenantId, jobId);
    const mapping = (job.mappingJson ?? {}) as ColumnMapping;
    const missing = IMPORT_REQUIRED_FIELDS.filter((f) => !mapping[f]?.trim());
    if (missing.length) {
      throw new BadRequestException(`Required fields unmapped: ${missing.join(', ')}`);
    }
    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.importJob.update({
        where: { id: jobId },
        data: { status: 'VALIDATING', startedAt: new Date() },
      }),
    );
    await this.importQueue.add(
      'validate',
      { tenantId, importJobId: jobId, phase: 'validate' },
      { removeOnComplete: 100, removeOnFail: 50 },
    );
    await this.audit.write({
      action: 'imports.validate',
      outcome: 'success',
      actorUserId: userId,
      tenantId,
      resourceType: 'import_job',
      resourceId: jobId,
    });
    return this.getJob(tenantId, jobId);
  }

  async enqueueRun(
    tenantId: string,
    userId: string,
    jobId: string,
    runMode: 'CREATE_ONLY' | 'CREATE_SIGN_SUBMIT',
  ) {
    const job = await this.getJob(tenantId, jobId);
    if (job.status !== 'VALIDATED') {
      throw new BadRequestException('Job must be VALIDATED before run');
    }
    if (job.validRows <= 0) {
      throw new BadRequestException('No valid rows to import');
    }
    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.importJob.update({
        where: { id: jobId },
        data: { status: 'RUNNING', runMode, startedAt: new Date() },
      }),
    );
    await this.importQueue.add(
      'run',
      { tenantId, importJobId: jobId, phase: 'run' },
      { removeOnComplete: 100, removeOnFail: 50 },
    );
    await this.audit.write({
      action: 'imports.run',
      outcome: 'success',
      actorUserId: userId,
      tenantId,
      resourceType: 'import_job',
      resourceId: jobId,
      metadata: { runMode },
    });
    return this.getJob(tenantId, jobId);
  }

  async downloadErrorReport(tenantId: string, jobId: string): Promise<Buffer> {
    const job = await this.getJob(tenantId, jobId);
    if (!job.errorReportObjectKey) {
      throw new NotFoundException('Error report not ready');
    }
    return this.artifacts.getByKey(job.errorReportObjectKey);
  }

  async processValidate(tenantId: string, jobId: string) {
    const env = loadEnv();
    const job = await this.getJob(tenantId, jobId);
    const mapping = (job.mappingJson ?? {}) as ColumnMapping;
    const fileBuf = await this.artifacts.getByKey(job.sourceObjectKey);
    const format = detectImportFormat(job.sourceFileName, job.sourceContentType);
    if (format === 'unsupported') throw new Error('Unsupported format');

    const rows: { rowNumber: number; cells: Record<string, string> }[] = [];
    if (format === 'csv') {
      await this.parseSvc.parseCsv(fileBuf.toString('utf8'), {
        maxRows: env.IMPORT_MAX_ROWS,
        onRow: (r) => {
          rows.push(r);
        },
      });
    } else {
      await this.parseSvc.parseXlsx(fileBuf, {
        maxRows: env.IMPORT_MAX_ROWS,
        onRow: async (r) => {
          rows.push(r);
        },
      });
    }

    const { results, validRows, invalidRows } = this.validateSvc.validateRows(
      rows,
      mapping,
    );

    // Replace prior row results + error report
    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      await tx.importRowResult.deleteMany({ where: { importJobId: jobId, tenantId } });
      const batchSize = 200;
      for (let i = 0; i < results.length; i += batchSize) {
        const slice = results.slice(i, i + batchSize);
        await tx.importRowResult.createMany({
          data: slice.map((r) => ({
            tenantId,
            importJobId: jobId,
            rowNumber: r.rowNumber,
            businessKey: r.businessKey,
            status: r.status,
            errorsJson: r.errors as unknown as Prisma.InputJsonValue,
          })),
        });
      }
    });

    const csv = this.errorReports.buildCsv(results);
    const reportPut = await this.artifacts.put({
      tenantId,
      kind: 'imports',
      objectId: `${jobId}-error-report.csv`,
      contentType: 'text/csv',
      body: Buffer.from(csv, 'utf8'),
    });

    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.importJob.update({
        where: { id: jobId },
        data: {
          status: 'VALIDATED',
          totalRows: results.length,
          validRows,
          invalidRows,
          processedRows: results.length,
          errorReportObjectKey: reportPut.key,
          finishedAt: new Date(),
        },
      }),
    );
  }

  async processRun(tenantId: string, jobId: string) {
    const job = await this.getJob(tenantId, jobId);
    const mapping = (job.mappingJson ?? {}) as ColumnMapping;
    const kind = ETA_TYPE_TO_KIND[job.documentType] ?? 'INVOICE';

    const branchId =
      job.branchId ??
      (
        await this.tenantPrisma.withTenant(tenantId, (tx) =>
          tx.branch.findFirst({
            where: { tenantId, isDefault: true },
            select: { id: true },
          }),
        )
      )?.id;
    if (!branchId) throw new Error('No branch available for import');

    const validRows = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.importRowResult.findMany({
        where: { tenantId, importJobId: jobId, status: 'VALID' },
        orderBy: { rowNumber: 'asc' },
      }),
    );

    // Need mapped cells — re-parse file for VALID rows only
    const env = loadEnv();
    const fileBuf = await this.artifacts.getByKey(job.sourceObjectKey);
    const format = detectImportFormat(job.sourceFileName, job.sourceContentType);
    const allRows: { rowNumber: number; cells: Record<string, string> }[] = [];
    if (format === 'csv') {
      await this.parseSvc.parseCsv(fileBuf.toString('utf8'), {
        maxRows: env.IMPORT_MAX_ROWS,
        onRow: (r) => {
          allRows.push(r);
        },
      });
    } else {
      await this.parseSvc.parseXlsx(fileBuf, {
        maxRows: env.IMPORT_MAX_ROWS,
        onRow: async (r) => {
          allRows.push(r);
        },
      });
    }
    const byNum = new Map(allRows.map((r) => [r.rowNumber, r]));

    let createdDocs = 0;
    let failedRows = 0;
    let signEnqueued = 0;

    for (const row of validRows) {
      if (row.documentId) {
        createdDocs += 1;
        continue;
      }
      const raw = byNum.get(row.rowNumber);
      if (!raw) {
        failedRows += 1;
        continue;
      }
      const mapped = applyMapping(raw.cells, mapping);
      try {
        const rowBranchId =
          (mapped.branchId || '').trim() || branchId;
        const dto = {
          kind,
          branchId: rowBranchId,
          currencyCode: 'EGP',
          issueDateTime: mapped.dateTimeIssued || new Date().toISOString(),
          internalId: mapped.internalID,
          version: 0,
          receiver: {
            type: 'B',
            id: mapped.receiverId,
            name: mapped.receiverName,
          },
          lines: [
            {
              description: mapped.itemCode || 'Item',
              itemType: 'EGS',
              itemCode: mapped.itemCode,
              unitType: 'EA',
              quantity: mapped.quantity,
              unitPrice: mapped.unitPrice,
              discountAmount: '0.00',
              taxes: [{ taxType: 'T1', subType: 'V001', rate: '14.00' }],
            },
          ],
        };
        const created = await this.documents.create(
          tenantId,
          job.createdByUserId ?? 'system',
          dto,
        );
        await this.documents.markReady(
          tenantId,
          job.createdByUserId ?? 'system',
          created.id,
        );
        // Link lineage
        await this.tenantPrisma.withTenant(tenantId, (tx) =>
          tx.document.update({
            where: { id: created.id },
            data: { importJobId: jobId, importRowNumber: row.rowNumber },
          }),
        );
        await this.tenantPrisma.withTenant(tenantId, (tx) =>
          tx.importRowResult.update({
            where: { id: row.id },
            data: { status: 'CREATED', documentId: created.id },
          }),
        );
        createdDocs += 1;

        if (job.runMode === 'CREATE_SIGN_SUBMIT') {
          try {
            await this.signing.sendForSignature(
              tenantId,
              job.createdByUserId ?? 'system',
              created.id,
            );
            await this.tenantPrisma.withTenant(tenantId, (tx) =>
              tx.importRowResult.update({
                where: { id: row.id },
                data: { status: 'SIGN_ENQUEUED' },
              }),
            );
            signEnqueued += 1;
          } catch (err) {
            this.log.warn(`sign enqueue failed for ${created.id}: ${String(err)}`);
            failedRows += 1;
            await this.tenantPrisma.withTenant(tenantId, (tx) =>
              tx.importRowResult.update({
                where: { id: row.id },
                data: { status: 'FAILED' },
              }),
            );
          }
        }
      } catch (err) {
        this.log.warn(`create failed row ${row.rowNumber}: ${String(err)}`);
        failedRows += 1;
        await this.tenantPrisma.withTenant(tenantId, (tx) =>
          tx.importRowResult.update({
            where: { id: row.id },
            data: { status: 'FAILED' },
          }),
        );
      }
    }

    const status = resolveImportTerminalStatus({
      validRows: job.validRows,
      invalidRows: job.invalidRows,
      createdDocs,
      failedRows,
      runAttempted: true,
    }) as ImportJobStatus;

    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.importJob.update({
        where: { id: jobId },
        data: {
          status,
          createdDocs,
          failedRows,
          signEnqueued,
          finishedAt: new Date(),
        },
      }),
    );
  }
}
