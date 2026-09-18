export const PLAN_HAS_SUBSCRIBERS_CODE = 'PLAN_HAS_SUBSCRIBERS';

export function planHasSubscribersBody(subscriberCount: number) {
  const n = Math.max(0, Math.floor(subscriberCount));
  const messageEn = `Cannot delete a plan that has active subscribers (${n} accounts). Move them to another plan first.`;
  const messageAr = `لا يمكن حذف الخطة لوجود مشتركين فيها (${n} حساب). انقل المشتركين لخطة أخرى أولاً`;
  return {
    code: PLAN_HAS_SUBSCRIBERS_CODE,
    subscriberCount: n,
    message: messageEn,
    messageEn,
    messageAr,
  };
}
