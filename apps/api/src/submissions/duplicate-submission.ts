/**
 * Parse ETA DuplicateSubmission / identical-payload 422 responses.
 * Message example:
 * "Request payload is identical to a previous payload sent in the last 10 Min.
 *  Try to submit payload after 582 seconds."
 */

export const MAX_DUPLICATE_RETRIES = 3;
/** Fallback when ETA omits an explicit wait (full 10-minute window). */
export const DEFAULT_DUPLICATE_COOLDOWN_SECONDS = 600;

export type DuplicateSubmissionInfo = {
  isDuplicate: boolean;
  retryAfterSeconds: number;
};

export function parseDuplicateSubmission(
  httpStatus: number,
  bodyText: string | undefined,
  retryAfterHeader: string | null | undefined,
): DuplicateSubmissionInfo {
  const text = bodyText ?? '';
  const lower = text.toLowerCase();
  const isDuplicate =
    httpStatus === 422 &&
    (lower.includes('identical') ||
      lower.includes('duplicatesubmission') ||
      lower.includes('duplicate submission') ||
      lower.includes('last 10 min') ||
      /try to submit payload after\s+\d+\s+seconds/i.test(text));

  if (!isDuplicate) {
    return { isDuplicate: false, retryAfterSeconds: 0 };
  }

  let retryAfterSeconds = DEFAULT_DUPLICATE_COOLDOWN_SECONDS;

  const fromHeader = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN;
  if (Number.isFinite(fromHeader) && fromHeader > 0) {
    retryAfterSeconds = fromHeader;
  }

  const fromBody = text.match(
    /try to submit payload after\s+(\d+)\s+seconds/i,
  );
  if (fromBody?.[1]) {
    const n = Number.parseInt(fromBody[1], 10);
    if (Number.isFinite(n) && n > 0) retryAfterSeconds = n;
  }

  // Never schedule a zero/negative wait — that would re-fire immediately.
  if (retryAfterSeconds < 1) retryAfterSeconds = DEFAULT_DUPLICATE_COOLDOWN_SECONDS;

  return { isDuplicate: true, retryAfterSeconds };
}
