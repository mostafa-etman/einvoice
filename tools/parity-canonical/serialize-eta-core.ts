import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
const inputPath = process.argv[2];
if (!inputPath) {
  console.error('usage: serialize-eta-core.ts <input.json>');
  process.exit(2);
}

const { canonicalSerialize } = await import(
  pathToFileURL(join(root, 'packages/eta-core/src/canonical-serialize.ts')).href
);
const golden = await import(
  pathToFileURL(join(root, 'packages/eta-core/src/canonical-serialize.golden.spec.ts')).href
);

const raw = readFileSync(inputPath, 'utf8');
const input = golden.parsePreservingNumberLiterals(raw);
const out = canonicalSerialize(input);
process.stdout.write(out.endsWith('\n') ? out.slice(0, -1) : out);
