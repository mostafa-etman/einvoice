import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  QUEUE_EXPORT,
  QUEUE_PACKAGE_POLL,
  type ExportJobData,
  type PackagePollJobData,
} from '../queues/queue-names';
import { ExportsService } from './exports.service';

@Processor(QUEUE_EXPORT)
export class ExportProcessor extends WorkerHost {
  private readonly log = new Logger(ExportProcessor.name);
  constructor(private readonly exports: ExportsService) {
    super();
  }
  async process(job: Job<ExportJobData>): Promise<void> {
    this.log.log(`export ${job.data.exportJobId}`);
    await this.exports.processLocalExport(job.data.tenantId, job.data.exportJobId);
  }
}

@Processor(QUEUE_PACKAGE_POLL)
export class PackagePollProcessor extends WorkerHost {
  private readonly log = new Logger(PackagePollProcessor.name);
  constructor(private readonly exports: ExportsService) {
    super();
  }
  async process(job: Job<PackagePollJobData>): Promise<void> {
    this.log.log(`package-poll ${job.data.etaPackageRequestId}`);
    await this.exports.processPackagePoll(
      job.data.tenantId,
      job.data.exportJobId,
      job.data.etaPackageRequestId,
    );
  }
}
