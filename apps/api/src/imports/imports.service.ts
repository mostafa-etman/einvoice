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
import type { ImportJobStatus, Prisma } from '@prisma/client';
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
  type FieldError,
} from './import-validate.service';
import { ImportErrorReportService } from './import-error-report.service';
import { resolveImportTerminalStatus } from './import-partial-status';
import {
  IMPORT_ALL_FIELD_KEYS,
  notesRows,
  sampleImportRows,
} from './import-schema';
import {
  buildDocumentUpsert,
  groupRowsByInternalId,
  type MappedImportRow,
} from './import-document-builder';
import { QUEUE_IMPORT, type ImportJobData } from '../queues/queue-names';
import type { ArtifactStorage } from '../storage/storage.module';
import { loadEnv } from '../config/env';
import * as XLSX from 'xlsx';

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
    const issued = new Date().toISOString();
    const rows = sampleImportRows(issued);
    const body = rows
      .map((r) =>
        r
          .map((cell) => {
            const s = String(cell ?? '');
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(','),
      )
      .join('\n');
    const notes = notesRows()
      .map((r) =>
        r
          .map((cell) => {
            const s = String(cell ?? '');
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(','),
      )
      .join('\n');
    // CSV: Import sheet content + a Notes section after a blank line comment.
    const combined = `${body}\n\n# --- Column notes (do not import below this line) ---\n${notes}\n`;
    return Buffer.from(combined, 'utf8');
  }

  templateXlsx(_documentType = 'I'): Buffer {
    const issued = new Date().toISOString();
    const importAoA = sampleImportRows(issued);
    const notesAoA = notesRows();
    const wb = XLSX.utils.book_new();
    const wsImport = XLSX.utils.aoa_to_sheet(importAoA);
    const wsNotes = XLSX.utils.aoa_to_sheet(notesAoA);
    XLSX.utils.book_append_sheet(wb, wsImport, 'Import');
    XLSX.utils.book_append_sheet(wb, wsNotes, 'Notes');
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
      contentType:
        args.contentType ||
        (format === 'csv'
          ? 'text/csv'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      body: args.buffer,
    });

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
      for (const h of text.split(',')) {
        const cleaned = h.trim().replace(/^"|"$/g, '');
        if (cleaned && !cleaned.startsWith('#')) headers.add(cleaned);
      }
    } else {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const sheetName =
        wb.SheetNames.find((n) => n.toLowerCase() === 'import') ??
        wb.SheetNames[0];
      const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
      if (sheet) {
        const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
        for (const h of rows[0] ?? []) headers.add(String(h ?? '').trim());
      }
    }
    const mapping: ColumnMapping = {};
    for (const field of IMPORT_ALL_FIELD_KEYS) {
      if (headers.has(field)) mapping[field] = field;
    }
    return mapping;
  }

  async putMapping(
    tenantId: string,
    userId: string,
    jobId: string,
    mapping: ColumnMapping,
  ) {
    const job = await this.getJob(tenantId, jobId);
    const missing = IMPORT_REQUIRED_FIELDS.filter((f) => !mapping[f]?.trim());
    if (missing.length) {
      throw new BadRequestException(
        `Required fields unmapped: ${missing.join(', ')}`,
      );
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
      throw new BadRequestException(
        `Required fields unmapped: ${missing.join(', ')}`,
      );
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

  /** Mark job FAILED so the UI does not stay stuck in VALIDATING/RUNNING. */
  async failJob(tenantId: string, jobId: string, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    this.log.error(`import job ${jobId} failed: ${message}`);
    try {
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.importJob.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
          },
        }),
      );
    } catch (updateErr) {
      this.log.error(
        `could not mark import job ${jobId} FAILED: ${String(updateErr)}`,
      );
    }
  }

  private async parseAllRows(
    job: { sourceObjectKey: string; sourceFileName: string; sourceContentType: string | null },
  ) {
    const env = loadEnv();
    const fileBuf = await this.artifacts.getByKey(job.sourceObjectKey);
    const format = detectImportFormat(
      job.sourceFileName,
      job.sourceContentType ?? undefined,
    );
    if (format === 'unsupported') throw new Error('Unsupported format');

    const rows: { rowNumber: number; cells: Record<string, string> }[] = [];
    if (format === 'csv') {
      await this.parseSvc.parseCsv(fileBuf.toString('utf8'), {
        maxRows: env.IMPORT_MAX_ROWS,
        onRow: (r) => {
          // Skip notes preamble rows if the template CSV was re-uploaded whole.
          const first = Object.values(r.cells)[0] ?? '';
          if (String(first).startsWith('#')) return;
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
    return rows;
  }

  async processValidate(tenantId: string, jobId: string) {
    const job = await this.getJob(tenantId, jobId);
    const mapping = (job.mappingJson ?? {}) as ColumnMapping;
    const rows = await this.parseAllRows(job);

    const { results, validRows, invalidRows } = this.validateSvc.validateRows(
      rows,
      mapping,
      { jobDocumentType: job.documentType },
    );

    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      await tx.importRowResult.deleteMany({
        where: { importJobId: jobId, tenantId },
      });
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

  private extractErrors(err: unknown): FieldError[] {
    if (
      err &&
      typeof err === 'object' &&
      'response' in err &&
      (err as { response?: { message?: unknown } }).response
    ) {
      const msg = (err as { response: { message?: unknown } }).response.message;
      if (msg && typeof msg === 'object' && msg !== null && 'issues' in msg) {
        const issues = (msg as { issues: Array<Record<string, unknown>> }).issues;
        return issues.map((i) => ({
          field: String(i.path ?? i.field ?? 'document'),
          code: String(i.code ?? 'VALIDATION'),
          message: String(i.message ?? i.messageKey ?? 'Validation failed'),
        }));
      }
      if (typeof msg === 'string') {
        return [{ field: 'document', code: 'ERROR', message: msg }];
      }
    }
    return [
      {
        field: 'document',
        code: 'ERROR',
        message: err instanceof Error ? err.message : String(err),
      },
    ];
  }

  async processRun(tenantId: string, jobId: string) {
    const job = await this.getJob(tenantId, jobId);
    const mapping = (job.mappingJson ?? {}) as ColumnMapping;

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

    const branches = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.branch.findMany({
        where: { tenantId },
        select: { id: true, etaBranchCode: true },
      }),
    );
    const branchByCode = new Map(
      branches
        .filter((b) => b.etaBranchCode)
        .map((b) => [b.etaBranchCode!, b.id]),
    );

    const validRowRecords = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.importRowResult.findMany({
        where: { tenantId, importJobId: jobId, status: 'VALID' },
        orderBy: { rowNumber: 'asc' },
      }),
    );
    const validByNum = new Map(validRowRecords.map((r) => [r.rowNumber, r]));

    const allRows = await this.parseAllRows(job);
    const mappedValid: MappedImportRow[] = [];
    for (const raw of allRows) {
      if (!validByNum.has(raw.rowNumber)) continue;
      const mapped = applyMapping(raw.cells, mapping);
      mappedValid.push({ rowNumber: raw.rowNumber, mapped });
    }

    const groups = groupRowsByInternalId(mappedValid);

    let createdDocs = 0;
    let failedRows = 0;
    let signEnqueued = 0;
    const actorUserId = job.createdByUserId ?? 'system';

    for (const group of groups) {
      // Resume: if any line already linked to a document, count as created.
      const already = group.rows
        .map((r) => validByNum.get(r.rowNumber))
        .find((r) => r?.documentId);
      if (already?.documentId) {
        createdDocs += 1;
        continue;
      }

      try {
        const dto = buildDocumentUpsert(group, {
          defaultBranchId: branchId,
          jobDocumentType: job.documentType,
          resolveBranchId: (code) => branchByCode.get(code) ?? null,
        });

        const created = await this.documents.create(tenantId, actorUserId, dto);

        try {
          await this.documents.markReady(tenantId, actorUserId, created.id);
        } catch (readyErr) {
          // Avoid orphan READY-blocked drafts without feedback.
          const errors = this.extractErrors(readyErr);
          await this.tenantPrisma.withTenant(tenantId, async (tx) => {
            await tx.document.delete({ where: { id: created.id } }).catch(() => undefined);
            for (const row of group.rows) {
              const rec = validByNum.get(row.rowNumber);
              if (!rec) continue;
              await tx.importRowResult.update({
                where: { id: rec.id },
                data: {
                  status: 'FAILED',
                  errorsJson: errors as unknown as Prisma.InputJsonValue,
                },
              });
            }
          });
          failedRows += group.rows.length;
          continue;
        }

        await this.tenantPrisma.withTenant(tenantId, async (tx) => {
          await tx.document.update({
            where: { id: created.id },
            data: {
              importJobId: jobId,
              importRowNumber: group.rows[0]!.rowNumber,
            },
          });
          for (const row of group.rows) {
            const rec = validByNum.get(row.rowNumber);
            if (!rec) continue;
            await tx.importRowResult.update({
              where: { id: rec.id },
              data: { status: 'CREATED', documentId: created.id },
            });
          }
        });
        createdDocs += 1;

        if (job.runMode === 'CREATE_SIGN_SUBMIT') {
          try {
            await this.signing.sendForSignature(
              tenantId,
              actorUserId,
              created.id,
            );
            await this.tenantPrisma.withTenant(tenantId, async (tx) => {
              for (const row of group.rows) {
                const rec = validByNum.get(row.rowNumber);
                if (!rec) continue;
                await tx.importRowResult.update({
                  where: { id: rec.id },
                  data: { status: 'SIGN_ENQUEUED' },
                });
              }
            });
            signEnqueued += 1;
          } catch (err) {
            this.log.warn(
              `sign enqueue failed for ${created.id}: ${String(err)}`,
            );
            const errors = this.extractErrors(err);
            await this.tenantPrisma.withTenant(tenantId, async (tx) => {
              for (const row of group.rows) {
                const rec = validByNum.get(row.rowNumber);
                if (!rec) continue;
                await tx.importRowResult.update({
                  where: { id: rec.id },
                  data: {
                    status: 'FAILED',
                    errorsJson: errors as unknown as Prisma.InputJsonValue,
                  },
                });
              }
            });
            failedRows += group.rows.length;
          }
        }
      } catch (err) {
        this.log.warn(
          `create failed invoice ${group.internalId}: ${String(err)}`,
        );
        const errors = this.extractErrors(err);
        await this.tenantPrisma.withTenant(tenantId, async (tx) => {
          for (const row of group.rows) {
            const rec = validByNum.get(row.rowNumber);
            if (!rec) continue;
            await tx.importRowResult.update({
              where: { id: rec.id },
              data: {
                status: 'FAILED',
                errorsJson: errors as unknown as Prisma.InputJsonValue,
              },
            });
          }
        });
        failedRows += group.rows.length;
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
