# Feature Specification: Project Foundation & Skeleton

**Feature Branch**: `001-project-foundation`

**Created**: 2026-07-20

**Status**: Clarified

**Input**: User description: "Feature: Project foundation & skeleton. Set up a monorepo with apps: `api` (NestJS), `web` (Next.js), `agent` (.NET 8), and shared packages: `shared` (types) and `eta-core` (ETA integration + canonical serialization to be filled later). Provide a Docker Compose stack for local dev: postgres, redis, minio, traefik. Add a health endpoint on the API and a landing page on web. Add CI (lint, typecheck, test, build). Add base design tokens (colors, spacing, typography) and .env schema for all services. No business logic yet."

## Clarifications

### Session 2026-07-20

- Q: When dependencies are down, what should API health behavior be? → A: Separate liveness + readiness (liveness = process up; readiness = dependencies reachable)
- Q: What runs inside Docker Compose for local development? → A: Infra only (Postgres, Redis, MinIO, Traefik); `api` and `web` run on the host
- Q: How should developers reach web/api through Traefik locally? → A: HTTPS via Traefik with local/dev certificates; document trust setup
- Q: How must users switch between English and Arabic on the landing page? → A: URL locale prefix (`/en`, `/ar`); default locale redirects to a prefixed route
- Q: What happens when a required environment variable is missing at startup? → A: Fail fast; refuse to boot and report which required vars are missing

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Boot local development stack (Priority: P1)

A developer clones the repository, starts Compose infrastructure, and runs the
API and web apps on the host. They can confirm API liveness and readiness and
open a public landing page in the browser without configuring business features.

**Why this priority**: Without a runnable skeleton, no later feature work can
proceed. This is the minimum viable foundation.

**Independent Test**: From a clean checkout, start Compose infra, trust local
HTTPS certs as documented, start `api` and `web` on the host, call the API
liveness and readiness checks over HTTPS, and load the web landing page over
HTTPS successfully.

**Acceptance Scenarios**:

1. **Given** a clean clone with documented prerequisites installed, **When** the
   developer starts the local Compose stack, **Then** the database, cache, object
   storage, and reverse-proxy services become available for local use (API and
   web apps are started separately on the host per documentation).
2. **Given** the local stack is running, **When** the developer requests the API
   liveness endpoint, **Then** the response indicates the API process is up.
3. **Given** the local stack is running with dependencies available, **When** the
   developer requests the API readiness endpoint, **Then** the response indicates
   required dependencies are reachable.
4. **Given** the API process is up but a required dependency is down, **When** the
   developer requests liveness and readiness, **Then** liveness still succeeds and
   readiness fails (or reports not ready).
5. **Given** the local stack is running, **When** the developer opens the web
   app via the documented HTTPS Traefik URL for a locale-prefixed route
   (`/en` or `/ar`), **Then** a landing page is displayed using the shared base
   visual tokens (colors, spacing, typography) with correct directionality
   (RTL for Arabic).
6. **Given** the developer opens a non-prefixed root URL, **When** the web app
   handles the request, **Then** it redirects to a default locale-prefixed route.

---

### User Story 2 - Work in a multi-app monorepo (Priority: P1)

A developer opens the repository and finds distinct application workspaces for
the API, web app, and desktop signing agent, plus shared packages for common
types and a reserved ETA core package (structure only; no ETA business logic).

**Why this priority**: Clear workspace boundaries are required before any
feature can be implemented without cross-cutting mess.

**Independent Test**: Inspect the repository layout and confirm each named app
and shared package exists, builds as a skeleton, and has no domain/business
workflows beyond placeholders.

**Acceptance Scenarios**:

1. **Given** the repository, **When** a developer lists application workspaces,
   **Then** they find `api`, `web`, and `agent` as separate apps.
2. **Given** the repository, **When** a developer lists shared packages,
   **Then** they find `shared` (common types) and `eta-core` (placeholder for
   future ETA integration and canonical serialization).
3. **Given** any app or shared package, **When** a developer inspects it for
   product features, **Then** they find no invoicing, tenancy, auth product
   flows, or ETA submission logic—only skeleton/placeholder code.

---

### User Story 3 - Rely on automated quality gates (Priority: P2)

A maintainer pushes changes and continuous integration runs lint, type checking,
tests, and build for the foundation so broken scaffolding cannot merge unnoticed.

**Why this priority**: Constitution requires acceptance criteria backed by
automated checks from day one; CI is the enforcement mechanism for the skeleton.

**Independent Test**: Trigger the CI pipeline on the foundation branch and
confirm lint, typecheck, test, and build jobs all run and pass on the skeleton.

**Acceptance Scenarios**:

1. **Given** the foundation branch, **When** CI runs, **Then** lint, typecheck,
   test, and build stages each execute.
2. **Given** a deliberate failing test or type error in an app, **When** CI runs,
   **Then** the pipeline fails and blocks a clean pass.

---

### User Story 4 - Configure services via documented env schema (Priority: P2)

A developer configures local or CI environments using a documented environment
variable schema for every service, without inventing ad-hoc secret names or
embedding live ETA endpoints in source.

**Why this priority**: Prevents credential and environment drift before any
ETA-facing code lands.

**Independent Test**: Review env schema/examples for all services; confirm
required variables are named, documented, and free of real secrets in git; and
confirm starting an app with a missing required variable fails fast with a
clear error.

**Acceptance Scenarios**:

1. **Given** the repository, **When** a developer opens the env schema (or
   example env files) for `api`, `web`, `agent`, and infrastructure services,
   **Then** each required variable is listed with purpose and whether it is
   secret.
2. **Given** the repository contents, **When** searched for committed secrets,
   **Then** no real credentials are present—only placeholders/examples.
3. **Given** environment configuration, **When** non-production defaults are
   reviewed, **Then** they target local/dev (sandbox-oriented) values, not
   production ETA endpoints.
4. **Given** a required environment variable is missing, **When** a developer
   starts the affected app/service, **Then** it refuses to start and reports
   which required variable(s) are missing.

---

### Edge Cases

- When a dependency service (database, cache, or object storage) is down: API
  liveness MUST still succeed; readiness MUST fail or report not ready.
- When required environment variables are missing: the affected app/service
  MUST fail fast at startup and name the missing required variable(s); it MUST
  NOT continue in a half-configured state.
- When a developer runs only the web app without Compose infra: expected
  degraded behavior MUST be documented (e.g., landing page may load while API
  readiness fails if the API is started without dependencies).
- When package managers or SDKs are missing on first clone: root documentation
  MUST state prerequisites clearly.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Repository MUST be organized as a monorepo containing apps
  `api`, `web`, and `agent`, and shared packages `shared` and `eta-core`.
- **FR-002**: `api` MUST expose separate liveness and readiness endpoints.
  Liveness MUST confirm the API process is running regardless of dependency
  state. Readiness MUST succeed only when required local dependencies
  (at minimum the database; cache and object storage if configured as required)
  are reachable, and MUST fail or report not ready when they are not.
- **FR-003**: `web` MUST serve a public landing page at locale-prefixed routes
  (`/en` and `/ar` at minimum). Unprefixed root access MUST redirect to a
  default locale-prefixed route.
- **FR-004**: `web` MUST apply base design tokens for colors, spacing, and
  typography on the landing page.
- **FR-005**: `web` MUST support Arabic and English presentation via URL locale
  prefixes, including RTL layout for Arabic landing-page copy (content may be
  minimal).
- **FR-006**: `agent` MUST exist as a buildable desktop-agent skeleton with no
  signing or ETA business behavior yet.
- **FR-007**: Package `shared` MUST provide a place for shared types usable by
  other workspaces (may be minimal placeholder types).
- **FR-008**: Package `eta-core` MUST exist as a reserved workspace for future
  ETA integration and canonical serialization, with placeholder exports only
  (no live ETA calls or serialization implementation in this feature).
- **FR-009**: Local development MUST provide a compose-based stack that runs
  infrastructure only: PostgreSQL, Redis, MinIO, and Traefik. `api` and `web`
  MUST be started on the host (not as required Compose services). Traefik MUST
  expose `web` and `api` over HTTPS using local/dev certificates, and
  documentation MUST cover certificate trust setup. Documentation MUST also
  describe starting Compose infra and then starting `api` and `web` separately.
- **FR-010**: Continuous integration MUST run lint, typecheck, test, and build
  for applicable workspaces.
- **FR-011**: Each service/app MUST have a documented environment-variable
  schema (names, purpose, secret vs non-secret) with example values suitable
  for local/dev. `api`, `web`, and `agent` MUST validate required variables at
  startup and fail fast—refusing to boot while naming missing required
  variable(s)—rather than running half-configured.
- **FR-012**: Source control MUST NOT contain real secrets; examples MUST use
  placeholders.
- **FR-013**: This feature MUST NOT implement product business logic
  (authentication product flows, tenancy product features, invoicing,
  receipts, ETA submission, or canonical serialization algorithms).
- **FR-014**: Automated tests MUST cover at least: API liveness success,
  API readiness success (dependencies up) and readiness failure/not-ready when
  a required dependency is unavailable (or equivalently mocked), web landing
  page render (including `/en` and `/ar` + RTL smoke coverage), and CI-wired smoke/unit
  placeholders for `shared` / `eta-core` / `agent` as applicable so the test
  stage is non-empty and meaningful.
- **FR-015**: Root documentation MUST describe how to start Compose infra,
  trust local Traefik HTTPS certificates, start `api` and `web` on the host,
  open the landing page over HTTPS, call liveness and readiness endpoints, and
  run lint/typecheck/test/build locally.

### Constitution Constraints *(mandatory — map applicable principles)*

- **CC-001 Reliability/Audit**: Acceptance criteria and automated tests for
  liveness/readiness endpoints, landing page, and CI stages. Full product audit
  log is N/A (no business actions yet); skeleton MUST NOT pretend to audit
  domain events.
- **CC-002 Security**: Env schema with secrets marked; no real secrets in git;
  Traefik routes local `web`/`api` over HTTPS with documented local/dev
  certificate trust. At-rest encryption of ETA credentials is N/A until
  credentials exist—schema MUST leave room for them.
- **CC-003 Tenant Isolation**: N/A for product RLS in this feature (no
  tenant-scoped business tables yet). Postgres is provisioned only as
  infrastructure readiness.
- **CC-004 ETA Serialization**: `eta-core` package scaffolded only; no
  serialization implementation or test vectors required in this feature.
- **CC-005 Runtime ETA Config**: Env schema MUST define placeholders for
  per-environment ETA URLs/credentials; no hardcoded live ETA endpoints in
  source.
- **CC-006 Sandbox-First**: Default/example env values MUST be local/dev or
  sandbox-oriented, not production ETA.
- **CC-007 UX/i18n**: Landing page uses base design tokens; Arabic/English via
  `/ar` and `/en` URL prefixes with RTL for Arabic; unprefixed root redirects
  to a default locale.
- **CC-008 Full-Stack Phase**: This phase ships `api` + `web` + `agent`
  skeletons together with shared packages, local stack, CI, and tests before
  any business feature phase.

### Key Entities

- **Application Workspace**: Named app (`api`, `web`, `agent`) with its own
  build/test entry points.
- **Shared Package**: Reusable library workspace (`shared`, `eta-core`)
  consumed by apps; `eta-core` remains a stub in this feature.
- **Environment Variable**: Named configuration entry with purpose, secrecy
  classification, and example value for local/dev.
- **Design Token**: Named visual primitive (color, spacing, typography) used by
  the web landing page.
- **Infrastructure Service**: Local dependency process (database, cache, object
  storage, reverse proxy) started via the compose stack.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new developer following root documentation can bring up Compose
  infra, trust local HTTPS certificates, start `api` and `web` on the host, and
  verify API liveness, API readiness, plus the landing page over HTTPS within
  30 minutes on a machine that already has documented prerequisites.
- **SC-002**: 100% of named apps (`api`, `web`, `agent`) and shared packages
  (`shared`, `eta-core`) exist as distinct workspaces and produce a successful
  skeleton build in CI.
- **SC-003**: CI lint, typecheck, test, and build stages each complete
  successfully on the foundation branch with zero failing checks.
- **SC-004**: The landing page is reachable at `/en` and `/ar` over HTTPS,
  shows RTL for Arabic, redirects unprefixed root to a default locale, and
  visually reflects the documented base tokens.
- **SC-005**: A repository secret scan / review finds no committed real
  credentials; all services have documented env schemas with examples.
- **SC-006**: Manual or automated review confirms no invoicing, tenancy product
  flows, authentication product flows, or ETA submission/serialization logic
  shipped in this feature.

## Assumptions

- Primary users of this feature are developers and maintainers, not end
  taxpayers or tenant operators.
- Package/workspace tooling and exact folder layout under the monorepo root
  will be chosen during planning, provided the named apps and packages exist.
- API health is split into liveness (process up) and readiness (required
  dependencies reachable); readiness MUST check at least the database in this
  foundation phase.
- Local Compose stack runs infrastructure only (PostgreSQL, Redis, MinIO,
  Traefik). Developers run `api` and `web` on the host against that infra.
  Optional containerization of apps is out of scope for this feature.
- Traefik terminates TLS for local `web` and `api` using local/dev certificates;
  certificate generation/trust steps are documented. Production VPS hardening
  remains out of scope for this feature.
- Base design tokens are sufficient for the landing page; a full component
  library beyond token foundations can follow in later phases.
- `eta-core` and `agent` skeletons may expose minimal placeholder APIs/tests
  solely so CI remains meaningful, without implementing ETA behavior.
- i18n for the landing page uses URL locale prefixes (`/en`, `/ar`) with
  redirect from unprefixed root to a default locale; Arabic uses RTL. Copy may
  be short.
- Apps (`api`, `web`, `agent`) validate required environment variables at
  startup and fail fast with explicit missing-variable errors; unsafe silent
  defaults for required vars are not used.
