# Implementation Plan: Document Building, Validation & ETA Canonical Serialization

**Branch**: `005-document-building-serialization` | **Date**: 2026-07-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-document-building-serialization/spec.md`
plus technical direction: `eta-core` `canonicalSerialize(document)` (framework-free,
100% unit-tested); document builders per type; tax/total calculators with exact
value preservation (decimal strings); `LocalValidator` using cached type-version
schema from Phase 3 / 004; web invoice form (lines, taxes, discounts, currency,
branch) with live JSON + canonical preview and draft save; golden tests asserting
`canonicalSerialize(input) === expected` byte-exact for **locked** fixtures
(gv-01+); PENDING vectors confirmed via bassemAgmi EInvoicingSigner.

## Summary

Ship the first end-to-end **document authoring** slice: build Invoice / Credit /
Debit / Export variants into ETA-shaped payloads, compute taxes/discounts/totals
as **decimal strings** (2 dp, half away from zero), validate locally against the
**004-cached document type version**, and produce the **ETA canonical string**
via a shared, framework-free `canonicalSerialize` in `@einvoice/eta-core`,
mirrored by a thin .NET agent implementation and locked by golden vectors.
Frontend: create/edit form with live JSON + canonical preview and draft CRUD.
No ETA submission or cryptographic signing in this phase.

## Technical Context

**Language/Version**: TypeScript 5.x (`packages/eta-core`, NestJS 10 API, Next.js
15 web); C# / .NET 8 (agent — canonical serialize + vector tests only)

**Primary Dependencies**: `@einvoice/eta-core` (pure TS, no Nest/Next); decimal
math via string/`Decimal.js` or equivalent that never emits IEEE floats into the
payload; NestJS + Prisma + RLS; existing 003 settings + 004 `EtaDocTypesClient`
cache; Next.js 15, next-intl, TanStack Query, react-hook-form + zod; Jest for
eta-core golden tests

**Storage**: PostgreSQL — new tenant-scoped `Document` (+ lines/taxes) with FORCE
RLS; Redis — reuse 004 doc-type/version cache keys only (no new token paths);
no MinIO in this feature

**Testing**: **Mandatory** golden tests in `packages/eta-core` — for each vector
in `specs/005-…/golden-vectors/`, `canonicalSerialize(input) === expected`
(byte-exact); calculator unit tests with worked examples; `LocalValidator` unit
tests against fixture type-version schemas; API e2e for draft CRUD + validate +
tenant isolation; agent vector suite reading the **same** golden files; web smoke
for form/preview/draft copy (ar/en)

**Target Platform**: Existing Compose Postgres/Redis + api/web; agent tests on
CI/.NET SDK; no live ETA submit

**Project Type**: Multi-tenant SaaS (API + web) + agent serialization parity

**Performance Goals**: `canonicalSerialize` on a 50-line document p95 < 20ms
locally; draft save p95 < 500ms; live preview recompute feels instant (< 100ms
client-side for typical invoices)

**Constraints**: Decimal strings only for money in ETA payload; no float money;
validation from 004 cached type-version (no hardcoded schema SoT); culture-
invariant `toUpperCase`; property order preserved; agent must match byte-exact;
no access tokens/secrets in document APIs; RLS on all document tables

**Scale/Scope**: Six document kinds; drafts + ready-for-submit flag (no submit);
MVP can prioritize Invoice first then notes/export, but contracts cover all six

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Reliability & Audit**: PASS — golden + calculator + validator + API/web
  tests; audit draft create/update/delete + mark-ready
- **II. Security by Default**: PASS — no new secrets; document APIs never return
  ETA tokens/creds
- **III. Multi-Tenant Isolation**: PASS — Document tables FORCE RLS +
  `withTenant`; cross-tenant original-doc refs rejected
- **IV. Serialization Parity**: PASS — `canonicalSerialize` in eta-core + .NET
  mirror; shared golden vectors gv-01..03 in CI for both
- **V. Runtime ETA Config**: PASS — `LocalValidator` consumes 004 cached
  type-version schema/metadata; builders bind catalog types, not hardcoded SoT
- **VI. Sandbox-First**: PASS — no submission; catalog reads reuse 004 sandbox
  config
- **VII. UX/i18n**: PASS — form, preview, validation messages ar/en + RTL
- **VIII. Phased Full-Stack DoD**: PASS — eta-core + API + web + agent vector
  tests ship together
- **Stack**: PASS — within baseline; `Decimal.js` (or equivalent) is a library
  addition inside eta-core/api, not a stack deviation

### Post-Design Re-check (Phase 1)

Gates remain PASS. Contracts expose draft/validate/preview without secrets;
data model RLS + version binding documented; research locks decimal-string money
and golden-test wiring. Agent scope limited to serialize + vectors (no PKCS#11).
No unjustified violations.

## Project Structure

### Documentation (this feature)

```text
specs/005-document-building-serialization/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── golden-vectors/          # gv-01..03 (already present)
├── contracts/
│   ├── documents-api.yaml
│   ├── eta-core-api.md      # canonicalSerialize / builders / validator surface
│   └── permissions.md
└── tasks.md                 # /speckit-tasks (later)
```

### Source Code (repository root)

```text
packages/eta-core/
├── src/
│   ├── index.ts
│   ├── canonical-serialize.ts   # canonicalSerialize(document)
│   ├── money.ts                 # decimal-string ops, 2dp half-away-from-zero
│   ├── calculate-totals.ts      # line + document tax/discount/totals
│   ├── builders/                # per document kind → ETA JSON shape
│   ├── local-validator.ts       # LocalValidator(typeVersionSchema, doc)
│   └── types.ts
├── tests/
│   ├── canonical-serialize.golden.spec.ts  # byte-exact gv-01..03
│   ├── money.spec.ts
│   ├── calculate-totals.spec.ts
│   └── local-validator.spec.ts
└── package.json

apps/api/
├── src/documents/
│   ├── documents.module.ts
│   ├── documents.controller.ts
│   ├── documents.service.ts     # draft CRUD, recompute, validate, preview
│   └── document-permissions.ts
├── prisma/schema.prisma         # Document, DocumentLine, DocumentLineTax, …
└── test/
    ├── documents.draft.spec.ts
    ├── documents.validate.spec.ts
    └── documents.isolation.spec.ts

apps/web/
├── src/app/[locale]/(app)/documents/
│   ├── page.tsx                 # draft list
│   └── [id]/page.tsx           # create/edit form + live previews
├── src/lib/api/documents.ts
└── src/messages/{ar,en}.json

apps/agent/
├── src/…/CanonicalSerialize.cs  # mirror of eta-core algorithm
└── tests/…/CanonicalSerializeGoldenTests.cs  # same golden-vectors files
```

**Structure Decision**: Put pure algorithms (`canonicalSerialize`, money,
totals, builders, `LocalValidator`) in **`packages/eta-core`** so Nest and the
agent never diverge on rules. Nest `DocumentsModule` owns persistence, RBAC,
audit, and loading the 004 type-version cache into the validator. Web owns the
authoring UX with live JSON + canonical previews calling API (server is SoT for
totals) and optional client-side `canonicalSerialize` for snappy preview if the
package is browser-safe. Agent only mirrors serialize + golden tests.

## Complexity Tracking

> No constitution violations requiring justification.
