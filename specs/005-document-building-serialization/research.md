# Research: Document Building, Validation & Canonical Serialization

**Feature**: `005-document-building-serialization` | **Date**: 2026-07-25

## R1 — `canonicalSerialize` placement and API

**Decision**: Implement `canonicalSerialize(document: JsonObject): string` in
`packages/eta-core` as a **framework-free** pure function. Input is a plain JSON
object whose scalars that matter for money are already **decimal strings** (or
other string/number literals that must be emitted verbatim). Output is the ETA
canonical string. Nest and the .NET agent both call/mirror this algorithm; they
do not re-implement rules ad hoc.

**Rationale**: Constitution IV and FR-030 require one shared algorithm + agent
parity. Keeping Nest/Prisma/React out of eta-core maximizes unit-testability and
prevents accidental environment coupling.

**Alternatives considered**:
- Nest-only service — rejected (agent cannot import Nest; parity harder).
- Duplicate TS + C# without shared vectors — rejected (constitution gate).

### Algorithm lock (bassemAgmi reference + ETA SDK cross-check)

**SoT**: `packages/eta-core/docs/reference-algorithm.md` (extracted from
[bassemAgmi/EInvoicingSigner](https://github.com/bassemAgmi/EInvoicingSigner)
`SerializeToken`). Official ETA SDK docs remain a cross-check; **gv-01** matches
both. Product/hash parity follows the reference `CanonicalString.txt`.

1. Walk object properties in **payload order**.
2. For each property: emit `"NAME"` via `Name.ToUpper()` then serialize value.
3. Arrays: after the initial `"NAME"`, for **each** element emit `"NAME"` again
   then `Serialize(element)`. **Empty array** → `"NAME"` once only.
4. Non-string scalars (bool/int/float/date): `"\`" + as-is + "\`"`.
5. **String** scalars: `JsonConvert.ToString` (JSON escaping, including `\"`).
6. **Null**: emit `"NAME"` only (no value token). **Absent**: skip.
7. Root is the **document object**, not the submission `documents` array.
8. No separators/whitespace; UTF-8 file with **no** trailing newline.

**Proven**: `build_vectors.py` / gv-01 matches
`one-doc-serialized.json.txt` byte-for-byte when number **literal text** from
the JSON file is preserved.

## R2 — Money / exact value preservation

**Decision**: Represent money (and other ETA numerics that enter
canonicalization) as **decimal strings**. Computed monetary amounts use
**exactly 2 fractional digits**, round **half away from zero**. Use a decimal
library (e.g. `decimal.js`) **internally** for arithmetic; **always** format to
string before placing values on the ETA payload. Reject IEEE `number` as the
storage type for money fields on the payload. Reject integer minor units (cannot
preserve `0.00`).

**Rationale**: Clarification session 2026-07-25; ETA SDK samples emit `0.00`,
`14.00`, `5191.50`. Canonicalization never reformats — computation owns the
final string.

**Alternatives considered**:
- Integer minor units — rejected (formatting loss).
- IEEE float + `toFixed` at serialize time — rejected (float error + serialize
  must stay “as-is”).

**Non-monetary numerics**: Quantity and rates that appear as integers in ETA
samples (e.g. `"5"`, `"7"`, `"12"`) keep the string form the mapping rules
produce; rates that are decimals keep two-fraction form when that is the
computed/mapped form (`"14.00"`, `"0.00"`).

## R3 — Document builders per type

**Decision**: Provide builder functions in eta-core (or thin wrappers) for the
six kinds: Invoice, Credit Note, Debit Note, Export Invoice, Export Credit Note,
Export Debit Note. Each builder maps an internal draft DTO + tenant/branch/
receiver context → ordered ETA JSON object bound to `documentType` +
`documentTypeVersion` from the **004 catalog** (caller supplies binding; builders
do not hardcode live schema SoT).

**Rationale**: Spec FR-001/FR-002; keeps ETA shape construction testable without
HTTP.

**Alternatives considered**: Single mega-builder with flags — deferred as harder
to validate per-kind required fields.

## R4 — Tax / total calculators

**Decision**: `calculateLine` + `calculateDocumentTotals` in eta-core: inputs are
decimal strings / rates; outputs decorate lines and document totals as decimal
strings. Server **always recomputes** on save/validate (FR-010). Client may
mirror for UX but must not be trusted.

**Rationale**: Exact preservation + deterministic SC-004.

**Alternatives considered**: Client-only totals — rejected (tampering /
inconsistency).

## R5 — `LocalValidator` + type-version schema

**Decision**: `LocalValidator.validate(document, typeVersionSchema, refs)` in
eta-core. `typeVersionSchema` is the structure/required-field metadata obtained
from the **004-cached document type version** (Nest loads cache → passes into
validator). Additional platform rules: referential (branch, currency, item code,
original document), arithmetic consistency, note/export specifics.

**Rationale**: Clarification — validation driven by Phase 3 cached version; no
hardcoded schema SoT.

**Alternatives considered**: Hardcoded Zod schemas per kind as SoT — rejected
(constitution V). Zod may still wrap **runtime** schema derived from cache.

**Schema shape**: Research at implement time against ETA type-version payload
fields returned by 004; if ETA returns limited metadata, validate what is
available + document gaps; never invent a fake “complete” hardcoded ETA schema
as SoT.

## R6 — Golden tests

**Decision**: In `packages/eta-core` tests, for each **locked** `*.canonical.txt`
(currently gv-01; promote PENDING as tool-confirmed):

```text
expect(normalize(canonicalSerialize(loadInput(id)))).toBe(normalize(loadExpected(id)))
// normalize = strip at most one trailing \n
```

Byte-exact. Same files consumed by agent tests. Skip `*.canonical.PENDING.txt`
until promoted. Inputs that contain JSON number literals (gv-01) MUST be loaded
with **literal preservation** (custom parse) — never `JSON.parse` alone for gv-01
money fields.

**Rationale**: FR-031/032; gv-01 official SDK; secondary vectors PENDING until
EInvoicingSigner `CanonicalString.txt` confirms (port candidates allowed only as
PENDING).

**Alternatives considered**: Snapshot from implementation — rejected (circular).

## R7 — Web UX: live JSON + canonical preview + drafts

**Decision**: Documents UI under `/(app)/documents`. Form: lines, taxes,
discounts, currency, branch. Side/panel preview: **ETA JSON** (post-recompute)
and **canonical string** (from `canonicalSerialize`). Draft list + save/reopen/
delete. Prefer server recompute on debounce/blur for SoT; optional client
eta-core import for instant canonical preview of the last server JSON.

**Rationale**: User story 6 + technical plan; SC-007.

**Alternatives considered**: Preview only after explicit button — weaker UX.

## R8 — Permissions

**Decision**: Add `documents.view` and `documents.manage` to `@einvoice/shared`.
Owner/Admin/Accountant get manage (Accountant: manage documents; view settings
as today). Viewer: view only if product wants read-only drafts — default
**Viewer = view**, Accountant/Owner/Admin = manage. Exact matrix in
`contracts/permissions.md`.

**Rationale**: Spec FR-039; existing matrix has no document perms.

## R9 — Agent scope

**Decision**: Add `CanonicalSerialize` in the .NET agent + golden tests reading
the shared `golden-vectors/` files. No signing/PKCS#11 work in this feature.

**Rationale**: Spec out-of-scope + constitution IV minimum for serialization.

## R10 — Concurrent draft edits

**Decision**: Optimistic concurrency via `updatedAt` / version column; second
save with stale version returns 409 Conflict.

**Rationale**: Spec edge case; simple and testable.

## Resolved unknowns

| Topic | Resolution |
|-------|------------|
| Money representation | Decimal strings, 2 dp monetary, half away from zero |
| Validation SoT | 004 cached type-version |
| Golden vectors | gv-01..03 under feature `golden-vectors/` |
| Serialize API | `canonicalSerialize(document)` in eta-core |
| Agent | Serialize + golden tests only |

No remaining NEEDS CLARIFICATION for planning.
