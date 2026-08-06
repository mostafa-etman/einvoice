/** Audit action name constants for the platform-operator surface (specs/013-saas-layer/contracts/permissions.md). */
export const PLATFORM_AUDIT_ACTIONS = {
  TENANT_PROVISION: 'platform.tenant.provision',
  TENANT_SUSPEND: 'platform.tenant.suspend',
  TENANT_ACTIVATE: 'platform.tenant.activate',
  PLAN_ASSIGN: 'platform.plan.assign',
  QUOTA_OVERRIDE: 'platform.quota.override',
  IMPERSONATION_START: 'platform.impersonation.start',
  IMPERSONATION_BREAK_GLASS: 'platform.impersonation.break_glass',
  IMPERSONATION_END: 'platform.impersonation.end',
  IMPERSONATION_EXPIRE: 'platform.impersonation.expire',
  /** Written for EVERY tenant-API request (read + write) made under an impersonation token — no sampling. */
  IMPERSONATION_ACTION: 'platform.impersonation.action',
} as const;

export type PlatformAuditAction =
  (typeof PLATFORM_AUDIT_ACTIONS)[keyof typeof PLATFORM_AUDIT_ACTIONS];
