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
  TENANT_APPROVE: 'platform.tenant.approve',
  TENANT_REJECT: 'platform.tenant.reject',
  POINTS_ADJUST: 'platform.points.adjust',
  POINTS_COSTS_SET: 'platform.points.costs.set',
  PLAN_UPSERT: 'platform.plan.upsert',
  ADDON_UPSERT: 'platform.addon.upsert',
  ADDON_APPLY: 'platform.addon.apply',
  SETTINGS_UPDATE: 'platform.settings.update',
  TENANT_LIMITS: 'platform.tenant.limits',
} as const;

export type PlatformAuditAction =
  (typeof PLATFORM_AUDIT_ACTIONS)[keyof typeof PLATFORM_AUDIT_ACTIONS];
