# Implementation Plan: Tenant Backup & Restore

**Branch**: `012-tenant-backup-restore` | **Date**: 2026-08-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-tenant-backup-restore/spec.md`
plus technical direction: Backup service (tenant-scoped DB rows + MinIO objects
→ encrypted archive with checksums; store + downloadable link); Restore service
(validate + import into clean/target tenant; integrity checks); Scheduler +
retention; Web backup/restore screen; tests backup → restore into clean env →
data + documents match; cross-tenant access denied.

## Summary

Ship **logical per-tenant backup & restore**: an async **Backup service** builds
an **encrypted archive** (DB extract + object manifest + MinIO files), stores it
under the tenant’s artifact prefix, and exposes authenticated download. A
**Restore service** validates **ownership** + **checksums**, then imports only
into an **empty** target: **TENANT** path requires
`sourceTenantId === targetTenantId` (wipe-then-restore); **OPERATOR** path may
clone cross-identity/environment via staging. **Canonical fidelity gate** =
same-tenant wipe-then-restore with a fixed checklist (3 docs, 2 objects, ≥1
settings row, ETA secret re-encrypt). **Cron schedules** + retention (keep last
**14** scheduled or **30 days**) run via BullMQ. **Portable export** is a
separate ZIP-of-CSV artifact (no secrets). Web **Backup** screen covers
create/schedule/download/export/restore. Desktop agent out of scope.

## Technical Context

**Language/Version**: TypeScript 5.x (NestJS 10 API, Next.js 15 web)

**Primary Dependencies**: NestJS + Prisma + RLS; BullMQ + Redis (backup,
restore, export, schedule-tick, retention); MinIO (`ArtifactStorage`);
libsodium/`SecretsEncryptionService` patterns for archive + secret
re-encryption; archiver/zip + CSV writers; Next.js 15, next-intl, TanStack
Query, Tailwind/shadcn

**Storage**: PostgreSQL — `TenantBackupJob`, `TenantBackupSchedule`,
`TenantRestoreJob`, `TenantDataExportJob` (+ artifact metadata) with FORCE RLS;
Redis — BullMQ queues; MinIO —
`tenants/{tenantId}/artifacts/backups|restores|tenant-exports/...`

**Testing**: Integration — **same-tenant wipe-then-restore** fidelity gate
(fixed checklist: 3 docs, 2 objects + checksums, ≥1 settings, ETA secret
re-encrypt under target key); server-side decrypt asserts A present / B absent
in archive; cross-tenant download/restore **denied**; checksum / non-empty /
wrong-ownership rejected; schedule + retention; web smoke ar/en RTL

**Target Platform**: Existing Compose (Postgres, Redis, MinIO, Traefik); API
workers run backup/restore/export/schedule jobs

**Project Type**: Multi-tenant SaaS (API + web); desktop agent out of scope

**Performance Goals**: Typical small/medium tenant on-demand backup reaches
terminal status within **30 minutes** (SC-001); UI stays responsive (async
jobs); one active backup per tenant at a time

**Constraints**: Distinct backup vs export; platform-managed archive encryption
(ciphertext downloads); secrets only in backups; PIN never in cloud;
TENANT restore `sourceTenantId === targetTenantId` only; OPERATOR for
cross-identity/env; empty-org + checksum gates; cron + retention 14/30d; JWT +
`X-Tenant-Id`; `backup.*` permissions; download-grant TTL post-MVP

**Scale/Scope**: Full-tenant snapshot (not PITR); all tenant-scoped business
tables + tenant MinIO objects; portable CSV ZIP export; Backup UI; agent local
state/PIN out of scope

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Reliability & Audit**: PASS — backup→restore match test + isolation
  tests planned; audit create/download/schedule/export/restore
- **II. Security by Default**: PASS — platform-encrypted archives; secrets
  re-encrypted on restore; never in exports/logs; least-privilege permissions
- **III. Multi-Tenant Isolation**: PASS — FORCE RLS on job tables; MinIO
  tenant prefixes; ownership binding on restore; cross-tenant denial tests
- **IV. Serialization Parity**: PASS — N/A (no signing/serialization changes)
- **V. Runtime ETA Config**: PASS — no ETA URL/schema hardcoding; env secrets
  keys remain per-environment
- **VI. Sandbox-First**: PASS — no new ETA traffic required for backup/restore
  itself; post-restore ETA checks use existing env config
- **VII. UX/i18n**: PASS — Backup screen ar/en + RTL + design system
- **VIII. Phased Full-Stack DoD**: PASS — API + web + tests; agent unchanged
- **Stack**: PASS — within Technology Baseline

## Project Structure

### Documentation (this feature)

```text
specs/012-tenant-backup-restore/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── backup-api.yaml
│   └── permissions.md
└── tasks.md              # /speckit-tasks (not this command)
```

### Source Code (repository root)

```text
apps/api/
├── src/backup/
│   ├── backup.module.ts
│   ├── backup.controller.ts       # jobs, download, schedule, export, restore
│   ├── backup.service.ts          # create/list backup jobs
│   ├── backup-archive.service.ts  # DB extract + MinIO pack + encrypt + checksum
│   ├── backup-restore.service.ts  # validate + import into empty target
│   ├── backup-export.service.ts   # ZIP of CSV (+ optional files); no secrets
│   ├── backup-schedule.service.ts # cron CRUD + due evaluation
│   ├── backup-retention.service.ts
│   ├── empty-org.guard.ts         # operational business-data detector
│   └── backup.processors.ts       # BullMQ workers
├── src/queues/
│   └── queue-names.ts             # + backup, restore, tenant-export, backup-schedule
├── src/crypto/                    # reuse SecretsEncryptionService; archive key
├── prisma/                        # models + RLS
└── test/                          # backup.restore-roundtrip.spec.ts, isolation

apps/web/
├── src/app/[locale]/(app)/backup/
│   ├── page.tsx                   # create/schedule/download/export/restore
│   └── backup.smoke.test.tsx
├── src/lib/api/backup.ts
└── src/messages/{en,ar}.json      # backup.* keys

packages/shared/
└── src/permissions.ts             # backup.create, schedule, download, export, restore
```

**Structure Decision**: New Nest module `backup` owns archive build/store,
restore, portable export, schedule/retention, and HTTP surface. Reuses
`ArtifactStorage` with kinds `backups` / `tenant-exports`. Web route under
`(app)/backup`. No desktop agent changes.

## Complexity Tracking

> No constitution violations. Notes only:

| Note | Why | Simpler Alternative Rejected Because |
|------|-----|--------------------------------------|
| Dedicated `backup` module | Heavy async + encryption + restore isolation | Stuffing into exports/settings couples unrelated domains |
| Platform operator capability (new) | Spec cross-env restore; no operator role exists today | Reusing Owner only cannot restore across environments |
| Separate archive master key | Backup ciphertext ≠ ETA secret box key rotation blast radius | Reusing `SECRETS_MASTER_KEY` alone couples rotations |
| Cron via schedule-tick + cron parser | Spec requires cron; only interval tick exists today | Raw OS crontab per tenant is not multi-tenant safe |
| Distinct CSV ZIP export | Spec FR-010 / clarify — not restore-capable | Single artifact confuses portability vs DR |

## Phase 0 / Phase 1

See [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md).

### Constitution Check (post-design)

Re-validated PASS: contracts require JWT + `X-Tenant-Id` + `backup.*`
permissions; operator restore gated; data model FORCE RLS; MinIO tenant
prefixes; encrypted archive + checksum/ownership gates; TENANT vs OPERATOR
ownership rule; same-tenant wipe-then-restore fidelity gate + content
isolation decrypt asserts; retention 14/30d; portable export strips secrets;
agent out of scope.
