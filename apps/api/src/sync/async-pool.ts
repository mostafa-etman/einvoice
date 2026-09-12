/**
 * Bounded worker pool — never unbounded Promise.all over large ETA sets.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

/** Details fan-out against ETA. Clamped so we cannot stampede the host or DB pool. */
export function etaSyncDetailsConcurrency(): number {
  const raw = process.env.ETA_SYNC_DETAILS_CONCURRENCY;
  const n = raw != null && raw !== '' ? Number(raw) : 6;
  if (!Number.isFinite(n)) return 6;
  return Math.min(10, Math.max(1, Math.floor(n)));
}
