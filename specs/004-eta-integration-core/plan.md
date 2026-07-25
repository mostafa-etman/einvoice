# Implementation Plan: ETA Integration Core

**Branch**: `004-eta-integration-core` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-eta-integration-core/spec.md`
plus technical direction: `eta-core` clients (`EtaAuthClient`, `EtaTokenCache`,
`EtaDocTypesClient`); NestJS `EtaModule` exposing `testConnection(tenantId)`,
`getDocumentTypes()`, `getDocumentTypeVersion(id)`; retry/backoff on 5xx; map
ETA errors (`invalid_client`, etc.) to clear messages; web connection status +
real Test Connection + doc-types viewer; unit tests (Basic-auth header + refresh
logic mocked) and integration test hitting sandbox behind an env flag.

## Summary

Replace the Phase 2 Test Connection **stub** with a live ETA **OAuth2
client-credentials** flow against sandbox/preprod: build Basic auth from
tenant-stored ClientId/ClientSecret (decrypt in memory only), POST identity
`/connect/token`, cache `access_token` in **Redis** keyed by
`tenantId` (+ `onbehalfof`), refresh at **~80% of `expires_in`**. Fetch and
cache Document Types / Document Type Versions from ETA API (never hardcode
schemas). Env: `ETA_IDENTITY_BASE_URL`, `ETA_API_BASE_URL`. NestJS `EtaModule`
+ Next.js status/viewer UI (ar/en). Tests: mocked unit for auth header + refresh;
optional live sandbox integration behind `ETA_SANDBOX_INTEGRATION=1`.

## Technical Context

**Language/Version**: TypeScript 5.x (NestJS 10 + Next.js 15)

**Primary Dependencies**: NestJS; existing Prisma + `SecretsEncryptionService` +
`TenantEtaCredential`; Redis (`ioredis`); HTTP client (`undici` or `fetch`);
zod; Next.js 15, next-intl, TanStack Query, Tailwind tokens

**Storage**: Redis for access-token cache (and short-lived doc-type cache keys);
PostgreSQL only for reading encrypted credentials (003) — no new Prisma models
required for tokens

**Testing**: Jest unit — Basic-auth header builder, refresh-at-80% logic,
error mapping (mocked HTTP/Redis); integration — sandbox token + doc types when
`ETA_SANDBOX_INTEGRATION=1` (skipped otherwise); API RBAC + missing-credentials
setup error; web smoke for status + doc-types copy

**Target Platform**: Existing Compose Redis + host `api`/`web` + Traefik TLS;
ETA sandbox/preprod over HTTPS

**Project Type**: Multi-tenant SaaS (API + web); agent out of scope

**Performance Goals**: Cached token path p95 < 50ms locally (Redis hit); Test
Connection (sandbox RTT) typically < 30s (SC-001); doc-types list from cache
p95 < 200ms

**Constraints**: Never log/return access tokens or client secrets; Redis keys
tenant-scoped; refresh at ~80% `expires_in`; missing creds → setup error + link
to 003 settings; retry/backoff only on 5xx; map `invalid_client` etc. to clear
messages; default sandbox URLs via env

**Scale/Scope**: Per-tenant token cache; shared ETA catalog cache with tenant
auth context; no invoice submit/sign

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Reliability & Audit**: PASS — acceptance + unit/integration tests; audit
  Test Connection / token failure / doc-type refresh (no secrets/tokens)
- **II. Security by Default**: PASS — decrypt secret only for token request;
  TLS to ETA; tokens only in Redis server-side; never to browser
- **III. Multi-Tenant Isolation**: PASS — Redis key prefix includes `tenantId`
  (+ `onbehalfof`); credential load via `withTenant`
- **IV. Serialization Parity**: N/A — no signing
- **V. Runtime ETA Config**: PASS — doc types from ETA; URLs via
  `ETA_IDENTITY_BASE_URL` / `ETA_API_BASE_URL`; creds from tenant settings
- **VI. Sandbox-First**: PASS — sandbox defaults; live integration gated by env
  flag in CI/local
- **VII. UX/i18n**: PASS — status card + viewer ar/en + RTL
- **VIII. Phased Full-Stack DoD**: PASS — API + web + tests; agent N/A
- **Stack**: PASS — within baseline (Redis already present)

### Post-Design Re-check (Phase 1)

Gates remain PASS/N/A. Contracts never return `access_token` or secrets; Redis
key schema documented; env migration from legacy `ETA_BASE_URL` noted in
research. No unjustified violations.

## Project Structure

### Documentation (this feature)

```text
specs/004-eta-integration-core/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── eta-api.yaml
│   └── permissions.md
└── tasks.md                 # /speckit-tasks (later)
```

### Source Code (repository root)

```text
apps/api/
├── src/
│   ├── config/env.ts                    # ETA_IDENTITY_BASE_URL, ETA_API_BASE_URL, flag
│   ├── eta/
│   │   ├── eta.module.ts
│   │   ├── eta.controller.ts            # status, test-connection, document-types
│   │   ├── eta.service.ts               # orchestration
│   │   ├── eta-auth.client.ts           # EtaAuthClient (client-credentials)
│   │   ├── eta-token.cache.ts           # EtaTokenCache (Redis)
│   │   ├── eta-doc-types.client.ts      # EtaDocTypesClient
│   │   ├── eta-errors.ts                # map invalid_client, etc.
│   │   └── eta-http.ts                  # retry/backoff 5xx
│   └── settings/eta-credentials/        # existing — load creds for auth
├── test/
│   ├── eta.auth.unit.spec.ts
│   ├── eta.token-cache.unit.spec.ts
│   ├── eta.connection.spec.ts
│   └── eta.sandbox.integration.spec.ts  # gated by ETA_SANDBOX_INTEGRATION
└── .env.example

apps/web/
├── src/app/[locale]/(app)/settings/
│   ├── eta-credentials/page.tsx         # status card + real Test Connection
│   └── eta-document-types/page.tsx      # doc-types / versions viewer
├── src/lib/api/eta.ts
└── src/messages/{ar,en}.json
```

**Structure Decision**: Keep ETA integration under `apps/api/src/eta/` as a
dedicated module (not inside settings CRUD). Web extends settings area with
connection status on credentials page and a document-types viewer route.
Reuse 003 credential load + encryption; agent unchanged.

## Complexity Tracking

> No constitution violations requiring justification.
