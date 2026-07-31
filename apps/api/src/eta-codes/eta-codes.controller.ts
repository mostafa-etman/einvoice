import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { EtaCodeCatalogKind } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EtaCodesService } from './eta-codes.service';
import { EtaCodesSyncService } from './eta-codes-sync.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class EtaCodesController {
  constructor(
    private readonly codes: EtaCodesService,
    private readonly sync: EtaCodesSyncService,
  ) {}

  @Get('eta-codes')
  listCatalogs() {
    return this.codes.listCatalogs();
  }

  @Get('eta-codes/sync-status')
  syncStatus() {
    return this.sync.catalogSyncStatus();
  }

  @Get('eta-codes/:kind')
  listEntries(
    @Param('kind') kind: string,
    @Query('parentCode') parentCode?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    const catalogKind = kind.toUpperCase() as EtaCodeCatalogKind;
    return this.codes.listEntries(catalogKind, {
      parentCode,
      q,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('document-schemas')
  listSchemas() {
    return this.codes.listDocumentSchemas();
  }

  @Get('document-schemas/:file')
  getSchema(@Param('file') file: string) {
    return this.codes.getDocumentSchema(file);
  }
}
