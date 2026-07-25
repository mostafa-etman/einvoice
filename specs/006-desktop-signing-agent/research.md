# Research: Desktop Signing Agent & Device Management

**Feature**: `006-desktop-signing-agent` | **Date**: 2026-07-25

## R1 — Tray UI: WPF vs WinForms

**Decision**: **WPF** tray application hosting `Microsoft.Extensions.Hosting`
background services in-process (worker for channel + queue + signing).

**Rationale**: Better long-term UI for status/PIN prompts; Host integration is
clean for DI (signing, PKCS#11, SQLite, HTTP). User allowed either; WPF aligns
with modern .NET desktop.

**Alternatives considered**:
- WinForms NotifyIcon-only — simpler, rejected for weaker structured UI growth.
- Separate Windows Service + tiny tray — more processes/IPC; deferred.

## R2 — Local status HTTP

**Decision**: Loopback-only **Kestrel** mini server (e.g. `https://127.0.0.1:<port>`
or `http://127.0.0.1` with OS ACLs) exposing readiness: paired, online, token
present, pending counts. No device token secrets in responses.

**Rationale**: Spec FR-017; easy for support/scripts; matches “local mini HTTP”.

**Alternatives considered**: Named pipes only — less accessible for quick checks.

## R3 — Canonical serialize + digest scope

**Decision**: Reuse existing agent `CanonicalSerialize` (005 / bassemAgmi mirror).
For signing, build digest input by serializing a **copy of the document JSON with
the `signatures` property removed** (or never present), then
`SHA256(UTF8(canonical))`. Platform attach path MUST use the same exclusion.

**Strip-signatures golden (C3)**: Fixture = `gv-01` input JSON **plus** a dummy
`signatures: [{ signatureType: "I", value: "dummy" }]` array → strip →
`CanonicalSerialize` MUST equal locked `gv-01` expected bytes.

**Rationale**: Spec clarification; ETA signs content excluding signatures array.

**Alternatives considered**: Serialize then strip tokens from string — brittle;
rejected.

## R4 — CAdES-BES + token access (structural contract)

**Decision**: **BouncyCastle** for **detached** CAdES-BES (CMS `SignedData`).
Private key ops via **Pkcs11Interop** first; **Windows CSP** fallback when
PKCS#11 cannot open the token/cert.

**ETA attached vs detached (authoritative)**:
- Source: ETA *Digital Signature Format for E-Invoice System V1.1*
  (`https://www.eta.gov.eg/sites/default/files/2021-09/Digital%20Signature%20Format%20V1.1_final_0.pdf`)
- **Detached**: `encapContentInfo.eContent` MUST NOT be present; `eContentType`
  = DigestData OID `1.2.840.113549.1.7.5`.

**Measurable FR-011 checklist (do NOT byte-compare to bassemAgmi `Cades.txt`)**:

1. Valid detached CMS SignedData (eContent absent; DigestData content type).
2. Digest alg OID `2.16.840.1.101.3.4.2.1` (SHA-256).
3. Signed attrs: content-type, message-digest, signing-time, **ESS
   signing-certificate-v2** (`1.2.840.113549.1.9.16.2.47`) — hard required.
4. Document entry `signatureType === "I"`.
5. Cryptographic verification against signer cert.

**CI oracle**: Committed software RSA test key + locked gv-01 digest input →
assert full checklist (CAdES golden gate).  
**Hardware oracle**: Manual/`EINVOICE_HARDWARE_TOKEN=1` PKCS#11
(`eps2003csp11.dll`).  
**Definitive oracle**: ETA preprod/sandbox **accepts** the signed document
(recorded; submit out of scope for 006).

**Rationale**: Spec + constitution baseline; dual path maximizes hardware
compatibility; structural contract is the only stable CI oracle.

**Alternatives considered**: Pure CSP-only — fails many USB tokens that expose
PKCS#11 only. Byte-exact `Cades.txt` compare — impossible (time/sig/cert).

## R5 — Cloud channel: WebSocket vs HTTPS

**Decision**: **HTTPS** REST for pairing, claim, submit, heartbeat (authoritative).
**WebSocket** (authenticated with device token) for low-latency “work available”
notifications; agent falls back to HTTPS poll with exponential backoff if WS
drops.

**Rationale**: User asked for both; REST is simpler to test/revoke; WS improves
latency without being the sole path.

**Alternatives considered**: WS-only — harder offline/resume semantics.

## R6 — Offline queue storage

**Decision**: **SQLite** file under `%LocalAppData%/Einvoice.Agent/` (or equivalent)
storing pending payloads, signed results, attempt counts, lease ids.

**Rationale**: Durable across restarts; FR-015 / SC-004; Complexity Tracking
justifies deviation from “Postgres-only” (agent-local only).

**Alternatives considered**: LiteDB; JSON files — SQLite has better concurrent
write + query support.

## R7 — Pairing code → device token

**Decision**: Admin creates code (e.g. 8–10 char, TTL 15–60 min, single-use).
Agent `POST /devices/pair` with code + device label/machine id → receives
**device access token** (opaque, high entropy). Server stores **hash** of token;
plaintext shown once to agent only. Unpair deletes/rotates hash → next call 401.

**Rationale**: Spec FR-001/002/003; immediate revocation testable.

## R8 — Signature job claim

**Decision**: `SignatureJob` rows with states `PENDING|CLAIMED|COMPLETED|FAILED|
CANCELLED`. Claim uses compare-and-set + short lease; heartbeat extends lease.
Submit includes `documentId`, `version`, Base64 CAdES, optional cert thumbprint.

**Rationale**: Prevents double-sign; idempotent submit by `(documentId, version)`.

## R9 — Golden vectors (“Phase 4”) — locked-only + cross-runtime parity

**Decision**: Treat user “Phase 4” as feature **005** serialization suite.
**Locked set today = 1 vector (`gv-01`)**. PENDING `gv-02`…`gv-08` and
`*.canonical.PENDING.txt` / candidates are **excluded** from CI gates until
promoted in **005** after a real bassemAgmi `CanonicalString.txt` paste.
**006 depends on 005** for any expansion of the locked set.

**Cross-runtime harness (C1 / constitution IV)**: One comparative test (script or
jest+dotnet orchestration) asserts per locked vector:
`agent(input) === etaCore(input) === expected` (byte-exact UTF-8). Separate
agent-only or eta-core-only suites alone are **not** sufficient for the merge
gate.

**Strip golden (C3)**: See R3.

**Rationale**: Constitution IV; shared SoT; avoid false “all vectors” claims.

## R10 — CAdES structure tests without USB

**Decision**: **CAdES golden gate** in CI: software RSA test key signs locked
gv-01 digest; assert FR-011 checklist items 1–5 (detached CMS, SHA-256 OID,
content-type / message-digest / signing-time / ESS signing-certificate-v2,
signatureType `"I"`, crypto verify). Map assertions to tasks T023a–T023g.
Hardware PKCS#11 tests gated `EINVOICE_HARDWARE_TOKEN=1`. Do not compare CMS
bytes to reference `Cades.txt`.

**Rationale**: CI cannot assume USB; structural + verify is the stable gate;
sandbox acceptance remains definitive when submit exists.

## R11 — Permissions

**Decision**: Add `devices.view` / `devices.manage`. Owner/Admin manage;
Accountant view (+ send-for-signature uses existing `documents.manage`); Viewer
neither manage nor pair.

**Rationale**: Spec assumptions; finalize in `contracts/permissions.md`.

## R12 — Document send-for-signature

**Decision**: Extend documents API with `POST /documents/{id}/send-for-signature`
(READY → creates `SignatureJob` PENDING). Intake on success sets document status
to `SIGNED` (new) or keeps READY + `signatures` populated — **Decision**: add
status **`SIGNED`** meaning issuer signature attached, not yet submitted to ETA.

**Rationale**: Clear queue vs authoring states; submit remains future feature.
