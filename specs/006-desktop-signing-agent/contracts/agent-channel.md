# Agent ↔ Cloud Channel Contract

**Feature**: `006-desktop-signing-agent`

## Auth

- After pairing, all agent cloud calls send:
  `Authorization: Bearer <device_token>`
- Server resolves device by token hash; requires `status=PAIRED`.
- **Revocation**: unpair → immediate `401` on next call (SC-005).

## Transport

| Path | Role |
|------|------|
| HTTPS REST | Pairing, heartbeat, claim, submit, cancel sync (authoritative) |
| WebSocket | Optional `work.available` ping; same Bearer; reconnect + backoff |

HTTPS poll interval when WS down: start 5s, exponential backoff to ≤60s jitter.

## REST (device-authenticated)

### `POST /agent/pair` (unauthenticated)

Request: `{ "pairingCode": "...", "label": "...", "machineFingerprint": "..." }`  
Response `201`: `{ "deviceId", "deviceToken", "tenantId", "expiresAt": null }`  
Errors: `400` invalid/expired/consumed code.

### `POST /agent/heartbeat`

Body: `{ "ready": { "tokenPresent": bool, "pendingLocal": number } }`  
Updates `lastSeenAt` / `lastReadyJson`.

### `POST /agent/jobs/claim`

Body: `{ "max": 1 }`  
Response `200`: `{ "jobs": [ { "jobId", "documentId", "documentVersion", "etaPayload" } ] }`  
Empty array if none. Payload MUST be document JSON **without** requiring
pre-existing signatures (or with signatures omitted for signing).

### `POST /agent/jobs/{jobId}/submit`

Body: `{ "documentId", "documentVersion", "signatureType": "I", "cadesBase64", "certificateThumbprint?" }`  
Server: verify job claim + version; attach `{ signatureType: "I", value }` to
document `signatures`; set document `SIGNED`; job `COMPLETED`.  
Idempotent if already completed for same version.  
`409` version mismatch; `401` revoked device; `404` unknown job.

### `POST /agent/jobs/{jobId}/fail`

Body: `{ "code", "message" }` — releases or marks FAILED per policy.

## WebSocket (optional)

```text
→ auth: { type: "auth", token }
← auth.ok
← { type: "work.available", count }
→ { type: "ping" } / ← { type: "pong" }
```

Agent still uses REST claim/submit after notification.

## Signing pipeline (agent-local)

1. Strip / omit `signatures` from payload copy  
2. `canonical = CanonicalSerialize(copy)` (same as **005 locked** vectors; today
   `gv-01` only)  
3. `hash = SHA256(UTF8(canonical))`  
4. CAdES-BES (BouncyCastle) per **FR-011 structural contract** (below) using
   token key (or software test key in CI)  
5. Embed locally for upload: `signatures: [{ signatureType: "I", value: cadesBase64 }]`

### FR-011 CAdES structural contract (normative mirror)

**Detached** CMS (ETA Digital Signature Format V1.1 — `eContent` absent;
`eContentType` = DigestData `1.2.840.113549.1.7.5`). Do **not** byte-compare to
reference `Cades.txt`.

| Assertion | OID / rule | Task map |
|-----------|------------|----------|
| Valid detached SignedData | `eContent` absent; DigestData content type | T023a |
| Digest algorithm SHA-256 | `2.16.840.1.101.3.4.2.1` | T023b |
| Signed attr content-type | `1.2.840.113549.1.9.3` | T023c |
| Signed attr message-digest | `1.2.840.113549.1.9.4` | T023c |
| Signed attr signing-time | `1.2.840.113549.1.9.5` | T023c |
| ESS signing-certificate-v2 | `1.2.840.113549.1.9.16.2.47` (hard required) | T023d |
| Document `signatureType` | `"I"` | T023e |
| Crypto verify vs signer cert | software test key in CI | T023f |
| Software-key CAdES golden gate | sign locked gv-01 digest; full checklist | T023g |

Hardware PKCS#11 (`eps2003csp11.dll`) = gated/manual. Definitive oracle = ETA
sandbox acceptance (when submit exists).

## Offline SQLite

States: `PENDING_SIGN` → `PENDING_UPLOAD` → `DONE`. Retry submit with backoff;
on `401` mark device unpaired locally and stop uploads.
