# Tasks: Business Tax Reports

**Input**: Design documents from `/specs/014-business-tax-reports/`

**Tests**: MANDATORY — S1 netting; C1 = S4 − P3; tenant isolation; read-only; permissions.

## Phase 1: Setup

- [x] T001 Add `REPORTS_VIEW` / `REPORTS_EXPORT` to `packages/shared/src/permissions.ts` (Owner/Admin/Accountant)
- [x] T002 Scaffold `apps/api/src/reports/` module + register in `app.module.ts`
- [x] T003 Add `reports.*` i18n keys + nav entry in web shell
- [x] T004 Add `apps/web/src/lib/api/reports.ts` client

## Phase 2: Core helpers

- [x] T005 Netting signs + money helpers (`report-netting.ts`, `report-vat.ts`)
- [x] T006 Shared filter parse (`report-filters.ts`)
- [x] T007 Unit tests for netting + VAT split

## Phase 3: API reports

- [x] T008 Sales S1–S4
- [x] T009 Purchases P1–P3
- [x] T010 Combined C1–C3 (per-branch C1)
- [x] T011 Export CSV/XLSX/PDF
- [x] T012 Controller + audit
- [x] T013 Integration: netting-sales + net-vat + isolation

## Phase 4: Web

- [x] T014 Reports hub + filter bar + per-report pages (table + recharts)
- [x] T015 Export UI + smoke test ar/en

## Phase 5: Polish

- [x] T016 Permission guard spec update
- [x] T017 Quickstart acceptance verified
