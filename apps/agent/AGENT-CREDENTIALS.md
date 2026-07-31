# Agent credentials & trust boundary

This document defines what lives **only on the client Windows machine** vs what
lives in the **cloud** SaaS. The eSeal token PIN never leaves the PC.

## Trust boundary

| Data | Where | Notes |
|------|--------|--------|
| eSeal **PIN** | **Agent only** | Prompt at sign time; optional DPAPI remember. Never in web UI, never in API bodies. |
| PKCS#11 **DLL path** | Agent local config | Auto-detected; manual override in agent. Not secret. |
| Certificate **issuer / thumbprint** | Agent local config | Auto-detected from token; picker if multiple. Not secret. |
| Device pairing token | Agent (`device.token`, DPAPI) + cloud pairing record | Bearer auth for agent channel only. |
| Tenant / branch / documents | Cloud | |
| ETA ClientId / ClientSecret | Cloud (encrypted at rest) | |

## PIN handling

1. **Default:** prompt in the desktop agent when a PKCS#11 sign job runs.
2. **Optional “Remember PIN”** (user must check the box):
   - Encrypted with **Windows DPAPI** (`DataProtectionScope.CurrentUser`) in
     `%LocalAppData%\Einvoice.Agent\pin.dpapi`.
   - Timeout: session / 15 min / 60 min / 8 hours (configurable in the dialog).
   - Cleared via tray **Clear PIN (memory + remembered)**.
3. **Guards:** `PinGuard.AssertNoPinInPayload` runs on every agent→API JSON body;
   fail messages are redacted before upload.

## PKCS#11 / certificate auto-detect

On startup (and via tray **Token / certificate…**):

1. Scan known libraries (`eps2003csp11.dll`, `SignatureP11.dll`, …) under
   `System32`, `SysWOW64`, and common Egypt Trust / ePass install folders.
2. Open a **read-only** PKCS#11 session **without PIN** and list public certs.
3. Prefer an eSeal-like cert (Egypt Trust / Sealing heuristics).
4. If multiple ambiguous certs → picker UI.
5. If detection fails → manual library path + issuer fields in the agent.

Saved in `%LocalAppData%\Einvoice.Agent\agent.config.json` (no PIN).

## Client setup (non-technical)

1. Install the agent on the Windows PC that has the USB token
   (see [INSTALL.md](./INSTALL.md) for the self-contained EXE or Setup installer).
2. Plug in the eSeal token (middleware/drivers already installed by the CA).
3. In the web app: **Devices → Create pairing code**.
4. In the agent tray: **Pair device…** and paste the code.
5. Confirm the auto-detected library/certificate (or pick manually).
6. When the first document is sent for signature, enter the PIN in the agent
   dialog (optionally remember locally).

**Distribution:** publish output is `apps/agent/dist/win-x64/Einvoice.Agent.exe`
(self-contained; client does not need .NET). Full publish/run/installer steps:
[INSTALL.md](./INSTALL.md).

## Files

| Path | Contents |
|------|----------|
| `agent.config.json` | Library, issuer, thumbprint, remember-PIN prefs (flags only) |
| `pin.dpapi` | Optional DPAPI ciphertext of PIN + expiry |
| `device.token` | DPAPI device bearer token |
| `queue.db` | Offline signed job queue |

## Code map

- `Config/PinVault.cs` — DPAPI PIN cache  
- `Config/LocalAgentConfig.cs` — non-secret settings  
- `Security/PinGuard.cs` — no-PIN-on-wire enforcement  
- `Signing/TokenAutoDetect.cs` — library + cert discovery  
- `Desktop/PinDialog.cs` / `TokenConfigDialog.cs` — UX  
- `Channel/AgentApiClient.cs` — asserts payloads before send  
