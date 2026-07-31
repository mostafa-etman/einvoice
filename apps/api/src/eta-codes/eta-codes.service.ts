import { Injectable, NotFoundException } from '@nestjs/common';
import { EtaCodeCatalogKind, Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

const SCHEMA_DIR = join(process.cwd(), 'data', 'eta-document-schemas');

@Injectable()
export class EtaCodesService {
  constructor(private readonly prisma: PrismaService) {}

  listCatalogs() {
    return this.prisma.etaCodeCatalog.findMany({
      orderBy: { kind: 'asc' },
      select: {
        kind: true,
        sourceUrl: true,
        sourceFile: true,
        entryCount: true,
        contentHash: true,
        lastSeededAt: true,
        lastSyncedAt: true,
        syncStatus: true,
        syncNotes: true,
      },
    });
  }

  async listEntries(
    kind: EtaCodeCatalogKind,
    opts?: { parentCode?: string; q?: string; limit?: number },
  ) {
    const catalog = await this.prisma.etaCodeCatalog.findUnique({ where: { kind } });
    if (!catalog) {
      throw new NotFoundException(`Code catalog ${kind} is not seeded`);
    }
    const where: Prisma.EtaCodeEntryWhereInput = {
      catalogKind: kind,
      isActive: true,
    };
    if (opts?.parentCode) where.parentCode = opts.parentCode;
    if (opts?.q) {
      where.OR = [
        { code: { contains: opts.q, mode: 'insensitive' } },
        { nameEn: { contains: opts.q, mode: 'insensitive' } },
        { nameAr: { contains: opts.q, mode: 'insensitive' } },
      ];
    }
    const take = Math.min(Math.max(opts?.limit ?? 500, 1), 2000);
    const entries = await this.prisma.etaCodeEntry.findMany({
      where,
      orderBy: { code: 'asc' },
      take,
      select: {
        code: true,
        nameEn: true,
        nameAr: true,
        parentCode: true,
        meta: true,
      },
    });
    return {
      kind,
      sourceUrl: catalog.sourceUrl,
      entryCount: catalog.entryCount,
      syncStatus: catalog.syncStatus,
      entries,
    };
  }

  getDocumentSchema(kindFile: string) {
    const safe = kindFile.replace(/[^a-zA-Z0-9._-]/g, '');
    try {
      const raw = readFileSync(join(SCHEMA_DIR, safe), 'utf8');
      return JSON.parse(raw) as unknown;
    } catch {
      throw new NotFoundException(`Document schema ${safe} not found`);
    }
  }

  listDocumentSchemas() {
    return [
      'invoice-v1.0.json',
      'credit-note-v1.0.json',
      'debit-note-v1.0.json',
      'export-invoice-v1.0.json',
      'export-credit-note-v1.0.json',
      'export-debit-note-v1.0.json',
    ].map((file) => ({
      file,
      schema: this.getDocumentSchema(file),
    }));
  }
}
