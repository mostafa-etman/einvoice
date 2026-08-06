import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { BackupRestoreService } from './backup-restore.service';

/** Platform-operator restore — no tenant permission matrix; flag-gated. */
@Controller('backup/operator')
@UseGuards(JwtAuthGuard)
export class BackupOperatorController {
  constructor(private readonly restores: BackupRestoreService) {}

  @Post('restores')
  @HttpCode(202)
  restore(
    @CurrentUser() user: { userId: string },
    @Body()
    body: {
      targetTenantId: string;
      sourceObjectKey: string;
      expectedChecksumSha256: string;
      sourceTenantId: string;
      confirmation: string;
      backupJobId?: string;
    },
  ) {
    return this.restores.restoreOperatorPath({
      ...body,
      actorUserId: user.userId,
    });
  }
}
