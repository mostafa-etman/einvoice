const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const { join, dirname } = require('node:path');

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('usage: parity-eta-core.mjs <input.json>');
    process.exit(2);
  }
  const root = join(__dirname, '../..');
  // Load via dynamic import of compiled or source through ts-node alternative:
  // Use the golden helper from package by spawning jest is heavy — import dist if built.
  let canonicalSerialize;
  let parsePreservingNumberLiterals;
  try {
    const mod = await import(
      pathToFileURL(join(root, 'packages/eta-core/dist/canonical-serialize.js')).href
    );
    canonicalSerialize = mod.canonicalSerialize;
    // Fallback parse: JSON.parse won't preserve numbers — use golden helper from dist tests not exported.
    // Inline minimal: for gv-01 we need number preservation. Import from source via jiti if available.
  } catch {
    /* continue */
  }

  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(join(root, 'packages/eta-core/package.json'));
    // Prefer running through pnpm exec tsx
  } catch {
    /* ignore */
  }

  // Reliable path: use child process with pnpm exec tsx
  const { spawnSync } = await import('node:child_process');
  const helper = join(__dirname, 'serialize-eta-core.ts');
  const r = spawnSync(
    'pnpm',
    ['exec', 'tsx', helper, inputPath],
    { cwd: root, encoding: 'utf8', shell: true },
  );
  if (r.status !== 0) {
    // fallback: node --import tsx
    const r2 = spawnSync(
      'pnpm',
      ['--filter', '@einvoice/eta-core', 'exec', 'tsx', helper, inputPath],
      { cwd: root, encoding: 'utf8', shell: true },
    );
    if (r2.status !== 0) {
      console.error(r.stderr || r.stdout || r2.stderr || r2.stdout);
      process.exit(1);
    }
    process.stdout.write(r2.stdout);
    return;
  }
  process.stdout.write(r.stdout);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
