/**
 * Advisory late-submission warning for signed documents.
 *
 * ETA does not publish a single fixed calendar-day limit for standard
 * e-invoice submit in the public SDK the way receipt "Late Submission
 * Request" does. When issueDate is older than this advisory window we warn
 * locally before send — we never mutate the signed dateTimeIssued, and ETA's
 * refuse reason is always the authority of truth.
 */
export const ETA_LATE_SUBMISSION_WARN_DAYS_DEFAULT = 7;

export type LateSubmissionCheck = {
  issueDateTime: string;
  ageDays: number;
  warnDays: number;
  isLate: boolean;
};

export function checkLateSubmission(
  issueDateTime: Date | string,
  now: Date = new Date(),
  warnDays: number = ETA_LATE_SUBMISSION_WARN_DAYS_DEFAULT,
): LateSubmissionCheck {
  const issued =
    issueDateTime instanceof Date ? issueDateTime : new Date(issueDateTime);
  const ms = Math.max(0, now.getTime() - issued.getTime());
  const ageDays = ms / (24 * 60 * 60 * 1000);
  return {
    issueDateTime: issued.toISOString(),
    ageDays: Math.round(ageDays * 100) / 100,
    warnDays,
    isLate: ageDays > warnDays,
  };
}
