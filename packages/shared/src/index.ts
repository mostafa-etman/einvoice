export type HealthStatus = 'ok' | 'ready' | 'not_ready';

export function createHealthStatus(status: HealthStatus): { status: HealthStatus } {
  return { status };
}

export * from './permissions.js';
