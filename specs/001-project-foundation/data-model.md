# Data Model: Project Foundation & Skeleton

**Feature**: `001-project-foundation` | **Date**: 2026-07-20

This phase has **no product domain database entities**. The model below captures
configuration and workspace concepts that constrain implementation and tests.

## Entities

### Application Workspace

| Field | Rules |
|-------|-------|
| name | One of: `api`, `web`, `agent` |
| kind | `app` |
| path | `apps/{name}` |
| buildEntry | Must succeed in CI `build` |
| testEntry | Must expose at least one automated test (or suite) for CI `test` |
| envSchema | Required vars documented; validated at startup (fail fast) |

**Relationships**: `api` and `web` may depend on `shared` and (later) `eta-core`.
`agent` is independent this phase (may reference docs only).

### Shared Package

| Field | Rules |
|-------|-------|
| name | One of: `shared`, `eta-core` |
| kind | `package` |
| path | `packages/{name}` |
| exports | `shared`: placeholder types; `eta-core`: stub only (no ETA I/O) |

### Environment Variable

| Field | Rules |
|-------|-------|
| key | Unique SCREAMING_SNAKE name |
| service | `api` \| `web` \| `agent` \| `infra` |
| required | boolean — if true, missing → startup failure |
| secret | boolean — never commit real values |
| example | Placeholder suitable for local/dev |
| purpose | Short description |

**Validation**: At process start, collect all missing required keys and abort
with a single clear error listing them.

### Design Token

| Field | Rules |
|-------|-------|
| category | `color` \| `spacing` \| `typography` |
| name | Stable token id (e.g. `color.background`, `space.md`, `font.sans`) |
| value | CSS-compatible value consumed by Tailwind theme |
| usage | Applied on landing page for both locales |

### Infrastructure Service

| Field | Rules |
|-------|-------|
| name | `postgres` \| `redis` \| `minio` \| `traefik` |
| compose | Defined in `infra/docker-compose.yml` |
| tls | Traefik terminates HTTPS for `api`/`web` routes |
| readinessImpact | Postgres required for API readiness; Redis/MinIO per env flags |

### Health Check Result (runtime, not persisted)

| Field | Rules |
|-------|-------|
| kind | `live` \| `ready` |
| status | `ok` \| `not_ready` |
| checks | Optional map of dependency name → pass/fail (readiness only) |
| httpStatus | live: always 200 if process up; ready: 200 or 503 |

## State Transitions

None for product entities. Process lifecycle only:

```text
missing required env → refuse start
started → live = ok
dependencies reachable → ready = ok
dependency down → ready = not_ready (live still ok)
```

## Out of Scope (explicit)

- Tenant, User, Invoice, Receipt, AuditEvent tables
- RLS policies
- ETA document schemas / serialization models
