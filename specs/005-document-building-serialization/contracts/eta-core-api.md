# @einvoice/eta-core public surface

**Feature**: `005-document-building-serialization`

Framework-free TypeScript package. No Nest/Next/Prisma imports.

## `canonicalSerialize(document): string`

- **Input**: Plain object representing one ETA document (not `{ documents: [...] }`).
  Property order is significant. Scalar money/numerics SHOULD be strings so
  formatting is preserved (`"0.00"`, `"10.50"`).
- **Output**: ETA canonical string. Fixtures are stored without a trailing
  newline; tests strip at most one trailing `\n` on expected and actual before
  comparing.
- **Rules**: Recursive per `packages/eta-core/docs/reference-algorithm.md`
  (bassemAgmi `SerializeToken`): names `"UPPER"`; non-string scalars as-is in
  quotes; strings via JSON escaping (`JsonConvert.ToString` semantics); arrays
  name once then name+element (empty → name once); null → name only; no
  separators.
- **Tests**: For each **locked** `*.canonical.txt` (currently gv-01),
  `canonicalSerialize(input) === expected` (byte-exact after newline normalize).
  gv-02..gv-08 remain PENDING until EInvoicingSigner confirms.

## Money helpers

- `add`, `sub`, `mul`, `div` on decimal strings
- `formatMoney(value): string` → exactly 2 fractional digits, half away from zero
- Never return JS `number` for money fields destined for the payload

## Calculators

- `calculateLine(input): LineComputed`
- `calculateDocumentTotals(lines, extraDiscount): DocumentTotals`
- All amounts out as decimal strings

## Builders

- `buildInvoice(ctx): EtaDocumentPayload`
- `buildCreditNote(ctx)`, `buildDebitNote(ctx)`
- `buildExportInvoice(ctx)`, `buildExportCreditNote(ctx)`, `buildExportDebitNote(ctx)`

`ctx` includes kind-specific fields, issuer snapshot, receiver, lines, taxes,
binding `{ documentType, documentTypeVersion }` from 004 catalog (caller-
supplied).

## `LocalValidator`

```ts
validate(params: {
  document: EtaDocumentPayload;
  typeVersionSchema: TypeVersionSchema; // from 004 cache
  refs: { branchOk; currencyOk; itemCodesOk; originalDocumentOk? };
}): ValidationIssue[]
```

Empty array = pass. Non-empty = must not mark READY.

## Agent mirror

.NET `CanonicalSerialize(JsonElement|JObject)` must match the same golden
expected strings. Shared files under
`specs/005-document-building-serialization/golden-vectors/`.
