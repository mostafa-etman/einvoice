# Data Model: Tenant Settings

**Feature**: `003-tenant-settings` | **Date**: 2026-07-20

## Overview

Extends `Branch`; adds global `Currency`, tenant `TenantCurrency`,
`ExchangeRate`, `TenantEtaCredential`, `ItemCode`. All tenant-scoped tables
require `tenant_id`, FORCE RLS, and policies on `current_setting('app.tenant_id')`.

## Entities

### Branch (extend existing)

| Field | Type | Notes |
|-------|------|--------|
| id | uuid PK | existing |
| tenantId | uuid FK | existing |
| name | string | existing |
| isDefault | boolean | existing — exactly one active default per tenant |
| isActive | boolean | default true — deactivate instead of delete when referenced |
| etaBranchCode | string? | ETA branch identity/code |
| activityCode | string? | ETA activity code |
| defaultCurrencyCode | string? FK → Currency.code | optional branch default |
| createdAt / updatedAt | datetime | existing |

**Rules**: Cannot deactivate sole active default; setting `isDefault=true`
clears other defaults in same tenant (transaction).

---

### Currency (global catalog)

| Field | Type | Notes |
|-------|------|--------|
| code | string PK | ISO 4217 (EGP, USD, EUR, …) |
| nameEn | string | |
| nameAr | string | |
| decimals | int | default 2 |
| isActive | boolean | catalog availability |

No `tenantId`. Seed EGP, USD, EUR minimum.

---

### TenantCurrency

| Field | Type | Notes |
|-------|------|--------|
| id | uuid PK | |
| tenantId | uuid FK | RLS |
| currencyCode | string FK | |
| isDefault | boolean | exactly one default per tenant |
| createdAt / updatedAt | datetime | |

**Unique**: `(tenantId, currencyCode)`.

---

### ExchangeRate

| Field | Type | Notes |
|-------|------|--------|
| id | uuid PK | |
| tenantId | uuid FK | RLS |
| baseCurrencyCode | string | |
| quoteCurrencyCode | string | |
| rate | decimal | > 0 |
| source | enum | `MANUAL` (only value written in this feature) |
| effectiveFrom | datetime | |
| effectiveTo | datetime? | null = open-ended |
| createdAt / updatedAt | datetime | |

**Rules**: Reject rate ≤ 0; reject overlapping `[effectiveFrom, effectiveTo)`
for same `(tenantId, base, quote)`. Lookup: latest `effectiveFrom` ≤ asOf where
open or `effectiveTo` > asOf.

**Provider adapter**: Interface only; future rows may use other `source` values.

---

### TenantEtaCredential

| Field | Type | Notes |
|-------|------|--------|
| id | uuid PK | |
| tenantId | uuid FK | RLS |
| branchId | uuid? FK | null = tenant-level; set = branch override |
| clientId | string | non-secret identifier |
| clientSecretCiphertext | bytes | libsodium secretbox ciphertext |
| clientSecretNonce | bytes | random nonce |
| registrationNumber | string? | taxpayer RIN / registration |
| activityCode | string? | |
| isIntermediary | boolean | default false |
| onBehalfOfRegistrationNumber | string? | required if intermediary |
| onBehalfOfName | string? | optional display |
| createdAt / updatedAt | datetime | |

**Unique**: `(tenantId)` where `branchId` IS NULL (one tenant default);
`(tenantId, branchId)` where branch set.

**Resolution**: For branch B, use row with `branchId=B` if present; else tenant
row (`branchId` null).

**Security**: Never select plaintext; API maps to masked DTO; decrypt only in
`SecretsEncryptionService.decrypt` call sites that need it.

---

### ItemCode

| Field | Type | Notes |
|-------|------|--------|
| id | uuid PK | |
| tenantId | uuid FK | RLS |
| type | enum | `EGS` \| `GS1` only |
| code | string | |
| description | string | |
| isActive | boolean | default true |
| lastSyncStatus | string? | reserved placeholder (null in this feature) |
| lastSyncAt | datetime? | reserved |
| createdAt / updatedAt | datetime | |

**Unique**: `(tenantId, type, code)`.

---

## Relationships

```text
Tenant 1—* Branch
Tenant 1—* TenantCurrency *—1 Currency
Tenant 1—* ExchangeRate
Tenant 1—* TenantEtaCredential
Branch 0..1—* TenantEtaCredential
Tenant 1—* ItemCode
Branch *—0..1 Currency (defaultCurrencyCode)
```

## RLS

FORCE RLS + policies on: `branches` (update existing), `tenant_currencies`,
`exchange_rates`, `tenant_eta_credentials`, `item_codes`.

`currencies` catalog: readable by authenticated app role; writes via migration
seed / admin only (no tenant writes).

App DB role remains `einvoice_app` (NOBYPASSRLS). Migrations via
`MIGRATE_DATABASE_URL`.

## Audit actions (examples)

- `settings.branch.create|update|deactivate`
- `settings.currency.enable|set_default`
- `settings.exchange_rate.create|update|delete`
- `settings.eta_credentials.upsert|rotate`
- `settings.item_code.create|update|deactivate`

Metadata MUST omit secret plaintext and ciphertext.
