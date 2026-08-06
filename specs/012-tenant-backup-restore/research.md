# Research: Tenant Backup & Restore

**Feature**: `012-tenant-backup-restore` | **Date**: 2026-08-01

Resolves Technical Context choices from the clarified spec and user plan:
encrypted archive backup, restore with ownership/checksum gates, cron +
retention, Backup UI, round-trip tests.

---

## R1 — Backup artifact shape

**Decision**: Backup = **platform-encrypted archive** containing:

1. **DB extract** — tenant-scoped rows needed to reconstitute the org
   (documents, purchases, settings, memberships/roles as product allows,
   encrypted ETA credentials ciphertext+nonce columns, etc.)
2. **Object manifest** — list of MinIO objects (key, size, contentType,
   per-object checksum)
3. **Files** — bytes for each manifested object
4. **Package metadata** — source `tenantId`, createdAt, schema/version stamp,
   **archive checksum** (hash of ciphertext or canonical package digest)

Stored at `tenants/{tenantId}/artifacts/backups/{jobId}/archive.bin` (exact
filename flexible) via existing `ArtifactStorage` with kind `backups`.

**Rationale**: Matches clarify (encrypted archive = DB extract + manifest +
files) and reuses MinIO key layout from exports/analytics.

**Alternatives considered**: Raw `pg_dump` filtered by tenant (fragile with
RLS/FKs); DB-only without files (incomplete restore); client-side zip of
JSON (secrets exposure, no server integrity).

---

## R2 — Archive encryption & checksums

**Decision**:

- Encrypt the packed archive with a **platform-managed** key
  (`BACKUP_ARCHIVE_MASTER_KEY`, 32-byte, distinct from `SECRETS_MASTER_KEY`).
- Prefer libsodium **secretstream** or equivalent AEAD; store nonce/header
  alongside ciphertext in MinIO or package header.
- Compute **SHA-256** (or stronger) **integrity checksum** over the stored
  ciphertext (+ header) and persist on `TenantBackupJob.checksumSha256`.
- Downloads stream ciphertext only; **decrypt only** inside authorized
  server-side restore.
- Tenant ETA secrets inside DB extract remain in their **ciphertext+nonce**
  form; on restore, **decrypt with source env key then re-encrypt with target
  env `SECRETS_MASTER_KEY`**.

**Rationale**: Spec clarify — platform-managed keys; secrets encrypted at rest;
re-encrypt per environment on restore.

**Alternatives considered**: Tenant passphrase (higher UX friction); single
shared master key for all secret types (worse rotation blast radius).

---

## R3 — Tenant table inventory for DB extract

**Decision**: Maintain an explicit **include list** of Prisma models / tables
that are tenant-scoped and required for reconstitution (documented in
implementation tasks from `schema.prisma`). Exclude: other tenants’ rows,
global catalogs (`permissions`, `currencies`, …), audit logs of other tenants,
and non-tenant platform tables. Include tenant audit slice only if product
requires (default: **exclude** historical audit from backup MVP to reduce size;
document as assumption — restore creates new audit for restore action itself).

**Rationale**: Logical backup must be deterministic and testable; exclude list
prevents accidental global leakage.

**Alternatives considered**: Reflect all tables with `tenant_id` automatically
(risk of including experimental tables); include full audit history (large,
often unnecessary for DR of operational data).

---

## R4 — Restore gates & ownership

**Decision**: Before mutating target:

1. Actor authorized (`backup.restore` on TENANT path, or `isPlatformOperator`
   on OPERATOR path)
2. Artifact is a **backup** (not export)
3. **Checksum** matches stored digest
4. **Ownership binding** (canonical rule):

| Path | Actor | Allowed when | Empty org | RLS |
|------|-------|--------------|-----------|-----|
| **TENANT** | Owner/Admin | `sourceTenantId === targetTenantId` only | Yes (wipe operational data) | Natural — same tenant context |
| **OPERATOR** | Platform operator | Cross-identity / cross-env / clone into **new** empty `tenantId` | Yes | Staging path **above** normal tenant RLS |

5. **Empty org**: no operational business data (shell + membership OK)
6. Explicit **confirmation**

On failure: abort with no partial apply. Status never `COMPLETED` on partial
failure.

**Tenant actors MUST NOT** restore org A’s backup into org A′ (`tenantId`
differs) via `POST /backup/restores`.

**Rationale**: Resolves analyze I1 — backups are RLS-scoped to source; self-service
DR stays same-identity; clone/cross-env is operator-only.

**Alternatives considered**: Allow any empty org under caller membership
(breaks RLS / enables cross-tenant restore); force-flag overwrite (rejected).

---

## R4b — Canonical fidelity-gate path

**Decision**: **Same-tenant wipe-then-restore** is the **only** path for
blocking gate T042 / SC-004:

1. Seed Tenant A with fixed checklist fixture
2. Create backup (COMPLETED + checksum)
3. Wipe A’s operational business data → empty
4. Tenant-path restore of A’s own backup into A (`sourceTenantId === targetTenantId`)
5. Assert fixed checklist + secret re-encryption

Operator-staged A→A′ clone may have a separate non-blocking test later; it is
**not** the equality gate.

**Rationale**: Unambiguous, RLS-natural, matches primary product DR.

**Alternatives considered**: Operator-staged A→A′ as gate (valid clone proof but
conflates operator path with self-service fidelity).

---

## R5 — Platform operator (greenfield)

**Decision**: Introduce `User.isPlatformOperator` (boolean, default false) for
**OPERATOR** restore (cross-identity / cross-environment / clone into new empty
org) via staging APIs that load archive bytes outside the target’s normal
backup-job RLS. Tenant Owner/Admin never get this flag via role matrix.
Operator endpoints still require confirmation, checksum, empty-org, and audit.
Seed/ops sets the flag out-of-band.

**Rationale**: Spec requires platform operators; no super-admin today.

**Alternatives considered**: Platform tenant membership; shared service account
without user audit.

---

## R6 — Scheduling (cron) + retention

**Decision**:

- `TenantBackupSchedule` stores a **cron expression** (5-field), timezone
  (default Africa/Cairo or tenant timezone if present), `paused`, and links to
  tenant.
- UI offers **presets** (daily/weekly) that write cron strings; advanced may
  edit expression (planning detail).
- **BullMQ** `backup-schedule` tick (e.g. every 60s) loads due schedules via
  cron parser (`cron-parser` or equivalent), enqueues backup jobs with
  `triggerSource=SCHEDULE`.
- **Retention**: after each successful scheduled backup (and on periodic
  retention job), delete/expire scheduled backups beyond **keep last 14** or
  older than **30 days** (whichever limit applies first). On-demand backups
  excluded from this auto-purge (manual delete only unless separately expired).

**Rationale**: Spec cron + retention clarify; existing pattern is interval
`upsertJobScheduler` (usage-rollup).

**Alternatives considered**: One BullMQ repeatable job per tenant (scheduler
churn); OS crontab (not multi-tenant).

---

## R7 — Portable export vs backup

**Decision**: Separate job type `TenantDataExportJob` producing **ZIP of CSV
tables** (+ optional `files/` when requested). **Strip** all secret columns
(ETA ClientId/Secret ciphertext, tokens, wrapped credentials). Not accepted by
restore. MinIO kind `tenant-exports`.

**Rationale**: Spec FR-010 / clarify Q1+Q4.

**Alternatives considered**: Same archive dual-labeled (rejected); XLSX-only
(less portable for large tables).

---

## R8 — Concurrency & job lifecycle

**Decision**: Status enum aligned with exports: `QUEUED` | `RUNNING` |
`COMPLETED` | `FAILED` (alias READY→COMPLETED for backups) | `EXPIRED`. At most
**one** active (`QUEUED`/`RUNNING`) backup per tenant; additional create
requests → `409` or queue-behind policy (**prefer 409** for clarity). Restore /
export similarly one active per tenant each.

**Rationale**: Spec FR-017; matches export UX mental model.

**Alternatives considered**: Unlimited parallel backups (I/O contention, messy
snapshots).

---

## R9 — Download grants

**Decision**: **MVP** — authenticated `GET .../download` after permission check
(stream ciphertext). **Post-MVP** — optional short-lived download grants +
expiry denial tests. Artifact TTL for stored packages via env
(`BACKUP_ARTIFACT_TTL_DAYS`).

**Rationale**: Analyze I2 — defer grant TTL to reduce gate scope; isolation
still enforced by permission + RLS + cross-tenant tests.

**Alternatives considered**: Presigned MinIO URLs; MVP short-lived grants
(acceptable later).

---

## R10 — Web Backup screen

**Decision**: Route `/{locale}/backup` under app shell: list jobs, create
backup, schedule form (presets→cron), download, export (CSV ZIP options),
restore wizard (confirm + empty-org messaging; tenant path =
wipe-then-restore same org). Permissions hide unauthorized actions. ar/en +
RTL.

**Rationale**: Spec User Story 6; matches analytics/sync page pattern.

**Alternatives considered**: Settings sub-tab only (discoverability worse).

---

## R11 — Acceptance tests (fidelity + isolation)

**Decision**:

1. **Blocking fidelity (T042)**: same-tenant wipe-then-restore; fixed checklist
   — **3** documents, **2** MinIO objects (per-object checksum), ≥**1**
   settings/config row, ETA credential decrypts under **target**
   `SECRETS_MASTER_KEY` with ciphertext/nonce **≠** source; PIN absent from
   archive; plaintext secrets absent from exports/logs.
2. **Content isolation (T019/T043)**: server-side **open + decrypt** archive;
   assert Tenant A fixture IDs **present**, Tenant B fixture IDs **absent**
   (job COMPLETED alone insufficient).
3. **Cross-tenant denial**: B cannot download or tenant-restore A’s backup;
   tenant-path restore A→A′ rejected on ownership.
4. Non-empty / bad checksum / no confirmation rejected.

**Rationale**: Analyze I1/C1/U1/U2 + user plan.

**Alternatives considered**: Narrative “spot-check” only (rejected).
