/**
 * Reuses the reports "Valid ETA" convention — local status VALID, or an
 * ETA_SYNC row whose stored portal status is Valid. Does not invent mappings.
 */
import type { DocumentStatus, Prisma } from '@prisma/client';

const VALID_ETA = { equals: 'Valid', mode: 'insensitive' } as const;

const NON_VALID_LOCAL: DocumentStatus[] = [
  'INVALID',
  'REJECTED',
  'CANCELLED',
];

export function wantsValidEtaExport(
  statuses?: string[] | null,
): boolean {
  if (!Array.isArray(statuses) || statuses.length !== 1) return false;
  return String(statuses[0]).trim().toUpperCase() === 'VALID';
}

export function issuedStatusWhere(
  statuses?: string[] | null,
): Prisma.DocumentWhereInput | undefined {
  if (!Array.isArray(statuses) || !statuses.length) return undefined;
  if (wantsValidEtaExport(statuses)) {
    return {
      AND: [
        {
          OR: [
            { status: 'VALID' },
            {
              origin: 'ETA_SYNC',
              etaStatus: VALID_ETA,
            },
          ],
        },
        { status: { notIn: NON_VALID_LOCAL } },
      ],
    };
  }
  return { status: { in: statuses as DocumentStatus[] } };
}

export function receivedStatusWhere(
  statuses?: string[] | null,
): Prisma.ReceivedDocumentWhereInput | undefined {
  if (!wantsValidEtaExport(statuses)) return undefined;
  return {
    AND: [
      { etaStatus: VALID_ETA },
      { buyerDecision: { not: 'REJECTED' } },
    ],
  };
}
