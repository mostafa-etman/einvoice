import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { loadEnv } from '../config/env';

type ArtifactStorage = {
  put: (input: {
    tenantId: string;
    kind: string;
    objectId: string;
    contentType: string;
    body: Buffer;
  }) => Promise<{ key: string; byteSize: number }>;
};

/** Minimal ZIP (store method) for CSV tables — no secrets. */
function zipStore(files: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    const crc = crc32(f.data);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    parts.push(local, f.data);

    const cen = Buffer.alloc(46 + nameBuf.length);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(f.data.length, 20);
    cen.writeUInt32LE(f.data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    nameBuf.copy(cen, 46);
    central.push(cen);
    offset += local.length + f.data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, centralBuf, end]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return ~c >>> 0;
}

@Injectable()
export class BackupExportService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    @Inject('ArtifactStorage') private readonly artifacts: ArtifactStorage,
  ) {}

  async create(input: {
    tenantId: string;
    userId: string;
    includeFiles: boolean;
  }) {
    const job = await this.tenantPrisma.withTenant(input.tenantId, (tx) =>
      tx.tenantDataExportJob.create({
        data: {
          tenantId: input.tenantId,
          status: 'QUEUED',
          includeFiles: input.includeFiles,
          createdByUserId: input.userId,
        },
      }),
    );
    // Sync in all envs for simplicity (CSV ZIP is light)
    return this.process(job.id, input.tenantId);
  }

  async process(jobId: string, tenantId: string) {
    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.tenantDataExportJob.update({
        where: { id: jobId },
        data: { status: 'RUNNING', startedAt: new Date() },
      }),
    );

    const { docsCsv, itemsCsv } = await this.tenantPrisma.withTenant(
      tenantId,
      async (tx) => {
        const docs = await tx.document.findMany({
          where: { tenantId },
          select: { id: true, internalId: true, status: true, kind: true },
        });
        const items = await tx.itemCode.findMany({
          where: { tenantId },
          select: { id: true, type: true, code: true, description: true },
        });
        const docsCsv =
          'id,internalId,status,kind\n' +
          docs
            .map((d) => `${d.id},${d.internalId},${d.status},${d.kind}`)
            .join('\n');
        const itemsCsv =
          'id,type,code,description\n' +
          items
            .map((i) => `${i.id},${i.type},${i.code},${JSON.stringify(i.description)}`)
            .join('\n');
        return { docsCsv, itemsCsv };
      },
    );

    // Never include secrets / PIN
    const zip = zipStore([
      { name: 'documents.csv', data: Buffer.from(docsCsv, 'utf8') },
      { name: 'item_codes.csv', data: Buffer.from(itemsCsv, 'utf8') },
    ]);

    const stored = await this.artifacts.put({
      tenantId,
      kind: 'tenant-exports',
      objectId: `${jobId}.zip`,
      contentType: 'application/zip',
      body: zip,
    });

    const ttl = loadEnv().BACKUP_ARTIFACT_TTL_DAYS;
    const done = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.tenantDataExportJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          objectKey: stored.key,
          byteSize: BigInt(stored.byteSize),
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + ttl * 86400_000),
        },
      }),
    );
    await this.audit.write({
      action: 'backup.export',
      outcome: 'success',
      tenantId,
      resourceType: 'TenantDataExportJob',
      resourceId: jobId,
    });
    return this.serialize(done);
  }

  async get(tenantId: string, id: string) {
    const job = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.tenantDataExportJob.findFirst({ where: { id, tenantId } }),
    );
    if (!job) throw new NotFoundException('export_not_found');
    return this.serialize(job);
  }

  async download(
    tenantId: string,
    id: string,
    userId: string,
    getByKey: (key: string) => Promise<Buffer>,
  ) {
    const job = await this.get(tenantId, id);
    if (job.status !== 'COMPLETED' || !job.objectKey) {
      throw new NotFoundException('export_not_downloadable');
    }
    const body = await getByKey(job.objectKey);
    // Guard: ensure no secret-looking columns leaked (heuristic)
    if (body.includes(Buffer.from('clientSecret')) || body.includes(Buffer.from('PIN'))) {
      throw new Error('export_contains_forbidden_material');
    }
    await this.audit.write({
      action: 'backup.export.download',
      outcome: 'success',
      actorUserId: userId,
      tenantId,
      resourceType: 'TenantDataExportJob',
      resourceId: id,
    });
    return { body };
  }

  serialize(job: {
    id: string;
    tenantId: string;
    status: string;
    includeFiles: boolean;
    objectKey?: string | null;
    byteSize: bigint | null;
    errorMessage: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }) {
    return {
      id: job.id,
      tenantId: job.tenantId,
      status: job.status,
      includeFiles: job.includeFiles,
      objectKey: job.objectKey ?? null,
      byteSize: job.byteSize != null ? Number(job.byteSize) : null,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    };
  }
}
