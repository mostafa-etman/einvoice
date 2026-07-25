import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalSerialize, type JsonObject, type JsonValue } from './canonical-serialize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS = join(
  __dirname,
  '../../../specs/005-document-building-serialization/golden-vectors',
);

function stripOneTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s.slice(0, -1) : s;
}

/**
 * Parse JSON preserving number literal text as strings (tagged then untagged).
 * Required for gv-01 where official JSON uses literals like 0.00.
 */
export function parsePreservingNumberLiterals(text: string): JsonObject {
  const out: string[] = [];
  let i = 0;
  let inStr = false;
  let esc = false;
  while (i < text.length) {
    const ch = text[i]!;
    if (inStr) {
      out.push(ch);
      if (esc) {
        esc = false;
      } else if (ch === '\\') {
        esc = true;
      } else if (ch === '"') {
        inStr = false;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out.push(ch);
      i += 1;
      continue;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let j = i + 1;
      while (j < text.length && /[0-9.eE+-]/.test(text[j]!)) {
        j += 1;
      }
      const lit = text.slice(i, j);
      out.push(JSON.stringify(`__num__:${lit}`));
      i = j;
      continue;
    }
    out.push(ch);
    i += 1;
  }
  const parsed = JSON.parse(out.join('')) as JsonValue;
  return untags(parsed) as JsonObject;
}

function untags(v: JsonValue): JsonValue {
  if (typeof v === 'string' && v.startsWith('__num__:')) {
    return v.slice('__num__:'.length);
  }
  if (Array.isArray(v)) {
    return v.map(untags);
  }
  if (v !== null && typeof v === 'object') {
    const o: JsonObject = {};
    for (const [k, val] of Object.entries(v)) {
      o[k] = untags(val);
    }
    return o;
  }
  return v;
}

function loadLockedVectors(): { id: string; input: JsonObject; expected: string }[] {
  const files = readdirSync(VECTORS).filter(
    (f) => f.startsWith('gv-') && f.endsWith('.canonical.txt') && !f.includes('PENDING'),
  );
  return files.map((expectedFile) => {
    const id = expectedFile.replace(/\.canonical\.txt$/, '');
    const inputPath = join(VECTORS, `${id}.input.json`);
    const expectedPath = join(VECTORS, expectedFile);
    const rawInput = readFileSync(inputPath, 'utf8');
    const expected = stripOneTrailingNewline(readFileSync(expectedPath, 'utf8'));
    const input = parsePreservingNumberLiterals(rawInput);
    return { id, input, expected };
  });
}

describe('canonicalSerialize golden (locked)', () => {
  const vectors = loadLockedVectors();

  it('discovers at least gv-01', () => {
    expect(vectors.some((v) => v.id.includes('gv-01'))).toBe(true);
  });

  it.each(vectors)('$id matches byte-exact', ({ input, expected }) => {
    const actual = stripOneTrailingNewline(canonicalSerialize(input));
    expect(actual).toBe(expected);
  });

  it('PENDING fixtures are not asserted as locked', () => {
    const pending = readdirSync(VECTORS).filter((f) => f.endsWith('.canonical.PENDING.txt'));
    expect(pending.length).toBeGreaterThan(0);
  });
});

describe('canonicalSerialize golden regression', () => {
  it('detects reformatting 0.00 → 0 as divergence from locked expected', () => {
    const gv01 = loadLockedVectors().find((v) => v.id.includes('gv-01'));
    expect(gv01).toBeDefined();
    const broken = gv01!.expected.replaceAll('"0.00"', '"0"');
    expect(broken).not.toBe(gv01!.expected);
    expect(canonicalSerialize(gv01!.input)).toBe(gv01!.expected);
  });
});
