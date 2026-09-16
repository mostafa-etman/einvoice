# macOS eSeal signing POC

Standalone **.NET 8** console diagnostic. It does **not** reference `apps/agent` or the signing service. It does **not** produce ETA CAdES-BES / ESS signing-certificate-v2 — it only answers: *can this Mac use the token's **private key** to create a verifiable RSA-SHA256 signature?*

Write/commit on Windows; **build and run on the Mac** after pull.

## 1. One-time on the Mac

Install the .NET 8 SDK: https://dotnet.microsoft.com/download/dotnet/8.0

Insert the eSeal USB token. Install the Feitian / ePass / Egypt Trust **macOS middleware** if you have not already (the PKCS#11 `.dylib` must exist on disk).

## 2. Find the PKCS#11 `.dylib`

Typical Feitian ePass2003 / Castle install paths:

| Path | When you see it |
|---|---|
| `/usr/local/lib/libeps2003csp11.dylib` | Classic ePass2003 PKCS#11 (same family as Windows `eps2003csp11.dll`) |
| `/usr/local/lib/libcastle_v2.1.0.0.dylib` | Newer **ePass2003-Castle** macOS client (often what Adobe Reader attaches) |
| `/usr/local/lib/libcastle.dylib` | Symlink / unversioned Castle name |
| `/usr/lib/libeps2003csp11.dylib` | Older installer layout |

Egypt Trust ETA tokens are usually Feitian ePass2003 Auto; their Mac pkg still drops one of the names above.

If none of those exist:

```bash
find /usr/local /usr/lib /Library /opt /Applications -name '*eps2003*.dylib' -o -name '*castle*.dylib' 2>/dev/null
```

Confirm architecture matches the binary you will run (`arm64` vs `x86_64`):

```bash
file /usr/local/lib/libeps2003csp11.dylib
# or
file /usr/local/lib/libcastle_v2.1.0.0.dylib
```

Apple Silicon + Intel-only `.dylib` → either run the **osx-x64** publish under Rosetta, or install a universal/arm64 middleware build.

## 3. Build + run (Apple Silicon / arm64)

```bash
cd apps/mac-agent-poc

dotnet publish -c Release -r osx-arm64 --self-contained true -p:PublishSingleFile=true

./bin/Release/net8.0/osx-arm64/publish/Einvoice.MacAgentPoc \
  --pkcs11-lib /usr/local/lib/libeps2003csp11.dylib \
  --subject "Egypt Trust"
```

If your middleware is Castle instead of `libeps2003csp11.dylib`:

```bash
./bin/Release/net8.0/osx-arm64/publish/Einvoice.MacAgentPoc \
  --pkcs11-lib /usr/local/lib/libcastle_v2.1.0.0.dylib \
  --subject "eSeal"
```

## 4. Build + run (Intel / x64)

```bash
cd apps/mac-agent-poc

dotnet publish -c Release -r osx-x64 --self-contained true -p:PublishSingleFile=true

./bin/Release/net8.0/osx-x64/publish/Einvoice.MacAgentPoc \
  --pkcs11-lib /usr/local/lib/libeps2003csp11.dylib \
  --subject "Egypt Trust"
```

On Apple Silicon you can still publish `-r osx-x64` and run that binary **under Rosetta** if the `.dylib` is Intel-only.

## 3b. Faster loop (SDK installed, no single-file publish)

```bash
cd apps/mac-agent-poc
dotnet run -c Release -- \
  --pkcs11-lib /usr/local/lib/libeps2003csp11.dylib \
  --subject "Egypt Trust"
```

This uses the machine-wide .NET 8 runtime (not self-contained). Use section 3/4 `dotnet publish` when you want a single binary.

## 5. Flags

| Flag | Meaning |
|---|---|
| `--pkcs11-lib PATH` | PKCS#11 `.dylib`. If omitted, well-known paths are probed. |
| `--subject "..."` | Substring vs certificate **subject** (and issuer). Use your eSeal org / CA text. |
| `--issuer "..."` | Substring vs **issuer** only. |
| `--pin PIN` | PKCS#11 PIN (otherwise prompted, hidden). Prefer the prompt. |
| `--skip-pkcs11` / `--skip-keychain` | Run only one approach. |

The tool prints process arch + `.NET` runtime so you can confirm the RID matched. Exit `0` if **either** approach produced a verifiable signature; `2` if neither did.

Keychain/CryptoTokenKit may still show a **system PIN dialog** even when PKCS#11 already used the console PIN.

## 6. Recommendation (full macOS agent)

**Default: PKCS#11 (Approach A), mirroring the Windows agent.**

ETA signing is strict (canonical bytes, CAdES-BES, RSA+SHA256, ESS signing-certificate-v2). The Windows agent already uses Pkcs11Interop + `CKM_SHA256_RSA_PKCS` against `eps2003csp11.dll`. Porting that same session/login/sign path to `libeps2003csp11.dylib` (or Castle) keeps one crypto implementation, one token PIN login, and the private key on the token.

Use Keychain **only if this POC shows Keychain SUCCEEDED and PKCS#11 failed**, or as a later optional fallback (analogous to Windows CSP). A Keychain-imported **public cert** without a SecIdentity is a common dead end: the PIN-protected key never left the USB token.

Do not treat Keychain success at *raw RSA-SHA256* as proof of ETA CAdES equivalence. After PKCS#11 PASS here, the full agent should still reuse the existing BouncyCastle CAdES-BES + ESS v2 builder, with PKCS#11 as the `ISignatureFactory` — same as Windows.
