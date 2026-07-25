import { HealthService } from '../src/health/health.service';

describe('Health readiness failure', () => {
  it('reports not_ready when a required dependency fails', () => {
    const service = Object.create(HealthService.prototype) as HealthService;
    const result = service.evaluate({
      postgres: 'fail',
      redis: 'ok',
      minio: 'ok',
    });
    expect(result.status).toBe('not_ready');
    expect(result.checks.postgres).toBe('fail');
  });
});
