import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUE_BACKUP, type BackupJobData } from '../queues/queue-names';
import { BackupService } from './backup.service';

@Processor(QUEUE_BACKUP)
export class BackupProcessor extends WorkerHost {
  constructor(private readonly backups: BackupService) {
    super();
  }

  async process(job: Job<BackupJobData>): Promise<void> {
    await this.backups.processBackupJob(job.data.backupJobId, job.data.tenantId);
  }
}
