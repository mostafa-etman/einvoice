/**
 * Resolve item / tax display names from tenant item codes and seeded ETA catalogs.
 */

import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export type LocalizedName = {
  nameEn: string | null;
  nameAr: string | null;
};

export async function loadItemNamesByCode(
  tx: Tx,
  codes: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await tx.itemCode.findMany({
    where: { code: { in: unique }, isActive: true },
    select: { code: true, description: true, type: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });
  const map = new Map<string, string>();
  for (const row of rows) {
    if (!map.has(row.code) && row.description?.trim()) {
      map.set(row.code, row.description.trim());
    }
  }
  return map;
}

export async function loadTaxCatalogNames(tx: Tx): Promise<{
  taxTypes: Map<string, LocalizedName>;
  taxSubtypes: Map<string, LocalizedName>;
}> {
  const [types, subtypes] = await Promise.all([
    tx.etaCodeEntry.findMany({
      where: { catalogKind: 'TAX_TYPE', isActive: true },
      select: { code: true, nameEn: true, nameAr: true },
    }),
    tx.etaCodeEntry.findMany({
      where: { catalogKind: 'TAX_SUBTYPE', isActive: true },
      select: { code: true, nameEn: true, nameAr: true },
    }),
  ]);
  const taxTypes = new Map<string, LocalizedName>();
  for (const t of types) {
    taxTypes.set(t.code.toUpperCase(), {
      nameEn: t.nameEn?.trim() || null,
      nameAr: t.nameAr?.trim() || null,
    });
  }
  const taxSubtypes = new Map<string, LocalizedName>();
  for (const t of subtypes) {
    taxSubtypes.set(t.code.toUpperCase(), {
      nameEn: t.nameEn?.trim() || null,
      nameAr: t.nameAr?.trim() || null,
    });
  }
  return { taxTypes, taxSubtypes };
}

export function attachTaxNames<
  T extends { taxType: string; subType?: string | null },
>(
  rows: T[],
  catalogs: {
    taxTypes: Map<string, LocalizedName>;
    taxSubtypes: Map<string, LocalizedName>;
  },
): Array<
  T & {
    taxTypeNameEn: string | null;
    taxTypeNameAr: string | null;
    subTypeNameEn: string | null;
    subTypeNameAr: string | null;
  }
> {
  return rows.map((row) => {
    const typeNames = catalogs.taxTypes.get(
      String(row.taxType ?? '').toUpperCase(),
    );
    const subNames = row.subType
      ? catalogs.taxSubtypes.get(String(row.subType).toUpperCase())
      : undefined;
    return {
      ...row,
      taxTypeNameEn: typeNames?.nameEn ?? null,
      taxTypeNameAr: typeNames?.nameAr ?? null,
      subTypeNameEn: subNames?.nameEn ?? null,
      subTypeNameAr: subNames?.nameAr ?? null,
    };
  });
}

/** Human-readable period label for a YYYY-MM-DD bucket. */
export function periodBucketLabels(
  bucket: string,
  grain: 'day' | 'month',
): {
  bucketLabelEn: string;
  bucketLabelAr: string;
} {
  const m = String(bucket).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!m) {
    return { bucketLabelEn: bucket, bucketLabelAr: bucket };
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = m[3] ? Number(m[3]) : 1;
  const d = new Date(Date.UTC(year, month - 1, grain === 'month' ? 1 : day));
  if (grain === 'month') {
    return {
      bucketLabelEn: new Intl.DateTimeFormat('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(d),
      bucketLabelAr: new Intl.DateTimeFormat('ar-EG', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(d),
    };
  }
  return {
    bucketLabelEn: new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC',
    }).format(d),
    bucketLabelAr: new Intl.DateTimeFormat('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(d),
  };
}

/** @deprecated use periodBucketLabels(bucket, 'month') */
export function monthBucketLabels(bucket: string): {
  bucketLabelEn: string;
  bucketLabelAr: string;
} {
  return periodBucketLabels(bucket, 'month');
}
