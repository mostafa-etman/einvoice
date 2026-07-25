# Hardware token signing — Windows test runbook

**Status**: Implementation is ready for **your** confirmation on a physical eSeal
token. Do **not** treat hardware signing as verified until you complete the
steps below and confirm success.

Software-key CI path remains the automated gate (`EINVOICE_SIGNING_KEY_SOURCE=Software`).

## Prerequisites

1. API running (`pnpm --filter @einvoice/api start:dev` or Compose) with migrations applied (`20260725060000_signing_devices`).
2. Web app running; you can open **Devices** and **Documents**.
3. .NET 8 SDK; build desktop agent:

```powershell
dotnet build apps/agent/src/Einvoice.Agent.Desktop/Einvoice.Agent.Desktop.csproj -c Release
```

4. USB eSeal token plugged in; vendor middleware installed so one of these exists:
   - `C:\Windows\System32\eps2003csp11.dll`
   - `C:\Windows\System32\SignatureP11.dll`
   - or set `EINVOICE_PKCS11_LIBRARY` to the real path
5. You know the token **PIN**.

## Environment (PowerShell before launch)

```powershell
$env:AGENT_ENVIRONMENT = "Development"
$env:EINVOICE_API_BASE_URL = "http://localhost:3001"   # your API
$env:EINVOICE_SIGNING_KEY_SOURCE = "Auto"              # Pkcs11 then CSP
# Optional if auto-probe fails:
# $env:EINVOICE_PKCS11_LIBRARY = "C:\Windows\System32\eps2003csp11.dll"
# Optional if multiple certs on token:
# $env:EINVOICE_CERT_FILTER = "Egypt Trust"            # or issuer substring
# $env:EINVOICE_CERT_THUMBPRINT = "AABBCC..."            # SHA-1 hex, no spaces
```

Launch:

```powershell
dotnet run --project apps/agent/src/Einvoice.Agent.Desktop -c Release
```

Tray icon appears (system tray).

---

## Test 1 — Pair device (T022)

| Step | Action | Expected |
|------|--------|----------|
| 1 | In web **Devices**, create a pairing code (copy plaintext once) | Code shown once |
| 2 | Tray → **Pair device…** → paste code → Pair | Success dialog with deviceId/tenantId |
| 3 | Refresh Devices list | New device **PAIRED**, last seen updates within ~poll interval |
| 4 | Tray tooltip | Shows Online / Not unpaired |

**Fail clues**: 400 expired/consumed code; API URL wrong; CORS/TLS.

---

## Test 2 — PIN unlock (T048)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Tray → **Unlock token PIN…** | PIN dialog (local only) |
| 2 | Enter correct PIN | Dialog closes; tray shows `PIN unlocked` |
| 3 | Enter wrong PIN later when signing | Clear error; no cloud upload of PIN |

PIN must **never** appear in API logs, heartbeat JSON, or network traces.

---

## Test 3 — End-to-end hardware sign (core)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Create a document in web, validate, **Mark ready**, **Send for signature** | Job pending |
| 2 | Agent online + PIN unlocked + token inserted | Within poll (~5s) job claimed |
| 3 | Watch tray `pending=` | Goes up then down after sign+upload |
| 4 | Refresh document | Status **SIGNED**, `signatures[0].signatureType === "I"`, non-empty Base64 value |
| 5 | Devices last seen | Recent |

**Confirm in tray/logs** that signing source is `PKCS#11:eps2003csp11.dll` (or your DLL) or `CSP/CNG:CurrentUser\My` — not `SoftwarePEM`.

**If PKCS#11 fails and CSP works**: Auto fallback is OK for this test; note which path worked.

**Do not claim success** until step 4 shows SIGNED with type I from a run that used the hardware path.

---

## Test 4 — Revocation while agent running

| Step | Action | Expected |
|------|--------|----------|
| 1 | In Devices, **Unpair** the agent device | Device REVOKED |
| 2 | Wait one poll / try heartbeat | Tray → Unpaired / 401; uploads stop |
| 3 | Document left pending | Not corrupted; can send again after re-pair |

---

## Test 5 — Offline queue (T037–T039)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Pair + unlock PIN | Ready |
| 2 | Stop API (or unplug network) | Tray may show Offline |
| 3 | Send doc for signature while API down (or claim already queued) | Items persist under `%LocalAppData%\Einvoice.Agent\queue.db` |
| 4 | Restart agent mid-offline | Queue restored (ListAll / pending count) |
| 5 | Bring API back | PENDING_UPLOAD drains once; document SIGNED once (no duplicate signatures) |

---

## Software-only smoke (optional, no token)

```powershell
$env:EINVOICE_SIGNING_KEY_SOURCE = "Software"
# optional paths to TestKeys PEMs
dotnet test apps/agent/Einvoice.Agent.sln --filter CadesSoftwareKeyGolden
```

Expected: CI golden CAdES checklist still green.

---

## After you confirm

Reply with: which DLL/path worked, whether source was PKCS#11 or CSP, and that a real document reached **SIGNED** with type **I**. Only then we treat hardware signing as verified.
