# Feature Specification: ETA Integration Core

**Feature Branch**: `004-eta-integration-core`

**Created**: 2026-07-20

**Status**: Clarified

**Input**: User description: "Feature: ETA integration core (authentication + document types). Implement ETA OAuth2 client-credentials: POST /connect/token with Basic auth (Base64(ClientId:ClientSecret)), grant_type=client_credentials. Cache access_token per tenant (and per onbehalfof) and auto-refresh before expiry (~1h). Support intermediary login via onbehalfof header (registration number). Fetch and cache Document Types and Document Type Versions from ETA (do NOT hardcode schemas). Base URLs (identity + api) and credentials come from per-environment config; default to the ETA sandbox/preprod. Frontend: ETA connection status (token validity, scope), Test Connection performing a real token request against sandbox, and a viewer for document types/versions."

## Clarifications

### Session 2026-07-20

- Q: Where are access tokens cached and when MUST they be refreshed? → A: Redis
  keyed by `tenantId` (+ `onbehalfof` when applicable); refresh at ~80% of
  `expires_in`
- Q: Which environment config keys identify ETA identity and API base URLs? → A:
  `ETA_IDENTITY_BASE_URL` and `ETA_API_BASE_URL` per environment
- Q: What happens when tenant ETA credentials are missing before Test Connection
  / token use? → A: Surface a clear setup error with a link to Phase 2
  (feature 003) tenant ETA credentials settings

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Obtain and reuse ETA access tokens (Priority: P1)

An authorized operator (or the system on their behalf) authenticates to the
Egyptian Tax Authority (ETA) identity service using the tenant’s stored Client
ID and Client Secret (and optional intermediary “on behalf of” registration
number). The platform receives a time-limited access token, reuses it for
subsequent ETA calls for that tenant (and on-behalf-of identity), and obtains a
fresh token before the current one expires—without prompting the user to
re-enter secrets.

**Why this priority**: Every later ETA capability (document types, submission,
status) depends on a valid access token. Without reliable auth, the product
cannot call ETA at all.

**Independent Test**: With sandbox credentials configured for a tenant, request
an access token successfully; request again before ~80% of `expires_in` and
confirm the Redis-cached token is reused; advance past ~80% (or simulate) and
confirm a new token is obtained; with credentials missing, confirm setup error
+ link to feature 003 settings and no ETA call; confirm unauthorized roles
cannot trigger live token requests.

**Acceptance Scenarios**:

1. **Given** a tenant with valid encrypted ETA credentials and sandbox identity
   URL configured, **When** an authorized user runs Test Connection (or the
   system needs a token), **Then** the platform authenticates to ETA using
   OAuth2 client credentials and receives a usable access token.
2. **Given** a valid cached token for that tenant (and on-behalf-of key if any)
   that is not near expiry, **When** another ETA operation needs a token,
   **Then** the cached token is reused (no unnecessary new login to ETA).
3. **Given** a cached token that is expired or at/beyond ~80% of its
   `expires_in` lifetime, **When** a token is needed, **Then** the platform
   obtains a new token and replaces the Redis cache entry for that
   `tenantId` (+ `onbehalfof` when set).
4. **Given** intermediary mode with an on-behalf-of registration number,
   **When** authenticating, **Then** the ETA request includes the on-behalf-of
   identity as required by ETA, and the token is cached in Redis under a key
   that includes both `tenantId` and that on-behalf-of value (separate from the
   tenant’s own non-intermediary token).
5. **Given** invalid credentials or ETA identity errors, **When** authentication
   is attempted, **Then** the user sees a clear failure outcome, secrets are not
   exposed, and the failure is auditable.
6. **Given** the tenant has no Client ID / Client Secret configured, **When**
   the user runs Test Connection or the system needs a token, **Then** the UI
   shows a clear setup error and a link to tenant ETA credentials settings
   (feature 003 / Phase 2 settings)—without calling ETA.

---

### User Story 2 - Load document types and versions from ETA (Priority: P1)

An authorized user refreshes or opens the document-type catalog so the platform
loads **Document Types** and **Document Type Versions** from ETA’s API (not from
hardcoded product schemas). Results are cached for reuse and can be refreshed
on demand. Operators can browse types and versions in the UI.

**Why this priority**: Constitution and ETA practice forbid hardcoding document
schemas; submission and UI later depend on runtime types/versions from ETA.

**Independent Test**: With a valid token against sandbox, fetch document types
and at least one type’s versions; confirm the UI lists them; refresh again and
confirm cache/refresh behavior; confirm no hardcoded type list is used as the
source of truth.

**Acceptance Scenarios**:

1. **Given** a tenant with a valid ETA access token, **When** an authorized user
   opens or refreshes Document Types, **Then** the platform retrieves current
   document types from ETA and displays them (id/name and related metadata ETA
   returns).
2. **Given** a selected document type, **When** the user views versions,
   **Then** document type versions for that type are retrieved from ETA (or
   shown from a fresh ETA-backed cache) without embedding schemas in source
   code as the live catalog.
3. **Given** types/versions were fetched recently, **When** the user opens the
   viewer again within the cache lifetime, **Then** results load from cache
   without an unnecessary ETA round-trip unless the user explicitly refreshes.
4. **Given** ETA is unreachable or returns an error, **When** fetch/refresh is
   attempted, **Then** the UI shows a clear error, prior cache may remain
   available as stale data if present, and the failure is auditable.

---

### User Story 3 - See ETA connection status and run real Test Connection (Priority: P1)

An authorized user opens ETA connection settings and sees whether the tenant
currently has a valid (or near-expiry) access token, relevant scope/claims the
product surfaces, and environment context (sandbox vs other). “Test Connection”
performs a **real** token request against the configured sandbox/preprod
identity endpoint (upgrading the previous placeholder), then updates status.

**Why this priority**: Operators need confidence credentials and URLs work
before invoicing; a stub “Test Connection” is insufficient for go-live readiness
on sandbox.

**Independent Test**: Open status with no token → shows disconnected; run Test
Connection with good sandbox credentials → success and valid status; with bad
secret → failure without leaking the secret; Arabic and English labels present.

**Acceptance Scenarios**:

1. **Given** no cached token for the tenant, **When** the user views ETA
   connection status, **Then** the UI indicates not connected / no valid token.
2. **Given** valid credentials, **When** the user clicks Test Connection,
   **Then** a live token request is made to the configured ETA identity base URL
   (default sandbox/preprod), and on success status shows valid token (and
   expiry / scope information the product chooses to display).
3. **Given** a successful prior token, **When** the user returns to the status
   screen before expiry, **Then** status reflects a valid cached connection
   without requiring another click.
4. **Given** a Viewer or other role without ETA manage permission, **When** they
   attempt Test Connection, **Then** the action is denied; view-only roles may
   see limited status if permitted by the role matrix.
5. **Given** no ETA Client ID/Secret saved for the tenant, **When** the user
   opens status or clicks Test Connection, **Then** they see a clear setup error
   with a link to Phase 2 / feature 003 ETA credentials settings, and ETA is not
   contacted.

---

### User Story 4 - Environment-safe ETA endpoints (Priority: P2)

Operators and engineers rely on per-environment configuration for ETA identity
and API base URLs (and related non-secret settings). Non-production defaults to
ETA sandbox/preprod. Production uses separately provisioned URLs and secrets.
Source code does not embed live endpoint URLs or credentials as the runtime
source of truth.

**Why this priority**: Prevents accidental production ETA traffic and satisfies
sandbox-first / runtime configuration principles.

**Independent Test**: In development/CI configuration, confirm identity and API
calls target sandbox/preprod base URLs from config; confirm missing config fails
closed with a clear error rather than falling back to hardcoded production.

**Acceptance Scenarios**:

1. **Given** development or CI environment configuration with
   `ETA_IDENTITY_BASE_URL` and `ETA_API_BASE_URL` set to sandbox/preprod,
   **When** the platform calls ETA identity or API, **Then** it uses those
   configured base URLs, not production.
2. **Given** `ETA_IDENTITY_BASE_URL` or `ETA_API_BASE_URL` is missing or
   invalid, **When** a connection is attempted, **Then** the operation fails
   closed with a clear configuration error (no silent production fallback).

---

### Edge Cases

- Missing Client ID or Client Secret (or incomplete intermediary on-behalf-of
  when required) → do **not** call ETA; surface a clear **setup error** with a
  navigational link to Phase 2 / feature 003 ETA credentials settings.
- Missing, rotated, or decrypt-failed Client Secret → fail closed; no plaintext
  in responses or logs; status shows authentication or setup failure as
  appropriate.
- Intermediary enabled without on-behalf-of registration number → reject before
  calling ETA with a validation / setup error (link to settings when useful).
- ETA identity returns 401/403 → surface auth failure; clear or mark Redis token
  cache invalid for that `tenantId` (+ `onbehalfof`) key.
- ETA rate limiting or transient 5xx → user-visible retryable error; do not
  thrash token cache with partial writes.
- Elapsed time ≥ ~80% of `expires_in` → treat as refresh-due (do not wait for
  exact expiry).
- Stale document-type cache when ETA catalog changes → explicit Refresh updates
  from ETA; optional indication of last successful fetch time.
- Cross-tenant access → tenant A cannot read tenant B’s tokens, status, or
  cached document types (Redis keys MUST include `tenantId`).
- Concurrent token refresh for the same `tenantId` (+ `onbehalfof`) → only one
  in-flight refresh should win; others wait for or reuse the new token (no
  credential stampede).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST authenticate to ETA using OAuth2 client-credentials
  as required by ETA (client id and secret presented via Basic authentication,
  grant type client credentials, against the configured identity token
  endpoint).
- **FR-002**: System MUST use Client ID and Client Secret from the tenant’s
  stored ETA credentials (feature 003); secrets MUST be decrypted only in memory
  for the token request and MUST never be logged, audited as plaintext, or
  returned to the client.
- **FR-003**: System MUST cache access tokens in **Redis**, keyed by `tenantId`
  and, when applicable, `onbehalfof` (registration number), and MUST reuse a
  token until refresh is due.
- **FR-004**: System MUST treat a token as refresh-due when elapsed time is at
  least **~80% of `expires_in`** (or when missing/expired), and MUST obtain a
  new access token before performing ETA API calls that require authentication.
- **FR-005**: When the tenant is configured as intermediary, the system MUST
  send the on-behalf-of registration number on the ETA authentication (and
  subsequent API calls as required by ETA) and MUST isolate Redis token cache
  entries by that on-behalf-of value.
- **FR-006**: System MUST fetch Document Types from ETA’s API using a valid
  access token and MUST NOT use hardcoded document type schemas as the live
  catalog source of truth.
- **FR-007**: System MUST fetch Document Type Versions from ETA for a selected
  document type and MUST NOT hardcode version schemas as the live catalog.
- **FR-008**: System MUST cache document types and versions with tenant
  isolation and a defined freshness policy, and MUST support an explicit
  user-triggered refresh from ETA.
- **FR-009**: Per-environment configuration MUST provide `ETA_IDENTITY_BASE_URL`
  and `ETA_API_BASE_URL`; non-production MUST default these to ETA
  sandbox/preprod; credentials for live calls MUST come from tenant settings /
  environment secrets—not source literals.
- **FR-010**: Authorized users MUST be able to view ETA connection status
  including whether a valid token exists, approximate validity/expiry, and
  any scope (or equivalent claim summary) the product surfaces from the token
  response.
- **FR-011**: “Test Connection” MUST perform a real token request against
  `ETA_IDENTITY_BASE_URL` (sandbox/preprod by default) and update connection
  status from the result; the previous placeholder-only behavior is replaced
  for this path.
- **FR-012**: Authorized users MUST be able to view cached/fetched document
  types and their versions in a bilingual (ar/en) UI with RTL support for
  Arabic.
- **FR-013**: System MUST enforce existing ETA settings permissions (view vs
  manage): Test Connection and refresh-from-ETA management actions require
  manage; viewing status/types requires view (or stricter if product matrix
  already excludes Viewer from ETA view).
- **FR-014**: System MUST write audit events for Test Connection attempts,
  token acquisition failures/successes (without token or secret values), and
  document-type refresh actions.
- **FR-015**: Redis token keys and document-type caches MUST be isolated per
  tenant (and on-behalf-of where applicable); cross-tenant reads MUST be
  impossible.
- **FR-016**: Automated tests MUST cover successful sandbox token acquisition
  (or a faithful recorded/sandbox double), Redis cache reuse, refresh at ~80%
  of `expires_in`, on-behalf-of cache keying, document type/version fetch
  without hardcoded catalog, and tenant isolation of caches.
- **FR-017**: When Client ID and/or Client Secret (or required on-behalf-of
  fields) are missing, the system MUST NOT call ETA; it MUST return a clear
  setup error and the UI MUST offer a link to Phase 2 / feature 003 ETA
  credentials settings.

### Constitution Constraints *(mandatory — map applicable principles)*

- **CC-001 Reliability/Audit**: Acceptance scenarios above are testable; audit
  events required for Test Connection, token outcomes, and catalog refresh
  (FR-014).
- **CC-002 Security**: Secrets remain encrypted at rest (003); decrypt only for
  token request; never log/return access tokens or client secrets to browsers;
  TLS for ETA calls.
- **CC-003 Tenant Isolation**: Redis token keys and document-type caches are
  tenant-scoped (and on-behalf-of-scoped); RLS/app isolation for any persisted
  rows.
- **CC-004 ETA Serialization**: N/A for this feature (no document signing or
  canonical serialization in scope).
- **CC-005 Runtime ETA Config**: Document types/versions loaded from ETA (or
  ETA-backed cache); `ETA_IDENTITY_BASE_URL` / `ETA_API_BASE_URL` from
  environment config—no hardcoded live schemas/URLs/credentials.
- **CC-006 Sandbox-First**: Default non-prod values for
  `ETA_IDENTITY_BASE_URL` / `ETA_API_BASE_URL` are ETA sandbox/preprod; Test
  Connection targets configured sandbox by default.
- **CC-007 UX/i18n**: Connection status, Test Connection, and document type
  viewer in ar/en with RTL for Arabic.
- **CC-008 Full-Stack Phase**: Backend token/catalog services + frontend status
  / Test Connection / type viewer ship together with automated tests.

### Key Entities *(include if feature involves data)*

- **EtaAccessTokenCache** (logical): Redis entry keyed by `tenantId` (+
  `onbehalfof` when set), holding access token, issued-at / `expires_in`,
  optional scope/claims summary, last refresh outcome—never exposed as full
  token to the UI. Refresh-due at ~80% of `expires_in`.
- **EtaConnectionStatus** (logical view): Derived status for operators—connected
  or not, expiry window, last test result, environment label (e.g. sandbox),
  and setup-required state when credentials are missing (with link target to
  feature 003 settings).
- **EtaDocumentType**: ETA-provided document type identity and display metadata
  as returned by ETA, cached per tenant (or shared read-through cache with
  tenant-safe access pattern).
- **EtaDocumentTypeVersion**: ETA-provided version metadata for a document
  type, cached alongside types; schemas/content come from ETA, not product
  hardcoding.
- **TenantEtaCredential** (existing): Source of Client ID, encrypted secret,
  registration number, intermediary flags / on-behalf-of fields from feature
  003.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With valid sandbox credentials, an authorized user completes Test
  Connection successfully in under 30 seconds on a normal network and sees a
  “connected / valid token” status.
- **SC-002**: While elapsed time is below ~80% of `expires_in` for a cached
  token, repeated ETA-authenticated operations for the same Redis
  `tenantId` (+ `onbehalfof`) key do not require a new ETA login (cache reuse
  verified in tests).
- **SC-003**: 100% of automated tests for Redis token cache keying
  (`tenantId` + `onbehalfof`), refresh at ~80% of `expires_in`, and
  cross-tenant cache isolation pass in CI.
- **SC-004**: Document type and version catalogs shown to users originate from
  ETA (or ETA-backed cache); automated checks fail if the live catalog is
  served from hardcoded product schema fixtures.
- **SC-005**: Operators can open connection status and the document type/version
  viewer in both Arabic and English without missing critical labels.
- **SC-006**: Failed Test Connection never displays Client Secret or access
  token values in the UI, logs, or audit payloads (spot-check / automated
  assertions on fixtures).
- **SC-007**: When credentials are missing, Test Connection (or status)
  presents a setup error with a working link to Phase 2 / feature 003 ETA
  credentials settings in under 5 seconds without contacting ETA.

## Assumptions

- Feature **003 Tenant Settings** (Phase 2 settings) is available: encrypted
  Client ID/Secret, registration number, intermediary / on-behalf-of fields,
  and ETA settings permissions (`settings.eta.view` / `settings.eta.manage`).
  Missing-credential setup links target that ETA credentials settings screen.
- ETA identity token endpoint follows ETA’s published client-credentials
  contract (`POST /connect/token`, Basic auth of ClientId:ClientSecret,
  `grant_type=client_credentials`). Exact paths remain configuration-relative
  to `ETA_IDENTITY_BASE_URL`.
- Access tokens live in **Redis** with keys that include `tenantId` and, when
  set, `onbehalfof`. Refresh is due at approximately **80% of `expires_in`**
  (ETA tokens are typically ~1 hour).
- Environment configuration exposes **`ETA_IDENTITY_BASE_URL`** and
  **`ETA_API_BASE_URL`** (sandbox/preprod defaults in non-production).
- “Scope” in the UI means whatever scope or related claim summary ETA returns
  on the token response (or a clear “not provided” if ETA omits it)—the product
  does not invent scopes.
- Document type **viewer** displays catalog metadata suitable for operators;
  full invoice authoring against those types is out of scope for this feature.
- Document **submission**, signing, notifications, and code-sync with ETA item
  APIs remain out of scope.
- Desktop signing agent is out of scope (no serialization/signing in this
  phase).
- Non-production environments set `ETA_IDENTITY_BASE_URL` /
  `ETA_API_BASE_URL` to ETA sandbox/preprod; production URLs are provisioned
  separately and never used as the development default.
- Test Connection in this feature **replaces** the placeholder stub from 003
  for the same user-facing control when live identity config and credentials
  are present.
- Automated tests may use ETA sandbox when credentials are available in CI
  secrets, or an equivalent contract double that mirrors ETA token and document
  type responses—without treating hardcoded schemas as the production catalog.

## Out of Scope

- Creating, signing, or submitting invoices/receipts to ETA
- Canonical serialization / agent signing parity work
- Production ETA cutover runbooks beyond requiring separate prod config
- Hardcoded offline document schemas as a substitute for ETA catalog
- Managing ETA credentials themselves (create/rotate)—owned by feature 003
