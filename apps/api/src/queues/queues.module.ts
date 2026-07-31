import { Module, Logger, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { loadEnv } from '../config/env';
import {
  QUEUE_IMPORT,
  QUEUE_EXPORT,
  QUEUE_PACKAGE_POLL,
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
    ),
  ],
  exports: [BullModule],
})
export class QueuesModule implements OnModuleInit {
  private readonly log = new Logger(QueuesModule.name);
  onModuleInit() {
    this.log.log('BullMQ queues registered: import, export, package-poll');
  }
}

export { QUEUE_IMPORT, QUEUE_EXPORT, QUEUE_PACKAGE_POLL };
