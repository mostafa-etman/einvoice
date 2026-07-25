# Quickstart Validation: Multi-Tenant Core & Authentication

**Feature**: `002-multi-tenant-auth` | **Date**: 2026-07-20

Prerequisites: foundation stack running (Compose Postgres, `api`, `web`, TLS as
in `001-project-foundation` quickstart). Contracts:
[auth-api.yaml](./contracts/auth-api.yaml),
[tenant-admin-api.yaml](./contracts/tenant-admin-api.yaml),
[permissions.md](./contracts/permissions.md).

## DB roles

- **Migrations**: `MIGRATE_DATABASE_URL` → `einvoice` (admin / may bypass RLS)
- **App + tests**: `DATABASE_URL` → `einvoice_app` (**NOSUPERUSER**, **NOBYPASSRLS**)

Create the app role (once per database):

```bash
# from repo root, with Compose Postgres up
docker exec -i infra-postgres-1 psql -U einvoice -d einvoice < infra/postgres/init/01-app-role.sql
```

## 1. Migrate

```bash
pnpm --filter @einvoice/api prisma:migrate
```

**Expect**: Tables + RLS policies applied.

## 2. Register & onboard

1. Open `http://localhost:3000/ar/register` (Arabic default / RTL)
2. Register email/password → create tenant name
3. Land in app shell with sidebar/topbar

**Expect**: Owner role; default branch; refresh cookie httpOnly on API host.

## 3. Session refresh

```bash
pnpm --filter @einvoice/api test -- auth.e2e
```

**Expect**: Refresh rotates cookie; reused old refresh returns 401.

## 4. Isolation proof

```bash
pnpm --filter @einvoice/api test -- tenant-isolation
```

**Expect**: Integration test creates tenants A/B; A context cannot read B data.
Requires `DATABASE_URL` as `einvoice_app` (superuser bypasses RLS even with FORCE).

## 5. RBAC

1. As Owner, open Users & Roles screens
2. Assign Viewer to a second user
3. As Viewer, confirm members.manage actions are denied

```bash
pnpm --filter @einvoice/api test -- rbac
```

## 6. i18n & switchers

1. Default shell is Arabic RTL
2. Switch to English → LTR
3. If two tenants, switch tenant via switcher; branch switcher updates context

## Timing (SC-001)

Happy path register → tenant → shell under 5 minutes for a new user.
