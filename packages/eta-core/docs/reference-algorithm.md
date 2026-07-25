# Reference algorithm: ETA canonical serialization

**Source of truth for this product**: the serialize path in
[bassemAgmi/EInvoicingSigner](https://github.com/bassemAgmi/EInvoicingSigner)
(`EInvoicingSigner/Signer.cs` → `Serialize` / `SerializeToken`), which writes
`CanonicalString.txt` (UTF-8) before optional token signing.

Official ETA SDK docs/pseudocode are useful cross-checks (especially **gv-01**),
but **byte-exact signing parity** follows this reference’s `CanonicalString.txt`
because that string is what is SHA-256’d and signed.

A serialize-only port of the same methods lives at
`tools/reference-canonical-serialize/` (no PKCS#11). Its outputs are
**candidates** until confirmed by running the full EInvoicingSigner (or pasting
its `CanonicalString.txt`).

---

## Load settings (before serialize)

Same as `Main` in `Signer.cs`:

```csharp
JsonConvert.DeserializeObject<JObject>(SourceDocumentJson, new JsonSerializerSettings()
{
    FloatFormatHandling = FloatFormatHandling.String,
    FloatParseHandling = FloatParseHandling.Decimal,
    DateFormatHandling = DateFormatHandling.IsoDateFormat,
    DateParseHandling = DateParseHandling.None
});
```

Money and floats must survive as decimals / string forms that match the JSON
text intent. Prefer **decimal strings** in product payloads (e.g. `"0.00"`) so
canonicalization does not depend on float formatting.

---

## Algorithm (`SerializeToken`) — exact rules

Pseudocode aligned to the C# control flow (including the root quirk):

1. **Root `JObject`** (`Parent == null`):
   - Calls `SerializeToken(First)` and **discards** the return value (no-op
     side effect).
   - Then falls through to the **object** branch and serializes **all** child
     properties in document order.
2. **`JProperty`**:
   - Emit `"NAME"` where `NAME = property.Name.ToUpper()`  
     (**current-culture** `ToUpper()`, **not** `ToUpperInvariant()`).
   - Then inspect the property **value**:
     - **Object** → recurse `SerializeToken(object)`.
     - **Boolean | Integer | Float | Date** → emit `"\`" + value.ToString() + "\`"`
       via `property.Value<string>()` (as-is string form; no extra formatting in
       serialize).
     - **String** → emit `JsonConvert.ToString(value)`  
       (JSON string literal: surrounding quotes **and** JSON escaping for `"`,
       `\`, controls, etc.).
     - **Array** → for **each** element: emit `"NAME"` again, then
       `SerializeToken(element)`. If the array is **empty**, this loop runs
       **zero** times → only the initial `"NAME"` from the property remains.
     - **Null** → **no** value branch matches → after `"NAME"`, nothing else is
       appended for that property.
3. **Standalone string token** (e.g. string array elements / “References” fix):
   - Emit `JsonConvert.ToString(...)`.
4. **Object** (non-root handled here; root also uses this):
   - For each child that is Object or Property → recurse.
5. **Concatenation only**: no commas, colons, spaces, or newlines inserted
   between tokens.
6. **Output file**: `File.WriteAllBytes(..., Encoding.UTF8.GetBytes(canonical))`
   — **no** trailing `\n` added by the writer.

---

## Confirmed behaviors (from reference source)

| Topic | Rule |
|-------|------|
| Property names | `"UPPER"` via `Name.ToUpper()` (current culture) |
| Name wrapping | Always `"NAME"` |
| Non-string scalars | `"\`" + as-is + "\`"` (Boolean/Integer/Float/Date) |
| String scalars | `JsonConvert.ToString` → quotes **with** JSON escaping |
| Empty string | `JsonConvert.ToString("")` → `""` (two quote chars as a value token) |
| Arrays | Prefix `"NAME"` once; per element `"NAME"` + serialize(element) |
| **Empty array** | `"NAME"` **exactly once**, zero element blocks |
| **Absent optional** | Property missing → never visited → **not emitted** |
| **Null value** | Property present, value `null` → emit `"NAME"` only (no value token) |
| Quote in value | Escaped: e.g. `say "hi"` → `"say \"hi\""` (via `JsonConvert.ToString`) |
| Arabic / UTF-8 | Preserved in the canonical string; file written as UTF-8 bytes |
| Trailing newline | **None** in `CanonicalString.txt` |
| Separators | None |

### Empty array (explicit)

```text
{ "invoiceLines": [] }  →  "INVOICELINES"
```

Property name is emitted once; the `foreach` over array children does not run.

### Null vs absent (explicit)

```text
{ "bankAccountIBAN": null, "bankName": "SomeBank" }
  →  "BANKACCOUNTIBAN""BANKNAME""SomeBank"

{ "issuer": { "name": "Issuer Co" }, "documentType": "I" }   // no issuer.id
  →  "ISSUER""NAME""Issuer Co""DOCUMENTTYPE""I"
```

### Quote-in-value (explicit)

```text
{ "description": "say \"hi\"" }
  →  "DESCRIPTION""say \"hi\""
```

(`JsonConvert.ToString` escapes the inner quotes. This differs from ETA SDK JSON
pseudocode that omits `EscapeQuotes`; **this product follows the reference
signer** for CanonicalString / hash compatibility.)

---

## SHA-256 / encoding

Signing hashes UTF-8 bytes of the canonical string
(`Encoding.UTF8.GetBytes(serializedJson)`). Any encoding drift (e.g. wrong
handling of Arabic) changes the digest and breaks signatures. Golden tests must
compare UTF-8 bytes (or equivalent Unicode strings that round-trip identically).

---

## CAdES-BES structural contract (feature 006 — not byte-exact CMS)

**Do not** use bassemAgmi `Cades.txt` / `FullSignedDocument.json` as a
byte-exact golden. Signing-time, RSA signature value, and certificate differ by
design between runs and keys.

**Authoritative ETA format**: *Digital Signature Format for E-Invoice System
V1.1*
([PDF](https://www.eta.gov.eg/sites/default/files/2021-09/Digital%20Signature%20Format%20V1.1_final_0.pdf)).

| Decision | Value | ETA justification |
|----------|-------|-------------------|
| Attached vs detached | **Detached** | `encapContentInfo.eContent` MUST be absent; ContentType = DigestData `1.2.840.113549.1.7.5` (“doesn’t contain the data (detached signature)”) |
| Digest algorithm | SHA-256 | OID `2.16.840.1.101.3.4.2.1` |
| ESS attribute | signing-certificate-v2 | OID `1.2.840.113549.1.9.16.2.47`; ESS hash SHA-256 (required) |
| Other signed attrs | content-type, message-digest, signing-time | OIDs `1.2.840.113549.1.9.3`, `.9.4`, `.9.5` |
| Document JSON field | `signatureType: "I"` | Issuer signature |
| CI verify | Crypto verify vs software test cert | Deterministic; no USB |
| Definitive oracle | ETA preprod/sandbox accept | When submit feature exists |
| Hardware | PKCS#11 (`eps2003csp11.dll`) | Manual / gated hardware tests |

Product CAdES construction (BouncyCastle) MUST satisfy the FR-011 checklist in
`specs/006-desktop-signing-agent/spec.md`. Serialization golden vectors remain
the only **byte-exact** SoT (`CanonicalString.txt` / locked `gv-*.canonical.txt`).

---

## What we do **not** use from the reference for vector generation

- `SignWithCMS` / PKCS#11 / physical token as a **byte-exact** CMS golden  
- `Cades.txt` / `FullSignedDocument.json` as CI expected CMS bytes  

Those require a token pin and CSP DLL and are non-deterministic across
certs/time. Serialization alone is enough for **canonical** golden vectors.
CAdES CI uses the **structural + verify** software-key gate above.

---

## Cross-check: official ETA SDK gv-01

`one-doc.json` → `one-doc-serialized.json.txt` matches this algorithm’s output
for that document (verified: port `SerializeToken` === official expected,
5752 UTF-8 bytes). Secondary edge cases still need a local
`CanonicalString.txt` paste to promote PENDING → locked.

**Locked count (as of 006 remediation)**: **1** (`gv-01`). PENDING
`gv-02`…`gv-08` are candidates only until promoted in feature **005**.

## Cross-runtime parity (constitution IV)

CI MUST run a **single comparative harness** per locked vector:
`agent(input) === etaCore(input) === expected`. Agent-only and eta-core-only
suites are supporting evidence; the comparative harness is the Principle IV
merge gate.
