# Implementation Plan: Business Tax Reports

**Branch**: `014-business-tax-reports` | **Date**: 2026-08-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/014-business-tax-reports/spec.md`
— ten business/tax reports (S1–S4, P1–P3, C1–C3) from issued/received
invoice data; credit/debit netting; NET VAT = output − input (T1 only);
per-branch C1; CSV/XLSX/(PDF); distinct from Phase 10 usage analytics.

## Summary

Ship a read-only **Reports** Nest module that aggregates **Document** (sales)
and **ReceivedDocument** (purchases) under tenant RLS, applying **default
credit/debit netting** and shared filters. Expose per-report query + export
APIs and a bilingual Next.js Reports UI (recharts, nav entry). Permissions
`reports.view` / `reports.export` for Owner/Admin/Accountant. No signing,
serialization, or agent changes. Money via `@einvoice/eta-core` money helpers;
VAT position uses **T1 only** (`ETA_VAT_TAX_TYPE`); **T4** stays separate.

## Technical Context

**Language/Version**: TypeScript 5.x (NestJS 10 API, Next.js 15 web)

**Primary Dependencies**: NestJS + Prisma + RLS; existing CSV/XLSX patterns
(009/011); PDF via existing local PDF stack where used; **recharts**;
next-intl; TanStack Query; `@einvoice/eta-core` money + tax-type helpers;
`@einvoice/shared` permissions

**Storage**: PostgreSQL — **no new aggregate tables** (query live documents);
optional short-lived export artifacts in MinIO under
`tenants/{tenantId}/artifacts/reports/...` when export is async; Redis only if
reusing BullMQ export pattern for large PDFs

**Testing**: Unit — netting sign, VAT vs T4 split, C1 identity; integration —
seed invoices + credit/debit notes → S1 and C1 match hand math; cross-tenant
isolation; permission denial; read-only (no document writes); web smoke ar/en

**Target Platform**: Existing Compose stack; API + web only

**Project Type**: Multi-tenant SaaS (API + web); desktop agent out of scope

**Performance Goals**: Interactive report p95 ≤5s for ≤90-day ranges on typical
tenant volumes; exports async when payload large

**Constraints**: Read-only; RLS + JWT + `X-Tenant-Id`; never mix currencies
opaquely; never fold T4 into NET VAT; do not regress signing

**Scale/Scope**: Ten reports; shared filter DTO; sync compute for MVP with
optional async export; Accountant included

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Reliability & Audit**: PASS — S1 netting + C1=S4−P3 tests; audit view/export
- **II. Security by Default**: PASS — permission gates; no secrets in exports
- **III. Multi-Tenant Isolation**: PASS — TenantPrisma + RLS on documents/purchases
- **IV. Serialization Parity**: PASS — N/A (read-only; no signing changes)
- **V. Runtime ETA Config**: PASS — N/A
- **VI. Sandbox-First**: PASS — no new ETA calls
- **VII. UX/i18n**: PASS — Reports ar/en + RTL + recharts
- **VIII. Phased Full-Stack DoD**: PASS — API + web + tests; agent unchanged
- **Stack**: PASS — within baseline

## Project Structure

### Documentation (this feature)

```text
specs/014-business-tax-reports/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── reports-api.yaml
│   └── permissions.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/api/
├── src/reports/
│   ├── reports.module.ts
│   ├── reports.controller.ts       # GET report + POST export
│   ├── reports.service.ts          # dispatch by reportId
│   ├── report-filters.ts           # shared filter parse/validate
│   ├── report-netting.ts           # kind → sign (+1/−1)
│   ├── report-vat.ts               # T1 vs non-VAT (T4…) split
│   ├── report-money.ts             # wrappers on eta-core money
│   ├── sales-reports.ts            # S1–S4
│   ├── purchase-reports.ts         # P1–P3
│   ├── combined-reports.ts         # C1–C3
│   └── report-export.service.ts    # CSV/XLSX/PDF
├── test/
│   ├── reports.netting-sales.spec.ts
│   ├── reports.net-vat.spec.ts
│   └── reports.tenant-isolation.spec.ts
packages/shared/src/permissions.ts  # reports.view, reports.export
apps/web/
├── src/app/[locale]/(app)/reports/
│   ├── page.tsx                    # hub / tabs
│   ├── [reportId]/page.tsx
│   └── reports.smoke.test.tsx
├── src/components/reports/         # filter bar, table, chart, export
├── src/lib/api/reports.ts
└── src/messages/{en,ar}.json       # reports.*
```

**Structure Decision**: Dedicated `reports` module (parallel to `analytics`)
queries existing Document/ReceivedDocument tables. Shared netting/VAT helpers
keep S4/P3/C1 consistent. Web route `/reports` with per-report pages.

## Complexity Tracking

| Note | Why | Simpler Alternative Rejected Because |
|------|-----|--------------------------------------|
| Live query vs rollup tables | Tax figures must match current docs; no metering lag | Usage-style rollups would drift from invoice edits/status and confuse with Analytics |
| Dedicated `reports.*` permissions | Spec: Accountant needs reports; Analytics excludes Accountant | Reusing `analytics.view` would wrongly grant usage analytics |
| Sync compute + optional async export | MVP speed | Always-async adds UX delay for small periods |

## Phase 0 / Phase 1

See [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md).

### Constitution Check (post-design)

Re-validated PASS: contracts require JWT + tenant + reports permissions;
netting and T1-only C1 documented; no schema writes to documents; identity
S4−P3=C1 in tests; agent untouched.
