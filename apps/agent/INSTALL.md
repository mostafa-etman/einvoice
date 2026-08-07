# eInvoice Signing Agent — install & distribute

## A) Quick test build (self-contained EXE — no .NET on the client)

### Publish

```powershell
powershell -ExecutionPolicy Bypass -File apps/agent/scripts/publish-win-x64.ps1
```

Or manually:

```powershell
dotnet publish apps/agent/src/Einvoice.Agent.Desktop/Einvoice.Agent.Desktop.csproj `
  -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:EnableCompressionInSingleFile=true `
  -o apps/agent/dist/win-x64
```

The publish script also copies the output to **`Einvoice.Agent.exe`** (same binary as `Einvoice.Agent.Desktop.exe`).

### Output path

| File | Role |
|------|------|
| **`apps/agent/dist/win-x64/Einvoice.Agent.exe`** | Distributable self-contained agent (~75 MB) |
| `apps/agent/dist/win-x64/Einvoice.Agent.Desktop.exe` | Same build (original assembly name) |
| `apps/agent/dist/win-x64/Run-Agent.cmd` | Optional local launcher (sets API URL + PKCS#11) |
| `*.pdb` | Debug symbols — **do not send to clients** |

Absolute path on this machine (after publish):

`c:\xampp\htdocs\einvoice\apps\agent\dist\win-x64\Einvoice.Agent.exe`

### What to send the client

- **Required:** `Einvoice.Agent.exe` only.
- **Optional:** `Run-Agent.cmd` if you want a one-click launcher with `EINVOICE_API_BASE_URL` pre-set.
- Config is created automatically under `%LocalAppData%\Einvoice.Agent\` (pairing token, library/cert prefs). You do **not** ship a config file.

### What the client machine must already have

| Requirement | Notes |
|-------------|--------|
| Windows 10/11 x64 | |
| USB eSeal token | Plugged in when using the agent |
| CA middleware / PKCS#11 DLL | e.g. `eps2003csp11.dll` or `SignatureP11.dll` in System32 or vendor path — **not** bundled with the agent |
| Network to your API | HTTPS cloud API at `https://etaapi.erp-esafe.com` by default. Override with `EINVOICE_API_BASE_URL` or the Pairing dialog. |

**.NET runtime is not required** (self-contained publish).

### Run steps (token signing test today)

1. Ensure the API is reachable and the web app can create a **device pairing code**.
2. On the Windows PC with the token + middleware installed:
   ```powershell
   $env:EINVOICE_API_BASE_URL = "https://etaapi.erp-esafe.com"   # production (also the shipped default)
   # Local/dev override once Traefik is up: https://api.localhost (mkcert TLS)
   # SIGNING_PROVIDER=pkcs11 is optional: Desktop auto-switches when a known DLL is found
   & "c:\xampp\htdocs\einvoice\apps\agent\dist\win-x64\Einvoice.Agent.exe"
   ```
   Or double-click `Run-Agent.cmd` after editing the API URL inside it.
3. Tray icon appears → first-run wizard: **pair** with the web code → confirm **auto-detected** library/certificate (or pick manually).
4. From the web app, send a document for signature. Agent prompts for **PIN** (stays on this PC only).
5. Tray menu: **Pair device…**, **Token / certificate…**, **Clear PIN**, Quit.

Confirmed by design: auto-detect → local config; pair + claim/sign over the API; PIN never leaves the machine (see [AGENT-CREDENTIALS.md](./AGENT-CREDENTIALS.md)).

---

## B) Professional installer (later / for selling)

Scaffold: **Inno Setup** script at [`installer/Einvoice.Agent.iss`](./installer/Einvoice.Agent.iss).

Why Inno Setup: simple Setup EXE, Start Menu + optional desktop + optional login auto-start, easy versioning, no WiX toolchain required. For enterprise MSI later, WiX can wrap the same published EXE.

### Build the Setup EXE

1. Install [Inno Setup 6](https://jrsoftware.org/isinfo.php).
2. Publish the agent (`publish-win-x64.ps1`).
3. Compile `installer/Einvoice.Agent.iss` (GUI or `ISCC.exe`).
4. Output: `apps/agent/dist/installer/EinvoiceAgentSetup-0.1.0.exe`.

Installer features (scaffolded):

- Install under `%LocalAppData%`-friendly Program Files path (`PrivilegesRequired=lowest` for per-user).
- Start Menu shortcut; optional desktop shortcut; optional HKCU Run auto-start.
- Reminder that token middleware is installed separately.
- Stable `AppId` GUID so later versions **upgrade** in place.

### Versioning & updates

1. Bump `<Version>` in `Einvoice.Agent.Desktop.csproj` and `#define MyAppVersion` in the `.iss` file together.
2. Rebuild publish → recompile Inno → ship new `EinvoiceAgentSetup-{version}.exe`.
3. Clients run the new Setup; same `AppId` replaces the previous install.
4. Future: optional in-app updater, Winget package, or MSIX — keep this Inno path as the baseline retail installer.

### Icon

Add `apps/agent/src/Einvoice.Agent.Desktop/agent.ico`, then uncomment `SetupIconFile` in the `.iss` and rebuild (csproj already picks up `agent.ico` when present).

---

## Client install checklist (non-technical)

1. Install eSeal USB middleware from your CA (Egypt Trust / etc.).
2. Plug in the USB token.
3. Install/run the agent (`Einvoice.Agent.exe` or the Setup EXE).
4. In the web app (https://eta.erp-esafe.com): **Devices → Create pairing code**.
5. In the agent: paste the code (API URL defaults to `https://etaapi.erp-esafe.com`) → confirm detected certificate.
6. Sign the first invoice → enter PIN in the agent dialog only.
