# Feature Specification: Document Building, Validation & ETA Canonical Serialization

**Feature Branch**: `005-document-building-serialization`

**Created**: 2026-07-25

**Status**: Clarified

**Input**: User description: "Feature: Document building, validation, and ETA canonical serialization. - Model documents: Invoice, Credit Note, Debit Note, Export Invoice, Export Credit Note, Export Debit Note — mapped to the active ETA document type version. - Compute taxes, discounts, totals; support multi-currency and multi-branch. - Local validation before submission (structure + required fields per type version). - Implement the ETA canonical serialization EXACTLY: recursive from root; property names uppercased (culture-invariant); values taken as-is (0.0 stays 0.0); names and scalar values wrapped in double quotes; for arrays the property name is repeated before each element. This lives in `eta-core` and is shared/mirrored by the agent. - Add unit tests using known input→canonical-string test vectors (compare against the reference C# signer outputs). Frontend: create/edit invoice form (line items, taxes, discounts, currency, branch), live preview, drafts."

## Clarifications

### Session 2026-07-25

- Q: How are monetary and numeric scalars represented so that exact formatting
  (e.g. `0.0` / `0.00`) survives into the canonical string — integer minor units
  or decimal strings? → A: **Decimal strings** (not integer minor units). Computed
  monetary amounts are emitted as decimal strings with **exactly 2 fractional
  digits**, rounded **half away from zero**. IEEE floating-point MUST NOT be the
  storage or canonicalization input for money. Integer minor units are rejected
  because they cannot preserve literals such as `0.00`.
- Q: What drives local structural / required-field validation? → A: The **cached
  ETA document type version** from Phase 3 / feature **004** (runtime catalog
  already fetched and cached). Validation MUST NOT use a product-hardcoded schema
  as the source of truth.
- Q: What are the authoritative golden vectors for the shared suite? → A: **gv-01**
  is the **official** ETA SDK pair (`one-doc.json` →
  `one-doc-serialized.json.txt`) and is **LOCKED**. All other vectors (gv-02..08)
  are **PENDING** until confirmed byte-exact against
  [bassemAgmi/EInvoicingSigner](https://github.com/bassemAgmi/EInvoicingSigner)
  `CanonicalString.txt`. Candidates may be produced only by that tool or by the
  exact `SerializeToken` port in `tools/reference-canonical-serialize` — **never**
  from the product serializer. Algorithm SoT:
  `packages/eta-core/docs/reference-algorithm.md`.
- Q: How does an empty JSON array serialize? → A: Per the reference
  `SerializeToken`, emit the uppercased property name **exactly once**, then
  zero element blocks. It does **not** omit the property. (Matches ETA SDK JSON
  loop semantics.) Candidate: gv-04 PENDING.
- Q: How are absent optionals vs null handled? → A: **Absent** → not emitted.
  **Null** (per reference source): emit `"NAME"` only, no value token. Candidate
  gv-08 PENDING until tool-confirmed `CanonicalString.txt`.
- Q: Does JSON canonicalization escape quotes inside values? → A: **Yes, per the
  reference signer**: string scalars use `JsonConvert.ToString` (JSON escaping).
  Example: `say "hi"` → `"say \"hi\""` (gv-06 PENDING). ETA SDK JSON pseudocode
  that omits EscapeQuotes is **not** followed for product/hash parity; the
  reference `CanonicalString.txt` is authoritative.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Author a document with correct taxes, discounts, and totals (Priority: P1)

An accountant opens the document form, selects the issuing branch and currency,
adds line items (description, item code, unit type, quantity, unit price),
applies line-level and document-level discounts, and selects the applicable
taxes for each line. The platform computes every derived amount—line net,
discount, taxable base, tax per tax type, line total, and document totals—and
shows them as the accountant types. The accountant saves the work as a draft and
can come back later to finish it.

**Why this priority**: Nothing else in the invoicing lifecycle exists without a
correctly computed document. This story alone gives accountants a usable
authoring surface and is the foundation every later story builds on.

**Independent Test**: Create a draft with several lines, mixed discounts, and
more than one tax type; verify each computed amount and the document totals
against hand-calculated expected values; reopen the draft and confirm all
captured and computed values persist unchanged.

**Acceptance Scenarios**:

1. **Given** an authorized user with an active branch and enabled currency,
   **When** they add a line with quantity and unit price, **Then** the line net
   amount, taxable base, tax amounts, and line total are computed and displayed
   without manual calculation.
2. **Given** a line with a line-level discount, **When** the discount is
   applied, **Then** the discount reduces the taxable base before taxes are
   computed, and both the discount and the resulting tax amounts appear in the
   line and document totals.
3. **Given** a document with several lines and a document-level (extra)
   discount, **When** totals are computed, **Then** total sales, total discount,
   net amount, total tax per tax type, and total amount payable are consistent
   with the line-level figures.
4. **Given** a user edits quantity, price, discount, or tax selection,
   **When** the change is made, **Then** all dependent amounts recompute
   immediately and no stale total remains visible.
5. **Given** a saved draft, **When** the user reopens it, **Then** every entered
   and computed value is restored exactly as saved.
6. **Given** amounts submitted by a client, **When** the platform stores or
   validates a document, **Then** the platform recomputes all derived amounts
   itself and does not trust client-supplied totals.

---

### User Story 2 - Produce the exact ETA canonical string (Priority: P1)

The platform converts a document payload into the ETA canonical string used for
signing, following ETA's canonicalization rules exactly. The identical algorithm
is available to the desktop signing agent so that both sides derive the same
canonical string from the same document, and a shared suite of known
input→expected-output vectors proves it.

**Why this priority**: A single character of divergence between the platform and
the signing agent produces an invalid signature and an ETA rejection that is
extremely expensive to diagnose. The constitution treats this parity as a
release gate.

**Independent Test**: Run the shared vector suite against the platform
implementation and against the agent implementation; every vector must produce
a canonical string identical to the recorded reference output, and any
deliberate one-character change to the algorithm must fail the suite.

**Acceptance Scenarios**:

1. **Given** a document payload, **When** it is canonicalized, **Then** the
   platform walks the payload recursively from the root and emits, for every
   property, the property name in double quotes, uppercased using
   culture-invariant rules.
2. **Given** a property whose value is a scalar, **When** it is canonicalized,
   **Then** the value is emitted in double quotes exactly as it appears in the
   payload, with no reformatting, rounding, padding, or normalization (a value
   of `0.0` remains `0.0`, not `0`).
3. **Given** a property whose value is an array, **When** it is canonicalized,
   **Then** the property name is repeated before each element, and each element
   is canonicalized by the same recursive rules.
4. **Given** a property whose value is a nested object, **When** it is
   canonicalized, **Then** the nested object's properties are canonicalized by
   the same rules, including uppercased names.
5. **Given** the same document payload canonicalized twice, or canonicalized by
   the platform and by the desktop signing agent, **When** the outputs are
   compared, **Then** they are identical character for character.
6. **Given** the shared vector suite, **When** continuous integration runs,
   **Then** every vector's produced canonical string matches its recorded
   expected string, and any mismatch fails the build.
7. **Given** property names that differ only by locale-sensitive casing rules,
   **When** names are uppercased, **Then** culture-invariant casing is used so
   the result never depends on the host machine's locale.

---

### User Story 3 - Catch problems locally before submission (Priority: P1)

Before a document is considered ready to send to ETA, the platform validates it
locally against the structure and required fields of the ETA document type
version the document is bound to, plus the platform's own referential and
arithmetic rules. The accountant sees a clear, actionable list of problems tied
to the exact fields that caused them, in Arabic or English.

**Why this priority**: Local validation converts slow, opaque ETA rejections
into immediate, specific feedback, and it is a precondition for any submission
work that follows this feature.

**Independent Test**: Build documents that each violate one rule (missing
required field, unknown code, note without an original-document reference,
inconsistent totals) and confirm each produces the expected issue with the
correct field path; then correct each document and confirm it validates cleanly.

**Acceptance Scenarios**:

1. **Given** a document missing a field the bound document type version
   (from the Phase 3 / feature 004 cached ETA catalog) requires, **When**
   validation runs, **Then** validation fails and reports the missing field with
   its location in the document.
2. **Given** a document whose values violate that cached version's structural
   expectations (wrong shape, wrong value domain, or a code outside the
   ETA-provided code lists), **When** validation runs, **Then** each violation
   is reported individually rather than as a single generic failure.
3. **Given** a document that references an inactive branch, a currency that is
   not enabled for the tenant, or an item code the tenant does not have,
   **When** validation runs, **Then** the referential problem is reported.
4. **Given** a credit note or debit note with no reference to the original
   document, **When** validation runs, **Then** validation fails with a clear
   explanation of the required reference.
5. **Given** a document whose stated totals do not agree with its lines,
   **When** validation runs, **Then** the arithmetic inconsistency is reported.
6. **Given** a document that fails validation, **When** the user tries to mark
   it ready for submission, **Then** the platform refuses and keeps the document
   in an unsent state.
7. **Given** a document that validated cleanly earlier, **When** the bound
   document type version changes, **Then** validation is re-run against the new
   version before the document may be treated as ready.
8. **Given** any validation failure, **When** it is displayed, **Then** the
   message is available in both Arabic and English with correct right-to-left
   layout for Arabic.

---

### User Story 4 - Credit notes, debit notes, and export variants (Priority: P2)

Beyond standard invoices, the accountant can create credit notes and debit notes
that reference an original document, plus the export forms of all three
documents for foreign customers. Each of the six document kinds is bound to the
ETA document type and active version that ETA's runtime catalog reports, and
only the fields that version requires are demanded.

**Why this priority**: Real customers cannot operate on invoices alone—
corrections and export sales are routine—but standard invoices deliver value
first.

**Independent Test**: Create one document of each of the six kinds, confirm each
binds to the document type and version reported by the runtime catalog, confirm
notes require and carry their original-document reference, and confirm export
variants demand the additional fields their version requires.

**Acceptance Scenarios**:

1. **Given** the ETA-backed document type catalog, **When** the user starts a
   new document of a given kind, **Then** the document is bound to the ETA
   document type and the active version reported by that catalog, not to a
   schema hardcoded in the product.
2. **Given** a credit note or debit note, **When** the user selects the original
   document, **Then** the reference is captured in the form the bound version
   requires and is carried through validation and canonicalization.
3. **Given** an export document kind, **When** the user completes it, **Then**
   the additional fields required by that version for exports are captured and
   validated.
4. **Given** a document type version that the catalog no longer reports as
   active, **When** the user opens a draft bound to it, **Then** the user is
   warned and the document must be re-validated against the current active
   version before it can be treated as ready.

---

### User Story 5 - Multi-currency and multi-branch documents (Priority: P2)

The accountant issues documents from any active branch of the tenant and in any
currency the tenant has enabled. For foreign-currency documents the platform
resolves the exchange rate that applies on the document's issue date and derives
the local-currency figures the bound version requires. Branch selection supplies
the issuer identity, activity code, and address that ETA expects.

**Why this priority**: Multi-branch and multi-currency operation is required for
the target market and for export documents, but a single-branch EGP invoice is
already a shippable slice.

**Independent Test**: Issue the same document from two different branches and in
two different currencies; confirm the issuer details follow the branch, the
exchange rate is resolved from the tenant's configured rates for the issue date,
and the local-currency amounts are derived correctly.

**Acceptance Scenarios**:

1. **Given** a tenant with several active branches, **When** the user selects an
   issuing branch, **Then** the document carries that branch's ETA identity,
   activity code, and address, and inactive branches are not selectable.
2. **Given** a document in a currency other than the local currency, **When**
   the document is built, **Then** the applicable exchange rate for the issue
   date is resolved from the tenant's configured rates and the local-currency
   amounts required by the bound version are derived from it.
3. **Given** a foreign-currency document with no exchange rate configured for
   its issue date, **When** validation runs, **Then** validation fails with a
   clear message pointing the user at exchange-rate settings.
4. **Given** a document in the local currency, **When** the document is built,
   **Then** the currency and exchange-rate representation the bound version
   requires for local-currency documents is produced without asking the user for
   a rate.
5. **Given** a currency that is not enabled for the tenant, **When** the user
   attempts to use it, **Then** it is unavailable or rejected with a clear
   message.

---

### User Story 6 - Live preview and draft management (Priority: P3)

While editing, the accountant sees a live preview of the document as it will be
sent, with totals updating on every change. Drafts are saved, listed, reopened,
and deleted, so long documents can be built over more than one sitting and
reviewed before anyone commits to sending them.

**Why this priority**: Preview and draft lifecycle raise confidence and reduce
rework, but authoring, canonicalization, and validation must exist first.

**Independent Test**: Edit a document and confirm the preview and totals track
each change; save several drafts, confirm they are listed and reopen with their
content intact, and confirm deleting one leaves the others untouched.

**Acceptance Scenarios**:

1. **Given** a document being edited, **When** any field changes, **Then** the
   preview and all totals refresh to reflect the change.
2. **Given** a draft list, **When** an authorized user opens it, **Then** they
   see only their own tenant's drafts with enough detail to identify each one.
3. **Given** a draft, **When** the user deletes it, **Then** it is removed from
   the list and the action is recorded in the audit trail.
4. **Given** a document under review, **When** the user inspects the preview,
   **Then** the preview reflects the document exactly as it would be sent, and
   any diagnostic view of the canonical string reflects the same payload.
5. **Given** an unauthorized role, **When** it attempts to create, edit, or
   delete documents, **Then** the action is denied while permitted read-only
   access still works.

---

### Edge Cases

- **Culture-sensitive casing**: the reference signer uses `Name.ToUpper()`
  (current culture). ETA property names in practice are ASCII (identical under
  invariant vs current culture). Product MUST match locked golden bytes; prefer
  documenting parity with
  `packages/eta-core/docs/reference-algorithm.md`.
- **Value fidelity**: `0.0`, `0.00`, trailing zeros, and other decimal-string
  forms MUST be emitted exactly as stored in the payload; canonicalization never
  re-formats numbers. Integer minor-unit money is out of scope.
- **Values containing double quotes or backslashes**: string scalars use
  `JsonConvert.ToString` semantics (**JSON escaping**), matching bassemAgmi
  `SerializeToken`. Example: `say "hi"` → `"say \"hi\""`. gv-06 **PENDING**.
- **Empty arrays**: emit the array property name **exactly once**, then zero
  element blocks. Example: `{ "invoiceLines": [] }` → `"INVOICELINES"`. gv-04
  **PENDING**.
- **Single-element arrays**: emit name once as prefix, then name + element
  content once more (same as any non-empty array).
- **Absent optional properties**: not present → **not emitted**. gv-05
  **PENDING**.
- **Null-valued properties**: reference emits `"NAME"` with no value token.
  Candidate gv-08 **PENDING** until tool-confirmed — do not invent from product
  code.
- **Empty-string scalars**: `JsonConvert.ToString("")` → `""` value token (as in
  official gv-01 IBAN/SWIFT). gv-02 **PENDING**.
- **Arabic and other non-Latin text**: preserved in UTF-8 (hash-critical). gv-07
  **PENDING**.
- **Property order**: canonical output follows the payload's property order; the
  platform never re-orders properties to make output "nicer".
- **Rounding boundaries**: a computed amount that lands exactly on a rounding
  midpoint MUST round predictably and identically on every run.
- **Discount larger than the line amount**, negative quantity, negative price,
  or zero quantity: rejected by validation with a specific message.
- **Tax rate of zero** and exempt lines: produce a tax entry or omission exactly
  as the bound version requires, not silently dropped.
- **Document with a very large number of lines**: computation, validation, and
  preview remain usable and correct.
- **Inactive branch or disabled currency selected earlier**, then deactivated:
  reopening the draft surfaces the problem instead of silently sending it.
- **Credit/debit note referencing a document that does not exist** or belongs to
  another tenant: rejected.
- **Concurrent edits to the same draft** from two sessions: the second save does
  not silently discard the first without the user knowing.
- **Cross-tenant access**: tenant A can never read, edit, or reference tenant
  B's documents or drafts.
- **Document type catalog unavailable**: the user is told the binding cannot be
  confirmed rather than being given a hardcoded fallback schema.

## Requirements *(mandatory)*

### Functional Requirements

#### Document modeling

- **FR-001**: System MUST support six document kinds: Invoice, Credit Note,
  Debit Note, Export Invoice, Export Credit Note, and Export Debit Note.
- **FR-002**: Every document MUST be bound to an ETA document type and an active
  ETA document type version obtained from the Phase 3 / feature 004 **cached**
  runtime catalog; the product MUST NOT use a hardcoded document schema as the
  source of truth for that binding.
- **FR-003**: Credit notes and debit notes MUST capture a reference to the
  original document in the form required by the bound version, and that
  reference MUST point to a document of the same tenant.
- **FR-004**: Documents MUST capture issuer details derived from tenant and
  branch settings and receiver details required by the bound version.
- **FR-005**: Documents MUST support line items capturing at minimum
  description, item code (code type and value from the tenant's item codes),
  unit type, quantity, and unit price/value.
- **FR-006**: Documents MUST support discounts at line level and a
  document-level (extra) discount, and taxes selected per line from the tax
  types and subtypes ETA publishes at runtime.

#### Computation

- **FR-007**: System MUST compute, per line, the net amount, the applied
  discount, the taxable base after discount, the amount of each applicable tax,
  and the line total.
- **FR-008**: System MUST compute document totals including total sales, total
  discount, net amount, total per tax type, extra discount, and total amount
  payable, consistent with the line-level figures.
- **FR-009**: System MUST represent monetary and other ETA numeric scalars that
  enter canonicalization as **decimal strings** (not IEEE floats and not integer
  minor units), so exact formatting is preserved (e.g. `0.00` stays `0.00`).
  Computed **monetary** amounts MUST be emitted with **exactly 2 fractional
  digits**, rounded **half away from zero**. Non-monetary numerics (e.g.
  quantity or integer-looking rates) MUST keep the exact string form produced by
  the computation / mapping rules without reformatting during canonicalization.
- **FR-010**: System MUST recompute all derived amounts authoritatively on the
  server and MUST NOT trust totals supplied by a client.
- **FR-011**: Computation MUST be deterministic: the same inputs always produce
  the same decimal-string amounts.

#### Multi-currency and multi-branch

- **FR-012**: Documents MUST be issuable in any currency the tenant has enabled,
  and MUST reject currencies that are not enabled for that tenant.
- **FR-013**: For documents not in the local currency, the system MUST resolve
  the exchange rate applicable to the document's issue date from the tenant's
  configured rates and derive the local-currency amounts the bound version
  requires; a missing applicable rate MUST fail validation with a message that
  points to exchange-rate settings.
- **FR-014**: For local-currency documents the system MUST produce the currency
  and exchange-rate representation the bound version requires without prompting
  the user for a rate.
- **FR-015**: Documents MUST be issuable from any active branch of the tenant;
  the selected branch MUST supply the issuer identity, activity code, and
  address used in the document, and inactive branches MUST NOT be selectable.

#### Local validation

- **FR-016**: System MUST validate a document locally before it may be treated
  as ready for submission, covering required-field presence and document
  structure as defined by the **cached ETA document type version** from Phase 3
  / feature **004** (the runtime catalog already obtained and cached for the
  tenant). Hardcoded product schemas MUST NOT be the validation source of truth.
- **FR-017**: Validation MUST cover value-domain rules, including codes that
  must come from ETA-published code lists available via that same cached catalog
  / runtime sources.
- **FR-018**: Validation MUST cover referential rules, including branch,
  currency, item codes, and the original-document reference for notes.
- **FR-019**: Validation MUST cover arithmetic consistency between line figures
  and document totals.
- **FR-020**: Validation MUST report every problem it finds individually, each
  with a stable machine-readable issue code, the location of the offending field
  within the document, and a human-readable message available in Arabic and
  English.
- **FR-021**: A document that fails validation MUST NOT be marked ready for
  submission.
- **FR-022**: When the bound document type version changes, the system MUST
  require re-validation against the new version before the document may be
  treated as ready.

#### ETA canonical serialization

- **FR-023**: System MUST produce the ETA canonical string by walking the
  document payload recursively from its root.
- **FR-024**: For every property, the canonical output MUST contain the property
  name wrapped in double quotes and uppercased per the reference algorithm
  (`Name.ToUpper()` as in bassemAgmi). Locked golden vectors MUST pass on CI
  hosts; ETA property names are ASCII in practice.
- **FR-025**: For every scalar value, the canonical output MUST contain the
  value wrapped in double quotes and emitted exactly as it appears in the
  payload, with no reformatting, rounding, trimming, padding, or normalization
  (a value of `0.00` MUST remain `0.00`). String scalars MUST match the
  reference signer’s `JsonConvert.ToString` escaping (e.g. `say "hi"` →
  `"say \"hi\""`).
- **FR-026**: For every array-valued property, the canonical output MUST first
  emit the property name once, then for **each** element follow the reference
  loop (emit the property name again, then serialize the element). An **empty**
  array therefore yields exactly one name token and no element content.
- **FR-027**: For every object-valued property, the canonical output MUST
  canonicalize the nested object by the same recursive rules.
- **FR-028**: Canonical output MUST be the direct concatenation of the emitted
  name and value tokens, with no separators, delimiters, or whitespace added
  between them, and MUST preserve the payload's property order.
- **FR-029**: System MUST define, document, and prove by test vector its
  behavior for: empty arrays (gv-04); empty strings (gv-02 / gv-01); absent
  optional properties (gv-05); values containing double quotes (gv-06,
  `JsonConvert.ToString` escaping); non-Latin/Arabic text (gv-07); and
  null-valued properties (gv-08 — reference: name only). Vectors remain
  **PENDING** until confirmed against EInvoicingSigner `CanonicalString.txt`
  (or official ETA SDK files). Never generate expecteds from product code.
- **FR-030**: Canonicalization MUST exist as a single shared implementation
  consumed by the platform, and the desktop signing agent MUST produce
  character-identical output for the same payload.
- **FR-031**: A shared suite of test vectors, each pairing a known input payload
  with its expected canonical string, MUST verify both the platform and the
  agent implementations, and MUST fail continuous integration on any mismatch
  for every **locked** vector.
- **FR-032**: The expected canonical strings in the vector suite MUST NOT be
  produced by the platform implementation under test. Provenance tiers:
  - **Official / tool-confirmed (locked)**: `*.canonical.txt` — currently
    **gv-01** only (ETA SDK `one-doc.json` → `one-doc-serialized.json.txt`).
  - **PENDING (candidate)**: gv-02..gv-08 — `*.canonical.PENDING.txt` from the
    exact bassemAgmi `SerializeToken` port; promote only after
    `CanonicalString.txt` byte match (see golden-vectors runbook).
  - Algorithm documentation SoT:
    `packages/eta-core/docs/reference-algorithm.md`.
- **FR-033**: Vectors MUST be versioned together with the canonicalization
  rules, and any change to those rules MUST update the vectors in the same
  change set. Golden fixture files MUST be stored **without** a trailing
  newline; byte-exact tests MAY strip at most one trailing `\n` on expected and
  actual before `===` for robustness.

#### Authoring experience

- **FR-034**: Authorized users MUST be able to create and edit a document
  through a form covering line items (add, edit, remove), line and document
  discounts, tax selection, currency, and issuing branch.
- **FR-035**: The form MUST show a live preview of the document as it would be
  sent, with all computed totals refreshing as the user edits.
- **FR-036**: Users MUST be able to save a document as a draft, list drafts,
  reopen a draft with its content intact, and delete a draft.
- **FR-037**: Validation issues MUST be surfaced against the fields that caused
  them within the authoring form.
- **FR-038**: All authoring, preview, validation, and draft screens MUST be
  available in Arabic and English with correct right-to-left layout for Arabic
  and responsive behavior across supported breakpoints.

#### Access, isolation, and audit

- **FR-039**: Document viewing and document management MUST be governed by
  tenant permissions, and users without management permission MUST NOT create,
  edit, or delete documents.
- **FR-040**: Documents and drafts MUST be tenant-isolated so that no tenant can
  read, edit, or reference another tenant's documents.
- **FR-041**: System MUST record audit events for document draft creation,
  update, deletion, and validation-ready transitions, with actor, tenant, time,
  action, and outcome, and without secret material.

### Constitution Constraints *(mandatory — map applicable principles)*

- **CC-001 Reliability/Audit**: Every user story above carries testable
  acceptance scenarios; audit events are required for draft lifecycle and
  validation-ready transitions (FR-041).
- **CC-002 Security**: This feature handles no new secrets; ETA credentials and
  signing material stay outside its scope. Document payloads and previews MUST
  NOT expose credentials or access tokens, and validation messages MUST NOT leak
  secret material.
- **CC-003 Tenant Isolation**: Documents, lines, and drafts are tenant-scoped
  with row-level enforcement plus application checks; cross-tenant references
  are rejected (FR-003, FR-040).
- **CC-004 ETA Serialization**: Central to this feature. One shared
  canonicalization implementation, mirrored character-for-character by the .NET
  signing agent, verified by shared test vectors in continuous integration
  (FR-023 to FR-033).
- **CC-005 Runtime ETA Config**: Document type versions, code lists, and tax
  types come from the runtime ETA-backed catalog; no hardcoded schema is the
  source of truth (FR-002, FR-017).
- **CC-006 Sandbox-First**: This feature makes no live ETA submissions. Any ETA
  catalog reads it depends on use the existing sandbox-first configuration.
- **CC-007 UX/i18n**: Authoring form, preview, drafts, and validation messages
  ship in Arabic and English with right-to-left support (FR-020, FR-038).
- **CC-008 Full-Stack Phase**: Backend document building, validation, and
  canonicalization ship together with the authoring frontend and with the
  agent-side parity vectors, all covered by automated tests.

### Key Entities *(include if feature involves data)*

- **Document**: A tenant-scoped commercial document of one of the six kinds,
  holding its kind, bound ETA document type and version, issuing branch,
  currency and resolved exchange rate, issue date, internal identifier, issuer
  and receiver details, computed totals, draft/ready state, and (for notes) the
  original-document reference.
- **DocumentLine**: A line of a document with description, item code type and
  value, unit type, quantity, unit price, line discount, computed net, taxable
  base, and line total.
- **DocumentLineTax**: A tax applied to a line, with tax type, subtype, rate or
  basis as ETA defines it, and the computed tax amount.
- **DocumentDiscount**: A discount applied at line or document level, expressed
  as rate or amount, with its computed effect.
- **DocumentTotals**: The document's derived figures—total sales, total
  discount, net amount, tax totals per type, extra discount, and total amount
  payable—recomputed authoritatively rather than accepted from clients.
- **DocumentTypeBinding**: The link between a document and the ETA document type
  plus active version from the Phase 3 / feature 004 cached catalog it was built
  and validated against, including when that binding was resolved so stale
  bindings can be detected.
- **ValidationIssue**: One problem found by local validation, with a stable
  issue code, the field path within the document, severity, and bilingual
  message; not necessarily persisted.
- **CanonicalTestVector**: A shared, versioned pair of an input document payload
  and its authoritative expected canonical string, used by both the platform and
  the signing agent test suites.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of shared canonical test vectors produce a canonical string
  identical, character for character, to the recorded authoritative expected
  output, in both the platform and the desktop signing agent, on every
  continuous-integration run.
- **SC-002**: An intentional single-character deviation in the canonicalization
  rules (for example locale-sensitive uppercasing, an added separator, or
  reformatting `0.0` to `0`) causes at least one vector to fail, proving the
  suite detects divergence.
- **SC-003**: Canonicalizing the same payload repeatedly, and on different host
  machines and locales, yields identical output every time.
- **SC-004**: For a documented set of worked examples covering multiple lines,
  line and document discounts, several tax types, and both local and foreign
  currency, 100% of computed line and document amounts match the independently
  calculated expected values, each as a 2-fractional-digit decimal string.
- **SC-005**: For each defined validation rule there is at least one automated
  case proving the rule reports the expected issue code and field location, and
  at least one proving a correct document passes; no document that fails
  validation can be marked ready for submission.
- **SC-006**: An accountant can create a five-line document with discounts,
  taxes, a selected branch, and a selected currency, and save it as a draft, in
  under 5 minutes without leaving the form or consulting documentation.
- **SC-007**: Totals and preview reflect an edit before the user's next action,
  with no stale value shown after a change is committed to a field.
- **SC-008**: All six document kinds can be created, validated, and canonicalized
  against the document type version reported by the runtime catalog, with no
  product-hardcoded schema serving as the source of truth.
- **SC-009**: Authoring, preview, validation messages, and draft management are
  fully usable in both Arabic (right-to-left) and English, with no missing
  labels or untranslated validation messages on the primary flows.
- **SC-010**: Automated checks confirm no tenant can read, edit, or reference
  another tenant's documents or drafts.

## Assumptions

- Feature **003 Tenant Settings** supplies active branches with ETA branch and
  activity codes, tenant-enabled currencies, exchange rates with effective
  dating, and tenant item codes; this feature consumes them rather than
  redefining them.
- Feature **004 ETA Integration Core** (Phase 3) supplies the runtime ETA-backed
  catalog of document types and versions and caches them; document binding,
  local validation of structure/required fields, and code lists derive from that
  **cached document type version**, not from hardcoded schemas.
- The six product document kinds map onto ETA document types and versions as
  reported by that catalog, including whatever distinguishes the export variants;
  the product does not invent its own type codes.
- Canonicalization rules are exactly as stated in this specification, matching
  ETA's canonicalization for signing: recursive from the root, culture-invariant
  uppercased property names, values emitted verbatim, names and scalar values in
  double quotes, and array property names repeated before each element (JSON
  array form per ETA SDK Document Serialization Approach).
- The shared canonicalization implementation lives in the workspace's shared ETA
  library (`packages/eta-core`) and is mirrored by the .NET desktop signing
  agent, per the constitution's serialization-parity principle.
- Documents and drafts are persisted server-side and tenant-scoped, so drafts
  survive sessions and devices and are covered by isolation and audit rules.
- Money and other ETA numeric scalars that are serialized are **decimal strings**
  so that formatting such as `0.00` and `10.50` is preserved; the computation
  layer emits those strings (2 fractional digits for monetary amounts, half away
  from zero). Integer minor-unit representation is out of scope for the ETA
  payload.
- Golden vectors live under
  `specs/005-document-building-serialization/golden-vectors/`. **gv-01** is
  LOCKED (official ETA SDK). gv-02..gv-08 are **PENDING** candidates from the
  bassemAgmi `SerializeToken` port until `CanonicalString.txt` confirms. Never
  mint expecteds from product code. Algorithm:
  `packages/eta-core/docs/reference-algorithm.md`.
- Empty JSON arrays emit the property name once (reference), not omit the
  property. Null emits name only. Strings use `JsonConvert.ToString` escaping.
- Reasonable defaults where the description was silent: internal document
  identifiers are unique per tenant; a document's issue date determines exchange
  rate resolution; and a draft may be edited freely until it is marked ready.
- Validation targets local, pre-submission correctness. It reduces ETA
  rejections but does not promise that ETA will accept every locally valid
  document.

## Out of Scope

- Signing documents, certificate or smart-card handling, and any cryptographic
  signature production
- Submitting documents to ETA, polling submission status, and handling ETA
  submission responses
- Building or changing the desktop signing agent itself, beyond the shared
  canonical vectors it must satisfy
- Managing ETA credentials, document type catalogs, branches, currencies,
  exchange rates, or item codes (owned by features 003 and 004)
- Printing, PDF rendering, QR codes, and customer-facing document delivery
- Bulk import of documents and integrations with external accounting systems
- Receipts (the ETA receipt/POS flow) as distinct from invoices and notes
