# Implementation Plan: Usage Analytics & Metering

**Branch**: `011-usage-analytics` | **Date**: 2026-08-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-usage-analytics/spec.md`
plus technical direction: `UsageEvent` model + daily/monthly rollup jobs per
tenant/branch; Analytics endpoints with filters + export service; Web
dashboards with **recharts** + filters; tests that after a known number of
submitted documents, dashboard totals match exactly.

## Summary

Ship **per-tenant usage metering** via an append-only **`UsageEvent`** log that
aggregates into **daily** and **monthly** rollups (dimensions: tenant, optional
branch, optional currency for document meters). Expose **Analytics API**
(summary + series + CSV/XLSX export) and a bilingual **Analytics dashboard**
(recharts charts, branch/period/currency filters). Canonical meters:
`issued`, `received`, `valid`, `invalid`, `api_calls`, `storage_bytes`. Structure
supports future billing (rollups + rebuildable event log); **no** invoicing or
payments. Desktop agent unchanged.

## Technical Context

**Language/Version**: TypeScript 5.x (NestJS 10 API, Next.js 15 web)

**Primary Dependencies**: NestJS + Prisma + RLS; BullMQ + Redis (rollup +
export jobs); MinIO (export artifacts); **recharts** (web charts); existing
xlsx/CSV writers (reuse export patterns from 009); Next.js 15, next-intl,
TanStack Query, Tailwind/shadcn

**Storage**: PostgreSQL — `UsageEvent`, `UsageDailyRollup`, `UsageMonthlyRollup`
(+ optional `UsageExportJob`) with FORCE RLS; Redis — BullMQ `usage-rollup` /
`usage-export`; MinIO — `tenants/{tenantId}/artifacts/analytics/...`

**Testing**: Unit — event→rollup aggregation, meter classification, export
rows; integration — submit/record a **known** set of issued/received docs →
dashboard/`GET` analytics totals **match exactly**; tenant isolation +
permission denial; web smoke — charts + filters ar/en RTL; no agent changes

**Target Platform**: Existing Compose (Postgres, Redis, MinIO, Traefik); API
workers run rollup/export jobs

**Project Type**: Multi-tenant SaaS (API + web); desktop agent out of scope

**Performance Goals**: Dashboard/API p95 ≤3s for typical filter sets (SC-004);
rollup job catches up within minutes of events; export of ≤90 days of daily
rows completes without UI hang (async job + download when large)

**Constraints**: Six canonical meters only; event log is rebuild source;
rollups preferred for reads; JWT + `X-Tenant-Id`; Owner/Admin analytics by
default; secrets never in analytics payloads; `storage_bytes` as **absolute
gauge** snapshots (clarify default — Q4 unanswered); timezone single product
default (Africa/Cairo unless tenant setting exists)

**Scale/Scope**: Events from document/purchase/API/storage hooks; rollups per
tenant (+ branch/currency dims where applicable); Analytics UI + CSV/XLSX
export; billing/charges out of scope

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Reliability & Audit**: PASS — exact-match totals test planned; audit
  analytics view + export
- **II. Security by Default**: PASS — no secrets in events/exports; permission
  gates; TLS as existing
- **III. Multi-Tenant Isolation**: PASS — FORCE RLS on usage tables; jobs carry
  `tenantId`; MinIO tenant prefixes
- **IV. Serialization Parity**: PASS — N/A (no signing/serialization changes)
- **V. Runtime ETA Config**: PASS — N/A (no ETA URL/schema hardcoding)
- **VI. Sandbox-First**: PASS — metering independent of ETA env; any live
  volume tests use existing sandbox config
- **VII. UX/i18n**: PASS — Analytics ar/en + RTL + design system + recharts
- **VIII. Phased Full-Stack DoD**: PASS — API + web + tests; agent unchanged
- **Stack**: PASS — recharts is a chart library within Next baseline (see
  Complexity Tracking note)

## Project Structure

### Documentation (this feature)

```text
specs/011-usage-analytics/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── analytics-api.yaml
│   └── permissions.md
└── tasks.md              # /speckit-tasks (not this command)
```

### Source Code (repository root)

```text
apps/api/
├── src/analytics/
│   ├── analytics.module.ts
│   ├── analytics.controller.ts      # summary, series, export
│   ├── analytics.service.ts         # read rollups + filters
│   ├── usage-event.service.ts       # append UsageEvent (idempotent keys)
│   ├── usage-rollup.service.ts      # daily/monthly aggregate + rebuild
│   ├── usage-export.service.ts      # CSV/XLSX build → MinIO
│   ├── usage-emit.hooks.ts          # document/purchase/API/storage emitters
│   └── usage-rollup.processor.ts    # BullMQ rollup + export workers
├── src/queues/
│   └── queue-names.ts               # + usage-rollup, usage-export
├── prisma/                          # Usage* models + RLS
└── test/                            # analytics.totals.spec.ts (exact match)

apps/web/
├── src/app/[locale]/(app)/analytics/
│   ├── page.tsx                     # dashboard + filters + charts
│   └── analytics.smoke.test.tsx
├── src/components/analytics/        # metric cards, charts, filter bar, export
├── src/lib/api/analytics.ts
└── src/messages/{en,ar}.json        # analytics.* keys

packages/shared/
└── src/permissions.ts               # analytics.view, analytics.export
```

**Structure Decision**: New Nest module `analytics` owns event append, rollup
jobs, query API, and export. Emitters hook existing documents/purchases/
HTTP/storage paths without forking those domains. Web route under
`(app)/analytics`. No desktop agent changes.

## Complexity Tracking

> No constitution violations. Notes only:

| Note | Why | Simpler Alternative Rejected Because |
|------|-----|--------------------------------------|
| Event log + daily/monthly rollups | Spec + user clarify; billing-ready rebuild | Query live Document tables only — slow, hard to bill, no API/storage history |
| Dedicated `analytics` module | Read-heavy + jobs separate from documents CRUD | Stuffing into documents module couples unrelated concerns |
| recharts (user plan) | Spec charts; mature React charting for Next 15 | Custom SVG/canvas delays UX; Chart.js also fine but plan specifies recharts |
| New `analytics.*` permissions | Spec Owner/Admin only; Accountant already has `billing.*` | Reusing `billing.view` would grant Accountants analytics contrary to FR-016 |
| Absolute `storage_bytes` gauge | Recommended clarify default (Q4 unanswered) | Delta-only risks drift; hybrid adds complexity without MVP need |

## Phase 0 / Phase 1

See [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md).

### Constitution Check (post-design)

Re-validated PASS: contracts require JWT + `X-Tenant-Id` + analytics
permissions; data model FORCE RLS; MinIO tenant prefixes; exact-match totals
acceptance in quickstart; event→rollup rebuild path; CSV+XLSX export; no
serialization/agent scope; i18n dashboard specified.
