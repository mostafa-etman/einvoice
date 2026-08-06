# Quickstart: Tenant Backup & Restore

**Feature**: `012-tenant-backup-restore`  
**Purpose**: Validate encrypted backup → restore round-trip, isolation, and
Backup UI after implementation.

## Prerequisites

- Compose stack up (Postgres, Redis, MinIO, API, web)
- Tenant A Owner/Admin; Tenant B with different fixture data (isolation)
- Permissions per [permissions.md](./contracts/permissions.md)
- Env: `BACKUP_ARCHIVE_MASTER_KEY`, `SECRETS_MASTER_KEY` (source = target in
  same-env gate; re-encrypt still must change ciphertext/nonce)
- Contracts: [backup-api.yaml](./contracts/backup-api.yaml)
- Ownership rules: [research.md](./research.md) R4 / R4b

## Fixed fidelity checklist (SC-004 / T042)

| # | Item | Assert after restore |
|---|------|----------------------|
| 1 | Exactly **3** documents | Same ids/core fields as pre-backup fixture |
| 2 | Exactly **2** storage objects | Per-object checksum (and/or bytes) match |
| 3 | ≥ **1** settings/config row | Present and equal |
| 4 | ETA credential | Decrypts under **target** `SECRETS_MASTER_KEY`; ciphertext **and** nonce **differ** from source snapshot |
| 5 | PIN | **Absent** from archive (never cloud-stored) |
| 6 | Plaintext secrets | **Absent** from any export artifact and client-visible logs |

## 1. Canonical fidelity gate — same-tenant wipe-then-restore (required)

**Path**: TENANT restore only (`sourceTenantId === targetTenantId`).  
**Not** A→A′ clone (that is OPERATOR-only and outside this gate).

1. Seed Tenant A with the fixed checklist (3 docs, 2 objects, ≥1 settings,
   ETA ClientId/Secret ciphertext under current env key). Record source
   ciphertext+nonce for ETA secret.
2. Create on-demand backup:

```http
POST /backup/jobs
Authorization: Bearer <tokenA>
X-Tenant-Id: <tenantA>
```

3. Poll until `status=COMPLETED`; note `checksumSha256` and `byteSize`.
4. **Wipe** Tenant A operational business data until empty-org detector passes
   (org shell + membership may remain).
5. Tenant-path restore of **A’s own** backup into **A**:

```http
POST /backup/restores
Authorization: Bearer <tokenA>
X-Tenant-Id: <tenantA>
Content-Type: application/json

{ "backupJobId": "<id>", "confirmation": "RESTORE" }
```

6. Expect restore `COMPLETED`. Assert **every** checklist row above.
7. Automated:

```bash
pnpm --filter api test -- backup.restore-roundtrip
```

## 2. Cross-tenant access denied + package content isolation (required)

1. As Tenant B, `GET /backup/jobs/{idA}/download` → **403/404**.
2. As Tenant B, tenant-path restore using A’s `backupJobId` → **denied**.
3. As Tenant A′ Owner (different `tenantId`, empty), tenant-path restore of A’s
   backup → **ownership rejection** (only operators may clone).
4. **Content isolation (C1)**: In test harness, **open and decrypt** A’s archive
   server-side; assert Tenant A fixture IDs are **present** and Tenant B
   fixture IDs are **ABSENT**. Job `COMPLETED` alone is insufficient.

```bash
pnpm --filter api test -- backup.cross-tenant
```

## 3. Restore safety gates

1. Seed operational data into target → restore → **400** empty-org failure.
2. Tamper checksum → restore → **400** integrity failure; no partial data.
3. Omit `confirmation` → **400**; no job created.

## 4. Schedule + retention

1. `PUT /backup/schedule` with daily cron; verify `nextRunAt`.
2. Force schedule tick / due run → new `triggerSource=SCHEDULE` job.
3. Create >14 scheduled completions or age past 30d in test clock → older
   scheduled jobs `EXPIRED` / objects removed; manual backups retained.

## 5. Portable export (no secrets)

```http
POST /backup/exports
Authorization: Bearer <tokenA>
X-Tenant-Id: <tenantA>
Content-Type: application/json

{ "includeFiles": true }
```

Download ZIP → CSV tables present; **no** ClientId/Secret/token/PIN material;
cannot be passed to restore endpoints successfully.

## 6. Web Backup screen

1. Open `/en/backup` and `/ar/backup` (RTL).
2. Create backup → status updates → download.
3. Configure schedule; start export; restore wizard shows confirmation + empty
   / wipe guidance for same-tenant DR.
4. User without `backup.*` → actions denied / hidden.

```bash
pnpm --filter web test -- backup.smoke
```

## Expected outcomes

| Check | Result |
|-------|--------|
| Fidelity gate (wipe-then-restore) | Fixed checklist all match; secrets re-encrypted |
| Cross-tenant download/restore | Denied |
| Package decrypt isolation | A present, B absent |
| Non-empty / bad checksum / wrong ownership | Rejected, no partial apply |
| Export | ZIP/CSV, no secrets/PIN |
| Schedule + retention | Cron fires; 14/30d policy enforced |
| i18n | ar/en Backup screen usable |
