import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalSerialize } from './canonical-serialize.js';
import { parsePreservingNumberLiterals } from './canonical-serialize.golden.spec.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../..');
const VECTORS = join(ROOT, 'specs/005-document-building-serialization/golden-vectors');
const AGENT_PROJ = join(ROOT, 'tools/parity-canonical/parity-agent/ParityAgent.csproj');

function stripOneTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s.slice(0, -1) : s;
}

function agentCanonical(inputPath: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'parity-'));
  const outPath = join(dir, 'out.txt');
  try {
    const build = spawnSync('dotnet', ['build', AGENT_PROJ, '-c', 'Release', '-v', 'q'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    if (build.status !== 0) {
      throw new Error(`ParityAgent build failed: ${build.stderr || build.stdout}`);
    }
    const dll = join(
      ROOT,
      'tools/parity-canonical/parity-agent/bin/Release/net8.0/ParityAgent.dll',
    );
    const r = spawnSync('dotnet', [dll, inputPath, outPath], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      throw new Error(`ParityAgent failed: ${r.stderr || r.stdout}`);
    }
    return stripOneTrailingNewline(readFileSync(outPath, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function lockedVectorFiles(): { id: string; inputPath: string; expected: string }[] {
  return readdirSync(VECTORS)
    .filter((f) => f.startsWith('gv-') && f.endsWith('.canonical.txt') && !f.includes('PENDING'))
    .map((expectedFile) => {
      const id = expectedFile.replace(/\.canonical\.txt$/, '');
      const inputPath = join(VECTORS, `${id}.input.json`);
      const expected = stripOneTrailingNewline(
        readFileSync(join(VECTORS, expectedFile), 'utf8'),
      );
      return { id, inputPath, expected };
    });
}

describe('cross-runtime parity (constitution IV / T010a)', () => {
  const vectors = lockedVectorFiles();

  it('locked set is exactly gv-01 today', () => {
    expect(vectors.map((v) => v.id)).toEqual(['gv-01-eta-sdk-one-doc']);
  });

  it.each(vectors)(
    '$id: agent === etaCore === expected',
    ({ id, inputPath, expected }) => {
      const raw = readFileSync(inputPath, 'utf8');
      const etaCore = stripOneTrailingNewline(
        canonicalSerialize(parsePreservingNumberLiterals(raw)),
      );
      const agent = agentCanonical(inputPath);
      expect(etaCore).toBe(expected);
      expect(agent).toBe(expected);
      expect(agent).toBe(etaCore);
      void id;
    },
  );
});
