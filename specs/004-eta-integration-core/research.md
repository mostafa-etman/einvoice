# Research: ETA Integration Core

**Feature**: `004-eta-integration-core` | **Date**: 2026-07-20

## R1 — Token cache store

**Decision**: Redis (`ioredis`) with keys
`eta:token:{tenantId}` or `eta:token:{tenantId}:{onbehalfof}`.

**Rationale**: Spec clarification; constitution already uses Redis; shared across
API instances; TTL can mirror remaining token lifetime.

**Alternatives considered**: In-memory Map (fails multi-instance); Postgres table
(heavier, token-at-rest risk higher than ephemeral Redis with TLS/auth).

## R2 — Refresh threshold

**Decision**: Refresh when `elapsed >= 0.8 * expires_in` (or missing/expired).

**Rationale**: Clarified; avoids edge expiry rejections without over-refreshing.

**Alternatives considered**: Fixed 5-minute skew; refresh only after 401 (extra
latency on first failure).

## R3 — Env URL keys vs legacy `ETA_BASE_URL`

**Decision**: Require `ETA_IDENTITY_BASE_URL` and `ETA_API_BASE_URL`. During
migration, if only legacy `ETA_BASE_URL` is set, treat it as API base and fail
fast asking for identity URL (or document dual-read: identity =
`{ETA_BASE_URL}` only if historically pointed at identity — prefer explicit
split). `.env.example` and CI set both to sandbox/preprod defaults. Deprecate
optional `ETA_CLIENT_ID` / `ETA_CLIENT_SECRET` env globals for live calls —
tenant credentials from DB are source of truth (env globals remain unused or
dev-only override out of scope).

**Rationale**: Clarification + Principle V/VI; identity and API hosts differ on
ETA (e.g. id.preprod… vs api.preprod…).

**Alternatives considered**: Single `ETA_BASE_URL` (ambiguous; rejects Principle
clarity).

## R4 — HTTP client + retry

**Decision**: Native `fetch` (Node 20) with small helper: retry 5xx (and network
errors) with exponential backoff (e.g. 3 attempts, 200ms/800ms/2s), no retry on
4xx. Map OAuth error bodies (`invalid_client`, `invalid_grant`, etc.) and HTTP
401/403 to stable app error codes + localized message keys.

**Rationale**: User plan; avoids stampeding ETA on client errors.

**Alternatives considered**: Axios + axios-retry; undici Agent only.

## R5 — Document types cache

**Decision**: Redis keys `eta:doctypes:{tenantId}` and
`eta:doctype-ver:{tenantId}:{typeId}` with TTL (e.g. 1h) + explicit Refresh
busts cache. Catalog content always from ETA responses, never product fixtures
as live source.

**Rationale**: Spec FR-008; tenant isolation on keys even if ETA catalog is
global (avoids leaking “last fetch” metadata across tenants; allows per-tenant
auth context).

**Alternatives considered**: Global shared catalog without tenantId (simpler but
weaker isolation of operational metadata); Postgres persistence (unnecessary for
MVP).

## R6 — Module layout

**Decision**: `EtaAuthClient`, `EtaTokenCache`, `EtaDocTypesClient` under
`apps/api/src/eta/`; `EtaService` orchestrates credential load → token →
doc-types; `EtaController` REST. Settings module continues to own credential
CRUD; Test Connection moves to `EtaModule` (or settings controller delegates to
`EtaService.testConnection`).

**Rationale**: User plan; separation of concerns from 003 settings CRUD.

## R7 — Sandbox integration tests

**Decision**: `eta.sandbox.integration.spec.ts` runs only when
`ETA_SANDBOX_INTEGRATION=1` and sandbox credentials exist (test tenant seeded or
env-provided test ClientId/Secret). Default CI skips. Unit tests always mock
HTTP/Redis.

**Rationale**: User plan; Principle VI without flaky unpaid CI dependency.

## R8 — Missing credentials UX

**Decision**: API returns structured error e.g. `code: 'ETA_CREDENTIALS_SETUP_REQUIRED'`
with `settingsPath` hint; web shows message + link to
`/{locale}/settings/eta-credentials`.

**Rationale**: Clarification FR-017.

## R9 — Concurrent refresh

**Decision**: Per-key Redis lock (`SET NX PX`) or single-flight promise map in
process + short lock; losers read cache after wait.

**Rationale**: Spec edge case; prevents credential stampede.

## R10 — Agent / serialization

**Decision**: Out of scope (Principle IV N/A).
