# Reference canonical serialize (bassemAgmi port)

Serialize-only harness that copies **`Serialize` / `SerializeToken`** from
[bassemAgmi/EInvoicingSigner](https://github.com/bassemAgmi/EInvoicingSigner)
(`EInvoicingSigner/Signer.cs`) plus the same Newtonsoft `JsonSerializerSettings`
used when loading `SourceDocumentJson.json`.

**Purpose**: produce candidate `CanonicalString.txt` files without a physical
token. Signing (`SignWithCMS`) is intentionally omitted.

**Provenance**: outputs of this tool are **candidates**
(`reference-algorithm-port`). Lock a golden fixture only after the full
EInvoicingSigner (or an identical `CanonicalString.txt` paste) confirms the
bytes. See `specs/005-document-building-serialization/golden-vectors/README.md`
and `packages/eta-core/docs/reference-algorithm.md`.

## Build & run

```powershell
cd tools\reference-canonical-serialize
dotnet run -- <path\to\SourceDocumentJson.json> [CanonicalString.txt]
```

Example (write next to input):

```powershell
dotnet run -- ..\..\specs\005-document-building-serialization\golden-vectors\gv-04-empty-array.input.json out.txt
```
