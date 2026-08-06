# Data Model: SaaS Layer (Plans, Billing & Super-Admin)

**Feature**: `013-saas-layer` | **Date**: 2026-08-01

Tenant-scoped billing tables use **FORCE RLS**. Platform-only tables
(`ImpersonationSession` may be global with tenantId column; operator actions
audit globally) documented per entity. `Plan` is a **global catalog** (no
tenantId).

---

## Enums

### `PlanCode`

`FREE` | `STARTER` | `PRO` | `ENTERPRISE`

### `SubscriptionStatus`

`TRIAL` | `ACTIVE` | `PAST_DUE` | `READ_ONLY` | `SUSPENDED` | `CANCELLED`

> `READ_ONLY` = past-due after grace (writes blocked; billing open).  
> `SUSPENDED` = operator suspend (stronger block).

### `ImpersonationMode`

`READ_ONLY` | `WRITE`

### `BillingProviderId`

`stripe` | `local`

### `EmailTemplate`

`onboarding_complete` | `plan_change` | `payment_success` | `payment_failure` |
`past_due` | `suspend` | `activate` | `quota_warn` | `impersonation_start`

### `EmailOutboxStatus`

`PENDING` | `SENT` | `FAILED` | `SKIPPED`

---

## Entities

### `Plan` (global catalog)

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `code` | `PlanCode` | Unique |
| `nameEn` / `nameAr` | text | Display |
| `descriptionEn` / `descriptionAr` | text? | |
| `documentQuota` | int | Calendar-month issued |
| `branchQuota` | int | Concurrent active |
| `deviceQuota` | int | Concurrent PAIRED |
| `selfServe` | bool | false for Enterprise |
| `isActive` | bool | Hidden/retired when false |
| `sortOrder` | int | Catalog order |
| `stripePriceId` | text? | Test price id when Stripe |
| `createdAt` / `updatedAt` | timestamptz | |

**Seed**:

| Code | Docs | Branches | Devices | Self-serve |
|------|------|----------|---------|------------|
| FREE | 100 | 1 | 1 | yes |
| STARTER | 500 | 3 | 3 | yes |
| PRO | 2000 | 10 | 10 | yes |
| ENTERPRISE | 20000 | 50 | 50 | **no** |

---

### `Subscription` (tenant-scoped, 1:1 with Tenant)

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid | Unique; RLS; FK Tenant |
| `planId` | uuid | FK Plan |
| `status` | `SubscriptionStatus` | |
| `graceEndsAt` | timestamptz? | Set on PAST_DUE |
| `currentPeriodStart` / `currentPeriodEnd` | timestamptz? | Provider period |
| `cancelAtPeriodEnd` | bool | default false |
| `provider` | `BillingProviderId`? | null while Free unpaid |
| `providerSubscriptionId` | text? | Stripe sub id |
| `createdAt` / `updatedAt` | timestamptz | |

**Rules**: Exactly one row per tenant. Status transitions audited.

**State transitions** (happy paths):

```text
ACTIVE (Free) --upgrade+pay--> ACTIVE (Starter/Pro)
ACTIVE --payment_failed--> PAST_DUE --grace expires--> READ_ONLY
PAST_DUE|READ_ONLY --payment_ok--> ACTIVE
* --operator suspend--> SUSPENDED --activate--> prior/ACTIVE
ENTERPRISE only via operator assign (from any)
```

---

### `QuotaOverride` (tenant-scoped, optional)

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid | RLS |
| `documentQuota` | int? | null = use plan |
| `branchQuota` | int? | |
| `deviceQuota` | int? | |
| `reason` | text | Required |
| `createdByUserId` | uuid | Operator or system |
| `expiresAt` | timestamptz? | Optional temporary |
| `createdAt` / `updatedAt` | timestamptz | |

**Effective limit** = override if set and not expired, else plan quota.

---

### `PaymentCustomer` (tenant-scoped)

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid | Unique per provider; RLS |
| `provider` | `BillingProviderId` | |
| `providerCustomerId` | text | Stripe cus_… |
| `createdAt` / `updatedAt` | timestamptz | |

**Constraints**: `@@unique([tenantId, provider])`  
No raw card data.

---

### `InvoiceRef` (tenant-scoped)

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid | RLS |
| `provider` | `BillingProviderId` | |
| `providerInvoiceId` | text | Unique per provider |
| `status` | text | paid / open / void… |
| `amountCents` | int | |
| `currency` | text | e.g. usd/egp |
| `periodStart` / `periodEnd` | timestamptz? | |
| `hostedInvoiceUrl` | text? | |
| `createdAt` | timestamptz | |

---

### `BillingWebhookEvent` (global / provider dedupe)

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `provider` | `BillingProviderId` | |
| `providerEventId` | text | Unique with provider |
| `type` | text | |
| `payloadJson` | jsonb | Redact secrets if any |
| `processedAt` | timestamptz? | |
| `outcome` | text? | success / ignored / error |
| `createdAt` | timestamptz | |

**Constraints**: `@@unique([provider, providerEventId])`

---

### `ImpersonationSession` (platform; not RLS-tenant-owned)

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `operatorUserId` | uuid | Must be platform operator |
| `targetUserId` | uuid | |
| `tenantId` | uuid | Target tenant |
| `reason` | text | Start reason |
| `mode` | `ImpersonationMode` | default READ_ONLY |
| `breakGlassReason` | text? | Set when elevating to WRITE |
| `expiresAt` | timestamptz | Default now+30m |
| `endedAt` | timestamptz? | Manual end |
| `createdAt` | timestamptz | |

**Rules**: Active if `endedAt` null and `now < expiresAt`. Writes require
`mode=WRITE`.

---

### `EmailOutbox`

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid? | When tenant-scoped |
| `template` | `EmailTemplate` | |
| `locale` | text | `ar` \| `en` |
| `toEmail` | text | |
| `dedupeKey` | text | e.g. quota_warn:80:2026-08 |
| `status` | `EmailOutboxStatus` | |
| `payloadJson` | jsonb | Non-secret template vars |
| `sentAt` | timestamptz? | |
| `error` | text? | |
| `createdAt` | timestamptz | |

**Constraints**: `@@unique([dedupeKey])` (or tenant+dedupeKey)

---

### Tenant lifecycle fields (on existing `Tenant`)

| Field | Type | Notes |
|-------|------|-------|
| `suspendedAt` | timestamptz? | Operator suspend |
| `suspendedReason` | text? | |
| `provisionedByUserId` | uuid? | Operator provision path |

Subscription `SUSPENDED` should stay in sync with `suspendedAt` (single
writer in `TenantLifecycleService`).

---

## Relationships

```text
Tenant 1──1 Subscription ──* Plan
Tenant 1──* QuotaOverride
Tenant 1──* PaymentCustomer
Tenant 1──* InvoiceRef
User(operator) ──* ImpersonationSession ──> User(target) + Tenant
BillingWebhookEvent (global)
EmailOutbox (optional tenantId)
```

---

## Quota read model (not a table)

Effective entitlements = Plan (+ QuotaOverride).  
Usage:

| Resource | Source |
|----------|--------|
| Documents | Analytics `issued` sum for Africa/Cairo current month |
| Branches | Count `Branch` where active for tenant |
| Devices | Count `SigningDevice` where `status=PAIRED` |

---

## Validation rules

- Document/branch/device quotas ≥ 0; Enterprise `selfServe=false`.
- Cannot self-checkout to Enterprise.
- Downgrade blocked if usage > target plan effective quotas.
- Impersonation `reason` and break-glass `breakGlassReason` required when
  applicable; max session length enforced.
- Webhook processing must be idempotent on `(provider, providerEventId)`.

---

## RLS / isolation

- FORCE RLS: `Subscription`, `QuotaOverride`, `PaymentCustomer`, `InvoiceRef`
  (and EmailOutbox when tenantId set) via `app.tenant_id`.
- `Plan`, `BillingWebhookEvent`, `ImpersonationSession`: no tenant RLS;
  access only via service role / platform-admin paths with explicit checks.
- Cross-tenant billing leakage is release-blocking.
