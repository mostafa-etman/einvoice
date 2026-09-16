import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { DocumentOrigin } from '@prisma/client';

/**
 * Content edits, mark-ready, and re-sign are allowed until ETA has accepted
 * the document or a submit is in flight. CANCELLED is terminal.
 */
const EDITABLE_STATUSES = new Set([
  'DRAFT',
  'READY',
  'SIGNED',
  'REJECTED',
  'INVALID',
]);

export const DOCUMENT_NOT_EDITABLE_CODE = 'DOCUMENT_NOT_EDITABLE';

export const DOCUMENT_NOT_EDITABLE_MESSAGE =
  'لا يمكن تعديل فاتورة معتمدة أو قيد الإرسال / A valid or in-flight (submitted) document cannot be edited';

export function isDocumentEditableStatus(
  status: string | null | undefined,
): boolean {
  return EDITABLE_STATUSES.has(String(status ?? ''));
}

export function documentNotEditableException(): ForbiddenException {
  return new ForbiddenException({
    code: DOCUMENT_NOT_EDITABLE_CODE,
    message: DOCUMENT_NOT_EDITABLE_MESSAGE,
  });
}

/**
 * Reject content mutations on VALID / SUBMITTED / CANCELLED (and any other
 * non-editable status such as PENDING_SIGNATURE). Call from every document
 * mutation path (update, delete, lines/taxes/totals, mark-ready).
 */
export function assertDocumentEditable(status: string | null | undefined) {
  if (!isDocumentEditableStatus(status)) {
    throw documentNotEditableException();
  }
}

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

/**
 * Single guard for document content mutations: historical ETA imports and
 * locked statuses are both rejected.
 */
export function assertDocumentCanMutate(
  origin: DocumentOrigin | string | null | undefined,
  status: string | null | undefined,
) {
  assertDocumentMutable(origin);
  assertDocumentEditable(status);
}
