/**
 * Re-download official ETA SDK code JSON from /files/ (no credentials) and
 * re-seed the DB. Detects content-hash drift vs previously seeded catalogs.
 */
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { seedEtaCodeTables } from './seed-eta-codes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data', 'eta-codes');
const BASE = 'https://sdk.invoicing.eta.gov.eg/files';

const FILES = [
  'TaxTypes.json',
  'NonTaxableTaxTypes.json',
  'TaxSubtypes.json',
  'UnitTypes.json',
  'WeightUnitTypes.json',
  'CurrencyCodes.json',
  'CountryCodes.json',
  'ActivityCodes.json',
  'ReturnWithNoReferenceReasonTypes.json',
];

const prisma = new PrismaClient();

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

async function download(fileName) {
  const url = `${BASE}/${fileName}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }
  return res.text();
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const before = await prisma.etaCodeCatalog.findMany({
    select: { kind: true, contentHash: true, sourceFile: true },
  });
  const beforeByFile = new Map(
    before.map((b) => [b.sourceFile ?? b.kind, b.contentHash]),
  );

  const drift = [];
  for (const file of FILES) {
    process.stdout.write(`Refreshing ${file}… `);
    const body = await download(file);
    const out = join(DATA_DIR, file);
    const prev = existsSync(out) ? readFileSync(out, 'utf8') : null;
    const nextHash = sha256(body);
    const prevHash = prev ? sha256(prev) : null;
    writeFileSync(out, body, 'utf8');
    if (prevHash && prevHash !== nextHash) {
      drift.push({ file, from: prevHash.slice(0, 12), to: nextHash.slice(0, 12) });
      console.log(`CHANGED ${prevHash.slice(0, 12)}→${nextHash.slice(0, 12)}`);
    } else if (!prevHash) {
      console.log(`NEW ${nextHash.slice(0, 12)}`);
    } else {
      console.log('unchanged');
    }
    void beforeByFile;
  }

  console.log('\nRe-seeding database from refreshed files…');
  const catalogs = await seedEtaCodeTables();
  for (const c of catalogs) {
    console.log(`  ${c.kind.padEnd(18)} ${String(c.entryCount).padStart(4)}`);
  }

  if (drift.length) {
    console.log('\nContent drift detected vs previous local files:');
    for (const d of drift) console.log(`  ${d.file}: ${d.from} → ${d.to}`);
  } else {
    console.log('\nNo file content drift vs previous local copies.');
  }

  console.log(
    '\nNote: EGS/GS1 published item codes still require authenticated ETA APIs later.',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
