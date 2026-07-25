# Implementation Plan: Desktop Signing Agent & Device Management

**Branch**: `006-desktop-signing-agent` | **Date**: 2026-07-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-desktop-signing-agent/spec.md`
plus technical direction: .NET 8 tray app (WPF) + background worker; local mini
HTTP status; signing = canonicalSerialize (eta-core mirror, shared golden
vectors) → SHA-256 → CAdES-BES (BouncyCastle) via PKCS#11 PIN (CSP fallback);
cloud channel authenticated WebSocket/HTTPS (pull pending, push signed,
retry/backoff); offline queue in SQLite; Nest backend Device + pairing +
pending distribution + signature intake; web Devices screen; tests reuse
`005` golden vectors, validate CAdES structure, prove revocation blocks
immediately.

## Summary

Ship the **desktop signing** vertical: pair a Windows agent to a tenant with a
short-lived pairing code and a **revocable device token**; pull documents that
need an issuer signature; canonicalize the payload **excluding `signatures`**
identically to `@einvoice/eta-core`; produce **CAdES-BES** on the eSeal token;
attach signature type **"I"** in the cloud. Support durable **offline SQLite
queue** and sync on reconnect. Admins manage devices on a bilingual Devices
screen. No ETA submission in this feature.

## Technical Context

**Language/Version**: TypeScript 5.x (NestJS 10 API, Next.js 15 web); C# / .NET 8
(WPF tray agent + worker + local HTTP)

**Primary Dependencies**: NestJS + Prisma + RLS; Next.js 15, next-intl, TanStack
Query; agent: WPF, `Microsoft.Extensions.Hosting`, Kestrel (localhost),
Newtonsoft.Json (canonical parity with bassemAgmi/`CanonicalSerialize`),
BouncyCastle (CAdES-BES), Pkcs11Interop (PKCS#11), optional Windows CSP path,
SQLite (offline queue), WebSocket client + HTTPS

**Storage**: PostgreSQL — `SigningDevice`, `PairingCode`, `SignatureJob`,
document signature fields (FORCE RLS); agent local **SQLite** for offline queue;
Redis optional for device presence / job fan-out (not required for MVP if
polling works)

**Testing**: Agent golden suite = **same**
`specs/005-document-building-serialization/golden-vectors/` locked files as
005/eta-core; CAdES structure unit tests (detached CMS parse / required OIDs);
API tests for pairing, claim, intake, **immediate revoke**; web Devices smoke
(ar/en); no live USB required in CI (PKCS#11 mocked; optional gated hardware
job)

**Target Platform**: Existing Compose api/web/Postgres; Windows agent on
developer PCs + CI Windows runner or Linux-skipped hardware tests; Traefik TLS
for cloud channel

**Project Type**: Multi-tenant SaaS (API + web) + desktop signing agent

**Performance Goals**: Claim→sign→intake for a typical invoice p95 < 30s with
token unlocked; local status HTTP p95 < 50ms; reconnect sync drains queue without
duplicates

**Constraints**: Device token never logged; PIN never leaves machine; private key
never exported; digest = SHA-256(UTF-8(canonical without `signatures`));
revocation must fail next authenticated call; tenant RLS on all new tables;
reuse 005 `CanonicalSerialize` / vectors — do not fork algorithm

**Scale/Scope**: Multi-device per tenant; any paired device may claim jobs;
MVP: pairing + sign path + Devices UI + offline queue; ETA submit out of scope

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Reliability & Audit**: PASS — golden + CAdES + pairing/revoke/intake
  tests; audit pairing, unpair, claim, sign accept/reject
- **II. Security by Default**: PASS — pairing codes hashed at rest; device
  tokens hashed/encrypted; TLS; PIN local-only; no secrets in web bundles
- **III. Multi-Tenant Isolation**: PASS — Device/PairingCode/SignatureJob FORCE
  RLS + device-token tenant binding
- **IV. Serialization Parity**: PASS — agent consumes **005** golden vectors
  + existing `CanonicalSerialize`; signing uses exclude-`signatures` wrapper
- **V. Runtime ETA Config**: PASS — no hardcoded ETA schemas; signing does not
  submit; cert selection is local config/operator
- **VI. Sandbox-First**: PASS — no ETA submit; cloud URLs from env
- **VII. UX/i18n**: PASS — Devices screen ar/en + RTL; agent tray en (+ ar where
  practical)
- **VIII. Phased Full-Stack DoD**: PASS — API + Devices UI + agent ship together
- **Stack**: PASS — .NET 8 + BouncyCastle + PKCS#11/CSP within constitution;
  SQLite on agent is local-only (Complexity note below)

## Project Structure

### Documentation (this feature)

```text
specs/006-desktop-signing-agent/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── devices-api.yaml
│   ├── agent-channel.md
│   └── permissions.md
└── tasks.md              # /speckit-tasks (not this command)
```

### Source Code (repository root)

```text
apps/api/
├── src/devices/                 # pairing, device CRUD, revoke
├── src/signing/                 # SignatureJob claim/intake, attach to Document
└── prisma/                      # migrations + RLS

apps/web/
├── src/app/[locale]/(app)/devices/
└── src/lib/api/devices.ts

apps/agent/
├── src/Einvoice.Agent/          # expand: WPF shell, Host worker, local HTTP
│   ├── CanonicalSerialize.cs    # existing (005) — reuse
│   ├── Signing/                 # CAdES-BES, PKCS#11/CSP, digest exclude signatures
│   ├── Channel/                 # HTTPS + WebSocket client, retry/backoff
│   ├── Queue/                   # SQLite offline store
│   └── LocalHttp/               # loopback status API
└── tests/
    ├── CanonicalSerializeGoldenTests.cs   # existing
    ├── CadesStructureTests.cs
    └── RevocationChannelTests.cs          # as applicable

packages/shared/
└── src/permissions.ts           # devices.view / devices.manage

specs/005-document-building-serialization/golden-vectors/   # shared SoT
```

**Structure Decision**: Extend existing `apps/agent` rather than a second
desktop project. API modules `devices` + `signing` beside existing `documents`.
Web Devices page under `(app)/devices`. Offline SQLite lives only under the
agent process data directory (not cloud Postgres).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Agent-local SQLite | Durable offline pending docs + signed results across restarts | In-memory queue loses work on crash/restart (violates FR-015 / SC-004) |

## Phase 0 / Phase 1

See [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md).

### Constitution Check (post-design)

Re-validated PASS: contracts enforce device-token auth + revoke; data model
FORCE RLS; golden vector path unchanged from 005; CAdES tests planned; Devices
i18n called out in quickstart.
