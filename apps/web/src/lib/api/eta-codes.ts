import { apiFetch } from './client';

export type EtaCodeEntry = {
  code: string;
  nameEn: string;
  nameAr: string;
  parentCode: string | null;
  meta: Record<string, unknown> | null;
};

export type EtaCodesList = {
  kind: string;
  entryCount: number;
  entries: EtaCodeEntry[];
  /** Alias of entries for callers that expect items */
  items: EtaCodeEntry[];
};

/**
 * GET /eta-codes/:kind returns `{ entries: [...] }` (not `items`).
 */
export async function listEtaCodes(
  kind: string,
  params?: { q?: string; parentCode?: string; limit?: number },
): Promise<EtaCodesList> {
  const q = new URLSearchParams();
  if (params?.q) q.set('q', params.q);
  if (params?.parentCode) q.set('parentCode', params.parentCode);
  if (params?.limit != null) q.set('limit', String(params.limit));
  const qs = q.toString();
  const res = await apiFetch<{
    kind: string;
    entryCount?: number;
    entries?: EtaCodeEntry[];
    items?: EtaCodeEntry[];
  }>(`/eta-codes/${encodeURIComponent(kind)}${qs ? `?${qs}` : ''}`, {
    tenantScoped: false,
  });
  const entries = res.entries ?? res.items ?? [];
  return {
    kind: res.kind,
    entryCount: res.entryCount ?? entries.length,
    entries,
    items: entries,
  };
}
