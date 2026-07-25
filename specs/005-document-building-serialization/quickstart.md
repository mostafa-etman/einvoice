# Quickstart Validation: Document Building & Canonical Serialization

**Feature**: `005-document-building-serialization` | **Date**: 2026-07-25

Prerequisites: Features **003** (branches, currencies, FX, item codes) and
**004** (cached document types/versions) available. Contracts:
[documents-api.yaml](./contracts/documents-api.yaml),
[eta-core-api.md](./contracts/eta-core-api.md),
[permissions.md](./contracts/permissions.md). Model: [data-model.md](./data-model.md).
Golden vectors: [golden-vectors/](./golden-vectors/).

## 0. Env

No new ETA URL keys beyond 004. Ensure Redis + Postgres are up for API draft
tests. Agent tests need .NET 8 SDK.

## 1. Golden tests (always — eta-core)

```bash
pnpm --filter @einvoice/eta-core test -- --runInBand
```

**Expect**: For every **locked** `*.canonical.txt` (currently **gv-01**):

`canonicalSerialize(input) === expected` (byte-exact after ≤1 trailing `\n`
normalize). PENDING files are not asserted until promoted via
[golden-vectors/RUNBOOK-bassemAgmi.md](./golden-vectors/RUNBOOK-bassemAgmi.md).

```bash
# Agent parity (same fixtures)
dotnet test apps/agent/Einvoice.Agent.sln --filter CanonicalSerialize
```

Any reformatting of `0.00` → `0` or wrong string escaping MUST fail.

## 2. Calculator + LocalValidator units

```bash
pnpm --filter @einvoice/eta-core test -- --testPathPattern="money|calculate|local-validator" --runInBand
```

**Expect**: Worked multi-line examples match 2-dp decimal strings; validator
reports missing required fields from a fixture type-version schema; arithmetic
mismatch yields a stable issue code.

## 3. API draft + validate (mocked catalog schema OK)

```bash
pnpm --filter @einvoice/api test -- --testPathPattern="documents" --runInBand
```

**Expect**: Create/update draft recomputes totals (ignores client totals);
validate uses cached type-version; mark-ready refused when issues exist;
cross-tenant get returns 404/403; stale `version` → 409.

## 4. Agent golden parity

```bash
dotnet test apps/agent/Einvoice.Agent.sln --filter CanonicalSerialize
```

**Expect**: Same gv-01..03 expected strings as eta-core.

## 5. UI (manual)

1. Sign in as Accountant/Owner → Documents → New Invoice.
2. Select branch + currency; add lines, taxes, discounts.
3. Confirm live **JSON** and **canonical** panels update; totals match server.
4. Save draft → reopen → values intact.
5. Trigger a validation error (clear required field) → field-linked message in
   ar and en.
6. Fix → Validate → Mark ready succeeds.

## 6. Isolation / security spot-checks

- Tenant A cannot open tenant B document ids.
- Preview/detail responses contain no access tokens or client secrets.
- Audit rows for draft/validate omit secret material.

## Out of scope check

No ETA document submission; no CAdES signing; no receipt/POS flow.
