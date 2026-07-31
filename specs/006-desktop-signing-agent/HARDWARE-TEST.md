# Hardware token signing — PENDING until a physical eSeal arrives

**Marker**: `HARDWARE_SIGNING_PENDING`  
**Status**: Implementation is **token-ready** (library load, cert selection, PIN login,
CSP fallback), but **UNVERIFIED**. Do **not** claim hardware signing works until you
complete this runbook on a real token and confirm success.

Software provider (`SIGNING_PROVIDER=software`) is the verified path for CI and
local progress today.

Skipped CI tests (never counted as passed):
`HardwareTokenSigningPendingTests` in `apps/agent/tests/Einvoice.Agent.Tests/`.

---

## Client install (non-technical)

See also [`apps/agent/AGENT-CREDENTIALS.md`](../../apps/agent/AGENT-CREDENTIALS.md)
for the cloud vs agent trust boundary.

1. Install the desktop agent on the PC that will hold the USB token.
2. Plug in the eSeal token (CA middleware already installed).
3. Web app → **Devices** → create a pairing code.
4. Agent tray → **Pair device…** → paste the code.
5. Confirm auto-detected PKCS#11 library + certificate (or set manually in the agent).
6. When a document is sent for signature, enter the PIN in the agent (optional
   “Remember PIN” uses Windows DPAPI on this PC only — never the cloud).

---

## Provider switch

| Config | Provider | When |
|--------|----------|------|
| `SIGNING_PROVIDER=software` (default) | `SoftwareKeySigningProvider` | Dev + CI now |
| `SIGNING_PROVIDER=pkcs11` | `Pkcs11TokenSigningProvider` | Physical token later |

Aliases: `EINVOICE_SIGNING_PROVIDER`, legacy `EINVOICE_SIGNING_KEY_SOURCE`
(`Software` → software; `Pkcs11` / `Csp` / `Auto` → pkcs11).

---

## Prerequisites (token day)

1. API + web running; migrations include `20260725060000_signing_devices`.
2. Build desktop agent:

```powershell
dotnet build apps/agent/src/Einvoice.Agent.Desktop/Einvoice.Agent.Desktop.csproj -c Release
```

3. USB eSeal plugged in; vendor middleware installed so one of these exists:
   - `C:\Windows\System32\eps2003csp11.dll`
   - `C:\Windows\System32\SignatureP11.dll`
   - or set `EINVOICE_PKCS11_LIBRARY` to the real path
4. You know the token **PIN**.

## Environment

```powershell
$env:AGENT_ENVIRONMENT = "Development"
$env:EINVOICE_API_BASE_URL = "http://localhost:3001"
$env:SIGNING_PROVIDER = "pkcs11"
# Optional:
# $env:EINVOICE_PKCS11_LIBRARY = "C:\Windows\System32\eps2003csp11.dll"
# $env:EINVOICE_CERT_FILTER = "Egypt Trust"
# $env:EINVOICE_CERT_THUMBPRINT = "AABBCC..."

dotnet run --project apps/agent/src/Einvoice.Agent.Desktop -c Release
```

---

## Manual test (exact sequence when token arrives)

### 1. Pair device

| Step | Action | Expected |
|------|--------|----------|
| 1 | Web **Devices** → create pairing code | Code shown once |
| 2 | Tray → **Pair device…** → paste code | Success; device **PAIRED** |
| 3 | Tray tooltip | Online |

### 2. Enter PIN

| Step | Action | Expected |
|------|--------|----------|
| 1 | Tray → **Unlock token PIN…** | Local PIN dialog |
| 2 | Enter correct PIN | Tray shows `PIN unlocked` |
| 3 | Confirm PIN never leaves the machine | No PIN in API/heartbeat/network |

### 3. Sign gv-01 / READY document (CAdES structural checklist)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Create/validate document (or use locked gv-01 digest input) → Mark ready → **Send for signature** | Job pending |
| 2 | Agent claims + signs with PKCS#11/CSP | Tray `pending=` drains |
| 3 | Document status | **SIGNED**, `signatureType === "I"`, non-empty Base64 |
| 4 | Confirm source | `signingSource` starts with `PKCS#11:` or `CSP/CNG:` — **not** `SoftwarePEM` |
| 5 | FR-011 checklist | Detached DigestedData CMS; content-type; SHA-256; signing-time; ESS cert-id; crypto verifies vs **eSeal** cert |

### 4. Submit to ETA sandbox (definitive oracle)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Submit the signed document to ETA preprod/sandbox | ETA accepts (or clear reject reason) |
| 2 | Record acceptance id / response | Keep for clearing `HARDWARE_SIGNING_PENDING` |

### 5. Revocation + offline (regression)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Unpair device while agent running | Tray Unpaired / 401 |
| 2 | Offline queue under `%LocalAppData%\Einvoice.Agent\queue.db` | Survives restart; drains once; no duplicate signatures |

---

## After you confirm

Reply with: DLL path, PKCS#11 vs CSP, that a real doc reached **SIGNED** with type **I**,
FR-011 checklist OK, and ETA sandbox acceptance. Only then:

1. Set `Pkcs11TokenSigningProvider.IsHardwarePathVerified => true`
2. Remove `Skip` from `HardwareTokenSigningPendingTests` (or convert to gated `EINVOICE_HARDWARE_TOKEN=1`)
3. Clear `HARDWARE_SIGNING_PENDING` from tasks/spec

Until then: **hardware signing is UNVERIFIED**.
