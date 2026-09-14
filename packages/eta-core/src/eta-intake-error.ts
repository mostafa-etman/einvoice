/**
 * Format ETA intake / rejectedDocuments[].error payloads for logs and UI.
 * Never include secrets — callers must pass already-redacted JSON when logging.
 */

export type EtaIntakeErrorLike = {
  code?: unknown;
  message?: unknown;
  target?: unknown;
  propertyPath?: unknown;
  details?: unknown;
};

const SECRET_KEY =
  /secret|token|password|authorization|private.?key|client.?secret|access.?key/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function part(label: string, value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || text === 'null' || text === 'undefined') return null;
  return `${label}=${text}`;
}

function formatDetail(detail: unknown, index: number): string {
  const rec = asRecord(detail);
  if (!rec) return `details[${index}]=${String(detail)}`;
  const bits = [
    part('code', rec.code),
    rec.message != null ? String(rec.message) : null,
    part('target', rec.target),
    part('propertyPath', rec.propertyPath),
  ].filter((v): v is string => Boolean(v));
  if (Array.isArray(rec.details) && rec.details.length) {
    bits.push(
      rec.details
        .map((nested, i) => formatDetail(nested, i))
        .join(' | '),
    );
  }
  return bits.length
    ? `details[${index}]: ${bits.join(' — ')}`
    : `details[${index}]=${JSON.stringify(detail)}`;
}

/**
 * Human-readable ETA validation text including every details[] entry.
 * Prefer this over the top-level "Validation Error" message alone.
 */
export function formatEtaIntakeError(error: unknown): string {
  if (error == null) return 'Refused at intake';
  if (typeof error === 'string') {
    const trimmed = error.trim();
    if (!trimmed) return 'Refused at intake';
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return formatEtaIntakeError(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  const rec = asRecord(error);
  if (!rec) return String(error);

  const bits = [
    part('code', rec.code),
    rec.message != null ? String(rec.message) : null,
    part('target', rec.target),
    part('propertyPath', rec.propertyPath),
  ].filter((v): v is string => Boolean(v));

  const details = Array.isArray(rec.details) ? rec.details : [];
  for (let i = 0; i < details.length; i += 1) {
    bits.push(formatDetail(details[i], i));
  }

  if (!bits.length) {
    try {
      return JSON.stringify(error);
    } catch {
      return 'Refused at intake';
    }
  }
  return bits.join(' — ');
}

/** Concise banner text: first detail message, else formatted error. */
export function formatEtaIntakeErrorSummary(error: unknown): string {
  const rec = asRecord(error);
  const details = Array.isArray(rec?.details) ? rec.details : [];
  for (const detail of details) {
    const msg = asRecord(detail)?.message;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  }
  if (typeof rec?.message === 'string' && rec.message.trim()) {
    const top = rec.message.trim();
    if (top.toLowerCase() !== 'validation error') return top;
  }
  return formatEtaIntakeError(error);
}

export function redactEtaLogJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactEtaLogJson);
  const rec = asRecord(value);
  if (!rec) return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(rec)) {
    out[key] = SECRET_KEY.test(key) ? '[redacted]' : redactEtaLogJson(nested);
  }
  return out;
}
