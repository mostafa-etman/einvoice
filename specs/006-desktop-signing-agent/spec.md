# Feature Specification: Desktop Signing Agent & Device Management

**Feature Branch**: `006-desktop-signing-agent`

**Created**: 2026-07-25

**Status**: Clarified

**Input**: User description: "Feature: Desktop signing agent (.NET 8, Windows-first).
- System tray app that pairs to a tenant via a revocable pairing token from the cloud.
- Access the eSeal certificate on a physical USB/HSM token via PKCS#11/CSP with PIN.
- Implement the SAME ETA canonical serialization as `eta-core`, then SHA256, then produce a CAdES-BES signature (RSA). Embed the signature into the document's signatures element (type "I").
- Local secure endpoint + a secure channel (HTTPS/WebSocket) to the cloud to pull "pending signature" documents and return signed results. Support offline queueing.
Backend: device registration/management, distribute documents needing signature, receive and attach signatures.
Frontend: "Devices" screen (pair/unpair, token status, last seen)."

## Clarifications

### Session 2026-07-25

- Q: How is the CAdES signature built, and how does the agent access the eSeal
  token? → A: **CAdES via BouncyCastle**. Token access is **PKCS#11 first**, with
  **Windows CSP as fallback** when PKCS#11 is unavailable or fails for that
  token.
- Q: What does successful pairing issue to the device? → A: Cloud issues a
  **short-lived pairing code**; on success the device receives a **revocable
  device token** used for subsequent authenticated cloud calls (until unpaired
  or rotated).
- Q: What is signed (signature type and content scope)? → A: Signature type
  **"I"** (issuer). Signed content is the **whole document except the
  `signatures` section** (canonicalization / digest input excludes
  `signatures`).
- Q: How does offline behavior work for pending documents? → A: A **local queue
  persists pending documents** (and signed results awaiting upload); the agent
  **syncs on reconnect**.

### Session 2026-07-25 (analyze remediation — CAdES + parity)

- Q: Must CAdES Base64 match bassemAgmi `Cades.txt` byte-exact? → A: **No** —
  signing-time, RSA signature value, and certificate differ by design. CI uses a
  **measurable structural contract** (FR-011) + crypto verify with a **software
  RSA test key**, not byte-compare to reference CMS.
- Q: Attached or detached CMS? → A: **Detached** — ETA *Digital Signature Format
  V1.1* requires `encapContentInfo.eContent` **absent** and content type
  DigestData (`1.2.840.113549.1.7.5`).
- Q: Which golden vectors gate CI? → A: **Locked only**. Current locked count =
  **1** (`gv-01`). PENDING `gv-02`…`gv-08` stay out of the gate until promoted
  in feature **005** after a real bassemAgmi `CanonicalString.txt` paste.
- Q: How is agent ↔ backend serialization parity proven? → A: One **cross-runtime
  comparative harness** per locked vector:
  `agent(input) === etaCore(input) === expected` (constitution Principle IV).
- Q: Final oracle for CAdES correctness? → A: **ETA preprod/sandbox accepting**
  the signed document (outside this feature’s submit scope; recorded as the
  definitive gate when submit lands). Hardware PKCS#11 (`eps2003csp11.dll`) is
  validated separately in manual/hardware tests.

### Session 2026-07-25 (software-first / token-ready)

- Q: How do we progress without a physical token? → A: **`ISigningProvider`**
  with `SoftwareKeySigningProvider` (default, CI/dev) and
  `Pkcs11TokenSigningProvider` (`SIGNING_PROVIDER=pkcs11`). Config:
  `SIGNING_PROVIDER=software|pkcs11`.
- Q: Is hardware signing done? → A: **HARDWARE_SIGNING_PENDING** —
  structure/library/PIN/cert selection implemented; **UNVERIFIED** until
  `HARDWARE-TEST.md` passes on a real eSeal. Skipped tests must never count as
  passed (`HardwareTokenSigningPendingTests`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pair a desktop signing device to the organization (Priority: P1)

An organization administrator opens the Devices screen, creates a short-lived
pairing code, and shows or copies it to the person who will run the desktop
signing helper on a Windows PC that has the eSeal USB token. That person opens
the tray helper, enters the pairing code, and confirms the device is linked to
the correct organization (receiving a revocable device token). The Devices
screen then shows the new device as paired, with last-seen status.

**Why this priority**: Without a trusted paired device, no document can be
signed under the organization's eSeal. Pairing is the gate for every later
story.

**Independent Test**: Create a pairing code in the web app; complete pairing on
a clean agent install; verify the device appears as paired with a working device
token and that an expired or revoked code cannot pair a second time.

**Acceptance Scenarios**:

1. **Given** an authorized admin on the Devices screen, **When** they create a
   pairing code, **Then** they receive a one-time, short-lived **pairing code**
   they can share out-of-band, and the code is listed as unused until claimed.
2. **Given** a valid unused pairing code, **When** the desktop helper submits it
   successfully, **Then** the device is registered to that tenant, the code is
   consumed, the agent receives a **revocable device token**, and the Devices
   screen shows the device name, paired time, and last seen.
3. **Given** a pairing code that was revoked or expired, **When** someone tries
   to pair with it, **Then** pairing fails with a clear message and no device
   record is created.
4. **Given** a paired device, **When** an admin unpairs it from the Devices
   screen, **Then** that device's token is revoked and the device can no longer
   pull documents or submit signatures for that tenant until paired again with
   a new code.

---

### User Story 2 - Sign pending documents with the eSeal token (Priority: P1)

An accountant marks a locally validated document as ready for signature. The
cloud places it in the tenant's pending-signature queue. The paired desktop
helper, with the eSeal token present and PIN entered locally, pulls the
document, builds the ETA canonical text for the document **excluding
`signatures`**, creates a CAdES-BES signature via BouncyCastle using the eSeal
key (PKCS#11, CSP fallback), embeds it as type **"I"**, and returns the signed
result. The cloud attaches the signature and advances the document so it is
ready for ETA submission in a later phase.

**Why this priority**: Producing a correct, ETA-acceptable signature on the
physical eSeal is the core business value of this feature.

**Independent Test**: Enqueue one ready document; with a paired agent and
token/PIN available (or a controlled test double for CI), complete a sign
cycle; verify the returned document carries an issuer signature and that the
canonical text used for signing matches the platform's golden vectors for the
same payload.

**Acceptance Scenarios**:

1. **Given** a document that has passed local validation and been sent for
   signature, **When** a paired online agent obtains work, **Then** it receives
   that document's payload and signs it without changing commercial amounts or
   structure.
2. **Given** the agent has produced a signature, **When** the cloud accepts
   the result, **Then** the document stores the embedded issuer signature
   (type **"I"**) and is no longer in the pending-signature queue.
3. **Given** the eSeal token is missing or the PIN is wrong, **When** the agent
   attempts to sign, **Then** the document remains pending, the user sees a
   local actionable error, and no partial or corrupt signature is attached in
   the cloud.
4. **Given** the same document payload, **When** the agent builds the digest
   input, **Then** it canonicalizes the **whole document excluding the
   `signatures` section**, matching **locked** platform golden vectors for that
   content scope (today: **gv-01** only), and embeds a **detached** CAdES-BES
   value satisfying FR-011 (ESS signing-certificate-v2 required) as type
   **"I"**.

---

### User Story 3 - Work offline and catch up when connectivity returns (Priority: P2)

The desktop helper loses connectivity to the cloud while documents are waiting
or while signed results are ready to upload. It keeps a local queue of work and
results, retries securely when the network returns, and never loses a
successfully created signature sitting on the machine.

**Why this priority**: Office networks and USB-token workstations are often
intermittently online; dropping signed work would force costly rework.

**Independent Test**: Enqueue documents, disconnect the agent mid-cycle, sign
locally if payload was already fetched, reconnect, and confirm results sync
without duplicates or lost signatures.

**Acceptance Scenarios**:

1. **Given** pending documents already downloaded to the agent, **When** the
   cloud becomes unreachable, **Then** those documents **remain in the local
   queue**, the agent can still complete signing locally (token and PIN
   permitting), and results are held until upload succeeds.
2. **Given** signed results waiting in the offline queue, **When** connectivity
   returns, **Then** the agent **syncs on reconnect**: uploads results over the
   secure channel, the cloud attaches each signature once (idempotent), and the
   local queue clears those items.
3. **Given** the cloud revoked or cancelled a document while the agent was
   offline, **When** the agent reconnects, **Then** it discards or rejects
   that work instead of attaching a stale signature.

---

### User Story 4 - Manage devices and see health on the Devices screen (Priority: P2)

Administrators open Devices to see all paired machines: name/label, pairing
status, whether the agent was recently seen, and high-level readiness hints
reported by the agent (without exposing secrets). They can rename, unpair, or
issue a new pairing code for a replacement PC.

**Why this priority**: Multi-PC organizations need visibility and revocation
without visiting each workstation.

**Independent Test**: Pair two devices (or one real and one simulated), verify
list fields, unpair one, confirm only the remaining device can sign.

**Acceptance Scenarios**:

1. **Given** one or more paired devices, **When** an admin opens Devices,
   **Then** each device shows identity label, status (paired/unpaired), and
   last-seen time in the user's locale.
2. **Given** a device that has not contacted the cloud within the expected
   heartbeat window, **When** the admin views the list, **Then** the device is
   visually marked stale or offline without removing the pairing.
3. **Given** an admin with manage rights, **When** they unpair a device,
   **Then** subsequent agent calls with that device's token are rejected.
4. **Given** a user without manage rights, **When** they attempt to create
   pairing codes or unpair, **Then** the action is denied.

---

### User Story 5 - Local agent experience (tray, PIN, readiness) (Priority: P3)

The Windows tray helper shows clear status: paired organization, online or
offline, token present or absent, and pending work count. The user enters the
eSeal PIN only on the local machine. The helper exposes a local secure endpoint
for supported local operations and keeps the cloud channel encrypted.

**Why this priority**: Day-to-day operators need confidence the signer is ready
without opening the web app; PIN handling must stay local for security.

**Independent Test**: Launch the agent paired; verify tray states for online or
offline and missing token; confirm PIN is never sent to the cloud (tests and
audit expectations).

**Acceptance Scenarios**:

1. **Given** a paired agent, **When** the user opens the tray menu, **Then**
   they see organization identity, connection state, and pending count.
2. **Given** signing requires the eSeal PIN, **When** the user unlocks the
   token, **Then** the PIN is used only locally and is not transmitted to the
   cloud or written to logs.
3. **Given** the agent is running, **When** health is checked, **Then** a
   local secure status endpoint reports readiness without exposing secrets.

---

### Edge Cases

- Pairing code reused after successful pair is rejected.
- PKCS#11 unavailable or failing for the inserted token: agent falls back to
  Windows CSP; if both fail, signing is blocked with a clear local message.
- Two agents claim the same pending document concurrently: only one wins; the
  other receives a conflict and moves on.
- Document content changes in the cloud after download but before upload: cloud
  rejects the signature for version mismatch; document returns to pending or
  failed-sign with a clear reason.
- Token present but certificate does not match the expected eSeal profile:
  signing is blocked with a clear local message.
- Agent paired to tenant A cannot access tenant B documents.
- Offline queue grows beyond a safe limit: oldest failed items surface as
  alerts; new downloads may pause until errors are cleared.
- Agent restart while offline: durable local queue of pending docs and signed
  results is restored and continues after relaunch.
- Admin unpairs while agent is mid-sign: upload of result is rejected; cloud
  does not attach.
- Empty pending queue: agent idles without errors.
- Pairing code expiry is evaluated with server time; agent shows clear expiry
  errors if the workstation clock differs.

## Requirements *(mandatory)*

### Functional Requirements

#### Pairing and device registry

- **FR-001**: Authorized users MUST be able to create a revocable, single-use,
  **short-lived pairing code** for their tenant.
- **FR-002**: The desktop signing helper MUST register as a device by consuming
  a valid pairing code and MUST receive a **revocable device token** used to
  authenticate subsequent cloud calls until the device is unpaired or the token
  is rotated/revoked.
- **FR-003**: Authorized users MUST be able to list paired devices (label,
  status, last seen) and unpair (revoke) any device, which MUST invalidate that
  device's token.
- **FR-004**: Revoked or unpaired devices MUST be rejected for pull and
  signature-submit operations.
- **FR-005**: Pairing codes, device tokens, and device records MUST be
  tenant-scoped; a device MUST NOT access another tenant's documents or device
  APIs.

#### Pending signature distribution

- **FR-006**: The cloud MUST maintain a per-tenant queue of documents that need
  an issuer signature (documents that are locally validated and explicitly sent
  for signature).
- **FR-007**: A paired agent MUST be able to obtain pending documents over a
  mutually authenticated secure channel (using its device token) and acknowledge
  claim so work is not double-processed.
- **FR-008**: The agent MUST return signed document results to the cloud; the
  cloud MUST attach the issuer signature to the stored document and remove it
  from the pending queue when acceptance checks pass.
- **FR-009**: Signature submit MUST be idempotent for a given document version
  so retries do not create duplicate signature entries.

#### Canonicalization and signing

- **FR-010**: Before signing, the agent MUST produce the ETA canonical string
  over the **entire document object excluding the `signatures` section**, using
  the same serialization rules and **locked** golden vectors as the shared
  platform library (feature **005**). **Locked count today = 1** (`gv-01`).
  PENDING vectors (`gv-02`…`gv-08`) MUST NOT be treated as CI SoT until promoted
  in **005**. A strip-signatures golden MUST prove: `(gv-01 input + dummy
  signatures array) → strip → canonicalize === gv-01 locked expected`.
- **FR-011**: The agent MUST hash that canonical string with SHA-256 over UTF-8
  bytes and produce an ETA-compliant **CAdES-BES** signature (**BouncyCastle**)
  using the eSeal certificate's RSA private key on the physical token (or a
  committed **software RSA test key** in CI). **Byte-exact match to reference
  `Cades.txt` is forbidden as a test oracle** (signing-time, RSA value, and cert
  differ). Instead, every produced CMS MUST satisfy this **measurable structural
  contract** (normative; mirrored in `contracts/agent-channel.md` and
  `packages/eta-core/docs/reference-algorithm.md`):

  | # | Requirement | Measurable assertion |
  |---|-------------|----------------------|
  | 1 | **Detached** CMS `SignedData` | Valid CMS/`SignedData`. `encapContentInfo.eContent` **MUST be absent** (detached). `encapContentInfo.eContentType` = DigestData OID **`1.2.840.113549.1.7.5`**. **Justification**: ETA *Digital Signature Format for E-Invoice System V1.1* (“eContent field should not be present as the expected digital signature format doesn’t contain the data (detached signature)”; ContentType DigestData). |
  | 2 | Digest algorithm SHA-256 | `digestAlgorithms` (and message-digest construction) use OID **`2.16.840.1.101.3.4.2.1`** (id-sha256). |
  | 3 | Required signed attributes | Present and correct: **content-type** (`1.2.840.113549.1.9.3`), **message-digest** (`1.2.840.113549.1.9.4`), **signing-time** (`1.2.840.113549.1.9.5`), and **ESS signing-certificate-v2** (`1.2.840.113549.1.9.16.2.47`) — **hard required** (ETA V1.1 / RFC 5035; ESS hash SHA-256). |
  | 4 | Document signature type | Embedded/uploaded entry has `signatureType` **`"I"`** (issuer). |
  | 5 | Cryptographic verify | Produced signature **verifies** against the signer certificate (software test cert in CI; eSeal cert on hardware path). |

  **CI CAdES golden gate (deterministic, no hardware):** Sign a fixed **locked**
  vector (gv-01 digest input) with a **committed software RSA test key** (not the
  token) and assert the full checklist above + crypto verify. Do **not**
  byte-compare CMS to bassemAgmi `Cades.txt`.

  **Oracles outside the software gate:** (a) Hardware-token signing via PKCS#11
  (`eps2003csp11.dll` / equivalent) is validated in **manual/hardware** tests
  gated separately. (b) The **definitive** oracle for CAdES correctness is **ETA
  preprod/sandbox accepting** the signed document (recorded as the final gate
  when ETA submit is in scope; this feature does not submit).

- **FR-011a**: Token private-key operations MUST use **PKCS#11** when available;
  if PKCS#11 cannot be used for the inserted token, the agent MUST fall back to
  **Windows CSP** for the same eSeal certificate/key.
- **FR-012**: The agent MUST embed the signature into the document's
  `signatures` structure as an issuer signature (type **"I"**).
- **FR-013**: The eSeal private key MUST NEVER leave the token; the cloud MUST
  NEVER receive the token PIN or private key material.
- **FR-014**: Automated tests MUST prove **cross-runtime** canonicalization
  parity in CI (constitution Principle IV): for **every locked** vector,
  `agent(input) === etaCore(input) === expected` in **one** comparative harness
  (not two independent suites alone). Current locked set size = **1** (`gv-01`).
  PENDING vectors are excluded until **005** promotion.

#### Offline and local agent

- **FR-015**: The agent MUST maintain a **durable local queue** of pending
  documents (downloaded payloads awaiting sign) and of signed results awaiting
  upload; when the cloud is unreachable the queue MUST persist across agent
  restarts, and the agent MUST **sync on reconnect**.
- **FR-016**: The agent MUST run as a Windows-first system tray application with
  visible connection, pairing, token, and pending-work status.
- **FR-017**: The agent MUST expose a local secure status endpoint for supported
  local operations without exposing secrets.
- **FR-018**: Communication between agent and cloud MUST use TLS; device
  authentication MUST use the **revocable device token** issued at pairing.

#### Web Devices experience

- **FR-019**: The product MUST provide a bilingual (Arabic and English,
  RTL-aware) Devices screen to create pairing codes, list devices, show
  last seen and status, and unpair devices.
- **FR-020**: Device management actions MUST be permission-protected and audited.

#### Audit and safety

- **FR-021**: The system MUST audit pairing code created or consumed, device
  unpaired (token revoked), document claimed for signature, signature accepted,
  and signature rejected (with reason codes)—never logging PIN, private keys,
  device token secrets, or oversized canonical blobs (optional hash only).
- **FR-022**: Cross-tenant access to devices, pairing codes, or pending documents
  MUST be impossible under application checks and database tenant isolation.

### Constitution Constraints *(mandatory — map applicable principles)*

- **CC-001 Reliability/Audit**: Pairing, unpair, claim, and sign accept/reject
  audited with actor or device, tenant, and outcome; acceptance scenarios are
  testable.
- **CC-002 Security**: Pairing codes and **device tokens** treated as secrets;
  TLS everywhere; PIN and private key stay on token or local agent;
  least-privilege device permissions; unpair revokes the device token.
- **CC-003 Tenant Isolation**: Devices, pairing codes, pending-signature jobs, and
  signed artifacts are tenant-scoped with row-level enforcement on new tables.
- **CC-004 ETA Serialization**: Agent MUST share **locked** golden-vector parity
  with platform canonicalization from feature **005** via a **single
  cross-runtime harness**; digest input is canonical UTF-8 of the document
  **excluding `signatures`**, then SHA-256; CAdES-BES via BouncyCastle under
  FR-011 structural contract (not `Cades.txt` byte-compare).
- **CC-005 Runtime ETA Config**: No hardcoded production ETA URLs or schemas in
  the agent or cloud for this feature's signing path; certificate selection
  remains operator or config driven.
- **CC-006 Sandbox-First**: Non-production verification uses sandbox-oriented
  configuration; ETA submit remains out of scope here (no accidental production
  submit). When submit exists, **sandbox acceptance** is the definitive CAdES
  correctness oracle.
- **CC-007 UX/i18n**: Devices screen Arabic and English with RTL; agent tray
  strings at least English, with Arabic preferred where practical for v1.
- **CC-008 Full-Stack Phase**: Backend device and queue APIs, Devices UI, and
  desktop agent signing path ship together with automated tests.

### Key Entities *(include if feature involves data)*

- **PairingCode** (pairing invitation): Tenant-scoped, single-use, short-lived,
  revocable code used to bind a new device; records creator, expiry, and
  consumed time.
- **SigningDevice**: Tenant-scoped registered agent instance; label, status
  (paired or revoked), **revocable device token** material, last seen, optional
  reported readiness hints.
- **SignatureJob**: Pending signature work item referencing a tenant document
  version; state (pending, claimed, completed, failed, cancelled); claim owner
  device; timestamps.
- **DocumentSignature** (logical): Issuer signature value and type **"I"**
  attached after successful agent submit; tied to document version; covers
  digest of document excluding `signatures`.
- **LocalAgentQueueItem** (on device only): Durable offline-held pending
  document payloads and signed results awaiting sync; survives agent restart;
  not a cloud table.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can create a pairing code and complete device
  pairing on a workstation in under 10 minutes without support intervention
  on the happy path.
- **SC-002**: For a standard single-document sign cycle with token ready and
  agent online, the document moves from pending signature to signature attached
  in under 2 minutes end-to-end under normal office conditions.
- **SC-003**: 100% of **LOCKED** golden canonical vectors (current count =
  **1**: `gv-01` only; PENDING `gv-02`…`gv-08` excluded) pass the **cross-runtime
  comparative harness** (`agent === etaCore === expected`) in CI; any
  one-character drift fails. Software-key CAdES structural gate (FR-011) also
  remains green.
- **SC-004**: After forced disconnect during or after local signing, 100% of
  successfully signed results in the test harness sync exactly once when
  connectivity is restored (no duplicates, no silent loss).
- **SC-005**: Unpairing a device causes subsequent sign attempts from that
  device to fail within one heartbeat or poll interval under test conditions.
- **SC-006**: Authorized users can identify stale devices (no recent last seen)
  on the Devices screen without opening each workstation.
- **SC-007**: Automated checks confirm a device or user from tenant A cannot
  list, pair into, or sign documents for tenant B.

## Assumptions

- Depends on feature **005** for document payloads, local validation, ready
  status, and shared canonicalization golden vectors. Signing digest applies
  those rules to the document **without** the `signatures` property.
- **Explicit 006 dependency on 005 vector promotion**: expanding the locked
  serialization gate beyond `gv-01` requires promoting PENDING vectors in
  **005** (real bassemAgmi `CanonicalString.txt`); 006 MUST NOT invent expected
  strings or treat candidates/PENDING as locked.
- ETA **submission** of the fully signed document remains out of scope (signature
  attachment only). Sandbox acceptance remains the recorded **definitive** CAdES
  oracle for a later submit feature.
- Windows is the primary supported desktop OS for the tray agent in v1; other
  desktop OS support is out of scope.
- Organizations use a physical eSeal USB or HSM token; soft certificates without
  a token are out of scope for v1.
- **Token access**: PKCS#11 preferred; Windows CSP fallback when PKCS#11 cannot
  complete the operation for that token.
- **CAdES-BES** construction uses **BouncyCastle** (aligned with constitution
  technology baseline).
- Any paired device for a tenant may claim pending signature jobs for that
  tenant (no per-document device assignment in v1).
- Default roles: Owner and Admin manage devices; Accountant may view device
  status and send documents for signature; Viewer cannot manage devices (exact
  permission codes finalized in planning).
- Pairing codes expire in a short window (about 15 to 60 minutes) by default.
- Agent prompts for PIN locally as needed; optional short-lived local PIN
  session unlock is allowed but PIN never leaves the machine.
- "Send for signature" is an explicit action after local validation succeeds
  (drafts do not auto-queue).
- Local secure endpoint is bound to loopback only with protection appropriate
  for a tray agent.
- Last-seen updates occur often enough for admins to detect offline devices
  within minutes, not hours.
- Secure cloud channel transport (HTTPS polling vs WebSocket push) is a planning
  choice provided TLS and device-token auth are preserved.

## Out of Scope

- Submitting signed documents to ETA and handling ETA receipts or responses.
- Mobile or non-Windows agent installs for v1.
- Cloud-held private keys or server-side signing without the physical token.
- Multi-tenant pairing of one agent instance to several tenants at once (one
  active tenant pairing per agent instance in v1).
- Full remote desktop management or remote PIN entry.
- Changing commercial document content on the agent (agent signs the provided
  payload; corrections happen in the web app).
