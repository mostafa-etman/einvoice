export type EtaHttpFetch = typeof fetch;

const BACKOFF_MS = [200, 800, 2000];

export async function etaFetch(
  input: string,
  init: RequestInit,
  fetchImpl: EtaHttpFetch = fetch,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      const res = await fetchImpl(input, init);
      if (res.status >= 500 && attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]!);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt >= BACKOFF_MS.length) break;
      await sleep(BACKOFF_MS[attempt]!);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('ETA request failed after retries');
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
