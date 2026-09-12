/**
 * Local export date bounds. Date-only values (and the UTC-midnight ISO the
 * date &lt;input&gt; used to emit) are interpreted as Africa/Cairo calendar days
 * so Egypt-issued documents are not dropped from the selected range.
 */

import {
  cairoDayEnd,
  cairoDayStart,
  parseCairoBoundedInstant,
} from '../time/cairo-day';

export { cairoDayEnd, cairoDayStart };

export type LocalExportIssueRange = {
  gte?: Date;
  lte?: Date;
};

export function parseLocalExportInstant(
  value: string | undefined,
  role: 'from' | 'to',
): Date | undefined {
  return parseCairoBoundedInstant(value, role);
}

export function localExportIssueRange(
  from?: string,
  to?: string,
): LocalExportIssueRange | undefined {
  const gte = parseLocalExportInstant(from, 'from');
  const lte = parseLocalExportInstant(to, 'to');
  if (!gte && !lte) return undefined;
  return {
    ...(gte ? { gte } : {}),
    ...(lte ? { lte } : {}),
  };
}
