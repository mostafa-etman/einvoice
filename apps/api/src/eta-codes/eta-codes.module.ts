import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EtaCodesController } from './eta-codes.controller';
import { EtaCodesService } from './eta-codes.service';
import { EtaCodesSyncService } from './eta-codes-sync.service';

@Module({
  imports: [PrismaModule],
  controllers: [EtaCodesController],
  providers: [EtaCodesService, EtaCodesSyncService],
  exports: [EtaCodesService, EtaCodesSyncService],
})
export class EtaCodesModule {}
