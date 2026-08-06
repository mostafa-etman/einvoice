import {
  checkLateSubmission,
  ETA_LATE_SUBMISSION_WARN_DAYS_DEFAULT,
} from './late-submission.js';

describe('checkLateSubmission', () => {
  it('flags documents older than the advisory window without mutating dates', () => {
    const now = new Date('2026-08-01T12:00:00Z');
    const recent = checkLateSubmission('2026-07-28T12:00:00Z', now, 7);
    expect(recent.isLate).toBe(false);
    expect(recent.warnDays).toBe(7);

    const late = checkLateSubmission('2026-07-01T12:00:00Z', now, 7);
    expect(late.isLate).toBe(true);
    expect(late.ageDays).toBeGreaterThan(ETA_LATE_SUBMISSION_WARN_DAYS_DEFAULT);
    expect(late.issueDateTime).toBe('2026-07-01T12:00:00.000Z');
  });
});
