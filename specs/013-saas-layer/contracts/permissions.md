# Permissions: SaaS Layer (Plans, Billing & Super-Admin)

**Feature**: `013-saas-layer`

## Tenant permission codes (existing — wire up)

| Code | Purpose |
|------|---------|
| `billing.view` | View Plans & Billing, quotas, invoices list |
| `billing.manage` | Change plan (Starter/Pro), start checkout, manage payment method |

Already defined in `packages/shared/src/permissions.ts` as `BILLING_VIEW` /
`BILLING_MANAGE`. Ensure Owner has both; Accountant may have view (existing
matrix); Admin per product matrix (recommend both for Admin).

## Platform operator (not a tenant permission)

| Capability | Purpose |
|------------|---------|
| `User.isPlatformOperator === true` | All `/platform-admin/*` routes: provision, suspend, activate, plan assign, overrides, usage monitor, impersonation |

Do **not** grant via Owner/Admin matrix.

## Default role matrix (seed) — billing

| Role | `billing.view` | `billing.manage` |
|------|:--------------:|:----------------:|
| Owner | yes | yes |
| Admin | yes | yes |
| Accountant | yes | no |
| Viewer | no | no |

## Endpoint map (tenant)

| Action | Permission |
|--------|------------|
| `GET /billing/plans` | authenticated (catalog; or `billing.view`) |
| `GET /billing/subscription` | `billing.view` |
| `GET /billing/quotas` | `billing.view` |
| `POST /billing/checkout` | `billing.manage` |
| `POST /billing/change-plan` | `billing.manage` |
| `GET /billing/invoices` | `billing.view` |
| `POST /billing/webhooks/stripe` | Stripe signature (no user JWT) |

Quota enforcement on document/branch/device mutate paths: no extra permission;
returns `QUOTA_EXCEEDED` regardless of billing permission.

## Endpoint map (platform)

| Action | Gate |
|--------|------|
| `GET /platform-admin/tenants` | `isPlatformOperator` |
| `POST /platform-admin/tenants` | provision |
| `POST /platform-admin/tenants/{id}/suspend` | + reason |
| `POST /platform-admin/tenants/{id}/activate` | |
| `POST /platform-admin/tenants/{id}/plan` | assign plan / override |
| `GET /platform-admin/tenants/{id}/usage` | |
| `POST /platform-admin/impersonation` | start |
| `POST /platform-admin/impersonation/{id}/break-glass` | typed reason |
| `POST /platform-admin/impersonation/{id}/end` | |

## Audit requirements

| Event | When |
|-------|------|
| `billing.checkout.start` / `.success` / `.fail` | Checkout |
| `billing.plan.change` | Plan change |
| `billing.webhook.processed` | After idempotent apply |
| `billing.quota.exceeded` | Refused mutate (optional sample OK) |
| `platform.tenant.provision` | Operator provision |
| `platform.tenant.suspend` / `.activate` | Lifecycle |
| `platform.plan.assign` / `platform.quota.override` | Entitlement changes |
| `platform.impersonation.start` / `.break_glass` / `.end` / `.expire` | Session |
| `platform.impersonation.action` | Each action under session |

## Notes

- Read-only / suspended tenants: deny writes except billing recovery routes.
- Impersonation READ_ONLY must block writes even if target user has permission.
- Cross-tenant billing or admin data leakage is release-blocking.
