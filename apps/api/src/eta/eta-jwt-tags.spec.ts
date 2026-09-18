import { jwtHasB2cTag, jwtPayload } from './eta-jwt-tags';

function b2cToken(tags: string) {
  const payload = Buffer.from(JSON.stringify({ TaxProfTags: tags }), 'utf8').toString(
    'base64url',
  );
  return `hdr.${payload}.sig`;
}

describe('jwtHasB2cTag', () => {
  it('detects B2C on TaxProfTags', () => {
    expect(jwtHasB2cTag(b2cToken('B2C'))).toBe(true);
    expect(jwtHasB2cTag(b2cToken('B2B B2C'))).toBe(true);
    expect(jwtHasB2cTag(b2cToken('B2B'))).toBe(false);
    expect(jwtPayload(b2cToken('B2C'))?.TaxProfTags).toBe('B2C');
  });
});
