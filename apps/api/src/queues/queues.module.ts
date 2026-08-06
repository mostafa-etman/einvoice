import { Module, Logger, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { loadEnv } from '../config/env';
import {
  QUEUE_IMPORT,
  QUEUE_EXPORT,
  QUEUE_PACKAGE_POLL,
  QUEUE_USAGE_ROLLUP,
  QUEUE_USAGE_EXPORT,
  QUEUE_BACKUP,
  QUEUE_RESTORE,
  QUEUE_TENANT_EXPORT,
  QUEUE_BACKUP_SCHEDULE,
  QUEUE_EMAIL_SEND,
  QUEUE_BILLING_PAST_DUE,
} from './queue-names';

function redisConnection() {
  const env = loadEnv();
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    maxRetriesPerRequest: null as null,
  };
}

@Module({
  imports: [
    BullModule.forRoot({ connection: redisConnection() }),
    BullModule.registerQueue(
      { name: QUEUE_IMPORT },
      { name: QUEUE_EXPORT },
      { name: QUEUE_PACKAGE_POLL },
      { name: QUEUE_USAGE_ROLLUP },
      { name: QUEUE_USAGE_EXPORT },
      { name: QUEUE_BACKUP },
      { name: QUEUE_RESTORE },
      { name: QUEUE_TENANT_EXPORT },
      { name: QUEUE_BACKUP_SCHEDULE },
      { name: QUEUE_EMAIL_SEND },
      { name: QUEUE_BILLING_PAST_DUE },
    ),
  ],
  exports: [BullModule],
})
export class QueuesModule implements OnModuleInit {
  private readonly log = new Logger(QueuesModule.name);
  onModuleInit() {
    this.log.log(
      'BullMQ queues registered: import, export, package-poll, usage-rollup, usage-export, backup, restore, tenant-export, backup-schedule, email-send, billing-past-due',
    );
  }
}

export {
  QUEUE_IMPORT,
  QUEUE_EXPORT,
  QUEUE_PACKAGE_POLL,
  QUEUE_USAGE_ROLLUP,
  QUEUE_USAGE_EXPORT,
};
