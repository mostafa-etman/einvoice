---
description: "Task list for SaaS layer (plans, billing, super-admin)"
---

# Tasks: SaaS Layer (Plans, Billing & Super-Admin)

**Input**: Design documents from `/specs/013-saas-layer/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/,
quickstart.md; features **002** (auth/RBAC/tenants), **011** (usage analytics
metering / `issued`), existing `User.isPlatformOperator`, reserved
`billing.view` / `billing.manage`

**Tests**: MANDATORY. Explicit gates from user / plan / quickstart:

1. **BLOCKING GATE — Quota enforcement** — At Free (or overridden) limits,
   exceeding **documents** (Cairo-month `issued`), **branches**, or **devices**
   is **blocked at request time** with clear `QUOTA_EXCEEDED` message; excess
   resource NOT persisted. Invalid/rejected and received must NOT consume
   document quota. Feature MUST NOT claim US2 Done while this fails.
   File: `apps/api/test/billing.quota-enforce.spec.ts` (SC-002 / quickstart §2).
2. **BLOCKING GATE — Audited impersonation** — Start (READ_ONLY) → write
   refused → break-glass WRITE with typed reason → end/expire; **every**
   start/break-glass/end/expire leave audit rows; **every** tenant API read and
   write under the session writes `platform.impersonation.action` (no
   sampling); post-expiry denied; impersonation credential **403** on all
   `/platform-admin/*` and MUST NOT carry `isPlatformOperator`; tenant notified
   on start. Files: `apps/api/test/platform-admin.impersonation.spec.ts`,
   `apps/api/test/platform-admin.impersonation-escalation.spec.ts`
   (SC-005 / FR-019b / FR-021 / quickstart §7).
3. **Signup → Free plan → activation e2e** — Register/onboard → Free 100/1/1;
   second tenant isolated. `apps/api/test/billing.onboarding-free.spec.ts`.
4. **Every platform admin action audited** — provision, suspend, activate,
   plan assign, **and quota override** (`platform.quota.override` with
   before/after + operator). `apps/api/test/platform-admin.audit.spec.ts`.
5. **Stripe webhook idempotency** — replay same event id → no double entitle.
6. **Past-due → read-only** — after grace, writes blocked; billing recovery open.
7. **Cross-tenant isolation** — A never sees B billing/quotas.
8. **Regression** — No desktop agent / ETA serialization changes.

**Out of scope** (do not task): Full Paymob/Fawry/Kashier live adapter wiring
(stub interface only); marketing CMS; reseller hierarchy; overage auto-charge;
Enterprise self-checkout.

**Organization**: Phases by user story. Quota gate = Phase 4 (US2).
Impersonation audit gate = Phase 7 (US5). Backend + Frontend before story Done.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable (different files, no incomplete deps)
- **[Story]**: [US1]…[US6] for story phases only
- Exact file paths required

## Path Conventions

- **API**: `apps/api/`
- **Web**: `apps/web/`
- **Shared**: `packages/shared/`
- **Contracts**: `specs/013-saas-layer/contracts/`
- **Infra**: `apps/api/.env.example`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Module shells, deps, env, i18n, permissions wiring, nav

- [x] T001 Confirm/wire `BILLING_VIEW` / `BILLING_MANAGE` in Owner/Admin/
      Accountant matrix per `specs/013-saas-layer/contracts/permissions.md` in
      `packages/shared/src/permissions.ts`
- [x] T002 [P] Add billing/Stripe/SMTP/email env keys to
      `apps/api/.env.example` and `apps/api/src/config/env.ts`
      (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BILLING_PROVIDER`,
      `EMAIL_TRANSPORT`, grace days, impersonation TTL default)
- [x] T003 [P] Add `billing.*`, `admin.*`, `onboarding.plan*` copy keys to
      `apps/web/src/messages/en.json` and `apps/web/src/messages/ar.json`
- [x] T004 [P] Scaffold Nest `BillingModule` shell and register in
      `apps/api/src/app.module.ts` → `apps/api/src/billing/billing.module.ts`
- [x] T005 [P] Scaffold Nest `PlatformAdminModule` shell and register in
      `apps/api/src/app.module.ts` →
      `apps/api/src/platform-admin/platform-admin.module.ts`
- [x] T006 [P] Scaffold Nest `EmailModule` shell and register in
      `apps/api/src/app.module.ts` → `apps/api/src/email/email.module.ts`
- [x] T007 [P] Add web API client stubs `apps/web/src/lib/api/billing.ts` per
      `contracts/billing-api.yaml`
- [x] T008 [P] Add web API client stubs
      `apps/web/src/lib/api/platform-admin.ts` per
      `contracts/platform-admin-api.yaml`
- [x] T009 [P] Add Billing nav entry (permission-gated) in
      `apps/web/src/components/shell/app-shell.tsx`
- [x] T010 [P] Scaffold empty Billing page
      `apps/web/src/app/[locale]/(app)/billing/page.tsx`
- [x] T011 [P] Scaffold platform admin route group layout + empty page
      `apps/web/src/app/[locale]/(platform)/admin/layout.tsx` and
      `apps/web/src/app/[locale]/(platform)/admin/page.tsx`
- [x] T012 [P] Register optional BullMQ queue names `email-send`,
      `billing-past-due` in `apps/api/src/queues/queue-names.ts` and
      `apps/api/src/queues/queues.module.ts`
- [x] T013 [P] Add `stripe` (or official Stripe SDK) dependency to
      `apps/api/package.json` for test-mode adapter

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema + RLS, plan seed, QuotaService skeleton, provider
interface, PlatformAdminGuard, audit action names — **BLOCKS all user stories**

**WARNING**: No story implementation until T014–T026 are green.

- [x] T014 Add Prisma models `Plan`, `Subscription`, `QuotaOverride`,
      `PaymentCustomer`, `InvoiceRef`, `BillingWebhookEvent`,
      `ImpersonationSession`, `EmailOutbox` (+ enums) and Tenant
      `suspendedAt` / `suspendedReason` / `provisionedByUserId` in
      `apps/api/prisma/schema.prisma` per `data-model.md`
- [x] T015 Create migration + FORCE RLS for tenant-scoped billing tables in
      `apps/api/prisma/migrations/` and `apps/api/prisma/rls.sql`
- [x] T016 Implement plan catalog seed (Free/Starter/Pro/Enterprise quotas
      100/1/1, 500/3/3, 2000/10/10, 20000/50/50; Enterprise `selfServe=false`)
      in `apps/api/src/billing/plan.seed.ts` (and invoke from migration seed
      or bootstrap)
- [x] T017 [P] Implement `BillingProvider` interface in
      `apps/api/src/billing/providers/billing-provider.ts`
- [x] T018 [P] Stub `LocalGatewayBillingProvider` in
      `apps/api/src/billing/providers/local-gateway.provider.ts` (interface-
      complete; NotImplemented / no-op with clear log)
- [x] T019 Implement `QuotaService` (effective entitlements = plan + override;
      Cairo-month `issued` via analytics; active branch count; PAIRED device
      count; `assertWithinLimits`) in `apps/api/src/billing/quota.service.ts`
- [x] T020 [P] Unit tests for Cairo month bounds + effective entitlement merge
      in `apps/api/src/billing/quota.service.spec.ts`
- [x] T021 [P] Implement `PlatformAdminGuard` (`isPlatformOperator`) in
      `apps/api/src/platform-admin/platform-admin.guard.ts`
- [x] T022 [P] Define audit action name constants for billing + platform +
      impersonation in `apps/api/src/billing/billing-audit.ts` and
      `apps/api/src/platform-admin/platform-audit.ts` per
      `contracts/permissions.md`
- [x] T023 [P] Implement `EmailService` transport abstraction + console
      adapter in `apps/api/src/email/email.service.ts`
- [x] T024 [P] Unit tests for EmailOutbox dedupe key behavior in
      `apps/api/src/email/email.service.spec.ts`
- [x] T025 Wire `@RequirePermissions(billing.*)` patterns for billing
      controllers in `apps/api/src/billing/`
- [x] T026 Document Africa/Cairo quota period helper (shared) used by
      QuotaService in `apps/api/src/billing/quota-period.ts`

**Checkpoint**: Foundation ready — schema/RLS/plans/quota/provider/email/guard

---

## Phase 3: User Story 1 - Self-service onboarding onto Free plan (Priority: P1) 🎯 MVP

**Goal**: Register + create tenant → Free subscription ACTIVE with 100/1/1;
no payment required; isolated per tenant.

**Independent Test**: Complete signup/onboarding; `GET /billing/subscription`
shows FREE; second org gets its own Free plan.

### Tests for User Story 1 (REQUIRED)

- [x] T027 [P] [US1] Integration e2e: signup → create tenant → Free
      subscription 100/1/1; second tenant isolated in
      `apps/api/test/billing.onboarding-free.spec.ts` (quickstart §1)
- [x] T028 [P] [US1] Permission/auth smoke: unauthenticated billing
      subscription → 401 in `apps/api/test/billing.permissions.spec.ts`
- [x] T029 [P] [US1] Web smoke: onboarding lands with Free plan messaging in
      `apps/web/src/app/[locale]/(auth)/onboarding/onboarding.smoke.test.tsx`

### Implementation for User Story 1

- [x] T030 [US1] On `TenantService.createTenant` create Free `Subscription`
      (ACTIVE) in `apps/api/src/tenants/` (or billing hook) —
      `apps/api/src/billing/subscription.service.ts`
- [x] T031 [P] [US1] Implement `GET /billing/plans` and
      `GET /billing/subscription` in
      `apps/api/src/billing/billing.controller.ts` +
      `apps/api/src/billing/billing.service.ts` per `billing-api.yaml`
- [x] T032 [P] [US1] Implement `GET /billing/quotas` (usage vs limits) in
      `apps/api/src/billing/billing.controller.ts` using QuotaService
- [x] T033 [US1] Audit `tenant.create` / subscription create success paths
      with plan code in metadata via AuditService
- [x] T034 [US1] Update onboarding UI to show Free plan + quotas after create
      in `apps/web/src/app/[locale]/(auth)/onboarding/page.tsx`
- [x] T035 [US1] Billing page read-only Free state (plan + quotas) in
      `apps/web/src/app/[locale]/(app)/billing/page.tsx` with ar/en RTL

**Checkpoint**: US1 Done — Free onboarding e2e + billing read UI green

---

## Phase 4: User Story 2 - Plans with enforced quotas (Priority: P1) ⛔ QUOTA GATE

**Goal**: Request-time enforcement of document/branch/device quotas using
Phase 10 metering (`issued`) + live counts; clear refusal messages.

**Independent Test**: At limit, next issue/branch/device register fails with
`QUOTA_EXCEEDED`; invalid/received do not consume issued quota.

### Tests for User Story 2 (REQUIRED) — quota-enforcement

- [x] T036 [P] [US2] **BLOCKING** Integration: document quota — Cairo-month
      `issued` at limit → issue/submit refused with clear `QUOTA_EXCEEDED`
      message; document not persisted in
      `apps/api/test/billing.quota-enforce.spec.ts`
- [x] T037 [P] [US2] **BLOCKING** Integration: branch at limit → create
      refused; device PAIRED at limit → pair refused in same
      `apps/api/test/billing.quota-enforce.spec.ts` (or
      `billing.quota-branches-devices.spec.ts`)
- [x] T038 [P] [US2] Integration: invalid/rejected and received documents do
      **not** reduce remaining issued quota in
      `apps/api/test/billing.quota-issued-exclusions.spec.ts`
- [x] T039 [P] [US2] Integration: Africa/Cairo month rollover resets issued
      usage for enforcement in
      `apps/api/test/billing.quota-month-rollover.spec.ts`
- [x] T040 [P] [US2] Web smoke: quota meters + blocked CTA messaging in
      `apps/web/src/app/[locale]/(app)/billing/billing-quotas.smoke.test.tsx`

### Implementation for User Story 2

- [x] T041 [US2] Call `QuotaService.assertWithinLimits('documents')` before
      issue/submit paths that count as issued in
      `apps/api/src/documents/` / `apps/api/src/submissions/` (exact service
      entry points that emit `issued`)
- [x] T042 [P] [US2] Call assert for branches on create in
      `apps/api/src/tenants/` (branch create path)
- [x] T043 [P] [US2] Call assert for devices on pair/register in
      `apps/api/src/devices/` (or agent pairing API)
- [x] T044 [US2] Map quota failures to stable API error body
      (`code`, `resource`, `used`, `limit`, `message`) shared helper in
      `apps/api/src/billing/quota-errors.ts`
- [x] T045 [US2] Surface quota remaining on Billing UI + inline upgrade hint
      when near/at limit in
      `apps/web/src/app/[locale]/(app)/billing/page.tsx`
- [x] T046 [US2] Optional audit `billing.quota.exceeded` on refuse (sampled OK)
      via AuditService from quota failure path

**Checkpoint**: US2 Done — **quota-enforce tests MUST be green** before US3+

---

## Phase 5: User Story 3 - Plans & billing self-service (Priority: P1)

**Goal**: Owners upgrade Free→Starter/Pro via Stripe test checkout; Enterprise
sales-assisted; downgrade rules; invoices list; past-due → read-only after
grace.

**Independent Test**: Checkout + webhook activates Starter; Enterprise checkout
rejected; past-due after grace blocks writes but billing open.

### Tests for User Story 3 (REQUIRED)

- [x] T047 [P] [US3] Integration: Stripe webhook idempotency + plan activate
      Starter in `apps/api/test/billing.stripe-webhook.spec.ts`
- [x] T048 [P] [US3] Integration: Enterprise checkout/change-plan rejected;
      enterprise-request 202 in
      `apps/api/test/billing.enterprise-sales.spec.ts`
- [x] T049 [P] [US3] Integration: downgrade blocked when usage exceeds target
      quotas in `apps/api/test/billing.downgrade-block.spec.ts`
- [x] T050 [P] [US3] Integration: past-due grace → READ_ONLY; writes refused;
      billing recovery allowed in
      `apps/api/test/billing.past-due-readonly.spec.ts`
- [x] T051 [P] [US3] Cross-tenant isolation for subscription/invoices/quotas
      in `apps/api/test/billing.cross-tenant.spec.ts`
- [x] T052 [P] [US3] Web smoke: upgrade CTA + Enterprise contact sales in
      `apps/web/src/app/[locale]/(app)/billing/billing.smoke.test.tsx`

### Implementation for User Story 3

- [x] T053 [US3] Implement `StripeBillingProvider` (test mode) in
      `apps/api/src/billing/providers/stripe.provider.ts`
- [x] T054 [US3] Implement checkout + change-plan + enterprise-request
      endpoints in `apps/api/src/billing/billing.controller.ts` /
      `billing.service.ts`
- [x] T055 [US3] Implement Stripe webhook controller (raw body + signature)
      + idempotent `BillingWebhookEvent` apply in
      `apps/api/src/billing/billing-webhook.controller.ts`
- [x] T056 [P] [US3] Implement `GET /billing/invoices` in billing controller
- [x] T057 [US3] Implement past-due → grace → READ_ONLY sweep (BullMQ or
      cron processor) in `apps/api/src/billing/billing-past-due.processor.ts`
- [x] T058 [US3] Global write-gate middleware/guard for READ_ONLY / SUSPENDED
      tenants (allow billing recovery routes) in
      `apps/api/src/billing/tenant-access.guard.ts` (wire in app module)
- [x] T059 [US3] Audit plan changes + webhook processed outcomes
- [x] T060 [US3] Billing UI: plan catalog, checkout redirect, Enterprise CTA,
      invoice list in `apps/web/src/app/[locale]/(app)/billing/page.tsx`

**Checkpoint**: US3 Done — Stripe test path + past-due read-only green

---

## Phase 6: User Story 4 - Super-admin provision / suspend / activate (Priority: P1)

**Goal**: Platform operators provision tenants, assign plans (incl.
Enterprise), suspend/activate, monitor usage; tenant roles cannot access.

**Independent Test**: Operator provisions + suspends + activates with audit
rows; non-operator 403.

### Tests for User Story 4 (REQUIRED)

- [x] T061 [P] [US4] **BLOCKING** Integration: every admin action audited —
      provision, suspend, activate, plan assign, **and quota override**:
      `POST /platform-admin/tenants/{id}/plan` with override fields MUST write
      `platform.quota.override` including **before/after** entitlement values
      and **operator identity** (in addition to plan-assign audit when plan
      changes) in `apps/api/test/platform-admin.audit.spec.ts` (quickstart §6;
      FR-007 / FR-025)
- [x] T062 [P] [US4] Integration: non-operator → 403 on all
      `/platform-admin/*` in `apps/api/test/platform-admin.authz.spec.ts`
- [x] T063 [P] [US4] Integration: suspend blocks tenant product access;
      activate restores in
      `apps/api/test/platform-admin.lifecycle.spec.ts`
- [x] T064 [P] [US4] Integration: usage monitor returns single-tenant meters
      only in `apps/api/test/platform-admin.usage.spec.ts`
- [x] T065 [P] [US4] Web smoke: admin tenant list/detail in
      `apps/web/src/app/[locale]/(platform)/admin/admin.smoke.test.tsx`

### Implementation for User Story 4

- [x] T066 [US4] Implement tenant list/get/provision/suspend/activate/plan/
      usage in `apps/api/src/platform-admin/platform-admin.controller.ts` +
      `tenant-lifecycle.service.ts` per `platform-admin-api.yaml`
- [x] T067 [US4] Ensure every mutating admin method writes AuditService events
      with actor, tenant, reason, outcome; quota override path MUST emit
      `platform.quota.override` with before/after values (not only plan code)
- [x] T068 [US4] Platform admin UI: list, detail, provision form, suspend/
      activate, plan assign in
      `apps/web/src/app/[locale]/(platform)/admin/page.tsx` (+ subcomponents
      under `apps/web/src/app/[locale]/(platform)/admin/`)
- [x] T069 [US4] Gate platform routes to operators only (web + API); hide from
      tenant AppShell nav

**Checkpoint**: US4 Done — admin audit test green

---

## Phase 7: User Story 5 - Audited impersonation (Priority: P2) ⛔ IMPERSONATION GATE

**Goal**: Time-limited READ_ONLY impersonation by default; break-glass WRITE;
full audit + banner + tenant email; auto-expire.

**Independent Test**: Start → write blocked → break-glass → write allowed under
target user perms only → **every** read/write audited → end/expire denial;
impersonation token **cannot** hit platform-admin; non-operator cannot start.

### Tests for User Story 5 (REQUIRED) — audited-impersonation

- [x] T070 [P] [US5] **BLOCKING** Integration in
      `apps/api/test/platform-admin.impersonation.spec.ts` (FR-019b / FR-020 /
      SC-005 / quickstart §7):
      (a) start READ_ONLY → mutating API refused; break-glass with typed reason
      → WRITE under **target user** permissions only;
      (b) perform **multiple distinct tenant API mutations** (e.g. ≥3 different
      write routes) and **≥1 tenant API read**; assert **each** produced its
      **own** `platform.impersonation.action` audit row with real **operator**
      actor, impersonated user, tenant, action/route, mode, timestamp, outcome
      — **no sampling**, no missing mutation;
      (c) end session **or** advance past TTL → further impersonated requests
      **denied** with end/expiry audit; denial after expiry required
- [x] T071 [P] [US5] Integration: impersonation into suspended tenant refused
      (or documented read-only support only) in
      `apps/api/test/platform-admin.impersonation-suspended.spec.ts`
- [x] T072 [P] [US5] Integration: non-operator cannot start impersonation in
      `apps/api/test/platform-admin.impersonation-authz.spec.ts`
- [x] T073 [P] [US5] Web smoke: impersonation banner + break-glass UI in
      `apps/web/src/app/[locale]/(platform)/admin/impersonation.smoke.test.tsx`
- [x] T093 [P] [US5] **BLOCKING** Integration (C2 / FR-021 escalation denial)
      in `apps/api/test/platform-admin.impersonation-escalation.spec.ts`: with
      an active impersonation-scoped token (READ_ONLY and WRITE modes), assert
      **403** on **any** `/platform-admin/*` call; token MUST **not** carry
      `isPlatformOperator`; MUST NOT start another impersonation; MUST NOT
      assign plans/quotas; MUST NOT suspend/activate tenants

### Implementation for User Story 5

- [x] T074 [US5] Implement `ImpersonationService` (create/end/break-glass/
      expire; default TTL 30m) in
      `apps/api/src/platform-admin/impersonation.service.ts`
- [x] T075 [US5] Impersonation endpoints in
      `apps/api/src/platform-admin/platform-admin.controller.ts` per contract
- [x] T076 [US5] Request guard in
      `apps/api/src/platform-admin/impersonation.guard.ts`: bind session;
      enforce READ_ONLY vs WRITE; on **every** tenant API read and write under
      the session write `platform.impersonation.action` (operator, target user,
      tenant, action, mode, time, outcome) — **no sampling**; reject expired
      sessions; ensure impersonation principal never satisfies
      `PlatformAdminGuard` / `isPlatformOperator`
- [x] T077 [US5] Auto-expire check on access + optional sweeper job; expired
      credential denied (pairs with T070c)
- [x] T078 [US5] Trigger impersonation-start email via EmailService (US6
      template can stub first)
- [x] T079 [US5] Admin UI: start/end/break-glass + persistent banner component
      in `apps/web/src/components/platform/impersonation-banner.tsx` and admin
      pages
- [x] T080 [US5] Ensure audits **never** store raw impersonation access tokens
      or other secrets (keep; verify in T070/T093 audit payload asserts)

**Checkpoint**: US5 Done — **impersonation audit + escalation-denial tests MUST
be green** (T070, T093)

---

## Phase 8: User Story 6 - Email notifications (Priority: P2)

**Goal**: Transactional emails ar/en for onboarding, plan/payment, past-due,
suspend/activate, quota thresholds, impersonation start; deduped warnings.

**Independent Test**: Trigger each template → outbox/sent to expected
recipients; no secrets in payload.

### Tests for User Story 6 (REQUIRED)

- [x] T081 [P] [US6] Integration: lifecycle emails written/sent for plan
      change, payment failure, suspend, impersonation start in
      `apps/api/test/email.lifecycle.spec.ts`
- [x] T082 [P] [US6] Integration: quota 80%/100% warn deduped per period in
      `apps/api/test/email.quota-warn-dedupe.spec.ts`
- [x] T083 [P] [US6] Unit/integration: locale ar vs en template selection;
      payload has no secrets in `apps/api/src/email/email-templates.spec.ts`

### Implementation for User Story 6

- [x] T084 [US6] Implement ar/en email templates in
      `apps/api/src/email/templates/` for all `EmailTemplate` enums
- [x] T085 [US6] Hook EmailService into subscription/webhook/lifecycle/
      quota/impersonation flows
- [x] T086 [P] [US6] Optional BullMQ `email-send` processor in
      `apps/api/src/email/email.processors.ts`
- [x] T087 [US6] Wire quota threshold checks (80/100) after issued increment
      or on quota read path

**Checkpoint**: US6 Done — lifecycle email tests green

---

## Phase 9: Polish & Cross-Cutting

**Purpose**: Quickstart alignment, env docs, analyze hygiene

- [x] T088 [P] Run/fix quickstart scenarios documented in
      `specs/013-saas-layer/quickstart.md` and update any drifted commands
- [x] T089 [P] Ensure `.env.example` documents Stripe test + email + billing
      provider switch in `apps/api/.env.example`
- [x] T090 [P] Cross-tenant billing isolation regression already covered —
      add any missing assert to `apps/api/test/billing.cross-tenant.spec.ts`
- [x] T091 [P] Verify no ETA serialization / agent signing files changed
      (git path check in PR notes)
- [x] T092 Confirm Definition of Done: US1–US6 BE+FE+tests; quota gate +
      impersonation gate (T070 + T093 escalation) + admin audit incl. quota
      override (T061) green; constitution checklist

---

## Dependencies & Execution Order

### Phase dependencies

- Phase 1 → Phase 2 → US1 (Phase 3) → US2 (Phase 4 **quota gate**) → US3
  (Phase 5) → US4 (Phase 6) → US5 (Phase 7 **impersonation gate**) → US6
  (Phase 8) → Polish
- US3 needs US1 subscription + US2 quota semantics
- US5 needs US4 operator authz
- US6 can stub early but completes after hooks exist in US3–US5

### User story dependency graph

```text
US1 (Free onboarding)
  └─► US2 (quota enforce) ⛔
        └─► US3 (Stripe billing + past-due)
              └─► US4 (platform admin) 
                    └─► US5 (impersonation) ⛔
                          └─► US6 (email polish/hooks)
```

### Parallel opportunities

- Phase 1: T002–T013 largely [P]
- Phase 2: T017–T018, T020–T024 [P] after T014–T016
- Within US2 tests: T036–T040 [P]
- Within US5 tests: T070–T073 [P]

### Independent test criteria (summary)

| Story | Independent test |
|-------|------------------|
| US1 | Signup → Free 100/1/1; second tenant isolated |
| US2 | Exceed docs/branches/devices → blocked + clear message |
| US3 | Stripe test upgrade; Enterprise sales-only; past-due read-only |
| US4 | Provision/suspend/activate audited; non-op 403 |
| US5 | READ_ONLY→break-glass→expire; every action audited; no platform-admin escalation |
| US6 | Lifecycle emails ar/en; quota warn dedupe |

---

## Parallel example: User Story 2 (quota)

```bash
# After QuotaService + mutate hooks exist, run in parallel:
pnpm --filter api test -- billing.quota-enforce
pnpm --filter api test -- billing.quota-issued-exclusions
pnpm --filter api test -- billing.quota-month-rollover
pnpm --filter web test -- billing-quotas.smoke
```

## Parallel example: User Story 5 (impersonation)

```bash
pnpm --filter api test -- platform-admin.impersonation
pnpm --filter api test -- platform-admin.impersonation-escalation
pnpm --filter api test -- platform-admin.impersonation-suspended
pnpm --filter api test -- platform-admin.impersonation-authz
pnpm --filter web test -- impersonation.smoke
```

---

## Implementation strategy

### MVP (stop after Phase 4)

1. Complete Phase 1–2 foundation
2. Deliver **US1** Free onboarding
3. Deliver **US2** with **quota-enforce tests green** (blocking gate)
4. Validate quickstart §1–§2

### Incremental delivery

5. US3 Stripe test + past-due
6. US4 platform admin + audit tests
7. US5 impersonation + **audited-impersonation tests green**
8. US6 emails + polish

### Suggested MVP scope

**US1 + US2** (onboarding + enforced quotas). Do not ship billing checkout or
admin console before quota gate passes.

---

## Notes

- Task format validated: checkbox + ID + optional [P] + [USn] on story tasks +
  file paths.
- Local gateway: stub only (T018); full adapter is a follow-up feature.
- Analyze remediation (2026-08-01): C1 full read+write action audit (T070/T076);
  C2 escalation denial (T093 + FR-021 scenario); C3 quota-override audit (T061);
  TTL expiry denial in T070c; T080 secrets-in-audit kept.
- Total tasks: **T001–T093** (93; T093 added for escalation gate).
