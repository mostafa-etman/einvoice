import {
  DEFAULT_DUPLICATE_COOLDOWN_SECONDS,
  parseDuplicateSubmission,
} from './duplicate-submission';

describe('parseDuplicateSubmission', () => {
  it('detects identical-payload 422 and extracts wait seconds', () => {
    const info = parseDuplicateSubmission(
      422,
      'Request payload is identical to a previous payload sent in the last 10 Min. Try to submit payload after 582 seconds.',
      null,
    );
    expect(info.isDuplicate).toBe(true);
    expect(info.retryAfterSeconds).toBe(582);
  });

  it('prefers Retry-After header when body has no seconds', () => {
    const info = parseDuplicateSubmission(
      422,
      'DuplicateSubmission: identical payload',
      '315',
    );
    expect(info.isDuplicate).toBe(true);
    expect(info.retryAfterSeconds).toBe(315);
  });

  it('does not treat other 422s as duplicates', () => {
    const info = parseDuplicateSubmission(422, 'Some other validation', null);
    expect(info.isDuplicate).toBe(false);
  });

  it('falls back to default cooldown when duplicate but no seconds', () => {
    const info = parseDuplicateSubmission(
      422,
      'identical payload in the last 10 Min',
      null,
    );
    expect(info.isDuplicate).toBe(true);
    expect(info.retryAfterSeconds).toBe(DEFAULT_DUPLICATE_COOLDOWN_SECONDS);
  });
});
