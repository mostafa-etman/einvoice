import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_POS_SERIAL_SCOPE,
  parsePosSerialScope,
} from './pos-serial-scope';

describe('parsePosSerialScope', () => {
  it('defaults blank to the safer per-branch chain', () => {
    expect(parsePosSerialScope(undefined)).toBe(DEFAULT_POS_SERIAL_SCOPE);
    expect(parsePosSerialScope('')).toBe('PER_BRANCH');
    expect(parsePosSerialScope('per_branch')).toBe('PER_BRANCH');
  });

  it('accepts company-wide aliases', () => {
    expect(parsePosSerialScope('COMPANY')).toBe('COMPANY');
    expect(parsePosSerialScope('company_wide')).toBe('COMPANY');
  });

  it('rejects unknown values', () => {
    expect(() => parsePosSerialScope('MIXED')).toThrow(BadRequestException);
  });
});
