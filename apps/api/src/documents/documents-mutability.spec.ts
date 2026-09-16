import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  DOCUMENT_NOT_EDITABLE_CODE,
  DOCUMENT_NOT_EDITABLE_MESSAGE,
  assertDocumentCanMutate,
  assertDocumentEditable,
  assertDocumentMutable,
  isDocumentEditableStatus,
} from './documents-mutability';

describe('document mutability guard', () => {
  it('allows DRAFT, READY, SIGNED, REJECTED, and INVALID', () => {
    for (const status of ['DRAFT', 'READY', 'SIGNED', 'REJECTED', 'INVALID']) {
      expect(isDocumentEditableStatus(status)).toBe(true);
      expect(() => assertDocumentEditable(status)).not.toThrow();
      expect(() => assertDocumentCanMutate('LOCAL', status)).not.toThrow();
    }
    expect(() => assertDocumentCanMutate('FILE_IMPORT', 'READY')).not.toThrow();
  });

  it('rejects VALID, SUBMITTED, CANCELLED, and PENDING_SIGNATURE', () => {
    for (const status of [
      'VALID',
      'SUBMITTED',
      'CANCELLED',
      'PENDING_SIGNATURE',
    ]) {
      expect(isDocumentEditableStatus(status)).toBe(false);
      expect(() => assertDocumentEditable(status)).toThrow(ForbiddenException);
    }
  });

  it('uses the bilingual not-editable message', () => {
    expect.assertions(3);
    try {
      assertDocumentEditable('VALID');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      const body = (e as ForbiddenException).getResponse() as {
        code: string;
        message: string;
      };
      expect(body.code).toBe(DOCUMENT_NOT_EDITABLE_CODE);
      expect(body.message).toBe(DOCUMENT_NOT_EDITABLE_MESSAGE);
    }
  });

  it('keeps ETA_SYNC historical records read-only even when DRAFT', () => {
    expect(() => assertDocumentMutable('ETA_SYNC')).toThrow(BadRequestException);
    expect(() => assertDocumentCanMutate('ETA_SYNC', 'DRAFT')).toThrow(
      BadRequestException,
    );
    expect(() => assertDocumentCanMutate('ETA_SYNC', 'VALID')).toThrow(
      BadRequestException,
    );
    expect(() => assertDocumentCanMutate('ETA_SYNC', 'SIGNED')).toThrow(
      BadRequestException,
    );
  });
});
