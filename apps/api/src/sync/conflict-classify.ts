/**
 * Clash classifier for offline sync (010).
 * Overlapping field paths → conflict; non-overlapping → last-write OK.
 */

const TRACKED_PATHS = [
  'internalId',
  'kind',
  'branchId',
  'currencyCode',
  'issueDateTime',
  'receiver.name',
  'receiver.id',
  'receiver.type',
  'extraDiscountAmount',
  'lines',
] as const;

function getPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function stable(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Paths present on both local and server that differ. */
export function classifyConflictingPaths(
  local: Record<string, unknown>,
  server: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const path of TRACKED_PATHS) {
    const lv = getPath(local, path);
    const sv = getPath(server, path);
    if (lv === undefined && sv === undefined) continue;
    if (stable(lv) !== stable(sv)) out.push(path);
  }
  return out;
}

/** True when client base revision is stale and overlapping edits exist. */
export function isOverlappingClash(
  baseRevision: number | undefined,
  serverRevision: number,
  local: Record<string, unknown>,
  server: Record<string, unknown>,
): { clash: boolean; paths: string[] } {
  if (baseRevision === undefined || baseRevision === serverRevision) {
    return { clash: false, paths: [] };
  }
  const paths = classifyConflictingPaths(local, server);
  return { clash: paths.length > 0, paths };
}
