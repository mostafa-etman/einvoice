export const FALLBACK_WHATSAPP_DISPLAY = '00201000864620';
export const FALLBACK_WHATSAPP_URL = 'https://wa.me/201000864620';

export function whatsappUrlWithText(baseUrl: string, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return baseUrl;
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}text=${encodeURIComponent(trimmed)}`;
}

function present(value?: string | null): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s || s === 'undefined' || s === 'null') return null;
  return s;
}

export type WhatsAppRequestKind = 'upgrade' | 'points' | 'activation' | 'renewal' | 'addon';

export type WhatsAppUpgradeContext = {
  locale: string;
  kind: WhatsAppRequestKind;
  tenantId?: string | null;
  companyName?: string | null;
  currentPlan?: string | null;
  requestedPlan?: string | null;
  userName?: string | null;
  userEmail?: string | null;
};

const AR = {
  upgradeWithPlan: (plan: string) => `أرغب في ترقية الباقة إلى ${plan}.`,
  upgradeGeneric: 'أرغب في ترقية الباقة أو شحن النقاط.',
  points: 'أرغب في شحن نقاط.',
  activation: 'أرغب في تفعيل حساب شركتي.',
  renewal: 'انتهت الفترة التجريبية / نفدت النقاط — للتجديد تواصل واتساب: 00201000864620',
  addon: (name: string) => `أرغب في شراء الإضافة: ${name}.`,
  tenantId: 'رقم المستأجر',
  company: 'اسم الشركة',
  currentPlan: 'الباقة الحالية',
  requestedPlan: 'الباقة المطلوبة',
  name: 'الاسم',
  email: 'البريد',
};

const EN = {
  upgradeWithPlan: (plan: string) => `I would like to upgrade to ${plan}.`,
  upgradeGeneric: 'I would like to upgrade my plan or top up points.',
  points: 'I would like to top up points.',
  activation: 'I would like to activate my company account.',
  renewal: 'Trial ended / points depleted — please renew via WhatsApp: 00201000864620',
  addon: (name: string) => `I would like to buy the add-on: ${name}.`,
  tenantId: 'Tenant ID',
  company: 'Company name',
  currentPlan: 'Current plan',
  requestedPlan: 'Requested plan',
  name: 'Name',
  email: 'Email',
};

export function buildWhatsAppUpgradeMessage(ctx: WhatsAppUpgradeContext): string {
  const copy = ctx.locale?.toLowerCase().startsWith('ar') ? AR : EN;
  const requestedPlan = present(ctx.requestedPlan);
  const currentPlan = present(ctx.currentPlan);

  let requestLine: string;
  if (ctx.kind === 'points') {
    requestLine = copy.points;
  } else if (ctx.kind === 'activation') {
    requestLine = copy.activation;
  } else if (ctx.kind === 'renewal') {
    requestLine = copy.renewal;
  } else if (ctx.kind === 'addon' && requestedPlan) {
    requestLine = copy.addon(requestedPlan);
  } else if (requestedPlan) {
    requestLine = copy.upgradeWithPlan(requestedPlan);
  } else {
    requestLine = copy.upgradeGeneric;
  }

  const lines = [requestLine];
  const add = (label: string, value?: string | null) => {
    const v = present(value);
    if (!v) return;
    lines.push(`${label}: ${v}`);
  };

  add(copy.tenantId, ctx.tenantId);
  add(copy.company, ctx.companyName);
  if (ctx.kind !== 'activation') {
    add(copy.currentPlan, currentPlan);
    if (ctx.kind !== 'points') {
      add(copy.requestedPlan, requestedPlan);
    }
  }
  add(copy.name, ctx.userName);
  add(copy.email, ctx.userEmail);

  return lines.join('\n');
}
