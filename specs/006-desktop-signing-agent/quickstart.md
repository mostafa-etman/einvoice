# Quickstart Validation: Desktop Signing Agent

**Feature**: `006-desktop-signing-agent` | **Date**: 2026-07-25

Prerequisites: Feature **005** documents + golden vectors; Compose Postgres/Redis;
.NET 8 SDK; Windows for tray (CI can run serialize/CAdES unit tests
cross-platform where PKCS#11 is mocked).

Contracts: [devices-api.yaml](./contracts/devices-api.yaml),
[agent-channel.md](./contracts/agent-channel.md),
[permissions.md](./contracts/permissions.md). Model: [data-model.md](./data-model.md).

## 0. Env

- API: existing JWT + `DATABASE_URL` / Redis  
- Agent: `EINVOICE_API_BASE_URL`, optional PKCS#11 library path, cert issuer
  filter (e.g. Egypt Trust), SQLite path under LocalAppData  
- Never commit device tokens or pairing codes

## 1. Locked golden canonical + cross-runtime parity (blocking)

**Locked count today = 1 (`gv-01`).** PENDING `gv-02`…`gv-08` are excluded.

```bash
pnpm --filter @einvoice/eta-core test -- --runInBand
dotnet test apps/agent/Einvoice.Agent.sln --filter CanonicalSerialize
# T010a — single comparative harness (agent === etaCore === expected):
# (command wired by T010a / CI — e.g. node tools/parity-canonical/run.mjs)
```

**Expect**: Locked vectors only; cross-runtime byte-exact parity.

## 1b. Strip-signatures golden (T010b)

**Expect**: `gv-01` input + dummy `signatures` → strip → canonicalize === locked
`gv-01` expected.

## 2. CAdES FR-011 structural gate (software key — T023a–T023g)

```bash
dotnet test apps/agent/Einvoice.Agent.sln --filter Cades
```

**Expect** (no `Cades.txt` byte-compare): detached CMS (`eContent` absent,
DigestData `1.2.840.113549.1.7.5`); digest OID `2.16.840.1.101.3.4.2.1`;
signed attrs content-type / message-digest / signing-time; ESS
signing-certificate-v2 `1.2.840.113549.1.9.16.2.47`; `signatureType` `"I"`;
crypto verify vs software test cert. Hardware PKCS#11 gated separately;
definitive oracle = ETA sandbox accept (later submit feature).

## 3. Pairing + revoke (API)

With API up and migrated:

1. Owner creates pairing code: `POST /devices/pairing-codes`  
2. Agent (or test client) `POST /agent/pair` with code → device token  
3. Heartbeat succeeds with Bearer token  
4. Admin `POST /devices/{id}/unpair`  
5. Next heartbeat/claim → **401**

**Expect**: Immediate revocation (SC-005).

## 4. Sign cycle (happy path)

1. Create READY document (005 flow)  
2. `POST /documents/{id}/send-for-signature` → job PENDING  
3. Agent claim → strip signatures → canonicalize → CAdES → submit  
4. Document status `SIGNED`; `signatures[0].signatureType === "I"`

Offline variant: disconnect after claim, sign locally, reconnect, submit once.

## 5. Devices UI smoke

```bash
pnpm --filter @einvoice/web test -- --testPathPattern=devices --runInBand
```

**Expect**: ar/en copy for pair/unpair/last seen.

## 6. Hardware (optional, gated)

```bash
# EINVOICE_HARDWARE_TOKEN=1
dotnet test ... --filter HardwareToken
```

**Expect**: PKCS#11 (or CSP fallback) signs a fixture payload when token+PIN
available.
