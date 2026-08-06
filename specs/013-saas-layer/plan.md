# Implementation Plan: SaaS Layer (Plans, Billing & Super-Admin)

**Branch**: `013-saas-layer` | **Date**: 2026-08-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-saas-layer/spec.md` plus
technical direction: Plan/Subscription/Quota models; enforcement guard reading
current usage; super-admin module (separate authz): provision/suspend/activate,
monitoring, audited impersonation; billing adapter (Stripe test) + webhooks;
transactional email; web pricing/billing, admin console, self-service
onboarding; tests — quota exceed blocked with clear message; signup→plan→
activation e2e; every admin action audited.

## Summary

Ship the commercial control plane: a **plan catalog** (Free / Starter / Pro /
Enterprise with seeded numeric quotas), per-tenant **Subscription** state, and
**request-time quota enforcement** that reads **Phase 10 / usage-analytics
metering** (`issued` for the Africa/Cairo calendar month) plus live branch and
paired-device counts. **Billing** uses a **provider abstraction** with a
**Stripe test-mode** adapter and webhook idempotency; a local Egyptian gateway
adapter slot is designed but not fully wired in v1. **Transactional email**
covers SaaS lifecycle events. A **platform super-admin** surface (separate
authz via `User.isPlatformOperator`, not tenant RBAC) provisions/suspends/
activates tenants, monitors usage, and runs **time-limited, audited
impersonation** (read-only default + break-glass write). Web delivers
**Plans & Billing**, **super-admin console**, and **Free-default onboarding**.
Desktop agent unchanged except device-register paths already hit API quota
checks.

## Technical Context

**Language/Version**: TypeScript 5.x (NestJS 10 API, Next.js 15 web)

**Primary Dependencies**: NestJS + Prisma + RLS; BullMQ (optional email/
past-due jobs); Stripe SDK (test mode); email transport abstraction
(SMTP or console in non-prod); Next.js 15, next-intl, TanStack Query,
Tailwind/shadcn; reuse `AnalyticsService` / usage rollups for `issued`

**Storage**: PostgreSQL — `Plan`, `Subscription`, `QuotaOverride`,
`PaymentCustomer`, `InvoiceRef`, `BillingWebhookEvent`,
`ImpersonationSession`, `EmailOutbox` (+ tenant suspend flags) with FORCE RLS
where tenant-scoped; Redis — optional queues for email / past-due sweep;
secrets via env (`STRIPE_*`, SMTP, webhook signing)

**Testing**: Integration — quota exceed blocked (docs/branches/devices) with
clear error; signup → Free plan activation e2e; Stripe webhook idempotency;
past-due → read-only; every platform admin action audited; impersonation
read-only vs break-glass; cross-tenant isolation; web smoke ar/en RTL for
billing + admin + onboarding

**Target Platform**: Existing Compose (Postgres, Redis, MinIO, Traefik); API
workers for email/past-due if queued

**Project Type**: Multi-tenant SaaS (API + web); desktop agent out of scope
for new UI (device quota enforced on existing register API)

**Performance Goals**: Quota check adds negligible latency (p95 +<50ms on
hot paths using rollup/`issued` summary + indexed counts); webhook handling
idempotent <2s typical; onboarding to Free usable org <10 minutes (SC-001)

**Constraints**: Request-time enforce; Africa/Cairo month; issued-only docs;
Enterprise sales-assisted; Free onboarding default; past-due grace then
read-only (billing still open); Stripe test first + billing abstraction;
impersonation audited + time-limited; platform operator ≠ tenant role;
reuse `billing.view` / `billing.manage`; no secrets in client/logs

**Scale/Scope**: Four catalog plans; tenant billing self-serve (Free/Starter/
Pro); platform console; email lifecycle; local gateway adapter interface only
in v1 (full Paymob/Fawry/Kashier wiring = follow-up)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Reliability & Audit**: PASS — quota/onboarding/admin/impersonation tests
  planned; audit plan changes, webhooks, suspend/activate, impersonation
  lifecycle + actions
- **II. Security by Default**: PASS — Stripe/webhook/SMTP secrets env-only;
  impersonation time-limited + banner; least privilege billing vs operator
- **III. Multi-Tenant Isolation**: PASS — FORCE RLS on tenant billing tables;
  operator paths explicit `isPlatformOperator` + no silent cross-tenant reads
- **IV. Serialization Parity**: PASS — N/A (no signing/serialization changes)
- **V. Runtime ETA Config**: PASS — N/A
- **VI. Sandbox-First**: PASS — Stripe **test mode** in non-prod; no live
  charges from CI/dev; local gateway production later
- **VII. UX/i18n**: PASS — billing, admin, onboarding ar/en + RTL + design system
- **VIII. Phased Full-Stack DoD**: PASS — API + web + tests; agent unchanged
- **Stack**: PASS — within Technology Baseline (+ Stripe as external billing
  SaaS, recorded in Complexity Tracking as integration note)

## Project Structure

### Documentation (this feature)

```text
specs/013-saas-layer/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── billing-api.yaml
│   ├── platform-admin-api.yaml
│   └── permissions.md
└── tasks.md              # /speckit-tasks (not this command)
```

### Source Code (repository root)

```text
apps/api/
├── src/billing/
│   ├── billing.module.ts
│   ├── billing.controller.ts          # plans, subscription, checkout, portal
│   ├── billing.service.ts
│   ├── quota.service.ts               # entitlements + usage vs limits
│   ├── quota.guard.ts                 # request-time enforce helpers/guards
│   ├── subscription.service.ts
│   ├── plan.seed.ts                   # Free/Starter/Pro/Enterprise
│   ├── providers/
│   │   ├── billing-provider.ts        # interface
│   │   ├── stripe.provider.ts         # Stripe test adapter
│   │   └── local-gateway.provider.ts  # stub / interface for next adapter
│   └── billing-webhook.controller.ts  # raw body + signature verify
├── src/platform-admin/
│   ├── platform-admin.module.ts
│   ├── platform-admin.controller.ts   # tenants CRUD-ish lifecycle
│   ├── platform-admin.guard.ts        # isPlatformOperator
│   ├── impersonation.service.ts
│   └── tenant-lifecycle.service.ts    # provision/suspend/activate
├── src/email/
│   ├── email.module.ts
│   ├── email.service.ts               # transactional templates ar/en
│   └── email.processors.ts            # optional BullMQ
├── src/documents/ / branches/ / devices/  # call QuotaService before mutate
├── src/tenants/                       # createTenant → Free subscription
├── src/analytics/                     # read issued for Cairo month
├── prisma/                            # models + RLS
└── test/                              # quota, onboarding, admin audit, webhook

apps/web/
├── src/app/[locale]/(auth)/onboarding/   # ensure Free plan messaging
├── src/app/[locale]/(app)/billing/       # Plans & Billing
├── src/app/[locale]/(platform)/admin/    # super-admin console (separate layout)
├── src/lib/api/billing.ts
├── src/lib/api/platform-admin.ts
└── src/messages/{en,ar}.json

packages/shared/
└── src/permissions.ts                 # wire billing.view/manage (already reserved)
```

**Structure Decision**: Split **`billing`** (tenant-facing plans/quotas/
Stripe) from **`platform-admin`** (operator-only lifecycle + impersonation)
and **`email`** (shared transactional sender). Quota checks are invoked from
document issue, branch create, and device pair paths. Web admin uses a
**(platform)** route group distinct from tenant `AppShell`.

## Complexity Tracking

> No constitution principle violations. Integration notes:

| Note | Why | Simpler Alternative Rejected Because |
|------|-----|--------------------------------------|
| Billing provider abstraction | Egyptian local gateway required later without rewrite | Stripe-only hardcode forces redesign for Paymob/Fawry/Kashier |
| Separate platform-admin module | Operator authz ≠ tenant RBAC | Stuffing into tenant settings leaks cross-tenant APIs |
| Impersonation session entity | Time limit, break-glass, full action audit | “Login as” without session model fails FR-019* |
| Email module (new) | No transactional mail exists today | Skipping email violates FR-022 lifecycle notifications |
| Read-only middleware after grace | Spec past-due behavior | Soft-warn-only fails commercial enforcement |

## Phase 0 / Phase 1

See [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md).

### Constitution Check (post-design)

Re-validated PASS: contracts gate tenant billing with JWT + `X-Tenant-Id` +
`billing.*`; platform routes with `isPlatformOperator`; data model FORCE RLS
on tenant-scoped billing tables; Stripe test + webhook signature + idempotent
`BillingWebhookEvent`; quota guard reads analytics `issued` (Cairo month) +
branch/device counts; impersonation sessions audited with auto-expire;
Enterprise sales-assisted; Free default onboarding; past-due → read-only;
email outbox without secrets; agent UI out of scope.
