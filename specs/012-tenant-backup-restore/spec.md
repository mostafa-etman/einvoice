# Feature Specification: Tenant Backup & Restore

**Feature Branch**: `012-tenant-backup-restore`

**Created**: 2026-08-01

**Status**: Clarified

**Input**: User description: "Feature: Tenant backup & restore.
- Logical per-tenant backup (DB rows for that tenant + its objects in MinIO). Scheduling; secure download; full restore into a clean environment; full tenant data export.
Frontend: backup screen (create/schedule/download/restore)."

## Clarifications

### Session 2026-08-01

- Q: Are backup download and full tenant data export the same package or distinct?
  → A: **Distinct artifacts**. **Backup** = full restore-oriented package
  (tenant data + stored files + config + encrypted secrets). **Export** =
  portable, human-readable data (tables + optionally documents); **no secrets**.
- Q: Who may restore, and where may the clean target live?
  → A: **Both actors**, with strict safety rules: Tenant Owner/Admin may restore
  **only into an EMPTY organization** (never overwrite a tenant that has data).
  Platform operators may restore **across environments**. Every restore is
  fully audit-logged, requires **explicit confirmation**, and MUST validate
  **tenant ownership** and **package integrity (checksums)** before applying.
- Q: Are secrets included in packages?
  → A: Encrypted secrets are included **only** in restore-capable **backups**,
  **never** in portable **exports**. **Secret** means: ETA ClientId/Secret, any
  stored tokens/PINs (PIN must never be stored in cloud anyway), and any
  encryption-wrapped credential. Secrets remain encrypted at rest inside the
  backup and are **re-encrypted per target environment** on restore.
- Q: What is the canonical backup package shape?
  → A: Backup is an **encrypted archive** containing a **DB extract** (tenant
  rows), an **object manifest**, and the tenant’s **stored files**.
- Q: What MUST restore validate before applying a backup?
  → A: Restore MUST validate **tenant ownership** and **package integrity
  (checksums)** before applying; failed checks abort restore with no data
  applied.
- Q: How are recurring backups scheduled and retained?
  → A: Scheduling is **cron-based**; a documented **retention policy** MUST
  purge or expire excess scheduled backups automatically.
- Q: What is the default retention policy for scheduled backups?
  → A: Keep last **14** scheduled backups **or** **30 days**, whichever limit
  applies first.
- Q: What counts as a non-empty organization for the restore gate?
  → A: Non-empty if **any operational business data** exists (documents,
  purchases, branch content, settings payloads, stored files, etc.). Org shell
  + membership alone may still be treated as **empty**.
- Q: Who holds keys for the encrypted backup archive?
  → A: **Platform-managed** archive encryption; decryption occurs only during
  authorized **server-side restore** (downloaded packages remain ciphertext to
  clients).
- Q: What format is the portable tenant export?
  → A: **ZIP of CSV tables**, with an optional documents/files folder when the
  user includes files.

### Session 2026-08-01 (analyze remediation)

- Q: How does restore ownership work when backups are RLS-scoped to the source
  tenant?
  → A: **Two paths only.** **TENANT restore** (self-service DR): allowed
  **only** when `sourceTenantId === targetTenantId` — the org restores its
  **own** backup into its **own** emptied org (same identity; RLS-natural).
  **OPERATOR restore** (cross-identity / cross-environment / clone into a
  **new** empty org with a different `tenantId`): **platform-operator only**,
  staging path that runs above normal tenant RLS. Tenant actors MUST NOT
  restore another org’s backup into a different `tenantId`.
- Q: What is the canonical fidelity-gate path?
  → A: **Same-tenant wipe-then-restore** — seed Tenant A → backup → wipe A’s
  operational data to empty → tenant restore of A’s own backup into A → assert
  fixed fidelity checklist. Operator-staged clone (A → A′) is a separate
  operator capability, **not** the equality gate.
- Q: Are short-lived download grants required for MVP?
  → A: **Deferred post-MVP.** MVP download = authenticated session +
  `backup.download` (ciphertext stream). Expired grant denial (SC-003 grant
  wording) is post-MVP; MVP still denies missing permission and cross-tenant
  access.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create an on-demand tenant backup (Priority: P1)

An authorized Owner or Admin opens the Backup screen and starts a full logical
**restore-oriented backup** of their organization. The result is an
**encrypted archive** containing a **DB extract** (tenant rows including
configuration and encrypted secrets), an **object manifest**, and the tenant’s
**stored files**. When the job finishes, the user sees a completed backup with
size, time, integrity checksum, and status, ready for secure download or
restore.

**Why this priority**: On-demand backup is the core capability; scheduling,
restore, and export build on a trustworthy backup artifact.

**Independent Test**: With known tenant data, files, config, and encrypted
secrets in one organization (and different data in another), create a backup
and confirm the package reflects only that organization, includes encrypted
secrets (not plaintext), and reaches Completed.

**Acceptance Scenarios**:

1. **Given** an authorized user in an organization with documents, settings,
   stored files, and encrypted credentials, **When** they start a backup from
   the Backup screen, **Then** a backup job is created for that organization
   only and progresses to Completed (or Failed with a clear reason).
2. **Given** a backup is running, **When** the user views the Backup screen,
   **Then** they see job status (Queued / Running / Completed / Failed) without
   needing to leave the page permanently to discover completion.
3. **Given** two organizations with different data, **When** a backup is
   created for organization A, **Then** the backup content excludes
   organization B’s data, files, config, and secrets.
4. **Given** a user without backup permission, **When** they attempt to create
   a backup, **Then** access is denied and no backup job is created.
5. **Given** a Completed backup, **When** package metadata is inspected,
   **Then** an integrity checksum is present, the archive is encrypted under
   platform-managed keys, and secrets inside the package are not stored in
   plaintext.

---

### User Story 2 - Securely download a completed backup (Priority: P1)

An authorized user downloads a completed **backup** package through a secure,
authenticated flow. The download is available only to permitted users of that
organization, expires or becomes invalid after a controlled window when using
one-time or time-limited access, and never exposes another tenant’s packages.

**Why this priority**: A backup that cannot be retrieved securely has little
operational value and creates high data-exfiltration risk (especially because
backups contain encrypted secrets).

**Independent Test**: Complete a backup, download it as an authorized user,
confirm contents are for that tenant only; confirm unauthorized users and
expired download access cannot retrieve it.

**Acceptance Scenarios**:

1. **Given** a Completed backup for the user’s organization, **When** they
   choose Download, **Then** they receive the backup package via an
   authenticated, time-limited secure download.
2. **Given** a user in another organization (or without permission), **When**
   they attempt to download the backup, **Then** access is denied.
3. **Given** a time-limited download link or token has expired, **When** it is
   used again, **Then** the download fails and no package bytes are returned.
4. **Given** a Failed or still-Running backup, **When** the user attempts
   Download, **Then** download is not offered or is rejected with a clear
   message.

---

### User Story 3 - Schedule recurring backups (Priority: P2)

An authorized user configures a **cron-based** backup schedule so the system
creates **restore-oriented encrypted archives** automatically without manual
intervention. They can view the next run, pause/resume, or change the cron
schedule from the same Backup screen. A **retention policy** automatically
removes or expires excess scheduled backups.

**Why this priority**: Recurring backups reduce operational risk; on-demand
backup alone still delivers MVP value.

**Independent Test**: Enable a short-interval or due schedule for a test tenant,
wait for the scheduled run (or trigger the due job in a controlled test), and
confirm a new Completed backup appears with schedule attribution.

**Acceptance Scenarios**:

1. **Given** an authorized user with no schedule, **When** they enable a
   cron-based schedule (including common daily/weekly patterns), **Then** the
   schedule is saved and the next run time is shown.
2. **Given** an active cron schedule whose run time is due, **When** the
   scheduler runs, **Then** a new backup job is created for that organization
   and completes or fails with visible status.
3. **Given** an active schedule, **When** the user pauses it, **Then** no new
   scheduled backups are created until they resume.
4. **Given** the retention policy for scheduled backups (keep last 14 or
   30 days, whichever limit applies first), **When** new scheduled backups
   exceed those limits, **Then** older eligible scheduled backups are removed
   or marked expired per policy (on-demand backups follow their own
   retention/delete rules).

---

### User Story 4 - Restore a tenant into a clean / empty target (Priority: P1)

Restore is a **dangerous** operation. Authorized actors restore a Completed
**backup** only after explicit confirmation, ownership checks, and package
integrity (checksum) validation.

| Path | Actor | Source → target | Empty required | Notes |
|------|-------|-----------------|----------------|-------|
| **TENANT** | Owner/Admin with `backup.restore` | `sourceTenantId === targetTenantId` only | Yes (wipe operational data first) | Self-service DR; RLS-natural |
| **OPERATOR** | `isPlatformOperator` | Different `tenantId` and/or environment (clone / cross-env) | Yes | Staging above RLS; not self-serve |

- **Tenant Owner/Admin**: may restore **only** their **own** backup
  (`sourceTenantId === targetTenantId`) into that **same** org after it is
  emptied of operational business data — never overwrite a populated tenant,
  and never restore another org’s backup into a different `tenantId`.
- **Platform operators**: may restore **across identities/environments** into
  a clean/empty target via the operator staging path, subject to the same
  empty-target, checksum, confirmation, and audit rules.

After a successful restore, the target contains the backed-up tenant data,
files, config, and secrets **re-encrypted for the target environment**.
Agent/token **PIN is never stored in cloud** and therefore never appears in
any backup or export. Every attempt and outcome is fully audit-logged.

**Why this priority**: Disaster recovery and environment cloning are primary
reasons to keep backups; without safe restore, backup is incomplete.

**Independent Test**: Same-tenant wipe-then-restore with the **fixed fidelity
checklist** (3 documents, 2 storage objects, ≥1 settings row, ETA credential
re-encrypt); reject non-empty, bad checksum, cross-tenant tenant-path restore,
and missing confirmation.

**Acceptance Scenarios**:

1. **Given** a Completed backup for Tenant A, a valid checksum, and Tenant A
   emptied of operational business data (`sourceTenantId === targetTenantId`),
   **When** a Tenant Owner/Admin confirms Restore, **Then** the restore job
   runs and A matches the fixed fidelity checklist with secrets re-encrypted
   for the target environment.
2. **Given** a target organization that already has **operational business
   data**, **When** restore is attempted, **Then** the system refuses and
   explains that the organization must be empty (no overwrite).
3. **Given** a Tenant Owner/Admin of empty Tenant A′ (`tenantId` ≠ A) and a
   backup belonging to A, **When** they call tenant-path restore with A’s
   `backupJobId`, **Then** ownership binding fails and restore is refused
   (only operators may clone cross-identity).
4. **Given** a Completed backup and a clean target with a **different**
   `tenantId` or environment, **When** a platform operator confirms operator
   Restore via staging, **Then** the restore proceeds under operator
   permissions with full audit logging.
5. **Given** a backup whose integrity checksum does not match, **When** restore
   is attempted, **Then** the system refuses to apply the package.
6. **Given** restore start is requested without explicit confirmation, **When**
   the confirmation step is incomplete, **Then** no restore job is created.
7. **Given** a restore in progress or completed (success or failure), **When**
   audit history is reviewed, **Then** actor, source backup, target,
   timestamp, confirmation evidence, and outcome are recorded.
8. **Given** a user without restore permission (and not a platform operator),
   **When** they attempt restore, **Then** access is denied.
9. **Given** restore completes successfully on the fidelity path, **When** the
   fixed checklist is evaluated, **Then** all checklist items match and ETA
   secret ciphertext/nonce differ from source while decrypting under the
   target environment key.

---

### User Story 5 - Export full tenant data for portability (Priority: P2)

An authorized user requests a **portable export** — a distinct artifact from
restore-oriented backup. The export is a **ZIP of CSV tables** (and, when
requested, an optional documents/files folder) for portability, compliance, or
offline archival. **Exports MUST NOT contain secrets** (ETA ClientId/Secret,
tokens, PINs, or encryption-wrapped credentials). Available from the Backup
screen alongside backup actions.

**Why this priority**: Portability and compliance exports are expected for
tenant-owned data; a restore package alone does not satisfy “give me my data”
in a safe, readable form.

**Independent Test**: Request an export for a tenant with known records and
secrets on file; download the ZIP and confirm CSV tables/(optional) documents
are present and that no secret material is included.

**Acceptance Scenarios**:

1. **Given** an authorized user, **When** they request a full tenant data
   export, **Then** an export job is created and reaches Completed or Failed
   with a clear reason.
2. **Given** a Completed export, **When** they download it, **Then** they
   receive a secure, authenticated **ZIP of CSV tables** (and optional files if
   requested) limited to their organization.
3. **Given** another organization’s data exists in the system, **When** export
   for organization A completes, **Then** organization B’s data is absent from
   the package.
4. **Given** the source organization has ETA credentials and other secrets,
   **When** export completes, **Then** the package contains no secrets
   (ClientId/Secret, tokens, PINs, or wrapped credentials).
5. **Given** Backup and Export both exist for the same organization, **When** a
   user compares the two job types on the Backup screen, **Then** they are
   clearly labeled as distinct artifacts with different purposes.

---

### User Story 6 - Manage backups on a dedicated Backup screen (Priority: P1)

Owners and Admins use a single Backup screen to create backups, manage
schedules, download completed backup/export packages, request exports, and
(when permitted) start restore into an empty target. Platform-operator restore
across environments is available through the authorized operator path. The
screen is bilingual (Arabic/English), RTL-correct for Arabic, and responsive.

**Why this priority**: The feature is user-facing; without a coherent screen,
capabilities are inaccessible.

**Independent Test**: As an authorized user, complete create → see status →
download; configure schedule; request export; as unauthorized user, confirm
controls are hidden or denied. Switch locale to Arabic and confirm layout/copy.

**Acceptance Scenarios**:

1. **Given** an authorized user, **When** they open Backup, **Then** they see
   recent backup/export jobs, actions to create backup, configure schedule,
   download, export, and restore (if permitted), with backup vs export clearly
   distinguished.
2. **Given** Arabic locale, **When** they open Backup, **Then** labels and
   layout are RTL-correct and translated.
3. **Given** a Failed job, **When** it appears in the list, **Then** a
   user-understandable failure reason is shown (no secret material in the
   message).

---

### Edge Cases

- What happens when a backup or export runs while users are still writing new
  documents? The job MUST produce a consistent logical snapshot as of a defined
  cutover point and MUST NOT interleave partial rows from after that point in a
  way that breaks referential integrity inside the package.
- How does the system handle very large tenants (many documents / large file
  volume)? Jobs MUST run asynchronously; the UI MUST remain usable; progress or
  status MUST be visible; failures due to size/time limits MUST be explicit.
- What if object storage files referenced by DB rows are missing? The job MUST
  fail or complete with a clear partial/warning outcome (product MUST NOT
  silently omit required files without recording it).
- What if two backup jobs for the same tenant overlap? The system MUST prevent
  conflicting concurrent backups for the same organization or queue them safely
  so only one active backup runs at a time per tenant.
- What if restore is interrupted mid-way? The target MUST NOT be left as a
  silently “successful” half-restored tenant; failed restores MUST leave the
  target marked failed/rolled back to empty/clean or clearly unusable pending
  retry cleanup.
- What if the user deletes or retention purges a backup that still has an
  active download link? Subsequent download attempts MUST fail safely.
- What if schedule timezone is ambiguous? Schedule times MUST be interpreted in
  a documented timezone (organization timezone if available; otherwise a stated
  default) and shown clearly in the UI.
- What if someone tries to “restore” using an Export package? The system MUST
  reject non-backup artifacts for restore.
- What if a PIN or agent-local secret is requested for cloud backup? PINs MUST
  NOT be stored in cloud; they are out of scope for backup package contents.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support creating an on-demand logical **backup** as an
  **encrypted archive** for a single organization. The archive MUST contain a
  **DB extract** (tenant-scoped rows including configuration and encrypted
  secrets), an **object manifest**, and that tenant’s **stored files** required
  to reconstitute the tenant. Archive encryption MUST be **platform-managed**;
  clients downloading a backup receive ciphertext and MUST NOT be able to
  decrypt it outside authorized server-side restore.
- **FR-002**: System MUST exclude other organizations’ data, files, config, and
  secrets from every backup and export package.
- **FR-003**: System MUST run backup, export, and restore as asynchronous jobs
  with visible statuses: at minimum Queued, Running, Completed, and Failed.
- **FR-004**: System MUST allow authorized users to download Completed backup
  and export packages only through authenticated, permission-checked secure
  download (ciphertext stream). **MVP**: session auth + `backup.download` (or
  export permission). **Post-MVP**: optional short-lived download grants with
  expiry denial (deferred).
- **FR-005**: System MUST allow authorized users to configure, pause, resume,
  and update a recurring backup schedule expressed as a **cron** schedule
  (common daily and weekly patterns MUST be supported).
- **FR-006**: System MUST apply a retention policy to scheduled backups: keep
  the last **14** scheduled backups **or** retain for **30 days**, whichever
  limit applies first, and enforce it automatically by purging or expiring
  excess scheduled backups. On-demand backups are not subject to this scheduled
  retention rule (they follow manual delete / separate retention controls).
- **FR-007**: System MUST support full restore of a Completed **backup** only;
  restore using an export or other non-backup artifact MUST be rejected.
- **FR-008**: System MUST require explicit confirmation before starting restore.
- **FR-009**: System MUST support a full tenant data **export** job that
  produces a portable **ZIP of CSV tables**, optionally including a
  documents/files folder when requested, and MUST allow secure download of the
  resulting package.
- **FR-010**: Backup and export MUST be **distinct artifacts**: Backup is the
  restore-oriented **encrypted archive** (DB extract + object manifest + files,
  including config and encrypted secrets in the DB extract); Export is a
  portable **ZIP of CSV tables** (plus optional documents/files) and MUST NOT
  include secrets.
- **FR-011**: System MUST provide a Backup screen where authorized users can
  create backups, manage schedules, download packages, request exports, and
  initiate restore when permitted, with backup vs export clearly distinguished.
- **FR-012**: System MUST enforce permission checks for backup create,
  schedule manage, download, export, and restore as separate capabilities
  (least privilege); unauthorized attempts MUST be denied.
- **FR-013**: Restore actors and targets MUST follow: (a) **TENANT** path —
  Owner/Admin may restore only when `sourceTenantId === targetTenantId` into
  that org after it is **EMPTY** of operational business data; (b) **OPERATOR**
  path — platform operators may restore cross-identity / cross-environment /
  clone into a **new** empty org via staging above RLS; (c) every restore MUST
  be fully audit-logged; (d) every restore MUST require explicit confirmation;
  (e) restore MUST validate ownership binding and package integrity (checksums)
  before applying; (f) tenant-path restore of another org’s backup into a
  different `tenantId` MUST be rejected.
- **FR-014**: Encrypted secrets MUST be included **only** in restore-capable
  backups and **never** in portable exports. For this feature, **secret** means
  ETA ClientId/Secret, any stored tokens/PINs (PIN MUST never be stored in
  cloud), and any encryption-wrapped credential. Secrets MUST remain encrypted
  at rest inside the backup and MUST be **re-encrypted for the target
  environment** on restore.
- **FR-015**: System MUST record audit events for backup create, schedule
  changes, download, export, restore confirmation/start, and restore outcome
  (actor, tenant, timestamp, action, outcome; restore also records source
  backup and target).
- **FR-016**: System MUST NOT allow a backup/export/restore failure message or
  log line exposed to clients to contain secrets or raw credential material.
- **FR-017**: System MUST keep at most one active (Queued/Running) backup job
  per organization at a time (additional requests are rejected or queued behind
  policy).
- **FR-018**: Restore MUST be atomic from the operator’s perspective: on
  failure, the target is not reported as successfully restored.
- **FR-019**: Backup and export job lists and detail views MUST show created
  time, completion time (when known), status, package size (when known),
  integrity checksum (for backups, when known), and triggering source (manual,
  schedule, or export).
- **FR-020**: UI for this feature MUST support Arabic and English with correct
  RTL behavior for Arabic and remain usable on supported responsive breakpoints.
- **FR-021**: Before applying restore, the system MUST verify package integrity
  via checksums and MUST abort restore if verification fails.
- **FR-022**: Before applying restore, the system MUST verify ownership binding:
  tenant path requires `sourceTenantId === targetTenantId`; operator path may
  target a different `tenantId` only when `isPlatformOperator` and staging
  rules pass. Invalid bindings MUST abort restore with no data applied.
- **FR-023**: Restore into any organization that already contains **operational
  business data** MUST be rejected for all actors (no silent overwrite).
  Operational business data includes documents, purchases, branch content,
  settings payloads, stored files, and comparable tenant operational rows. An
  organization that has only the org shell and membership (no operational
  business data) MAY be treated as empty/clean for restore.

### Constitution Constraints *(mandatory — map applicable principles)*

- **CC-001 Reliability/Audit**: Acceptance scenarios map to automated tests for
  create/download/schedule/restore/export isolation, empty-target enforcement,
  checksum/ownership gates, and failure handling. Audit events required per
  FR-015 for all security- and business-relevant backup actions including
  restore confirmation.
- **CC-002 Security**: Backups are platform-encrypted archives (clients get
  ciphertext); tenant secrets inside remain encrypted and are re-encrypted per
  environment on restore (FR-014). PIN never in cloud/backup/export. Exports
  must not contain secrets. MVP: authenticated permissioned download; short-lived
  grant TTL post-MVP.
- **CC-003 Tenant Isolation**: Every backup/export/restore is strictly
  single-tenant. Cross-tenant leakage in packages or downloads is
  release-blocking. Shared object storage MUST only include that tenant’s
  objects in the package. Ownership validation before restore (FR-022).
- **CC-004 ETA Serialization**: N/A — this feature does not change canonical
  signing serialization.
- **CC-005 Runtime ETA Config**: N/A — no hardcoded ETA URLs/schemas; restore
  of tenant settings must not embed environment-wide ETA endpoints as
  source-code literals (environment config remains separate).
- **CC-006 Sandbox-First**: N/A for ETA calls; restore/validation in non-prod
  MUST use non-prod environment configuration when any post-restore ETA
  connectivity is tested.
- **CC-007 UX/i18n**: Backup screen ships with ar/en, RTL, design-system
  consistency, and responsive layout (FR-020, User Story 6).
- **CC-008 Full-Stack Phase**: Backend job/package/permissions/audit and
  Frontend Backup screen delivered together with tests; desktop agent local
  state/PIN out of scope for cloud backup contents.

### Key Entities *(include if feature involves data)*

- **Tenant Backup**: Restore-oriented **encrypted archive** for one organization
  at a point in time, containing a **DB extract**, an **object manifest**, and
  **stored files** (DB extract includes config and encrypted secrets); encrypted
  with **platform-managed** keys; metadata includes status, size, timestamps,
  trigger source, retention eligibility, and integrity checksum.
- **Object Manifest**: Inventory of tenant-owned stored files included in the
  backup (identity/path, size, and per-object integrity information as needed
  for restore verification).
- **Tenant Export**: Distinct portable package: **ZIP of CSV tables**, with an
  optional documents/files folder when requested; never contains secrets; not
  usable for restore.
- **Backup Schedule**: Per-organization recurring **cron** configuration
  (expression or equivalent daily/weekly pattern, timezone interpretation,
  paused/active) plus retention-policy parameters.
- **Restore Job**: Operation applying a Tenant Backup onto an empty/clean
  target (actor type, source backup, target identity, confirmation, checksum
  and ownership check results, status, outcome).
- **Secure Download Grant**: Post-MVP optional short-lived download access.
  MVP uses authenticated permissioned download only.
- **Tenant Secret (backup scope)**: ETA ClientId/Secret, stored tokens, and
  encryption-wrapped credentials included only inside backups (encrypted at
  rest); PINs are never cloud-stored and are out of backup scope.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Authorized users can start an on-demand backup and see a terminal
  status (Completed or Failed) without manual server intervention for typical
  small/medium tenants within 30 minutes in normal operating conditions.
- **SC-002**: 100% of sampled backup and export packages from isolation tests
  contain only the source organization’s data and files (zero cross-tenant
  inclusions).
- **SC-003**: 100% of download attempts by users lacking permission, or by
  another tenant’s users against this tenant’s backup id, are denied. (Expired
  short-lived grant denial is **post-MVP**.)
- **SC-004**: Same-tenant wipe-then-restore fidelity gate passes the **fixed
  checklist**: exactly **3** documents, **2** storage objects (per-object
  checksum match), ≥**1** settings/config row, and ETA-credential ciphertext
  that decrypts under the **target** environment key with ciphertext/nonce
  **different** from source; restore into a target with operational business
  data is rejected in 100% of attempts for all actors.
- **SC-005**: At least 90% of authorized users in usability validation can
  complete “create backup → download” on the Backup screen on the first try
  without assistance.
- **SC-006**: Scheduled backups produce a new Completed (or clearly Failed)
  job for each due run under test, and retention removes or expires excess
  scheduled backups when either more than **14** scheduled backups exist or a
  scheduled backup is older than **30 days** (whichever limit applies first).
- **SC-007**: Every backup create, download, export, schedule change, and
  restore attempt (including confirmation) leaves a corresponding audit record
  with actor, tenant, timestamp, action, and outcome.
- **SC-008**: 100% of inspected export packages in security tests contain no
  secrets; 100% of restore attempts with mismatched checksums or invalid tenant
  ownership bindings are rejected before any data is applied; downloaded backup
  archives remain undecryptable to clients outside authorized server-side
  restore.

## Assumptions

- “Logical per-tenant backup” means an application-level **encrypted archive**
  (DB extract + object manifest + files) for that tenant — not a raw
  full-database physical dump of the whole platform.
- Recurring schedules are **cron-based**; exact UI (presets vs raw expression)
  may be refined in planning so long as cron semantics and next-run visibility
  are preserved.
- Stored files/objects in scope are those owned by the tenant in the platform’s
  object storage (constitution baseline: MinIO); platform-global assets are out
  of scope.
- Desktop signing agent local state and local certificates/PINs on customer
  machines are out of scope for cloud tenant backup contents.
- “Empty organization” / “clean environment” means the restore target has **no
  operational business data** (documents, purchases, branch content, settings
  payloads, stored files, etc.). Org shell + membership alone may still qualify
  as empty.
- **Ownership**: TENANT restore requires `sourceTenantId === targetTenantId`
  (wipe-then-restore same org). OPERATOR restore may clone into a different
  empty `tenantId` / environment via staging. Canonical fidelity gate =
  **same-tenant wipe-then-restore** (not A→A′ clone).
- **Download grants**: Short-lived download grant TTL is **post-MVP**; MVP uses
  authenticated permissioned download only.
- Token/agent **PIN is never stored in cloud** and MUST NOT appear in any
  backup or export package.
- On-demand backups may have longer retention or manual delete controls;
  scheduled backups follow automatic retention: keep last **14** scheduled
  backups **or** **30 days**, whichever limit applies first.
- Secure download uses authenticated app access plus short-lived retrieval
  grants (for example minutes-scale expiry); exact mechanism is a planning
  detail.
- Backup and export are heavy operations and are always asynchronous.
- Permissions integrate with the existing RBAC model (new backup-related
  permissions). Tenant Owners/Admins get backup/export/schedule/download and
  empty-org restore; platform operators get cross-environment restore.
- After restore, secrets are re-encrypted for the target environment; operators
  remain responsible for verifying post-restore ETA connectivity in that
  environment. Backup archive decryption is platform-managed and occurs only in
  authorized server-side restore flows.
- This feature does not include continuous point-in-time recovery (PITR),
  per-document versioning, or overwrite-restore of populated tenants.
