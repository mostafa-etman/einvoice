# Implementation Plan: Bulk Import / Export

**Branch**: `009-bulk-import-export` | **Date**: 2026-07-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-bulk-import-export/spec.md`
plus technical direction: Import service (CSV/XLSX templates + papaparse/xlsx
streaming parse, row validation, map → documents, enqueue sign+submit in
batches, error report file); Export (Request Document Package → poll Get
Package Requests → Get Document Package zip → MinIO; local CSV/XLSX/PDF/JSON
exporters); Web Import Wizard + Export Center; tests (dozens of rows with bad
rows → only valid submit; ETA package round-trip).

## Summary

Ship **bulk intake and bulk outbound packages** for issued documents: a
tenant-scoped **Import Wizard** that uploads CSV/XLSX, maps columns, validates
row-by-row (streaming), creates documents from **valid rows only**, optionally
enqueues existing **sign → submit** queues, and stores a downloadable error
report; plus an **Export Center** for local multi-format exports and ETA
**document packages** (request → **Get Package Requests** until ready → zip to
MinIO). Reuses document builder, signing agent intake, and submission pipeline;
does **not** fork canonical serialization. Desktop agent unchanged except
consuming existing sign jobs.

## Technical Context

**Language/Version**: TypeScript 5.x (NestJS 10 API, Next.js 15 web)

**Primary Dependencies**: NestJS + Prisma + RLS; BullMQ + Redis; MinIO;
**papaparse** (CSV stream); **xlsx** (SheetJS) for XLSX template + parse;
local exporters (xlsx write, CSV, JSON; PDF via printout reuse and/or
lightweight PDF assembler); Next.js 15, next-intl, TanStack Query,
Tailwind/shadcn; existing `EtaService` / `etaFetch`, documents + submissions
modules

**Storage**: PostgreSQL — `ImportJob`, `ImportRowResult`, `ExportJob`,
`EtaPackageRequest` (+ artifact refs) with FORCE RLS; Redis — BullMQ
`import` / `export` / `package-poll` (+ reuse `sign` / `submit`); MinIO —
`tenants/{tenantId}/artifacts/imports|exports|packages/...`

**Testing**: Unit — streaming parse + row validation + “bad rows don’t block”;
integration — import fixture with dozens of rows (mix valid/invalid) → only
valid docs created / submitted; gated sandbox — Request → Get Package Requests
→ Get Document Package zip stored in MinIO; API contract — tenant isolation +
permissions; web smoke — wizard + Export Center i18n; regression — 005 golden /
parity / 007 submit gates green

**Target Platform**: Existing Compose (Postgres, Redis, MinIO, Traefik); API
workers process import/export/package-poll jobs

**Project Type**: Multi-tenant SaaS (API + web); agent out of scope for code
changes (sign jobs already defined in 007)

**Performance Goals**: Stream-validate ≥2,000-row CSV/XLSX within configured
limits without loading whole file into memory (SC-005a); Import Wizard
Create-only for 50 valid rows ≤5 min active time (SC-001); local CSV/XLSX
export ≤500 docs ≤3 min (SC-004); package poll backoff similar to submission
poll (env-configurable)

**Constraints**: CSV + XLSX only (no `.xls`); bad rows reported never block
valid; Get Package Requests is canonical ETA package status; secrets never
logged; tenant-scoped jobs + MinIO prefixes; sandbox-first; no alternate
serializer for imported docs; max upload size / max rows from env

**Scale/Scope**: One document type per import job; Create only vs Create, sign
& submit; local export formats CSV/XLSX/PDF/JSON; ETA packages for filed docs;
watched-folder/cron pickup out of scope

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Reliability & Audit**: PASS — unit + import fixture + gated package
  round-trip; audit import commit, export, package request/get/download
- **II. Security by Default**: PASS — ETA creds encrypted; upload/download
  authZ; no secrets in error reports or client bundles
- **III. Multi-Tenant Isolation**: PASS — FORCE RLS on new tables; jobs carry
  `tenantId`; MinIO tenant prefixes
- **IV. Serialization Parity**: PASS — import builds via existing document
  builder + sign path; no bulk-only serializer; 005/006 regression gates
- **V. Runtime ETA Config**: PASS — package URLs under `ETA_API_BASE_URL`;
  limits/backoff from env
- **VI. Sandbox-First**: PASS — default preprod; live package tests gated
- **VII. UX/i18n**: PASS — Import Wizard + Export Center ar/en + RTL
- **VIII. Phased Full-Stack DoD**: PASS — API + web + tests; agent unchanged
- **Stack**: PASS — papaparse/xlsx are libraries within Node/Nest baseline (see
  Complexity Tracking note)

## Project Structure

### Documentation (this feature)

```text
specs/009-bulk-import-export/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── imports-exports-api.yaml
│   ├── eta-document-packages.md
│   └── permissions.md
└── tasks.md              # /speckit-tasks (not this command)
```

### Source Code (repository root)

```text
apps/api/
├── src/imports/
│   ├── imports.module.ts
│   ├── imports.controller.ts       # templates, upload, map, validate, run, jobs
│   ├── imports.service.ts
│   ├── import-parse.service.ts     # papaparse + xlsx streaming
│   ├── import-validate.service.ts  # row rules → ImportRowResult
│   ├── import-map.service.ts       # mapping + document create DTO
│   └── import-error-report.service.ts
├── src/exports/
│   ├── exports.module.ts
│   ├── exports.controller.ts       # local export + ETA package jobs
│   ├── exports.service.ts
│   ├── local-exporters/            # csv, xlsx, json, pdf
│   └── eta-package.service.ts      # request → poll → get zip
├── src/eta/
│   ├── eta-document-package.client.ts  # POST/GET package requests + GET zip
├── src/queues/
│   └── queue-names.ts              # + import, export, package-poll
├── src/storage/minio-artifact.store.ts  # reuse kinds: imports/exports/packages
└── prisma/                         # Import*/Export*/EtaPackage* + RLS

apps/web/
├── src/app/[locale]/(app)/imports/
│   ├── page.tsx                    # history + start wizard
│   └── [jobId]/page.tsx            # job detail / error report
├── src/app/[locale]/(app)/exports/
│   ├── page.tsx                    # Export Center
│   └── [jobId]/page.tsx
├── src/components/imports/         # wizard steps: upload, mapping, report, run
├── src/lib/api/imports.ts
├── src/lib/api/exports.ts
└── src/messages/{en,ar}.json       # imports.* / exports.* keys

packages/shared/
└── src/permissions.ts              # reuse documents.* (see research)
```

**Structure Decision**: New Nest modules `imports` and `exports` beside
`documents` / `submissions` / `eta`. ETA package HTTP client lives under
`apps/api/src/eta` (same pattern as submit/search). Web routes under
`(app)/imports` and `(app)/exports`. Sign/submit reuse existing queues—no agent
source changes.

## Complexity Tracking

> No constitution violations. Notes only:

| Note | Why | Simpler Alternative Rejected Because |
|------|-----|--------------------------------------|
| Separate `imports` + `exports` modules | Different lifecycles (upload/validate vs ETA async package) | One “bulk” mega-module mixes permissions and job types |
| papaparse + xlsx (user plan) | Spec formats CSV+XLSX; streaming CSV is mature in papaparse | ExcelJS-only would diverge from requested stack without benefit for MVP templates |
| Dedicated `package-poll` queue | Status via Get Package Requests until ready; backoff isolation | Reusing `poll` (submission) couples unrelated ETA rate budgets |
| Reuse `documents.*` permissions MVP | Matches 007; least privilege still Viewer read / Accountant write | New permission codes delay ship; can split later |

## Phase 0 / Phase 1

See [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md).

### Constitution Check (post-design)

Re-validated PASS: contracts require JWT + `X-Tenant-Id`; data model FORCE RLS;
MinIO tenant prefixes; package status via Get Package Requests; streaming parse
+ valid-rows-only encoded; sandbox-gated package round-trip; no serialization
fork; agent unchanged.
