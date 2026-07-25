# Data Model: ETA Integration Core

**Feature**: `004-eta-integration-core` | **Date**: 2026-07-20

## Overview

No new PostgreSQL tables for access tokens. Tokens and short-lived document-type
catalog entries live in **Redis**. Credentials remain in `tenant_eta_credentials`
(feature 003).

## Redis — Access token cache

| Field | Type | Notes |
|-------|------|--------|
| key | string | `eta:token:{tenantId}` or `eta:token:{tenantId}:{onBehalfOf}` |
| accessToken | string | server-only; never returned to clients |
| tokenType | string? | e.g. Bearer |
| expiresIn | number | seconds from ETA |
| obtainedAt | number | epoch ms |
| scope | string? | raw scope if ETA returns it |
| onBehalfOf | string? | registration number when intermediary |

**Refresh rule**: Refresh-due when
`(now - obtainedAt) / 1000 >= 0.8 * expiresIn` OR missing OR past absolute
expiry.

**TTL**: Set Redis TTL to remaining lifetime (or `expiresIn`) so keys expire
naturally; refresh logic still applies on read.

**Security**: Values must not be written to audit logs or HTTP responses.

## Redis — Document types cache

| Field | Type | Notes |
|-------|------|--------|
| key | string | `eta:doctypes:{tenantId}` |
| payload | JSON | array of type summaries from ETA (id, name, … as returned) |
| fetchedAt | number | epoch ms |

| Field | Type | Notes |
|-------|------|--------|
| key | string | `eta:doctype-ver:{tenantId}:{documentTypeId}` |
| payload | JSON | versions list / detail from ETA |
| fetchedAt | number | epoch ms |

**TTL**: Default ~1 hour; explicit Refresh deletes keys then re-fetches.

**Rule**: Never seed from hardcoded product schemas as the live catalog.

## Existing Postgres (read-only for this feature)

### TenantEtaCredential (003)

Used fields: `clientId`, `clientSecretCiphertext`, `clientSecretNonce`,
`registrationNumber`, `isIntermediary`, `onBehalfOfRegistrationNumber`,
`branchId` (optional resolution).

Decrypt secret only inside `EtaAuthClient` / orchestration for token POST.

## Logical API views (not persisted)

### EtaConnectionStatus

| Field | Notes |
|-------|--------|
| connected | boolean — has non-refresh-due cached token |
| expiresAt | ISO or null |
| scope | string or null |
| environment | derived label from identity URL host (e.g. sandbox) |
| lastTestOutcome | success \| failure \| never |
| setupRequired | true when credentials missing |
| settingsPath | relative path to 003 ETA credentials UI |

### EtaDocumentType / Version

Opaque shapes aligned with ETA JSON; API contracts define the subset exposed to
the UI (ids, names, version ids, status flags)—not full schema documents unless
ETA returns them and UI needs them.

## Validation rules

- Missing clientId/secret → `ETA_CREDENTIALS_SETUP_REQUIRED` (no ETA call)
- Intermediary without onBehalfOf → validation error / setup required
- Redis key MUST include `tenantId`
- Cross-tenant key read forbidden by construction (service always prefixes
  active tenant)

## Audit (metadata only)

- `eta.test_connection.success|failure`
- `eta.token.refresh.failure` (optional)
- `eta.document_types.refresh.success|failure`

Never include `access_token`, `client_secret`, ciphertext, or raw Basic auth.
