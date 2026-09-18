import { BadRequestException } from '@nestjs/common';

export const POS_SERIAL_SCOPES = ['PER_BRANCH', 'COMPANY'] as const;
export type PosSerialScope = (typeof POS_SERIAL_SCOPES)[number];

/** Safer default: isolate previousUUID per branch POS so chains cannot cross branches. */
export const DEFAULT_POS_SERIAL_SCOPE: PosSerialScope = 'PER_BRANCH';

export function parsePosSerialScope(
  value: string | null | undefined,
): PosSerialScope {
  const raw = (value ?? '').trim().toUpperCase();
  if (!raw || raw === 'PER_BRANCH' || raw === 'BRANCH') return 'PER_BRANCH';
  if (raw === 'COMPANY' || raw === 'COMPANY_WIDE' || raw === 'SINGLE') {
    return 'COMPANY';
  }
  throw new BadRequestException({
    code: 'INVALID_POS_SERIAL_SCOPE',
    message:
      'POS serial scope must be PER_BRANCH (each branch has its own POS chain) or COMPANY (one shared POS serial).',
  });
}

export function isCompanyPosScope(value: string | null | undefined): boolean {
  return parsePosSerialScope(value) === 'COMPANY';
}
