import {
  buildWhatsAppUpgradeMessage,
  whatsappUrlWithText,
} from './support-whatsapp';

describe('buildWhatsAppUpgradeMessage', () => {
  it('builds a complete Arabic upgrade message without blanks', () => {
    const text = buildWhatsAppUpgradeMessage({
      locale: 'ar',
      kind: 'upgrade',
      tenantId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      companyName: 'شركة الاختبار',
      currentPlan: 'مجاني',
      requestedPlan: 'احترافي',
      userName: 'أحمد',
      userEmail: 'owner@example.com',
    });
    expect(text).toContain('أرغب في ترقية الباقة إلى احترافي.');
    expect(text).toContain('رقم المستأجر: aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(text).toContain('اسم الشركة: شركة الاختبار');
    expect(text).toContain('الباقة الحالية: مجاني');
    expect(text).toContain('الباقة المطلوبة: احترافي');
    expect(text).toContain('الاسم: أحمد');
    expect(text).toContain('البريد: owner@example.com');
    expect(text).not.toMatch(/undefined|null/i);
  });

  it('omits missing fields and still forms a points request', () => {
    const text = buildWhatsAppUpgradeMessage({
      locale: 'ar',
      kind: 'points',
      tenantId: 'tid-1',
      companyName: '  ',
      currentPlan: undefined,
      requestedPlan: 'ignored',
      userEmail: 'a@b.c',
    });
    expect(text.startsWith('أرغب في شحن نقاط.')).toBe(true);
    expect(text).toContain('رقم المستأجر: tid-1');
    expect(text).toContain('البريد: a@b.c');
    expect(text).not.toContain('اسم الشركة');
    expect(text).not.toContain('الباقة الحالية');
    expect(text).not.toContain('الباقة المطلوبة');
  });

  it('builds an English variant', () => {
    const text = buildWhatsAppUpgradeMessage({
      locale: 'en',
      kind: 'upgrade',
      tenantId: 'tid-2',
      companyName: 'Acme',
      requestedPlan: 'Pro',
      userEmail: 'a@b.c',
    });
    expect(text).toContain('I would like to upgrade to Pro.');
    expect(text).toContain('Tenant ID: tid-2');
    expect(text).toContain('Company name: Acme');
    expect(text).toContain('Email: a@b.c');
    expect(text).not.toContain('Current plan');
  });
});

describe('whatsappUrlWithText', () => {
  it('URL-encodes the prefill including newlines', () => {
    const msg = 'line1\nرقم المستأجر: abc';
    const url = whatsappUrlWithText('https://wa.me/201000864620', msg);
    expect(url.startsWith('https://wa.me/201000864620?text=')).toBe(true);
    expect(decodeURIComponent(url.split('text=')[1])).toBe(msg);
  });
});
