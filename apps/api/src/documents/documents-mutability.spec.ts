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
  it('allows DRAFT and READY', () => {
    expect(isDocumentEditableStatus('DRAFT')).toBe(true);
    expect(isDocumentEditableStatus('READY')).toBe(true);
    expect(() => assertDocumentEditable('DRAFT')).not.toThrow();
    expect(() => assertDocumentEditable('READY')).not.toThrow();
    expect(() => assertDocumentCanMutate('LOCAL', 'DRAFT')).not.toThrow();
    expect(() => assertDocumentCanMutate('FILE_IMPORT', 'READY')).not.toThrow();
  });

  it('rejects VALID and other final / post-sign statuses', () => {
    for (const status of [
      'VALID',
      'SUBMITTED',
      'CANCELLED',
      'REJECTED',
      'INVALID',
      'SIGNED',
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
  });
});
