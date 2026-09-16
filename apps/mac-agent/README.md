# eInvoice Signing Agent — macOS

Menu-bar agent for Intel (primary) and Apple Silicon Macs. It **ProjectReferences** `apps/agent/src/Einvoice.Agent` — the same BouncyCastle CAdES-BES + ESS signing-certificate-v2 + canonical path the Windows agent uses. It does **not** replace `Einvoice.Agent.Desktop` (Windows tray).

## What the client needs

| Requirement | Notes |
|---|---|
| macOS 12+ | Intel (`osx-x64`) is the customer/Hackintosh target; `osx-arm64` is also publishable |
| USB eSeal token | Egypt Trust / Feitian ePass2003 |
| Token middleware | **Not bundled.** Install the Egypt Trust / ePass **Castle** macOS pkg so `/usr/local/lib/libcastle.1.0.0.dylib` exists |
| Network | Default API `https://etaapi.erp-esafe.com` (override in the Pair dialog or `EINVOICE_API_BASE_URL`) |

**.NET SDK is not required** on client machines (self-contained publish).

Config + pairing live in `~/Library/Application Support/Einvoice.Agent/`. The device token is Keychain-wrapped. The eSeal PIN never leaves the Mac (PinGuard on payloads).

Give clients the **`.dmg`**, not a raw `.app`. They still must install Egypt Trust / ePass **Castle** PKCS#11 middleware **before** using the agent (the token driver is not inside the DMG).

## Build the .app + .dmg (on the Mac, after git pull)

Install the .NET 8 SDK once on the build Mac: https://dotnet.microsoft.com/download/dotnet/8.0

Scripts are LF-only (`*.sh text eol=lf` in `.gitattributes`). After pull:

```bash
cd apps/mac-agent
chmod +x package-macos-app.sh make-dmg.sh build-and-package.sh
```

**Intel / Hackintosh / customer PCs (`osx-x64`) — primary (one shot):**

```bash
cd apps/mac-agent
./build-and-package.sh osx-x64
```

That runs `package-macos-app.sh` then `make-dmg.sh`. Outputs:

| File | Role |
|---|---|
| `apps/mac-agent/dist/osx-x64/eInvoice Signing Agent.app` | App bundle |
| **`apps/mac-agent/dist/eInvoice-Signing-Agent-osx-x64.dmg`** | **Send this to clients** |

**Two-step (same result):**

```bash
cd apps/mac-agent
./package-macos-app.sh osx-x64
./make-dmg.sh osx-x64
```

**Apple Silicon (`osx-arm64`):**

```bash
cd apps/mac-agent
./build-and-package.sh osx-arm64
```

DMG: `apps/mac-agent/dist/eInvoice-Signing-Agent-osx-arm64.dmg`

If the Castle dylib is Intel-only, always ship **osx-x64** (Rosetta on Apple Silicon).

The DMG volume is named **eInvoice Signing Agent** and contains the `.app` plus an **Applications** shortcut — drag the app onto Applications.

Equivalent manual publish (no `.app` / `.dmg` wrapper):

```bash
cd apps/mac-agent
dotnet publish Einvoice.Agent.Mac.csproj -c Release -r osx-x64 --self-contained true -o dist/osx-x64/publish
./dist/osx-x64/publish/Einvoice.Agent.Mac
```

## How the client installs it

1. **Install Egypt Trust / ePass Castle macOS middleware first** (required; not in the DMG). Confirm:
   ```bash
   ls -l /usr/local/lib/libcastle.1.0.0.dylib
   ```
2. Insert the USB eSeal token.
3. Open `eInvoice-Signing-Agent-osx-x64.dmg` and **drag “eInvoice Signing Agent” onto Applications**.
4. Open the app (see Gatekeeper below). A **menu-bar extra** appears (no Dock icon — `LSUIElement`).
5. First launch: pair with a Devices code from the web app → confirm auto-detected library/cert.
6. Send a document to sign from the web app. The agent prompts for the **token PIN** (local only).
7. Menu: Pair / Unpair / Token / Unlock PIN / Clear PIN / Quit.

Already-paired relaunch does **not** ask for a pairing code. PIN is requested when signing.

Override PKCS#11 path if needed:

```bash
export EINVOICE_PKCS11_LIBRARY=/usr/local/lib/libcastle.1.0.0.dylib
open -a "/Applications/eInvoice Signing Agent.app"
```

## Gatekeeper / unsigned DMG (current builds)

This publish is **unsigned** (no Apple Developer ID yet). macOS will warn that the app is from an unidentified developer. That does **not** stop signing invoices; it only blocks a naive double-click until the user allows it.

**What to tell the client:**

1. Install the Castle middleware (step 1 above).
2. Open the DMG → drag the app to Applications.
3. **Right-click** `eInvoice Signing Agent` in Applications → **Open** → **Open** (once).  
   Or in Terminal:
   ```bash
   xattr -cr "/Applications/eInvoice Signing Agent.app"
   open "/Applications/eInvoice Signing Agent.app"
   ```
4. After that, double-click / menu-bar launch works for that user.

If Gatekeeper still blocks the DMG itself: right-click the `.dmg` → Open, or `xattr -cr ~/Downloads/eInvoice-Signing-Agent-osx-x64.dmg`.

## Optional later: codesign + notarize (smoother client UX)

An **Apple Developer Program** membership (~99 USD/year) lets you sign and notarize so Gatekeeper does not warn. Not required for ETA signing. After you have a Developer ID Application certificate:

```bash
# 1) Sign the .app (do this before make-dmg.sh, or sign then re-run make-dmg.sh)
codesign --deep --force --options runtime \
  --sign "Developer ID Application: Your Name (TEAMID)" \
  "dist/osx-x64/eInvoice Signing Agent.app"

# 2) Build the DMG, then submit it (or a zip of the .app)
./make-dmg.sh osx-x64
xcrun notarytool submit dist/eInvoice-Signing-Agent-osx-x64.dmg \
  --apple-id "you@example.com" --team-id TEAMID --password "@keychain:notary" --wait
xcrun stapler staple dist/eInvoice-Signing-Agent-osx-x64.dmg
```

Until that is in place, use the right-click Open / `xattr -cr` path above.

## Architecture (reuse, not a fork)

```
Einvoice.Agent.Mac (Avalonia tray)  ──ProjectReference──►  Einvoice.Agent
                                                          ├── SignPipeline / CadesBesSigner / CanonicalSerialize
                                                          ├── Pkcs11KeyProvider (CKM_SHA256_RSA_PKCS)
                                                          ├── SigningWorker (heartbeat, claim, sign, submit)
                                                          ├── AgentApiClient / PinGuard / DeviceTokenStore
                                                          └── TokenAutoDetect (macOS dylibs + Windows DLLs)
```

Windows tray (`Einvoice.Agent.Desktop`) is unchanged aside from the shared library’s additive macOS paths/Keychain/CSP-skip. CAdES construction is not forked.
