/** Audit action name constants for tenant-facing billing (specs/013-saas-layer/contracts/permissions.md). */
export const BILLING_AUDIT_ACTIONS = {
  CHECKOUT_START: 'billing.checkout.start',
  CHECKOUT_SUCCESS: 'billing.checkout.success',
  CHECKOUT_FAIL: 'billing.checkout.fail',
  PLAN_CHANGE: 'billing.plan.change',
  WEBHOOK_PROCESSED: 'billing.webhook.processed',
  QUOTA_EXCEEDED: 'billing.quota.exceeded',
  ENTERPRISE_REQUEST: 'billing.enterprise.request',
  SUBSCRIPTION_FREE_CREATE: 'billing.subscription.free.create',
  PAST_DUE_READ_ONLY: 'billing.subscription.past_due.read_only',
} as const;

export type BillingAuditAction =
  (typeof BILLING_AUDIT_ACTIONS)[keyof typeof BILLING_AUDIT_ACTIONS];
