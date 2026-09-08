import { normalizeTaxRegistration, trialAlreadyUsedMessages } from './tax-registration';

describe('normalizeTaxRegistration', () => {
  it('strips separators and uppercases', () => {
    expect(normalizeTaxRegistration(' 123-456.789 ')).toBe('123456789');
    expect(normalizeTaxRegistration('ab-cd')).toBe('ABCD');
  });

  it('maps Eastern Arabic and Persian digits', () => {
    expect(normalizeTaxRegistration('١٢٣٤٥٦٧٨٩')).toBe('123456789');
    expect(normalizeTaxRegistration('۱۲۳۴۵۶۷۸۹')).toBe('123456789');
  });

  it('returns null for blank input', () => {
    expect(normalizeTaxRegistration('')).toBeNull();
    expect(normalizeTaxRegistration('   ')).toBeNull();
    expect(normalizeTaxRegistration(null)).toBeNull();
    expect(normalizeTaxRegistration(undefined)).toBeNull();
  });
});

describe('trialAlreadyUsedMessages', () => {
  it('includes the WhatsApp number in Arabic and the English copy', () => {
    const msgs = trialAlreadyUsedMessages('00201000864620');
    expect(msgs.messageAr).toContain('رقم التسجيل الضريبي ده استخدم الخطة المجانية قبل كده');
    expect(msgs.messageAr).toContain('00201000864620');
    expect(msgs.messageEn).toBe(
      'This tax registration number has already used a free trial — contact WhatsApp to subscribe.',
    );
  });
});
