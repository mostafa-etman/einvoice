import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_IMPORT, type ImportJobData } from '../queues/queue-names';
import { ImportsService } from './imports.service';

@Processor(QUEUE_IMPORT)
export class ImportProcessor extends WorkerHost {
  private readonly log = new Logger(ImportProcessor.name);
  constructor(private readonly imports: ImportsService) {
    super();
  }
  async process(job: Job<ImportJobData>): Promise<void> {
    this.log.log(`import ${job.data.importJobId} ${job.data.phase}`);
    try {
      if (job.data.phase === 'validate') {
        await this.imports.processValidate(
          job.data.tenantId,
          job.data.importJobId,
        );
      } else {
        await this.imports.processRun(job.data.tenantId, job.data.importJobId);
      }
    } catch (err) {
      this.log.error(
        `import ${job.data.importJobId} ${job.data.phase} failed: ${String(err)}`,
      );
      await this.imports.failJob(
        job.data.tenantId,
        job.data.importJobId,
        err,
      );
      throw err;
    }
  }
}
