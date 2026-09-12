/** Egypt observes permanent UTC+2 (no DST), matching report/export filters. */
export function cairoExportRangeIso(dateYmd: string, endOfDay: boolean): string {
  return endOfDay
    ? `${dateYmd}T23:59:59.999+02:00`
    : `${dateYmd}T00:00:00.000+02:00`;
}
