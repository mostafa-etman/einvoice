---
description: "Task list for tenant backup & restore"
---

# Tasks: Tenant Backup & Restore

**Input**: Design documents from `/specs/012-tenant-backup-restore/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/,
quickstart.md; features **002** (RBAC), **003** (settings/secrets), storage
(`ArtifactStorage`), export job patterns (**009** / analytics export)

**Tests**: MANDATORY. Explicit gates from user / plan / quickstart:

1. **BLOCKING GATE — Backup→restore equality (same-tenant wipe-then-restore)** —
   Seed Tenant A with **fixed checklist** (exactly **3** documents, **2**
   storage objects with per-object checksums, ≥**1** settings/config row, ETA
   credential ciphertext) → backup → **wipe** A’s operational data → tenant
   restore into **same** `tenantId` (`sourceTenantId === targetTenantId`) →
   assert checklist equality **and** ETA secret decrypts under **target**
   `SECRETS_MASTER_KEY` with ciphertext/nonce **≠** source; PIN absent from
   archive; plaintext secrets absent from exports/logs. **Not** A→A′ clone.
   Feature MUST NOT proceed past Phase 6 while this fails.
   File: `apps/api/test/backup.restore-roundtrip.spec.ts` (SC-004 / quickstart §1).
2. **Package content isolation (SC-002)** — Server-side **open + decrypt** of
   A’s archive MUST assert A fixture IDs **present** and B fixture IDs
   **ABSENT** (T019 + T043). Job COMPLETED alone is insufficient.
3. **Cross-tenant denial** — Tenant B cannot download or tenant-restore A’s
   backup; tenant-path A→A′ ownership rejected (SC-003 / quickstart §2).
4. **Safety gates** — Non-empty target rejected; checksum mismatch rejected; no
   confirmation → no job (FR-008/021/023).
5. **Export hygiene** — Portable ZIP/CSV contains **no secrets/PIN**; not
   accepted by restore (FR-010/014).
6. **Schedule + retention** — Cron due run creates job; keep last **14**
   scheduled **or** **30 days** enforced (FR-005/006).
7. **Permissions** — Missing `backup.*` → 403; operator restore requires
   `isPlatformOperator`.
8. **Regression** — No desktop agent / ETA serialization changes.

**Out of scope** (do not task): PITR; overwrite restore of populated tenants;
agent-local PIN/certs in cloud backup; raw `pg_dump` of whole platform;
presigned MinIO URLs; MVP short-lived download-grant TTL (post-MVP / I2).

**Organization**: Phases by user story. **Phase 6 is a hard blocking gate.**
Backend + Frontend before claiming story Done. Agent N/A.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable (different files, no incomplete deps)
- **[Story]**: [US1]…[US6] for story phases only
- Exact file paths required

## Path Conventions

- **API**: `apps/api/`
- **Web**: `apps/web/`
- **Shared**: `packages/shared/`
- **Contracts**: `specs/012-tenant-backup-restore/contracts/`
- **Infra**: `apps/api/.env.example`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Module shells, deps, env, i18n keys, permission codes, queues

- [X] T001 Add `BACKUP_CREATE`, `BACKUP_SCHEDULE`, `BACKUP_DOWNLOAD`,
      `BACKUP_EXPORT`, `BACKUP_RESTORE` to `packages/shared/src/permissions.ts`
      and Owner/Admin matrix per
      `specs/012-tenant-backup-restore/contracts/permissions.md`
- [X] T002 [P] Add backup env keys to `apps/api/.env.example` and
      `apps/api/src/config/env.ts` (`BACKUP_ARCHIVE_MASTER_KEY`,
      `BACKUP_ARTIFACT_TTL_DAYS`, schedule tick interval, retention constants)
- [X] T003 [P] Add `backup.*` copy keys to `apps/web/src/messages/en.json` and
      `apps/web/src/messages/ar.json`
- [X] T004 [P] Scaffold Nest `BackupModule` shell and register in
      `apps/api/src/app.module.ts` → `apps/api/src/backup/backup.module.ts`
- [X] T005 [P] Add web API client stubs `apps/web/src/lib/api/backup.ts` per
      `contracts/backup-api.yaml`
- [X] T006 [P] Register BullMQ queue names `backup`, `restore`,
      `tenant-export`, `backup-schedule` in
      `apps/api/src/queues/queue-names.ts` and wire in
      `apps/api/src/queues/queues.module.ts`
- [X] T007 [P] Add Backup nav entry (permission-gated) in
      `apps/web/src/components/shell/app-shell.tsx`
- [X] T008 [P] Scaffold empty Backup page route
      `apps/web/src/app/[locale]/(app)/backup/page.tsx` (ar/en layout shell)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema + RLS, archive crypto helpers, empty-org detector, audit
hooks — **BLOCKS all user stories**

**WARNING**: No story implementation until T009–T018 are green.

- [X] T009 Add Prisma models `TenantBackupJob`, `TenantBackupSchedule`,
      `TenantRestoreJob`, `TenantDataExportJob` (+ enums) and
      `User.isPlatformOperator` in `apps/api/prisma/schema.prisma` per
      `data-model.md`
- [X] T010 Create migration + FORCE RLS policies for backup tables in
      `apps/api/prisma/migrations/` and `apps/api/prisma/rls.sql`
- [X] T011 Implement platform archive encrypt/decrypt + SHA-256 checksum helpers
      in `apps/api/src/backup/backup-crypto.ts` (use
      `BACKUP_ARCHIVE_MASTER_KEY`; distinct from `SECRETS_MASTER_KEY`)
- [X] T012 [P] Implement `assertEmptyOrganization` / empty-org detector in
      `apps/api/src/backup/empty-org.guard.ts` (operational business data vs
      shell+membership per spec clarify)
- [X] T013 [P] Document + code tenant table **include list** for DB extract in
      `apps/api/src/backup/backup-table-inventory.ts` (from `schema.prisma`;
      exclude global catalogs)
- [X] T014 [P] Unit tests for crypto round-trip + checksum mismatch detection in
      `apps/api/src/backup/backup-crypto.spec.ts`
- [X] T015 [P] Unit tests for empty-org detector fixtures in
      `apps/api/src/backup/empty-org.guard.spec.ts`
- [X] T016 [P] Wire permission decorator usage helpers for `backup.*` in
      `apps/api/src/backup/` (follow existing `@RequirePermissions` pattern)
- [X] T017 [P] Extend `ArtifactStorage` kind usage for `backups` and
      `tenant-exports` (reuse `tenantArtifactKey`) in
      `apps/api/src/storage/minio-artifact.store.ts` if kind union needs update
- [X] T018 Define audit action names for backup create/download/schedule/export/
      restore in audit helpers used by `apps/api/src/backup/` (actor, tenant,
      outcome; no secrets in payloads)

**Checkpoint**: Foundation ready — schema/RLS/crypto/empty-org/inventory in place

---

## Phase 3: User Story 1 - Create on-demand tenant backup (Priority: P1) 🎯 MVP

**Goal**: Authorized user starts async backup; job builds encrypted archive
(DB extract + object manifest + files) and reaches COMPLETED/FAILED.

**Independent Test**: Create backup for Tenant A with known data/files; job
completes with checksum; server-side decrypt proves A fixtures present and B
fixtures absent.

### Tests for User Story 1 (REQUIRED)

- [X] T019 [P] [US1] Integration test: create backup → COMPLETED with
      `objectKey` + `checksumSha256`; **open and decrypt** archive server-side;
      assert Tenant A fixture IDs **present** and Tenant B fixture IDs
      **ABSENT** in `apps/api/test/backup.create.spec.ts` (SC-002; job
      COMPLETED alone insufficient)
- [X] T020 [P] [US1] Integration test: concurrent second backup → 409 in
      `apps/api/test/backup.concurrency.spec.ts`
- [X] T021 [P] [US1] Permission test: missing `backup.create` → 403 in
      `apps/api/test/backup.permissions.spec.ts`

### Implementation for User Story 1

- [X] T022 [US1] Implement DB extract + MinIO manifest/file pack + encrypt +
      store in `apps/api/src/backup/backup-archive.service.ts`
- [X] T023 [US1] Implement create/list/get backup jobs + enqueue in
      `apps/api/src/backup/backup.service.ts`
- [X] T024 [US1] Implement BullMQ backup processor in
      `apps/api/src/backup/backup.processors.ts`
- [X] T025 [US1] Add `POST/GET /backup/jobs` (+ get by id) in
      `apps/api/src/backup/backup.controller.ts` per `contracts/backup-api.yaml`
- [X] T026 [US1] Audit backup create start/outcome from
      `apps/api/src/backup/backup.service.ts`
- [X] T027 [US1] Wire web client create/list in
      `apps/web/src/lib/api/backup.ts` and show job status list on
      `apps/web/src/app/[locale]/(app)/backup/page.tsx`

**Checkpoint**: On-demand backup works end-to-end (API + minimal UI status)

---

## Phase 4: User Story 2 - Secure download (Priority: P1)

**Goal**: Authenticated, permissioned download of completed ciphertext archive;
cross-tenant denied.

**Independent Test**: Download as Owner of A succeeds; B denied; non-COMPLETED
rejected.

### Tests for User Story 2 (REQUIRED)

- [X] T028 [P] [US2] Integration test: download COMPLETED backup streams bytes in
      `apps/api/test/backup.download.spec.ts`
- [X] T029 [P] [US2] Integration test: cross-tenant download denied in
      `apps/api/test/backup.download-isolation.spec.ts`

### Implementation for User Story 2

- [X] T030 [US2] Implement authenticated stream download via `getByKey` in
      `apps/api/src/backup/backup.controller.ts` (`GET .../download`)
- [X] T031 [US2] Audit download attempts (success/deny) in
      `apps/api/src/backup/backup.service.ts`
- [X] T032 [US2] Add Download action on Backup page using
      `apps/web/src/lib/api/backup.ts` →
      `apps/web/src/app/[locale]/(app)/backup/page.tsx`

**Checkpoint**: Secure download + isolation verified

---

## Phase 5: User Story 4 - Restore into empty target (Priority: P1)

**Goal**: Restore encrypted backup after confirmation, ownership
(`sourceTenantId === targetTenantId` for TENANT path), checksum, and empty-org
checks; OPERATOR path for cross-identity/env clone; secrets re-encrypted for
target env.

**Independent Test**: Same-tenant wipe-then-restore structurally succeeds;
non-empty / bad checksum / no confirmation / cross-tenantId tenant-path
rejected. (**Full equality + secret re-encrypt asserted in Phase 6 gate.**)

### Tests for User Story 4 (REQUIRED)

- [X] T033 [P] [US4] Integration test: restore rejected for non-empty org in
      `apps/api/test/backup.restore-empty-org.spec.ts`
- [X] T034 [P] [US4] Integration test: checksum mismatch rejected with no partial
      apply in `apps/api/test/backup.restore-checksum.spec.ts`
- [X] T035 [P] [US4] Integration test: missing confirmation → 400 in
      `apps/api/test/backup.restore-confirm.spec.ts`
- [X] T036 [P] [US4] Integration test: non-operator denied on
      `POST /backup/operator/restores`; tenant-path restore with
      `sourceTenantId !== targetTenantId` rejected in
      `apps/api/test/backup.operator-restore.spec.ts`

### Implementation for User Story 4

- [X] T037 [US4] Implement validate + decrypt + import + secret re-encrypt in
      `apps/api/src/backup/backup-restore.service.ts`
- [X] T038 [US4] Implement restore job create/status + BullMQ restore worker in
      `apps/api/src/backup/backup.service.ts` and
      `apps/api/src/backup/backup.processors.ts`
- [X] T039 [US4] Add `POST /backup/restores` and
      `POST /backup/operator/restores` in
      `apps/api/src/backup/backup.controller.ts` per contract
- [X] T040 [US4] Audit restore confirmation/start/outcome (include check flags)
      in `apps/api/src/backup/backup-restore.service.ts`
- [X] T041 [US4] Add restore confirm UI (danger) on
      `apps/web/src/app/[locale]/(app)/backup/page.tsx` via
      `apps/web/src/lib/api/backup.ts`

**Checkpoint**: Restore API safe; ready for equality gate

---

## Phase 6: BLOCKING GATE — Backup→restore equality ⛔

**Purpose**: Prove DR fidelity on the **canonical path** before schedule/export
polish or feature Done.

**Canonical path (ONLY)**: **Same-tenant wipe-then-restore** —
`sourceTenantId === targetTenantId`. Operator A→A′ clone is **out of this
gate**.

**WARNING**: **HARD STOP.** Do not start Phase 7+ (US3/US5) or claim feature
Done until T042–T044 are **green in CI**. If any fail, fix restore/archive
before continuing.

- [X] T042 Write **blocking** integration test in
      `apps/api/test/backup.restore-roundtrip.spec.ts`: seed Tenant A with
      fixed checklist (**3** documents, **2** MinIO objects + per-object
      checksums, ≥**1** settings/config row, ETA credential ciphertext+nonce
      snapshot) → backup → wipe A operational data → tenant restore into A →
      assert each checklist item matches; assert ETA secret **decrypts** under
      target `SECRETS_MASTER_KEY` and ciphertext **and** nonce **differ** from
      source; assert PIN **absent** from archive; assert plaintext secrets
      **absent** from export artifacts and client-visible logs (quickstart §1)
- [X] T043 [P] Gate suite in `apps/api/test/backup.cross-tenant.spec.ts`: (a)
      Tenant B cannot download or tenant-restore A’s backup; (b) tenant-path
      restore into different `tenantId` (A′) rejected on ownership; (c)
      **open + decrypt** A’s archive server-side — A fixture IDs **present**, B
      fixture IDs **ABSENT** (SC-002; complements T019)
- [X] T044 Run and **require pass**:
      `pnpm --filter api test -- backup.restore-roundtrip` and
      `backup.cross-tenant`; keep
      `specs/012-tenant-backup-restore/quickstart.md` aligned; fail the
      pipeline if red

**Checkpoint**: Equality + isolation gates green — only then continue

---

## Phase 7: User Story 6 - Backup screen (Priority: P1)

**Goal**: Cohesive Backup UI for create/schedule/download/export/restore;
ar/en + RTL; clear backup vs export.

**Independent Test**: Smoke test covers primary actions; unauthorized hidden;
Arabic RTL.

**Depends on**: Phase 6 gate green (full restore UX may ship only after gate).

### Tests for User Story 6 (REQUIRED)

- [ ] T045 [P] [US6] Web smoke test create→status→download (+ restore confirm
      affordance) in
      `apps/web/src/app/[locale]/(app)/backup/backup.smoke.test.tsx`

### Implementation for User Story 6

- [ ] T046 [US6] Complete Backup page UX (job table, actions, empty/error
      states, backup vs export labels) in
      `apps/web/src/app/[locale]/(app)/backup/page.tsx`
- [ ] T047 [P] [US6] Ensure ar/en strings + RTL layout for all backup UI in
      `apps/web/src/messages/en.json` and `apps/web/src/messages/ar.json`
- [ ] T048 [US6] Permission-gated action visibility on Backup page (hide/disable
      without `backup.*`)

**Checkpoint**: P1 UI complete on top of gated restore

---

## Phase 8: User Story 3 - Schedule + retention (Priority: P2)

**Goal**: Cron-based schedule with presets; retention keep last 14 or 30 days.

**Independent Test**: Due cron enqueues scheduled backup; retention expires
excess scheduled jobs only.

**Depends on**: Phase 6 gate green.

### Tests for User Story 3 (REQUIRED)

- [ ] T049 [P] [US3] Integration test: schedule upsert + due tick creates
      `SCHEDULE` backup in `apps/api/test/backup.schedule.spec.ts`
- [ ] T050 [P] [US3] Integration test: retention keeps last 14 / 30d policy in
      `apps/api/test/backup.retention.spec.ts`

### Implementation for User Story 3

- [ ] T051 [US3] Implement schedule CRUD + cron validation + `nextRunAt` in
      `apps/api/src/backup/backup-schedule.service.ts`
- [ ] T052 [US3] Implement schedule tick worker (BullMQ) evaluating due crons in
      `apps/api/src/backup/backup.processors.ts`
- [ ] T053 [US3] Implement retention purge/expire in
      `apps/api/src/backup/backup-retention.service.ts`
- [ ] T054 [US3] Add `GET/PUT /backup/schedule` in
      `apps/api/src/backup/backup.controller.ts`
- [ ] T055 [US3] Schedule form (daily/weekly presets → cron) on
      `apps/web/src/app/[locale]/(app)/backup/page.tsx`
- [ ] T056 [US3] Audit schedule changes from
      `apps/api/src/backup/backup-schedule.service.ts`

**Checkpoint**: Cron + retention working

---

## Phase 9: User Story 5 - Portable export (Priority: P2)

**Goal**: ZIP of CSV tables (+ optional files); no secrets; distinct from
backup; not restorable.

**Independent Test**: Export completes; ZIP has CSVs; secrets absent; restore
rejects export artifact.

**Depends on**: Phase 6 gate green.

### Tests for User Story 5 (REQUIRED)

- [ ] T057 [P] [US5] Integration test: export ZIP has CSV tables and strips
      secrets in `apps/api/test/backup.export.spec.ts`
- [ ] T058 [P] [US5] Integration test: restore rejects non-backup/export
      artifact in `apps/api/test/backup.export-not-restorable.spec.ts`

### Implementation for User Story 5

- [ ] T059 [US5] Implement CSV ZIP builder (optional files folder) in
      `apps/api/src/backup/backup-export.service.ts`
- [ ] T060 [US5] Implement export job + processor +
      `POST/GET /backup/exports` + download in
      `apps/api/src/backup/backup.controller.ts` /
      `apps/api/src/backup/backup.processors.ts`
- [ ] T061 [US5] Export UI (includeFiles toggle + download) on
      `apps/web/src/app/[locale]/(app)/backup/page.tsx`
- [ ] T062 [US5] Audit export create/download in
      `apps/api/src/backup/backup-export.service.ts`

**Checkpoint**: Portable export distinct and secret-free

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Quickstart alignment, hardening, DoD — **only after Phase 6 gate**

- [ ] T063 [P] Align `specs/012-tenant-backup-restore/quickstart.md` commands
      with final test names
- [ ] T064 [P] Security review pass: no secrets in logs/errorMessage; ciphertext
      downloads only; RLS on all backup tables
- [ ] T065 Confirm one-active-backup-per-tenant and restore atomicity edge cases
      covered in `apps/api/test/`
- [ ] T066 [P] Add/adjust CI job filter or docs so
      `backup.restore-roundtrip` is required on PRs touching `apps/api/src/backup/`
- [ ] T067 Definition of Done review vs constitution (audit, RLS, i18n, full-stack
      tests); agent unchanged

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → stories
- **US1 (Phase 3)** → **US2 (Phase 4)** → **US4 (Phase 5)** → **Phase 6 GATE**
- **Phase 6 GATE** **BLOCKS** US3, US5, Polish (and blocks claiming US6 Done /
  feature Done)
- **US6 (Phase 7)** after gate (UI polish on proven restore)
- **US3 (Phase 8)** and **US5 (Phase 9)** after gate (can parallelize with each
  other)
- **Polish (Phase 10)** after desired stories + gate green

### User Story Dependencies

| Story | Depends on |
|-------|------------|
| US1 Create backup | Phase 2 |
| US2 Download | US1 |
| US4 Restore | US1 (archive format) |
| **GATE equality** | US1 + US4 |
| US6 Backup screen | Gate (+ US1/US2/US4 APIs) |
| US3 Schedule | Gate + US1 |
| US5 Export | Gate + Phase 2 |

### Parallel Opportunities

- Phase 1: T002–T008 parallel after T001
- Phase 2: T012–T018 parallel after T009–T011 where noted
- US1 tests T019–T021 parallel
- After gate: US3 and US5 in parallel by different owners
- US5 tests T057–T058 parallel

### Parallel Example: After Foundational

```bash
# US1 tests together:
Task: "apps/api/test/backup.create.spec.ts"
Task: "apps/api/test/backup.concurrency.spec.ts"
Task: "apps/api/test/backup.permissions.spec.ts"
```

### Parallel Example: After Gate

```bash
# US3 + US5 in parallel:
Dev A: schedule + retention (T049–T056)
Dev B: portable export (T057–T062)
```

---

## Implementation Strategy

### MVP (through blocking gate)

1. Phase 1 Setup + Phase 2 Foundational
2. US1 Create backup → US2 Download → US4 Restore (TENANT same-id + OPERATOR)
3. **Phase 6 GATE** — same-tenant wipe-then-restore equality + decrypt
   isolation MUST pass
4. STOP and validate quickstart §1–§2 before P2 work

### Incremental delivery

1. MVP + gate → demo DR confidence
2. US6 Backup screen polish
3. US3 Schedule/retention and/or US5 Export (parallel)
4. Polish + CI gate enforcement

### Suggested MVP scope

**Phases 1–6** (Setup → Foundational → US1 → US2 → US4 → **equality gate**).
US6 minimal status UI may exist from US1/US2 but full screen Done is Phase 7.

---

## Notes

- [P] = different files, no incomplete deps
- Phase 6 is a **release-blocking** quality gate, not optional polish
- TENANT restore: `sourceTenantId === targetTenantId` only; OPERATOR for clone
- Never store PIN in cloud backups; strip secrets from exports
- Prefer 409 when a backup is already QUEUED/RUNNING for the tenant
- Commit after each task or logical group
- Do **not** run `/speckit-implement` for the fidelity gate until these
  remediations are approved
