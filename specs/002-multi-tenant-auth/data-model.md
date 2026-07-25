# Data Model: Multi-Tenant Core & Authentication

**Feature**: `002-multi-tenant-auth` | **Date**: 2026-07-20

## Conventions

- IDs: UUID primary keys
- Tenant-scoped tables include `tenant_id` (UUID, indexed) + RLS
- Global tables: `User`, `Permission` (catalog), optionally `RefreshSession`
  (user-scoped, not tenant RLS)
- Timestamps: `created_at`, `updated_at` where relevant

## Entities

### User (global)

| Field | Type | Rules |
|-------|------|-------|
| id | uuid | PK |
| email | string | unique, normalized lowercase |
| password_hash | string | argon2id; never expose in API |
| name | string | optional display name |
| created_at | datetime | |

### Tenant (global registry; row itself may be readable by members via app)

| Field | Type | Rules |
|-------|------|-------|
| id | uuid | PK |
| name | string | required |
| created_at | datetime | |

Note: Listing “my tenants” is membership-driven, not open tenant table scan.

### Branch (tenant-scoped, RLS)

| Field | Type | Rules |
|-------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | FK Tenant, RLS |
| name | string | required |
| is_default | bool | one default per tenant preferred |
| created_at | datetime | |

### Permission (global catalog)

| Field | Type | Rules |
|-------|------|-------|
| id | uuid | PK |
| code | string | unique (e.g. `members.manage`) |
| description | string | |

### Role (tenant-scoped, RLS)

| Field | Type | Rules |
|-------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | RLS |
| name | string | Owner / Admin / Accountant / Viewer (+ future) |
| is_system | bool | seeded roles protected from delete |
| created_at | datetime | |

### RolePermission (tenant-scoped via role, RLS)

| Field | Type | Rules |
|-------|------|-------|
| role_id | uuid | FK Role |
| permission_id | uuid | FK Permission |
| PK | (role_id, permission_id) | |

### Membership (tenant-scoped, RLS)

| Field | Type | Rules |
|-------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | RLS |
| user_id | uuid | FK User |
| role_id | uuid | FK Role (same tenant) |
| created_at | datetime | |
| Unique | (tenant_id, user_id) | one membership per user per tenant |

### RefreshSession (user-scoped, not tenant RLS)

| Field | Type | Rules |
|-------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK User |
| token_hash | string | hash of opaque refresh token |
| expires_at | datetime | |
| revoked_at | datetime | nullable |
| replaced_by_id | uuid | nullable FK self (rotation chain) |
| created_at | datetime | |

### AuditLog (tenant-scoped when tenant known; RLS when tenant_id set)

| Field | Type | Rules |
|-------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | nullable for pure auth failures pre-tenant |
| actor_user_id | uuid | nullable |
| action | string | e.g. `auth.login.success` |
| resource_type | string | optional |
| resource_id | string | optional |
| outcome | string | `success` / `failure` |
| metadata | json | non-secret context |
| created_at | datetime | append-only (no update/delete APIs) |

## RLS Policy Pattern

For each tenant-scoped table `T`:

```sql
ALTER TABLE T ENABLE ROW LEVEL SECURITY;
ALTER TABLE T FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON T
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
```

Application MUST `SET LOCAL app.tenant_id = '<tenant uuid>'` inside the same
transaction as queries. Empty/missing setting yields no rows / check failures.

Migrations and privileged seed jobs use a bypass role or `SET LOCAL` explicitly
in controlled scripts (documented; not exposed to request path).

## Relationships

```text
User 1──* Membership *──1 Tenant
Membership *──1 Role
Role *──* Permission (via RolePermission)
Tenant 1──* Branch
Tenant 1──* Role
User 1──* RefreshSession
User 1──* AuditLog (actor)
Tenant 1──* AuditLog
```

## State / lifecycle

- **RefreshSession**: active → rotated (revoked + replaced_by) → expired/revoked
- **Membership**: created → role changed → removed (soft or hard delete)
- **Role**: system seeded immutable name; non-system optional later

## Seed on tenant create

1. Insert Tenant  
2. Insert default Branch (`is_default=true`)  
3. Insert Roles Owner, Admin, Accountant, Viewer + RolePermissions per matrix  
4. Insert Membership (creator → Owner)
