# Runbook: bassemAgmi EInvoicingSigner (Windows)

Use this to produce authoritative `CanonicalString.txt` for golden vectors
(and later full signing on a real token). Repo:
https://github.com/bassemAgmi/EInvoicingSigner

Serialization writes `CanonicalString.txt` **before** signing. You can obtain
canonical strings even when signing fails, if the process gets that far — but
the published app expects a token for non-`0.9` documents. Prefer the
downloadable runtime + bat files from the README, or build from source.

## 1. Get the tool

**Option A — runtime (README):**

1. Download the runtime zip from the link in the [EInvoicingSigner README](https://github.com/bassemAgmi/EInvoicingSigner).
2. Extract to e.g. `D:\EInvoicing`.

**Option B — build from source:**

```powershell
git clone https://github.com/bassemAgmi/EInvoicingSigner.git
cd EInvoicingSigner\EInvoicingSigner
dotnet build -c Release
# run the built exe (path depends on SDK / target)
```

## 2. Prepare a work folder

```powershell
$app = "D:\EInvoicing"   # folder that contains the signer exe / bats
$work = "D:\EInvoicing\vector-runs\gv-04"
New-Item -ItemType Directory -Force -Path $work | Out-Null

# Copy the golden-vector INPUT as SourceDocumentJson.json
Copy-Item `
  "C:\xampp\htdocs\einvoice\specs\005-document-building-serialization\golden-vectors\gv-04-empty-array.input.json" `
  "$work\SourceDocumentJson.json"
```

Repeat with the matching `gv-*.input.json` for each vector.

## 3. Run (arguments)

```text
EInvoicingSigner.exe <app-or-work-folder> <token-pin> "<cert-issuer>" <pkcs11-dll>
```

| Arg | Example | Meaning |
|-----|---------|---------|
| 1 | `D:\EInvoicing\vector-runs\gv-04` | Folder containing `SourceDocumentJson.json` (outputs written here) |
| 2 | `123456` | Token PIN |
| 3 | `Egypt Trust Sealing CA` | Certificate issuer (or `Egypt Trust CA G6`) |
| 4 | `eps2003csp11.dll` | PKCS#11 library (or `SignatureP11.dll`) |

Example:

```powershell
cd D:\EInvoicing
.\EInvoicingSigner.exe `
  "D:\EInvoicing\vector-runs\gv-04" `
  "YOUR_PIN" `
  "Egypt Trust Sealing CA" `
  "eps2003csp11.dll"
```

Or edit `SubmitInvoices.bat` / `SubmitInvoicesNewToken2024.bat` with folder + PIN
and run the bat (per upstream README).

### Outputs

| File | Need for vectors? |
|------|-------------------|
| **`CanonicalString.txt`** | **Yes** — UTF-8 canonical serialization |
| `Cades.txt` | No (signature; needs token) |
| `FullSignedDocument.json` | No (signed payload) |

## 4. Confirm a PENDING vector

```powershell
$pending = "C:\xampp\htdocs\einvoice\specs\005-document-building-serialization\golden-vectors\gv-04-empty-array.canonical.PENDING.txt"
$actual  = "D:\EInvoicing\vector-runs\gv-04\CanonicalString.txt"

# Byte compare (PowerShell)
$a = [IO.File]::ReadAllBytes($pending)
$b = [IO.File]::ReadAllBytes($actual)
# strip at most one trailing LF on either side if present
if ($a.Length -and $a[-1] -eq 10) { $a = $a[0..($a.Length-2)] }
if ($b.Length -and $b[-1] -eq 10) { $b = $b[0..($b.Length-2)] }
[Linq.Enumerable]::SequenceEqual($a, $b)
```

If `$true`:

```powershell
$gv = "C:\xampp\htdocs\einvoice\specs\005-document-building-serialization\golden-vectors"
Move-Item -Force "$gv\gv-04-empty-array.canonical.PENDING.txt" "$gv\gv-04-empty-array.canonical.txt"
```

Then paste/commit the confirmed file and extend T012/T013 to include it.

## 5. Canonical-only without fighting the token (optional)

- Set `"documentTypeVersion": "0.9"` in a **throwaway** copy of the JSON so the
  reference sets `cades = "ANY"` and skips `SignWithCMS` — **only** if that does
  not change fields you care about for the vector. Prefer real token runs for
  final confirmation when possible.
- Or use `tools/reference-canonical-serialize` for **candidates** only; still
  promote with a real `CanonicalString.txt` before locking.

## 6. Full signing (later)

Same command with a present token + correct PIN/issuer/DLL. Compare `Cades.txt`
/ `FullSignedDocument.json` to your agent when implementing signing (out of
scope for vector generation).
