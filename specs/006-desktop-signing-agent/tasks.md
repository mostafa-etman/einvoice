---
description: "Task list for desktop signing agent & device management"
---

# Tasks: Desktop Signing Agent & Device Management

**Input**: Design documents from `/specs/006-desktop-signing-agent/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/,
quickstart.md; feature **005** (documents + `CanonicalSerialize` + golden
vectors under `specs/005-document-building-serialization/golden-vectors/`)

**Tests**: MANDATORY. **Blocking gates before signing path**:
1. **Locked-only** serialization (current locked count = **1**: `gv-01`; PENDING
   `gv-02`…`gv-08` **excluded**) via agent golden + **cross-runtime comparative
   harness** `agent === etaCore === expected` (constitution IV).
2. **Strip-signatures golden** on gv-01 + dummy signatures.
3. **CAdES software-key structural gate** (FR-011 checklist; no `Cades.txt`
   byte-compare).

> **HARDWARE_SIGNING_PENDING** (do not clear until field confirmation): Physical
> eSeal token signing via `Pkcs11TokenSigningProvider` is implemented but
> **UNVERIFIED**. CI uses `SIGNING_PROVIDER=software` only. Skipped tests:
> `HardwareTokenSigningPendingTests`. Manual runbook:
> `HARDWARE-TEST.md` (pair → PIN → sign gv-01 → FR-011 → ETA sandbox).

Also: pairing/revoke API tests, Devices UI smoke. No ETA submission in this
feature (sandbox acceptance recorded as definitive CAdES oracle for later).

**006 dependency**: Expanding locked vectors requires **005** promotion after
real bassemAgmi `CanonicalString.txt` — do not invent expected strings here.

**Organization**: Phases by user story. Backend + frontend + agent before
claiming story Done when the story touches that tier.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable (different files, no incomplete deps)
- **[Story]**: [US1]…[US5] for story phases only
- Exact file paths required

## Path Conventions

- **API**: `apps/api/`
- **Web**: `apps/web/`
- **Agent**: `apps/agent/`
- **Shared**: `packages/shared/`
- **005 golden vectors (Phase 4 serialization SoT)**:
  `specs/005-document-building-serialization/golden-vectors/`
- **Contracts**: `specs/006-desktop-signing-agent/contracts/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Permissions, i18n, module shells, agent package deps

- [X] T001 Add `devices.view` and `devices.manage` to
      `packages/shared/src/permissions.ts` and update `ROLE_PERMISSION_MATRIX`
      (Owner/Admin manage; Accountant view; Viewer neither) per
      `contracts/permissions.md`
- [X] T002 [P] Add Devices screen copy keys to
      `apps/web/src/messages/ar.json` and `apps/web/src/messages/en.json`
- [X] T003 [P] Scaffold `apps/api/src/devices/devices.module.ts` and
      `apps/api/src/signing/signing.module.ts`; register both in
      `apps/api/src/app.module.ts`
- [X] T004 [P] Add agent NuGet deps for signing/offline/channel in
      `apps/agent/src/Einvoice.Agent/Einvoice.Agent.csproj`
      (BouncyCastle, Pkcs11Interop, Microsoft.Data.Sqlite or equivalent,
      WebSocket client packages as needed)
- [X] T005 [P] Confirm 005 golden-vector path and existing agent
      `CanonicalSerialize` / `CanonicalSerializeGoldenTests` are the SoT for
      this feature in `specs/006-desktop-signing-agent/quickstart.md` (link
      Phase 4 / 005 fixtures explicitly)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema + RLS, document `SIGNED` status, **locked-only 005 golden
gate**, **cross-runtime parity harness**, **strip-signatures golden**, CI
wiring — **BLOCKS all user stories** (and **blocks US2 signing path** until
parity + CAdES structural tasks are green)

**WARNING**: No user-story **signing** work until T010, **T010a**, **T010b** are
green. PENDING vectors are never part of these gates.

- [X] T006 Extend Prisma schema: `PairingCode`, `SigningDevice`,
      `SignatureJob`; extend `Document` with `SIGNED` status,
      `signaturesJson`, `signedAt`, `signedByDeviceId` in
      `apps/api/prisma/schema.prisma` per `data-model.md`
- [X] T007 Add migration + FORCE RLS for pairing/device/job tables (and grants)
      in `apps/api/prisma/migrations/` and `apps/api/prisma/rls.sql`
- [X] T008 [P] Implement `stripSignatures` / signing-input helper (document copy
      without `signatures`) in
      `apps/agent/src/Einvoice.Agent/Signing/SigningInput.cs`
- [X] T009 [P] Unit test signing-input excludes `signatures` before canonicalize
      in `apps/agent/tests/Einvoice.Agent.Tests/SigningInputTests.cs`
- [X] T010 **BLOCKING GATE — LOCKED 005 GOLDEN VECTORS IN AGENT (count = 1)**:
      Ensure `apps/agent/tests/Einvoice.Agent.Tests/CanonicalSerializeGoldenTests.cs`
      loads **every locked** `gv-*.canonical.txt` only (today: **gv-01** only;
      files named `*.canonical.txt` that are locked SoT). Asserts
      `CanonicalSerialize.SerializeFromJson(input) === expected` **byte-exact**
      (strip at most one trailing `\n`). Command:
      `dotnet test apps/agent/Einvoice.Agent.sln --filter CanonicalSerialize`
      MUST pass. **Do not** assert `*.canonical.PENDING.txt`, candidates, or
      gv-02…gv-08 until **005** promotes them. Never mint expected strings from
      product code.
- [X] T010a **BLOCKING GATE — CROSS-RUNTIME PARITY HARNESS (constitution IV)**:
      Add a single comparative harness (e.g.
      `tools/parity-canonical/run.mjs` or
      `packages/eta-core/src/parity-agent.spec.ts` + agent invocation) that, for
      **each locked** vector (today: **gv-01** only), asserts
      `agent(input) === etaCore(input) === expected` (UTF-8 byte-exact). Wire as
      a **mandatory** CI step in `.github/workflows/ci.yml`. Separate agent-only
      and eta-core-only suites alone are insufficient for merge. PENDING vectors
      excluded.
- [X] T010b **BLOCKING — STRIP-SIGNATURES GOLDEN**: Add fixture + test
      `apps/agent/tests/Einvoice.Agent.Tests/StripSignaturesGoldenTests.cs` (and
      matching eta-core test if strip helper lives there): input =
      `gv-01-eta-sdk-one-doc.input.json` **plus** dummy
      `signatures: [{ "signatureType": "I", "value": "dummy" }]` →
      `stripSignatures` → `CanonicalSerialize` === locked
      `gv-01-eta-sdk-one-doc.canonical.txt` byte-exact. Proves pre-signing strip
      does not alter digest input vs locked SoT.
- [X] T011 [P] Confirm CI runs **(a)** agent locked golden filter, **(b)**
      cross-runtime parity harness (T010a), **(c)** strip-signatures golden
      (T010b) in `.github/workflows/ci.yml`; wire any missing steps on default CI
- [X] T012 [P] Add device-token auth guard skeleton
      `apps/api/src/devices/device-token.guard.ts` (hash lookup, require
      `PAIRED`; return 401 when revoked)

**Checkpoint**: Migration applied; **T010 + T010a + T010b green** (locked gv-01
only; PENDING excluded); device-token guard stub ready. Pairing US1 may begin;
**US2 signing implementation waits for T023a–T023g as well**.

---

## Phase 3: User Story 1 - Pair desktop signing device (Priority: P1)

**Goal**: Short-lived pairing code → revocable device token; Devices list shows
paired device; unpair revokes token immediately

**Independent Test**: Create code in API; pair via `/agent/pair`; heartbeat OK;
unpair → next call 401

### Tests for User Story 1 (REQUIRED)

- [X] T013 [P] [US1] API tests pairing create/consume/expire/revoke + unpair
      immediate 401 in `apps/api/test/devices.pairing.spec.ts`
- [X] T014 [P] [US1] Frontend smoke for Devices pair/unpair copy in
      `apps/web/src/app/[locale]/(app)/devices/devices.smoke.test.tsx`

### Implementation for User Story 1

- [X] T015 [US1] Implement pairing code service (hash at rest, TTL, single-use)
      in `apps/api/src/devices/pairing.service.ts`
- [X] T016 [US1] Implement device service (register, list, rename, unpair/revoke
      token) in `apps/api/src/devices/devices.service.ts`
- [X] T017 [US1] Implement user JWT controllers per `contracts/devices-api.yaml`
      in `apps/api/src/devices/devices.controller.ts` with
      `devices.view` / `devices.manage`
- [X] T018 [US1] Implement `POST /agent/pair` + `POST /agent/heartbeat` in
      `apps/api/src/devices/agent-devices.controller.ts` per
      `contracts/agent-channel.md`
- [X] T019 [US1] Audit pairing create/consume/revoke and device unpair in
      devices services
- [X] T020 [P] [US1] Web API client `apps/web/src/lib/api/devices.ts`
- [X] T021 [US1] Devices list + create pairing code + unpair UI in
      `apps/web/src/app/[locale]/(app)/devices/page.tsx`; add nav link in
      `apps/web/src/components/shell/app-shell.tsx`
- [X] T022 [US1] Agent pairing flow (enter code, store device token securely) in
      `apps/agent/src/Einvoice.Agent/Pairing/PairingService.cs` (+ WPF dialog)

**Checkpoint**: US1 DoD — pair + unpair + revoke-401 tests pass

---

## Phase 4: User Story 2 - Sign pending documents (Priority: P1)

**Goal**: Send-for-signature → claim → canonicalize (005-identical, exclude
`signatures`) → SHA-256 → **detached** CAdES-BES (FR-011) → attach type `"I"`

**Independent Test**: READY doc → job → agent sign (software key in CI) →
document `SIGNED` with `signatures[0].signatureType === "I"`; T010/T010a/T010b
and **T023a–T023g** green

**DO NOT start T026–T033 signing implementation until T010a, T010b, and
T023a–T023g are specified green (or implemented in this story’s test-first
order).** Prefer completing T023a–T023g before claim/submit wiring.

### Tests for User Story 2 (REQUIRED) — CAdES FR-011 map

All CAdES tests live primarily in
`apps/agent/tests/Einvoice.Agent.Tests/CadesStructureTests.cs` (and
`CadesSoftwareKeyGoldenTests.cs` as needed). Use committed software RSA test
key under `apps/agent/tests/Einvoice.Agent.Tests/TestKeys/` — **never** the
hardware token. **Do not** byte-compare CMS to bassemAgmi `Cades.txt`.

- [X] T023 [P] [US2] Scaffold CAdES test harness + committed software RSA test
      key/cert in `apps/agent/tests/Einvoice.Agent.Tests/TestKeys/` and shared
      helpers in `CadesStructureTests.cs` (parse CMS SignedData from Base64)
- [X] T023a [P] [US2] Assert **valid detached** CMS SignedData:
      `encapContentInfo.eContent` **absent**; `eContentType` = DigestData OID
      `1.2.840.113549.1.7.5` (ETA V1.1) in `CadesStructureTests.cs`
- [X] T023b [P] [US2] Assert digest algorithm OID **`2.16.840.1.101.3.4.2.1`**
      (SHA-256) in `CadesStructureTests.cs`
- [X] T023c [P] [US2] Assert signed attributes present:
      content-type (`1.2.840.113549.1.9.3`), message-digest
      (`1.2.840.113549.1.9.4`), signing-time (`1.2.840.113549.1.9.5`) in
      `CadesStructureTests.cs`
- [X] T023d [P] [US2] Assert **ESS signing-certificate-v2** attribute OID
      **`1.2.840.113549.1.9.16.2.47`** present and well-formed (hard required;
      ESS hash SHA-256) in `CadesStructureTests.cs`
- [X] T023e [P] [US2] Assert document signature entry `signatureType === "I"`
      after pipeline embed / submit DTO in
      `CadesStructureTests.cs` and/or `apps/api/test/signing.jobs.spec.ts`
- [X] T023f [P] [US2] Assert produced CMS **cryptographically verifies** against
      the software signer certificate in `CadesStructureTests.cs`
- [X] T023g [US2] **CAdES GOLDEN GATE (software key)**: Sign locked **gv-01**
      digest input with software RSA test key; run full FR-011 checklist
      (T023a–T023f) in
      `apps/agent/tests/Einvoice.Agent.Tests/CadesSoftwareKeyGoldenTests.cs`;
      wire `dotnet test … --filter CadesSoftwareKeyGolden` (or equivalent) on
      default CI. Document hardware PKCS#11 (`eps2003csp11.dll`) as separate
      gated/manual path; document ETA sandbox acceptance as definitive oracle
      (submit out of scope here).
- [X] T024 [P] [US2] API tests send-for-signature, claim, submit, idempotent
      submit, version conflict in `apps/api/test/signing.jobs.spec.ts`
- [X] T025 [P] [US2] **Regression**: re-run locked agent golden + T010a parity
      harness + T010b strip golden + T023g CAdES gate after signing changes —
      all MUST remain green (PENDING vectors still excluded)

### Implementation for User Story 2

- [X] T026 [US2] Implement SignatureJob create/claim/fail/complete + lease in
      `apps/api/src/signing/signing.service.ts`
- [X] T027 [US2] Implement `POST /documents/{id}/send-for-signature` and agent
      claim/submit/fail endpoints in
      `apps/api/src/signing/signing.controller.ts` and
      `apps/api/src/signing/agent-signing.controller.ts`
- [X] T028 [US2] On submit: attach `{ signatureType: "I", value }`, set document
      `SIGNED`, complete job; validate device token + version in
      `SigningService`
- [X] T029 [US2] Implement **detached** CAdES-BES signer (BouncyCastle) meeting
      FR-011 checklist + PKCS#11 primary / Windows CSP fallback in
      `apps/agent/src/Einvoice.Agent/Signing/`
      (`CadesBesSigner.cs`, `Pkcs11KeyProvider.cs`, `CspKeyProvider.cs`)
- [X] T030 [US2] Implement agent sign pipeline: strip signatures →
      `CanonicalSerialize` → SHA-256 → CAdES → submit in
      `apps/agent/src/Einvoice.Agent/Signing/SignPipeline.cs`
- [X] T031 [US2] HTTPS channel client (claim/submit/heartbeat) with device token
      in `apps/agent/src/Einvoice.Agent/Channel/AgentApiClient.cs`
- [X] T032 [P] [US2] Web: “Send for signature” on document detail
      `apps/web/src/app/[locale]/(app)/documents/[id]/page.tsx` + i18n keys
- [X] T033 [US2] Audit send-for-signature, claim, sign accept/reject (codes only)

**Checkpoint**: US2 DoD — end-to-end sign (software key) + T010/T010a/T010b +
T023a–T023g green; PENDING vectors still excluded

---

## Phase 5: User Story 3 - Offline queue & sync (Priority: P2)

**Goal**: Durable SQLite queue for pending docs + signed results; sync on
reconnect; no duplicate attaches

**Independent Test**: Claim, disconnect, sign locally, reconnect, submit once;
restart agent mid-offline and recover queue

### Tests for User Story 3 (REQUIRED)

- [X] T034 [P] [US3] SQLite queue unit tests (persist, recover, state machine) in
      `apps/agent/tests/Einvoice.Agent.Tests/OfflineQueueTests.cs`
- [X] T035 [P] [US3] Idempotent submit / duplicate upload handling in
      `apps/api/test/signing.idempotency.spec.ts`

### Implementation for User Story 3

- [X] T036 [US3] Implement SQLite offline store under AppData in
      `apps/agent/src/Einvoice.Agent/Queue/SqliteOfflineQueue.cs`
- [X] T037 [US3] Wire queue into SignPipeline + background worker
      (PENDING_SIGN → PENDING_UPLOAD → DONE) in
      `apps/agent/src/Einvoice.Agent/Workers/SigningWorker.cs`
- [X] T038 [US3] Retry/backoff on upload; on `401` mark unpaired locally and
      stop uploads in `AgentApiClient` / worker
- [X] T039 [US3] Cancelled/stale job handling on reconnect per
      `contracts/agent-channel.md`

**Checkpoint**: US3 DoD — offline persist + single sync after reconnect

---

## Phase 6: User Story 4 - Devices screen health (Priority: P2)

**Goal**: Last seen, stale marking, rename; RBAC for view vs manage

**Independent Test**: Two devices listed; stale styling; viewer denied manage

### Tests for User Story 4 (REQUIRED)

- [X] T040 [P] [US4] API RBAC tests devices.view vs manage in
      `apps/api/test/devices.rbac.spec.ts`
- [X] T041 [P] [US4] Tenant isolation tests for devices/jobs in
      `apps/api/test/devices.isolation.spec.ts`

### Implementation for User Story 4

- [X] T042 [US4] Heartbeat updates `lastSeenAt` / `lastReadyJson`; Devices UI
      shows stale when outside threshold in
      `apps/web/src/app/[locale]/(app)/devices/page.tsx`
- [X] T043 [US4] Rename device PATCH wired in UI + API client
- [ ] T044 [P] [US4] Optional WebSocket `work.available` notify in
      `apps/api/src/signing/signing.gateway.ts` and agent
      `apps/agent/src/Einvoice.Agent/Channel/AgentWebSocketClient.cs` (HTTPS
      poll remains authoritative)

**Checkpoint**: US4 DoD — Devices health + RBAC/isolation pass

---

## Phase 7: User Story 5 - Tray, PIN, local status HTTP (Priority: P3)

**Goal**: WPF tray status; local PIN unlock; loopback status endpoint; Host
worker

**Independent Test**: Tray shows online/offline/pending; local HTTP readiness
without secrets; PIN never in logs/network

### Tests for User Story 5 (REQUIRED)

- [X] T045 [P] [US5] Local status HTTP contract tests (loopback, no token leak)
      in `apps/agent/tests/Einvoice.Agent.Tests/LocalStatusHttpTests.cs`

### Implementation for User Story 5

- [X] T046 [US5] Convert/extend agent to WPF + `Microsoft.Extensions.Hosting`
      tray shell in `apps/agent/src/Einvoice.Agent/` (entry + `App.xaml`)
- [X] T047 [US5] Local Kestrel status server in
      `apps/agent/src/Einvoice.Agent/LocalHttp/StatusServer.cs`
- [X] T048 [US5] PIN prompt UI (local only) + session unlock policy in
      `apps/agent/src/Einvoice.Agent/Signing/PinPrompt.cs`
- [X] T049 [US5] Tray menu: paired tenant, connection, token present, pending
      counts

**Checkpoint**: US5 DoD — tray + local HTTP + PIN locality

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: CI, quickstart, DoD, no ETA submit creep; locked-only + CAdES gates

- [X] T050 [P] Run locked agent golden gate (gv-01 only):
      `dotnet test apps/agent/Einvoice.Agent.sln --filter CanonicalSerialize`
- [X] T051 [P] Run cross-runtime parity harness (T010a) + confirm eta-core locked
      golden still green:
      `pnpm --filter @einvoice/eta-core test -- --runInBand` (and parity command)
- [X] T051b [P] Run strip-signatures golden (T010b) and CAdES software-key gate
      (T023g)
- [X] T052 [P] Run API devices/signing suites:
      `pnpm --filter @einvoice/api test -- --testPathPattern="devices|signing" --runInBand`
- [X] T053 [P] Run agent OfflineQueue filters
- [X] T054 [P] Run web devices smoke:
      `pnpm --filter @einvoice/web test -- --testPathPattern=devices --runInBand`
- [X] T055 Confirm no ETA submit/receipt scope creep; DoD vs `spec.md` Out of
      Scope + constitution IV (cross-runtime parity) + FR-011 CAdES contract;
      note sandbox acceptance as definitive CAdES oracle for later submit
- [X] T056 [P] Align `specs/006-desktop-signing-agent/quickstart.md` with final
      task IDs / commands (T010/T010a/T010b/T023g; locked count = 1)

**Checkpoint**: Default CI green; locked gv-01 + parity + strip + CAdES
structural gates mandatory; PENDING excluded

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup → Foundational** → **BLOCKS stories** (especially **T010 / T010a /
  T010b**)
- **US1** (pairing) after Foundational schema/guards
- **US2** (signing) after US1 device token + **T010a + T010b + T023a–T023g**
- **US3** (offline) after US2 pipeline exists
- **US4** (Devices polish) after US1 list exists
- **US5** (tray/HTTP) after agent Host shell; full DoD after US2 worker
- **Polish** last
- **005 vector promotion** is an external dependency for expanding locked set

### User Story Dependencies

| Story | Depends on |
|-------|------------|
| US1 | Phase 2 (T010 locked golden) |
| US2 | US1 + T010a parity + T010b strip + T023a–T023g CAdES |
| US3 | US2 SignPipeline |
| US4 | US1 Devices API/UI |
| US5 | Agent Host shell; integrates US2/US3 workers |

### Recommended sequence

1. Setup T001–T005
2. Foundational T006–T012 with **T010 / T010a / T010b blocking**
3. US1 T013–T022 (MVP pairing)
4. US2 **tests first** T023–T023g, then T024–T033 — keep gates green
5. US3 T034–T039
6. US4 T040–T044
7. US5 T045–T049
8. Polish T050–T056

### Parallel opportunities

- T001–T005 after shared build
- T008–T009 with T006–T007
- T013/T014 once APIs sketched
- T023a–T023f once signer compiles; T023g after checklist helpers exist

### MVP

Phase 1–2 (**T010 / T010a / T010b**) + **US1** pairing + **US2** sign (software
key + T023g) unlocks value; US3 offline next; US4/US5 polish.

---

## Parallel Example: Foundational golden gates

```bash
# LOCKED ONLY (count=1 gv-01) — PENDING excluded:
Task: "T010 agent CanonicalSerializeGoldenTests"
Task: "T010a cross-runtime agent === etaCore === expected"
Task: "T010b strip-signatures golden (gv-01 + dummy signatures)"
```

## Parallel Example: User Story 2 CAdES checklist

```bash
Task: "T023a detached SignedData / DigestData OID"
Task: "T023b digest alg 2.16.840.1.101.3.4.2.1"
Task: "T023c content-type / message-digest / signing-time"
Task: "T023d ESS signing-certificate-v2 1.2.840.113549.1.9.16.2.47"
Task: "T023e signatureType I"
Task: "T023f crypto verify"
Task: "T023g software-key CAdES golden gate on gv-01"
```

---

## Implementation Strategy

### MVP first

1. Complete Setup
2. Complete Foundational — **stop if T010 / T010a / T010b fail**
3. Complete US1 — pair/unpair
4. Complete US2 CAdES tests (T023a–T023g) then sign path + attach `"I"`
5. Add US3 offline, then US4/US5

### Blocking golden rule (non-negotiable)

| Gate | Path | Assertion | Blocks |
|------|------|-----------|--------|
| T010 | agent `CanonicalSerializeGoldenTests` | Byte-exact vs **locked** 005 vectors only (**count = 1**: gv-01) | Signing |
| T010a | cross-runtime parity harness | `agent === etaCore === expected` per locked vector | Merge / signing |
| T010b | `StripSignaturesGoldenTests` | gv-01 + dummy signatures → strip → === locked expected | Signing |
| T023a–T023g | `CadesStructureTests` / `CadesSoftwareKeyGoldenTests` | FR-011 structural + verify (no `Cades.txt` bytes) | Signing / merge |
| T011 | `.github/workflows/ci.yml` | T010 + T010a + T010b + T023g on default CI | Merge |
| T025 / T050–T051b | same gates | Remain green after changes | Merge |

- Never generate expected canonical strings from the implementation under test
- Never skip locked golden / parity / CAdES structural tests in default CI
- **PENDING 005 vectors (`gv-02`…`gv-08`) stay excluded** until promoted in 005
- Never byte-compare CAdES to reference `Cades.txt`

### Notes

- Digest input = canonicalize(document **without** `signatures`)
- CAdES-BES **detached** via BouncyCastle; `ISigningProvider`: software (default)
  or PKCS#11 (+ CSP fallback)
- Device token hashed at rest; unpair → immediate 401
- SQLite offline queue is agent-local only
- No ETA submit in this feature; sandbox accept = definitive CAdES oracle later

### HARDWARE_SIGNING_PENDING (token day)

- [ ] T053 **HARDWARE_SIGNING_PENDING**: On physical eSeal — set
      `SIGNING_PROVIDER=pkcs11`, complete `HARDWARE-TEST.md` (pair → PIN → sign
      gv-01 → FR-011 CAdES checklist → ETA sandbox acceptance). Then flip
      `Pkcs11TokenSigningProvider.IsHardwarePathVerified`, un-Skip
      `HardwareTokenSigningPendingTests`, clear this marker. Until then hardware
      signing is **UNVERIFIED** and must not be claimed working.