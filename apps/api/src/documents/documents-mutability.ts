import { BadRequestException } from '@nestjs/common';
import type { DocumentOrigin } from '@prisma/client';

/** ETA-synced historical invoices must not be edited, signed, or re-submitted. */
export function assertDocumentMutable(
  origin: DocumentOrigin | string | null | undefined,
) {
  if (origin === 'ETA_SYNC') {
    throw new BadRequestException({
      code: 'DOCUMENT_ETA_SYNC_READONLY',
      message:
        'This document was imported from ETA and is a read-only historical record',
    });
  }
}
