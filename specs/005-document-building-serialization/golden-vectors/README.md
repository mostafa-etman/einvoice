# Golden vectors: ETA canonical serialization

**Feature**: `005-document-building-serialization`

Authoritative expected outputs for platform + agent parity (FR-031 / FR-032).
**Never** mint expected strings from `packages/eta-core` or the agent under test.

**Algorithm SoT**: [`packages/eta-core/docs/reference-algorithm.md`](../../../packages/eta-core/docs/reference-algorithm.md)
(extracted from [bassemAgmi/EInvoicingSigner](https://github.com/bassemAgmi/EInvoicingSigner)
`SerializeToken`).

## Provenance tiers

| Tier | Meaning | Fixture naming |
|------|---------|----------------|
| **Official reference** | Byte-identical to ETA SDK published files | `*.canonical.txt` |
| **Tool-confirmed** | Byte-identical to EInvoicingSigner `CanonicalString.txt` from a local run | `*.canonical.txt` |
| **PENDING (candidate)** | Produced by `tools/reference-canonical-serialize` (exact `SerializeToken` port) — **not** yet confirmed against the real tool’s `CanonicalString.txt` | `*.canonical.PENDING.txt` |

Candidates also live under `candidates/*.canonical.CANDIDATE.txt` for diffing.

## Vector catalog

| ID | Case | Expected file | Status / provenance |
|----|------|---------------|---------------------|
| **gv-01** | Official one-doc | `gv-01-eta-sdk-one-doc.canonical.txt` | **LOCKED — Official** ETA SDK (+ port MATCH) |
| **gv-02** | Empty-string scalars | `gv-02-empty-scalars.canonical.PENDING.txt` | **PENDING** — port candidate |
| **gv-03** | Arrays + `"0.00"` / `"14.00"` | `gv-03-array-and-zero.canonical.PENDING.txt` | **PENDING** — port candidate |
| **gv-04** | Empty array | `gv-04-empty-array.canonical.PENDING.txt` | **PENDING** — port candidate → `"INVOICELINES""TOTALAMOUNT""0.00"` |
| **gv-05** | Absent optional | `gv-05-absent-optional.canonical.PENDING.txt` | **PENDING** — port candidate (skipped) |
| **gv-06** | Quote in value | `gv-06-quote-in-value.canonical.PENDING.txt` | **PENDING** — port candidate → `"DESCRIPTION""say \"hi\""` (`JsonConvert.ToString` escapes) |
| **gv-07** | Arabic text | `gv-07-arabic.canonical.PENDING.txt` | **PENDING** — port candidate (UTF-8) |
| **gv-08** | JSON `null` | `gv-08-null.canonical.PENDING.txt` | **PENDING** — port candidate → `"BANKACCOUNTIBAN""BANKNAME""SomeBank"` (name only) |

Raw SDK downloads: `eta-sdk-one-doc.json` / `eta-sdk-one-doc.canonical.txt`.

## Reference rules (summary)

See `reference-algorithm.md` for full detail. Highlights:

- Empty array → emit `"NAME"` once (zero element blocks).
- Absent optional → not emitted; null → emit `"NAME"` only.
- Strings use `JsonConvert.ToString` (**escapes** quotes); not raw concatenation.
- `CanonicalString.txt` is UTF-8 with **no** trailing newline.
- Property names: `Name.ToUpper()` (current culture), as in the reference.

## Promoting PENDING → locked

1. Run EInvoicingSigner on the vector’s input as `SourceDocumentJson.json`
   (see [RUNBOOK-bassemAgmi.md](./RUNBOOK-bassemAgmi.md)).
2. Compare `CanonicalString.txt` to `*.canonical.PENDING.txt` (byte-exact).
3. If identical: rename `*.canonical.PENDING.txt` → `*.canonical.txt`.
4. Expand T012/T013 to assert the new locked file.

Until promoted, CI/golden gate asserts **locked** `*.canonical.txt` only
(currently **gv-01**). PENDING files are fixtures + documentation, not gate
failures.

## Trailing newline (U1)

Locked and PENDING expected files are stored **without** a trailing `\n`.
T012/T013 strip at most one trailing `\n` on expected and actual before `===`.

## Candidate generator (not product code)

```powershell
cd tools\reference-canonical-serialize
dotnet run -- ..\..\specs\005-document-building-serialization\golden-vectors\gv-04-empty-array.input.json out.txt
```

Do **not** use product `canonicalSerialize` to mint expecteds.
