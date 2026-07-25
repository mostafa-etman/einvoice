import { createHealthStatus } from './index.js';

describe('@einvoice/shared', () => {
  it('exports createHealthStatus helper', () => {
    expect(createHealthStatus('ok')).toEqual({ status: 'ok' });
  });
});
