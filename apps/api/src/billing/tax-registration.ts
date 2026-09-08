/** Map Eastern / Persian digits and strip separators so the same TIN always matches. */
const EASTERN_ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export const TRIAL_ALREADY_USED_CODE = 'TRIAL_ALREADY_USED' as const;

export function normalizeTaxRegistration(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const mapped = [...raw.trim()]
    .map((ch) => {
      const eastern = EASTERN_ARABIC_DIGITS.indexOf(ch);
      if (eastern >= 0) return String(eastern);
      const persian = PERSIAN_DIGITS.indexOf(ch);
      if (persian >= 0) return String(persian);
      return ch;
    })
    .join('');
  const normalized = mapped.replace(/[\s\-_.]/g, '').toUpperCase();
  return normalized.length ? normalized : null;
}

export function trialAlreadyUsedMessages(whatsappDisplay: string): {
  messageAr: string;
  messageEn: string;
} {
  const display = whatsappDisplay.trim() || '00201000864620';
  return {
    messageAr: `رقم التسجيل الضريبي ده استخدم الخطة المجانية قبل كده — للاشتراك تواصل واتساب: ${display}`,
    messageEn:
      'This tax registration number has already used a free trial — contact WhatsApp to subscribe.',
  };
}
