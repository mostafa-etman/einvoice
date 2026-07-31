/**
 * Load official ETA SDK code tables from apps/api/data/eta-codes into Postgres.
 * Idempotent upsert. Also expands the global currencies table from CurrencyCodes.json.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data', 'eta-codes');
const SDK_FILES_BASE = 'https://sdk.invoicing.eta.gov.eg/files';

const prisma = new PrismaClient();

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function readJson(fileName) {
  const raw = readFileSync(join(DATA_DIR, fileName), 'utf8');
  return { raw, data: JSON.parse(raw) };
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).length > 0) return String(obj[k]);
  }
  return '';
}

async function upsertCatalog(kind, sourceUrl, sourceFile, raw, entries) {
  const contentHash = sha256(raw);
  const catalog = await prisma.etaCodeCatalog.upsert({
    where: { kind },
    create: {
      kind,
      sourceUrl,
      sourceFile,
      contentHash,
      entryCount: entries.length,
      lastSeededAt: new Date(),
      syncStatus: 'seeded',
    },
    update: {
      sourceUrl,
      sourceFile,
      contentHash,
      entryCount: entries.length,
      lastSeededAt: new Date(),
      syncStatus: 'seeded',
      syncNotes: null,
    },
  });

  // Replace entries for this catalog atomically-ish: delete missing, upsert present.
  const codes = new Set(entries.map((e) => e.code));
  const existing = await prisma.etaCodeEntry.findMany({
    where: { catalogKind: kind },
    select: { code: true },
  });
  const toDelete = existing.filter((e) => !codes.has(e.code)).map((e) => e.code);
  if (toDelete.length) {
    await prisma.etaCodeEntry.deleteMany({
      where: { catalogKind: kind, code: { in: toDelete } },
    });
  }

  for (const entry of entries) {
    await prisma.etaCodeEntry.upsert({
      where: { catalogKind_code: { catalogKind: kind, code: entry.code } },
      create: {
        catalogKind: kind,
        code: entry.code,
        nameEn: entry.nameEn,
        nameAr: entry.nameAr ?? null,
        parentCode: entry.parentCode ?? null,
        meta: entry.meta ?? undefined,
        isActive: entry.isActive ?? true,
      },
      update: {
        nameEn: entry.nameEn,
        nameAr: entry.nameAr ?? null,
        parentCode: entry.parentCode ?? null,
        meta: entry.meta ?? undefined,
        isActive: entry.isActive ?? true,
      },
    });
  }

  return catalog;
}

function mapSimpleRows(rows, { taxable } = {}) {
  return rows.map((row) => ({
    code: pick(row, ['Code', 'code']),
    nameEn: pick(row, ['Desc_en', 'desc_en', 'Desc_En']),
    nameAr: pick(row, ['Desc_ar', 'desc_ar', 'Desc_Ar']) || null,
    parentCode: pick(row, ['TaxtypeReference', 'taxTypeReference', 'parentCode']) || null,
    meta: taxable === undefined ? undefined : { taxable },
  })).filter((e) => e.code);
}

export async function seedEtaCodeTables(client = prisma) {
  // Allow injecting prisma from other scripts; rebind helpers that use prisma.
  // (This function uses the module-level prisma below via upsertCatalog.)
  void client;

  const taxTypes = readJson('TaxTypes.json');
  const nonTax = readJson('NonTaxableTaxTypes.json');
  const taxCombined = {
    raw: taxTypes.raw + '\n' + nonTax.raw,
    entries: [
      ...mapSimpleRows(taxTypes.data, { taxable: true }),
      ...mapSimpleRows(nonTax.data, { taxable: false }),
    ],
  };
  await upsertCatalog(
    'TAX_TYPE',
    'https://sdk.invoicing.eta.gov.eg/codes/tax-types/',
    'TaxTypes.json+NonTaxableTaxTypes.json',
    taxCombined.raw,
    taxCombined.entries,
  );

  const subtypes = readJson('TaxSubtypes.json');
  await upsertCatalog(
    'TAX_SUBTYPE',
    'https://sdk.invoicing.eta.gov.eg/codes/tax-types/',
    'TaxSubtypes.json',
    subtypes.raw,
    mapSimpleRows(subtypes.data),
  );

  const units = readJson('UnitTypes.json');
  await upsertCatalog(
    'UNIT_TYPE',
    'https://sdk.invoicing.eta.gov.eg/codes/unit-types/',
    'UnitTypes.json',
    units.raw,
    mapSimpleRows(units.data),
  );

  const weight = readJson('WeightUnitTypes.json');
  await upsertCatalog(
    'WEIGHT_UNIT_TYPE',
    `${SDK_FILES_BASE}/WeightUnitTypes.json`,
    'WeightUnitTypes.json',
    weight.raw,
    mapSimpleRows(weight.data),
  );

  const currencies = readJson('CurrencyCodes.json');
  await upsertCatalog(
    'CURRENCY',
    `${SDK_FILES_BASE}/CurrencyCodes.json`,
    'CurrencyCodes.json',
    currencies.raw,
    mapSimpleRows(currencies.data),
  );
  // Keep legacy Currency table in sync for tenant currency enablement.
  for (const row of currencies.data) {
    const code = pick(row, ['code', 'Code']);
    if (!code) continue;
    const nameEn = pick(row, ['Desc_en', 'desc_en']) || code;
    const nameAr = pick(row, ['Desc_ar', 'desc_ar']) || nameEn;
    await prisma.currency.upsert({
      where: { code },
      create: { code, nameEn, nameAr, decimals: 2, isActive: true },
      update: { nameEn, nameAr, isActive: true },
    });
  }

  const countries = readJson('CountryCodes.json');
  await upsertCatalog(
    'COUNTRY',
    `${SDK_FILES_BASE}/CountryCodes.json`,
    'CountryCodes.json',
    countries.raw,
    mapSimpleRows(countries.data),
  );

  const activities = readJson('ActivityCodes.json');
  await upsertCatalog(
    'ACTIVITY_CODE',
    `${SDK_FILES_BASE}/ActivityCodes.json`,
    'ActivityCodes.json',
    activities.raw,
    mapSimpleRows(activities.data),
  );

  const returns = readJson('ReturnWithNoReferenceReasonTypes.json');
  await upsertCatalog(
    'RETURN_REASON',
    `${SDK_FILES_BASE}/ReturnWithNoReferenceReasonTypes.json`,
    'ReturnWithNoReferenceReasonTypes.json',
    returns.raw,
    mapSimpleRows(returns.data),
  );

  const enums = readJson('static-enums.json');
  await upsertCatalog(
    'RECEIVER_TYPE',
    'https://sdk.invoicing.eta.gov.eg/documents/invoice-v1-0/',
    'static-enums.json#receiverTypes',
    JSON.stringify(enums.data.receiverTypes),
    enums.data.receiverTypes.map((r) => ({
      code: r.code,
      nameEn: r.nameEn,
      nameAr: r.nameAr,
    })),
  );
  await upsertCatalog(
    'ITEM_CODE_TYPE',
    'https://sdk.invoicing.eta.gov.eg/documents/invoice-v1-0/',
    'static-enums.json#itemCodeTypes',
    JSON.stringify(enums.data.itemCodeTypes),
    enums.data.itemCodeTypes.map((r) => ({
      code: r.code,
      nameEn: r.nameEn,
      nameAr: r.nameAr,
    })),
  );
  await upsertCatalog(
    'DOCUMENT_TYPE',
    'https://sdk.invoicing.eta.gov.eg/types/',
    'static-enums.json#documentTypes',
    JSON.stringify(enums.data.documentTypes),
    enums.data.documentTypes.map((r) => ({
      code: r.code,
      nameEn: r.nameEn,
      nameAr: null,
      meta: { kind: r.kind, version: r.version },
    })),
  );

  const counts = await prisma.etaCodeCatalog.findMany({
    select: { kind: true, entryCount: true, contentHash: true },
    orderBy: { kind: 'asc' },
  });
  return counts;
}

async function main() {
  const counts = await seedEtaCodeTables();
  console.log('ETA code tables seeded:');
  for (const c of counts) {
    console.log(`  ${c.kind.padEnd(18)} ${String(c.entryCount).padStart(4)}  hash=${c.contentHash.slice(0, 12)}…`);
  }
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('/seed-eta-codes.mjs');
if (invokedDirectly) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
