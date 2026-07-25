# Quickstart Validation: ETA Integration Core

**Feature**: `004-eta-integration-core` | **Date**: 2026-07-20

Prerequisites: Feature **003** working (encrypted ETA credentials UI, Owner
role, Redis up). Contracts: [eta-api.yaml](./contracts/eta-api.yaml),
[permissions.md](./contracts/permissions.md). Model: [data-model.md](./data-model.md).

## 0. Env

In `apps/api/.env` (sandbox/preprod defaults):

```bash
ETA_IDENTITY_BASE_URL=https://id.preprod.eta.gov.eg
ETA_API_BASE_URL=https://api.preprod.invoicing.eta.gov.eg
# Optional live integration tests (skipped unless set):
# ETA_SANDBOX_INTEGRATION=1
# ETA_SANDBOX_CLIENT_ID=...
# ETA_SANDBOX_CLIENT_SECRET=...
```

Do not commit real ClientId/Secret; store them via Settings → ETA credentials
(003). Ensure `SECRETS_MASTER_KEY` and `REDIS_URL` remain set.

**`ETA_SANDBOX_INTEGRATION`**: When unset/false, `eta.sandbox.integration.spec.ts`
uses `describe.skip` so default CI/`pnpm test` never hits live ETA. Enable only
for local sandbox proof with real credentials.

## 1. Unit tests (always — mocked)

```bash
pnpm --filter @einvoice/api test -- --testPathPattern="eta-auth|eta-token|eta-errors" --runInBand
```

**Expect**: Basic-auth header builds as Base64(clientId:clientSecret); refresh
logic marks due at ≥80% of `expires_in`; no plaintext logged.

## 2. API / connection tests (mocked ETA)

```bash
pnpm --filter @einvoice/api test -- --testPathPattern="eta\\.(token|connection|document-types|rbac|config)|eta.sandbox" --runInBand
```

**Expect**: Missing credentials → `ETA_CREDENTIALS_SETUP_REQUIRED` +
`settingsPath`; mocked Test Connection returns `accessToken`; GET
`/settings/eta/connection` never includes token; Redis key includes `tenantId`;
sandbox file is skipped when flag unset.

## 3. Optional sandbox integration

With valid sandbox credentials (env or seeded):

```bash
# PowerShell
$env:ETA_SANDBOX_INTEGRATION="1"
$env:ETA_SANDBOX_CLIENT_ID="your-sandbox-client"
$env:ETA_SANDBOX_CLIENT_SECRET="your-sandbox-secret"
pnpm --filter @einvoice/api test -- --testPathPattern="eta.sandbox" --runInBand
```

**Expect**: Real `accessToken` from identity URL; document types list non-empty
from ETA (skipped automatically when flag unset or creds are `change-me`).

## 4. UI (manual)

1. Sign in as Owner → Settings → ETA credentials.
2. Without credentials: status shows setup required + link to this page.
3. Save sandbox Client ID/Secret (003) → **Test Connection** → connected status
   (expiry/scope if present); secret remains masked; UI does not display the token.
4. Open Document Types viewer → list types; open a type → versions; Refresh
   re-fetches from ETA.
5. Switch locale ar/en; confirm labels.

## 5. Isolation / security spot-checks

- Tenant A Redis token key must not be readable as tenant B (service always
  prefixes active tenant).
- GET connection JSON must never include `access_token` / `accessToken`.
- Test Connection may return `accessToken` for verification; UI must not render it.
- Audit rows for test-connection must omit token/secret material.

## Out of scope check

No invoice submit/sign; no agent changes; no hardcoded document schemas as live
catalog.
