# Quickstart: SaaS Layer (Plans, Billing & Super-Admin)

**Feature**: `013-saas-layer`  
**Purpose**: Validate Free onboarding, request-time quotas, Stripe test
checkout path, platform admin audits, and impersonation after implementation.

## Prerequisites

- Compose stack up (Postgres, Redis, API, web)
- Env: `STRIPE_SECRET_KEY` (test), `STRIPE_WEBHOOK_SECRET`, `BILLING_PROVIDER=stripe`
- SMTP or console email transport configured for non-prod
- At least one user with `isPlatformOperator=true`
- Contracts: [billing-api.yaml](./contracts/billing-api.yaml),
  [platform-admin-api.yaml](./contracts/platform-admin-api.yaml),
  [permissions.md](./contracts/permissions.md)
- Plan seeds: Free 100/1/1, Starter 500/3/3, Pro 2000/10/10, Enterprise 20000/50/50

## 1. Signup → Free plan → activation (required e2e)

1. Register a new user; complete onboarding (`POST /tenants` or web onboarding).
2. Expect `GET /billing/subscription` → plan `FREE`, status `ACTIVE`,
   entitlements 100/1/1.
3. Second signup creates a **different** tenant with its own Free subscription
   (no shared quota).

```bash
pnpm --filter api test -- billing.onboarding-free
```

**Web**: Register → onboarding → land in app → open Billing; see Free + quotas
(ar/en).

## 2. Quota exceed blocked with clear message (required)

1. As Free tenant (or override documentQuota to a low test value e.g. 1):
   ensure `issued` for current Africa/Cairo month is at limit (via fixtures /
   emit).
2. Attempt issue/submit that would exceed → **refused** with
   `QUOTA_EXCEEDED` / clear message; no excess document persisted.
3. With 1 branch allowed and 1 exists → create branch → refused.
4. With 1 PAIRED device and limit 1 → pair another → refused.

```bash
pnpm --filter api test -- billing.quota-enforce
```

## 3. Plan upgrade path (Stripe test)

1. Owner with `billing.manage`: `POST /billing/checkout` `{ planCode: "STARTER" }`.
2. Complete Stripe test Checkout (or simulate webhook `checkout.session.completed`
   / `customer.subscription.updated`).
3. Expect subscription plan STARTER, quotas 500/3/3; confirmation email outbox
   entry (or console send).
4. Replay same webhook event id → state unchanged (idempotent).

```bash
pnpm --filter api test -- billing.stripe-webhook
```

## 4. Enterprise is sales-assisted

1. `POST /billing/checkout` with `ENTERPRISE` → **400**.
2. `POST /billing/enterprise-request` → **202**.
3. Operator `POST /platform-admin/tenants/{id}/plan` `{ planCode: "ENTERPRISE", reason }` →
   quotas 20000/50/50; audit row present.

## 5. Past-due → read-only

1. Simulate payment_failed → status `PAST_DUE`, `graceEndsAt` ~+3d.
2. Advance time past grace → `READ_ONLY`.
3. Document create/issue → refused; `GET /billing/subscription` and checkout
   recovery still allowed.

```bash
pnpm --filter api test -- billing.past-due-readonly
```

## 6. Platform admin — every action audited (required)

As platform operator:

1. Provision tenant → audit `platform.tenant.provision`.
2. Suspend with reason → audit `platform.tenant.suspend`; tenant users blocked.
3. Activate → audit `platform.tenant.activate`.
4. Assign plan / override → audited.
5. Non-operator JWT → **403** on all `/platform-admin/*`.

```bash
pnpm --filter api test -- platform-admin.audit
```

## 7. Impersonation

1. Start session with reason → mode `READ_ONLY`, email notification, audit start.
2. Attempt write as impersonated → refused.
3. Break-glass with typed reason → mode `WRITE`, extra audit.
4. End or wait expiry → further actions fail; audit end/expire.
5. Banner visible in web admin/impersonation UI.

```bash
pnpm --filter api test -- platform-admin.impersonation
```

## 8. Isolation

1. Tenant A never sees Tenant B subscription/invoices/quotas.
2. Operator usage view for A does not mix B meter totals.

```bash
pnpm --filter api test -- billing.cross-tenant
```

## 9. Web smoke

- `(app)/billing` — plan, quotas, upgrade CTA (ar + en, RTL).
- `(platform)/admin` — tenant list, suspend, impersonation (operator only).
- Onboarding shows Free plan context after create.

```bash
pnpm --filter web test -- billing.smoke
pnpm --filter web test -- admin.smoke
```

## Done when

- [ ] Free onboarding e2e green
- [ ] Quota exceed tests green (docs/branches/devices + clear error)
- [ ] Admin lifecycle actions all leave audit rows
- [ ] Impersonation read-only + break-glass + expiry covered
- [ ] Stripe webhook idempotency covered
- [ ] Web billing + admin smoke ar/en
