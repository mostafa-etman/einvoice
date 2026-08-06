# Data Model: Tenant Backup & Restore

**Feature**: `012-tenant-backup-restore` | **Date**: 2026-08-01

All new tenant job/schedule tables are **tenant-scoped** with **FORCE RLS**
unless noted. Platform-operator restore may set tenant context to the **target**
tenant for writes.

---

## Enums

### `BackupJobStatus`

`QUEUED` | `RUNNING` | `COMPLETED` | `FAILED` | `EXPIRED`

### `BackupTriggerSource`

`MANUAL` | `SCHEDULE`

### `RestoreJobStatus`

`QUEUED` | `RUNNING` | `COMPLETED` | `FAILED`

### `TenantExportJobStatus`

`QUEUED` | `RUNNING` | `COMPLETED` | `FAILED` | `EXPIRED`

---

## Entities

### `TenantBackupJob`

One backup (encrypted archive) for a tenant.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid | RLS; source org |
| `status` | `BackupJobStatus` | |
| `triggerSource` | `BackupTriggerSource` | |
| `scheduleId` | uuid? | FK when `SCHEDULE` |
| `objectKey` | text? | MinIO key when stored |
| `byteSize` | bigint? | Ciphertext size |
| `checksumSha256` | text? | Hex digest of stored package |
| `schemaVersion` | text | Archive format version stamp |
| `errorCode` | text? | Stable code; no secrets |
| `errorMessage` | text? | Safe user-facing reason |
| `createdByUserId` | uuid? | Null for schedule |
| `startedAt` / `completedAt` | timestamptz? | |
| `expiresAt` | timestamptz? | Retention/TTL |
| `createdAt` / `updatedAt` | timestamptz | |

**Indexes**: `(tenantId, createdAt DESC)`, `(tenantId, status)`,
`(tenantId, triggerSource, createdAt)`

**Rules**:
- At most one `QUEUED`/`RUNNING` backup per `tenantId`.
- `COMPLETED` requires `objectKey` + `checksumSha256` + `byteSize`.
- Scheduled retention may set `EXPIRED` and delete MinIO object.

---

### `TenantBackupSchedule`

Per-tenant cron schedule.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid | RLS; **unique** one active schedule row per tenant (upsert) |
| `cronExpression` | text | 5-field cron |
| `timezone` | text | e.g. `Africa/Cairo` |
| `paused` | boolean | default false |
| `nextRunAt` | timestamptz? | Maintained by tick |
| `lastRunAt` | timestamptz? | |
| `createdByUserId` | uuid? | |
| `createdAt` / `updatedAt` | timestamptz | |

**Rules**: Invalid cron rejected on write. Pause skips enqueue.

---

### `TenantRestoreJob`

Restore of a backup into a target tenant.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid | RLS = **target** tenant |
| `sourceBackupJobId` | uuid | Logical reference (may be cross-env for operators — see notes) |
| `sourceTenantId` | uuid | Ownership binding |
| `sourceChecksumSha256` | text | Expected digest at start |
| `status` | `RestoreJobStatus` | |
| `confirmationToken` | text | One-time / request-bound confirmation id |
| `actorUserId` | uuid | |
| `actorIsPlatformOperator` | boolean | Audit |
| `ownershipCheckPassed` | boolean? | Set during validate |
| `checksumCheckPassed` | boolean? | |
| `emptyOrgCheckPassed` | boolean? | |
| `errorCode` / `errorMessage` | text? | Safe |
| `startedAt` / `completedAt` | timestamptz? | |
| `createdAt` / `updatedAt` | timestamptz | |

**Rules**:
- Never `COMPLETED` unless all three checks passed and import finished.
- Target must remain without operational business data until import begins
  inside a transaction/strategy that rolls back on failure.

**Cross-env note**: When operator restores from an uploaded/imported archive
not already a local `TenantBackupJob`, allow `sourceObjectKey` + metadata
fields instead of FK (optional columns `externalArchiveObjectKey`,
`packageMetaJson`). MVP may require the backup job to exist in the same DB;
cross-env = copy archive into target env first then restore — document in
tasks.

---

### `TenantDataExportJob`

Portable ZIP-of-CSV export (no secrets).

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid | RLS |
| `status` | `TenantExportJobStatus` | |
| `includeFiles` | boolean | Optional documents/files folder |
| `objectKey` | text? | MinIO |
| `byteSize` | bigint? | |
| `errorCode` / `errorMessage` | text? | |
| `createdByUserId` | uuid? | |
| `startedAt` / `completedAt` | timestamptz? | |
| `expiresAt` | timestamptz? | |
| `createdAt` / `updatedAt` | timestamptz | |

---

### `User` (extension)

| Field | Type | Notes |
|-------|------|-------|
| `isPlatformOperator` | boolean | default `false`; not tenant-scoped |

Used only for cross-environment / elevated restore. Not granted via Owner/Admin
role matrix.

---

## Empty-org detector (logical)

Not a table. Service function `assertEmptyOrganization(tenantId)` returns
non-empty if **any** of:

- Documents / document lines / related operational docs
- Purchases / received documents
- Branch operational content beyond empty stubs (product list)
- Settings payloads that count as configured business settings (ETA creds row
  with values, etc. — treat configured ETA as operational)
- Tenant-owned MinIO artifacts under document/import/export kinds that indicate
  business files

**Empty allowed**: org row, memberships, roles bindings, empty branches if
product treats them as shell.

Exact table checklist lives in implementation tasks derived from
`schema.prisma`.

---

## Archive logical layout (not DB)

```text
backup-archive/
  meta.json          # tenantId, schemaVersion, createdAt, checksums
  db/                # table extracts (JSONL or SQL-neutral rows)
  manifest.json      # [{ key, size, sha256, contentType }]
  files/             # object bytes keyed by manifest id
```

Entire tree packed then **encrypted** → stored blob. `meta.json` also carries
digest used for job `checksumSha256` of final ciphertext.

---

## Retention

| Trigger | Policy |
|---------|--------|
| Scheduled backups | Keep last **14** `triggerSource=SCHEDULE` **or** delete/expire those older than **30 days** (apply both limits: whichever removes more first / evaluate both each run) |
| Manual backups | No auto-purge by 14/30 rule; optional TTL via `expiresAt` / manual delete |
| Exports | TTL env (e.g. 7–30 days) then `EXPIRED` + object delete |

---

## Relationships

```text
Tenant 1──* TenantBackupJob
Tenant 1──1 TenantBackupSchedule
TenantBackupSchedule 1──* TenantBackupJob (optional)
Tenant 1──* TenantRestoreJob (as target)
Tenant 1──* TenantDataExportJob
User 1──* jobs (createdBy / actor)
```

---

## RLS

- `tenant_backup_jobs`, `tenant_backup_schedules`, `tenant_restore_jobs`,
  `tenant_data_export_jobs`: ENABLE + FORCE RLS;
  `tenant_id::text = current_setting('app.tenant_id')`.
- `users.is_platform_operator`: not RLS; guarded in application code + audit.
- Workers always `withTenant(targetOrSource)` before reads/writes.
