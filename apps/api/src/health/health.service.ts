import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import * as net from 'node:net';
import { loadEnv, type ApiEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export type CheckResult = 'ok' | 'fail' | 'skipped';

@Injectable()
export class HealthService {
  private readonly env: ApiEnv;

  constructor(private readonly prisma: PrismaService) {
    this.env = loadEnv();
  }

  live() {
    return { status: 'ok' as const };
  }

  async ready(): Promise<{
    status: 'ready' | 'not_ready';
    checks: Record<string, CheckResult>;
  }> {
    const checks: Record<string, CheckResult> = {
      postgres: (await this.prisma.ping()) ? 'ok' : 'fail',
      redis: await this.checkRedis(),
      minio: await this.checkMinio(),
    };

    const failed = Object.values(checks).some((v) => v === 'fail');
    return {
      status: failed ? 'not_ready' : 'ready',
      checks,
    };
  }

  /** Test helper: evaluate readiness from injected check map */
  evaluate(checks: Record<string, CheckResult>) {
    const failed = Object.values(checks).some((v) => v === 'fail');
    return {
      status: (failed ? 'not_ready' : 'ready') as 'ready' | 'not_ready',
      checks,
    };
  }

  private async checkRedis(): Promise<CheckResult> {
    const redis = new Redis(this.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
    });
    try {
      await redis.connect();
      const pong = await redis.ping();
      return pong === 'PONG' ? 'ok' : 'fail';
    } catch {
      return 'fail';
    } finally {
      redis.disconnect();
    }
  }

  private async checkMinio(): Promise<CheckResult> {
    return new Promise((resolve) => {
      const socket = net.connect(
        {
          host: this.env.MINIO_ENDPOINT,
          port: this.env.MINIO_PORT,
        },
        () => {
          socket.end();
          resolve('ok');
        },
      );
      socket.setTimeout(1500);
      socket.on('error', () => resolve('fail'));
      socket.on('timeout', () => {
        socket.destroy();
        resolve('fail');
      });
    });
  }
}
