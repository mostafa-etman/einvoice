export const FALLBACK_WHATSAPP_DISPLAY = '00201000864620';
export const FALLBACK_WHATSAPP_URL = 'https://wa.me/201000864620';

export function whatsappUrlWithText(baseUrl: string, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return baseUrl;
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}text=${encodeURIComponent(trimmed)}`;
}
