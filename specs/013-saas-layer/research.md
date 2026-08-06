# Research: SaaS Layer (Plans, Billing & Super-Admin)

**Feature**: `013-saas-layer` | **Date**: 2026-08-01

Resolves Technical Context choices from the clarified spec and user plan
inputs (models, quota guard, super-admin, Stripe adapter, email, web, tests).

---

## R1 — Plan catalog + Subscription on tenant create

**Decision**:
- Seed four **`Plan`** rows: Free, Starter, Pro, Enterprise with quotas
  **100/1/1**, **500/3/3**, **2000/10/10**, **20000/50/50**
  (issued docs / branches / devices).
- Flags: `selfServe` true for Free/Starter/Pro; **false for Enterprise**.
- On `TenantService.createTenant` (self-serve onboarding) and platform
  provision: create **`Subscription`** in `ACTIVE` (or `TRIAL` if later used)
  on **Free** unless operator specifies another plan.
- Optional **`QuotaOverride`** rows adjust effective limits without changing
  catalog (audited).

**Rationale**: Spec clarifications on catalog, seeds, Free default, Enterprise
sales-assisted.

**Alternatives considered**: Soft-coded quotas in env only (no catalog UI);
Enterprise self-checkout (rejected by clarify).

---

## R2 — Request-time quota enforcement via Phase 10 metering

**Decision**:
- **`QuotaService.assertWithinLimits(tenantId, resource)`** called **before**
  mutating:
  - **documents (issue/submit that would count as issued)**: compare
    Africa/Cairo calendar-month **`issued`** from usage-analytics
    (`AnalyticsService.getSummary` / rollup sum for current Cairo month) to
    effective document quota; refuse if `issued + 1 > limit`.
  - **branches**: count active branches vs limit.
  - **devices**: count `SigningDevice` with status `PAIRED` vs limit.
- Return structured error (e.g. `403`/`402`/`409` with code `QUOTA_EXCEEDED`
  + resource + limit + usage) for UI messaging.
- Do **not** maintain a parallel issued counter; metering is source of truth.
- Invalid/rejected and received do not consume document quota (meter rules).

**Rationale**: Spec FR-004/006 + “Phase 10 metering” + user plan.

**Alternatives considered**: Nightly soft enforce (too late); client-only
checks (bypassable); duplicate counter table (drift vs analytics).

---

## R3 — Billing provider abstraction + Stripe test first

**Decision**:
- Interface **`BillingProvider`**: createCustomer, createCheckoutSession /
  changePlan, cancel, parseWebhookEvent, map to internal subscription status.
- **`StripeBillingProvider`**: Stripe **test mode** keys; Checkout or
  Billing Portal for Starter/Pro upgrades; webhooks update `Subscription` +
  `InvoiceRef`.
- **`LocalGatewayBillingProvider`**: stub implementing the same interface
  (methods throw `NotImplemented` or no-op with clear log) so Paymob/Fawry/
  Kashier can plug in without rewriting entitlements.
- Persist **`BillingWebhookEvent`** with provider event id unique for
  idempotency.
- Provider selection via env `BILLING_PROVIDER=stripe|local` (default stripe
  in v1).

**Rationale**: Clarify — abstraction now; Stripe test for flow; local gateway
required later for Egyptian merchants.

**Alternatives considered**: Stripe-only; dual live providers in v1 (scope
creep).

---

## R4 — Past-due grace → read-only

**Decision**:
- On payment_failed / past_due webhook: set status `PAST_DUE`, record
  `graceEndsAt` = now + **3 days** (assumption).
- Scheduled sweep (BullMQ or cron): when `graceEndsAt` passed and still
  unpaid → set `READ_ONLY` (or status `PAST_DUE` + `accessMode=READ_ONLY`).
- Global **WriteGate** / interceptor: if tenant accessMode is READ_ONLY,
  reject mutating routes except billing payment/recovery endpoints.
- Operator **SUSPENDED** blocks product access stronger than read-only
  (existing clarify: suspend vs past-due).

**Rationale**: Spec clarify Q5 + 3-day grace assumption.

**Alternatives considered**: Full lockout; soft-warn only.

---

## R5 — Platform admin authz (separate scope)

**Decision**:
- Reuse **`User.isPlatformOperator`** (already used by backup operator APIs).
- **`PlatformAdminGuard`**: JWT + `isPlatformOperator === true`; **no**
  tenant permission codes for these routes.
- Endpoints under `/platform-admin/*` (no reliance on `X-Tenant-Id` for
  list-all; target tenant id in path/body when acting on one tenant).
- Capabilities: list/search tenants, provision, assign plan/overrides,
  suspend/activate, usage summary (call analytics with tenant context),
  impersonation start/end/break-glass.

**Rationale**: Spec FR-016; aligns with backup operator pattern.

**Alternatives considered**: New `super_admin` role in tenant matrix (wrong
isolation model); separate IdP (overkill for v1).

---

## R6 — Impersonation sessions

**Decision**:
- **`ImpersonationSession`**: operatorUserId, targetUserId, tenantId, reason,
  mode `READ_ONLY` | `WRITE`, expiresAt (default **30 minutes**), endedAt.
- Start → audit + email tenant owner/security; issue short-lived token or
  session cookie claim `{ impersonationSessionId, mode }` bound to target
  user permissions.
- Default mode READ_ONLY: mutating APIs refuse unless mode WRITE.
- Break-glass: typed reason → mode WRITE + extra audit; still expires with
  session.
- Every action under session: audit with session id + mode.
- Auto-expire job / check on each request.

**Rationale**: Spec FR-019*.

**Alternatives considered**: Full write by default; infinite sessions.

---

## R7 — Transactional email

**Decision**:
- New **`EmailService`** with templates (ar/en) for: onboarding complete,
  plan change, payment success/failure, past-due, suspend/activate, quota
  80%/100%, impersonation start.
- Persist **`EmailOutbox`** (or send + log) for dedupe of threshold emails
  (`tenantId + template + periodKey`).
- Transport: console/file in test; SMTP (or provider) via env in deployed
  envs — abstraction so provider can change.
- Never include secrets, raw cards, or impersonation tokens.

**Rationale**: Spec FR-022/023; no email infra exists today.

**Alternatives considered**: Skip email in v1 (fails spec); only in-app toasts.

---

## R8 — Web surfaces

**Decision**:
- **`(app)/billing`**: current plan, quota meters, catalog, upgrade
  Starter/Pro (Stripe Checkout), Enterprise CTA → contact sales.
- **`(platform)/admin`**: separate layout; tenant list/detail; provision;
  suspend/activate; usage; impersonation controls + banner when active.
- **Onboarding**: keep create-tenant flow; after success show Free plan
  quotas; ensure API creates Free subscription.
- Permissions: `billing.view` / `billing.manage` (already in shared package).

**Rationale**: Spec frontend requirements + existing auth/onboarding routes.

**Alternatives considered**: Admin inside tenant shell (confusing + risk).

---

## R9 — Test strategy (user-required)

**Decision**:
1. Quota exceed → blocked with clear message (docs, branches, devices).
2. New tenant signup → Free plan → activation e2e.
3. Every platform admin action produces audit rows (provision, suspend,
   activate, plan assign, impersonation start/end/break-glass).

**Rationale**: User plan + SC-002/005.

**Alternatives considered**: UI-only checks without API integration tests.

---

## R10 — Metering timezone alignment

**Decision**: Document quota month buckets use **Africa/Cairo**. Prefer
aligning analytics rollup queries for quota checks to Cairo month bounds
(even if analytics UI allows other ranges). If analytics rollups are UTC
today, quota service MUST convert “current Cairo month” to `[from,to)`
timestamps when calling summary — do not invent a second meter store.

**Rationale**: Clarify timezone; avoid double counters.

**Alternatives considered**: UTC month (rejected).
