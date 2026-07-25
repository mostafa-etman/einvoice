# Data Model: Desktop Signing Agent & Device Management

**Feature**: `006-desktop-signing-agent` | **Date**: 2026-07-25

## Overview

Tenant-scoped device pairing, signature jobs, and document signature attachment.
Agent-local SQLite is documented separately (not Prisma). FORCE RLS on all new
Postgres tables.

## Enums

### PairingCodeStatus

`ACTIVE` | `CONSUMED` | `REVOKED` | `EXPIRED`

### DeviceStatus

`PAIRED` | `REVOKED`

### SignatureJobStatus

`PENDING` | `CLAIMED` | `COMPLETED` | `FAILED` | `CANCELLED`

### DocumentStatus (extend 005)

Existing: `DRAFT` | `READY`  
**Add**: `SIGNED` — issuer signature attached; not submitted to ETA.

## Postgres entities

### PairingCode

| Field | Type | Notes |
|-------|------|--------|
| id | uuid PK | |
| tenantId | uuid FK | RLS |
| codeHash | string | hash of pairing code (never store plaintext) |
| codeHint | string? | optional last-4 for UI |
| status | PairingCodeStatus | |
| expiresAt | datetime | |
| createdByUserId | uuid? | |
| consumedAt | datetime? | |
| consumedByDeviceId | uuid? FK | |
| createdAt / updatedAt | datetime | |

**Rules**: Single-use; reject if expired/revoked/consumed; TTL default 30 min.

---

### SigningDevice

| Field | Type | Notes |
|-------|------|--------|
| id | uuid PK | |
| tenantId | uuid FK | RLS |
| label | string | user-visible name |
| machineFingerprint | string? | optional stable id from agent |
| status | DeviceStatus | |
| tokenHash | string | hash of device token |
| tokenExpiresAt | datetime? | null = until revoke |
| lastSeenAt | datetime? | |
| lastReadyJson | jsonb? | non-secret readiness hints |
| pairedAt | datetime | |
| revokedAt | datetime? | |
| createdAt / updatedAt | datetime | |

**Rules**: Unpair → `REVOKED`, clear/rotate `tokenHash`; authenticated agent
calls MUST match hash + `PAIRED`.

---

### SignatureJob

| Field | Type | Notes |
|-------|------|--------|
| id | uuid PK | |
| tenantId | uuid FK | RLS |
| documentId | uuid FK → Document | |
| documentVersion | int | optimistic version at enqueue |
| status | SignatureJobStatus | |
| claimedByDeviceId | uuid? FK | |
| claimExpiresAt | datetime? | lease |
| failureCode | string? | |
| createdAt / updatedAt | datetime | |
| completedAt | datetime? | |

**Rules**: Unique active job per `(documentId)` while PENDING/CLAIMED; claim is
CAS; submit validates `documentVersion` still matches.

---

### Document (delta from 005)

| Field | Change |
|-------|--------|
| status | allow `SIGNED` |
| signaturesJson | jsonb? — ETA `signatures` array after intake |
| signedAt | datetime? |
| signedByDeviceId | uuid? |

## Agent-local SQLite (not cloud)

### LocalQueueItem

| Field | Notes |
|-------|--------|
| id | local PK |
| jobId | cloud SignatureJob id |
| documentId / version | |
| payloadJson | pending doc without needing signatures |
| signedJson | nullable result awaiting upload |
| state | `PENDING_SIGN` \| `PENDING_UPLOAD` \| `DONE` \| `DEAD` |
| attempts | int |
| lastError | text? |
| updatedAt | |

Persisted under agent AppData; sync on reconnect.

## Relationships

```text
Tenant 1—* PairingCode
Tenant 1—* SigningDevice
Tenant 1—* SignatureJob
Document 1—* SignatureJob
SigningDevice 0..* SignatureJob (claims)
```

## State transitions

### PairingCode

```text
ACTIVE --[pair success]--> CONSUMED
ACTIVE --[admin revoke]--> REVOKED
ACTIVE --[past expiresAt]--> EXPIRED (lazy)
```

### SigningDevice

```text
(none) --[pair]--> PAIRED
PAIRED --[unpair]--> REVOKED
```

### SignatureJob

```text
PENDING --[claim]--> CLAIMED
CLAIMED --[submit ok]--> COMPLETED
CLAIMED --[lease expire]--> PENDING
CLAIMED --[fail]--> FAILED
PENDING|CLAIMED --[cancel]--> CANCELLED
```

### Document

```text
READY --[send-for-signature]--> READY (+ SignatureJob PENDING)
READY --[intake ok]--> SIGNED
```

## Audit actions (examples)

- `devices.pairing.create|consume|revoke`
- `devices.device.unpair`
- `signing.job.claim|complete|fail`
- `documents.send_for_signature`

Never log PIN, device token plaintext, or full CAdES if oversized (hash OK).

## Permissions

See [contracts/permissions.md](./contracts/permissions.md).
