# P17 — XIRA UI/UX consistency pass

P16 baseline: `3bb4822` (`ui(P16): finalize XIRA release readiness`).

P17 is an evidence-driven release-quality pass. Pages that already matched P1–P16 were not rewritten.

## 1. Scope

Additive presentation/accessibility consistency only. No new product features. No backend, API client, query-key, payload, or permission changes.

Inspected remaining inconsistencies against XIRA tokens, P1–P16 primitives, RTL/LTR, responsive overflow, dark mode, accessibility, and loading/empty/error/success completeness.

## 2. Baseline

```text
P16 commit: 3bb4822
command:    pnpm --filter @einvoice/web test -- --no-coverage
suites:     105
tests:      366
result:     passed
working tree: clean
```

Lint/typecheck/`git diff --check` were already green at P16 close. Re-run after P17 implementation (see §§22–24).

## 3. Routes audited

Tenant: `/`, `/documents`, `/documents/[id]`, `/purchases`, `/purchases/[id]`, `/customers`, `/settings`, `/settings/*`, `/users`, `/roles`, `/sync`, `/sync/conflict`, `/backup`, `/devices`, `/imports`, `/exports`, `/analytics`, `/reports`, `/reports/[reportId]`, `/billing`, `/dev/ui`.

Auth: `/login`, `/register`, `/onboarding` (not re-authenticated live; would end the session). Covered by existing `auth.smoke.test.tsx`.

Platform: `/admin`.

Shell / shared: `components/shell/*`, `components/ui/*`, shared overlays including `LocalPdfPreviewModal`.

Live browser QA (logged in as `owner@test.local` on `http://localhost:3000`): `/en/users`, `/en/documents`, `/en/documents/7659d7b6-bba9-46c6-92ee-14ed80aedb30`, `/en/purchases`, `/en/settings/company`, `/en/billing`, `/en/admin`, `/en/reports/S5`, `/ar/users`, `/ar/documents`, `/ar/purchases`, `/ar/settings/company`, `/ar/billing`, `/ar/admin`.

## 4. Issues found

### Visual consistency

Physical Tailwind (`ml-*` / `mr-*` / `text-left` / `text-right`): none.

`text-muted-foreground` / `text-green-700` / `text-white`: none remaining after P16.

Document editor and customer-picker still use `text-foreground/60` and `text-foreground/70`. These are P5-preserved editor/combobox chrome; mechanical rewrite was omitted.

```text
Finding: Local PDF preview used a custom overlay (bg-black/50, native buttons, no Escape, no focus trap).
Route/component: LocalPdfPreviewModal (documents list, document detail, purchase detail)
Problem: Same leftover class as the P16 WhatsApp dialog; overlay and controls were not on XIRA Modal/Button.
Fix: Modal size xl + Button footer; overlay via Modal bg-navy/50; loading uses text-foreground-muted.
Why it is safe: loadPdf, blob URL create/revoke, triggerBrowserDownload, filename, and caller labels unchanged.
```

```text
Finding: Report detail expand control used arbitrary px-2 py-0.5 text-xs.
Route/component: ReportDetailDocumentsTable
Problem: One-off control chrome; not the primary issue (see Accessibility).
Fix: Token spacing/radius/text on the expand button only. Table cell padding left as-is.
```

### RTL / LTR

No remaining physical `ml-*`/`mr-*`/`left-*`/`right-*`/`text-left`/`text-right` in app UI.

Technical values already LTR from P15. P17 did not change Arabic copy to LTR.

### Loading / empty / error / success

```text
Finding: Auth-not-ready app layout rendered a lone ellipsis without a translated name or aria-busy.
Route/component: apps/web/src/app/[locale]/(app)/layout.tsx
Problem: Blank-looking loading with no status semantics.
Fix: common.states.loading + role="status" + aria-busy="true" + text-foreground-muted.
Why it is safe: redirect / PendingActivationScreen / AppShell gating unchanged.
```

PDF preview loading/error now use `role="status"` / `aria-busy` and `role="alert"`. No retry invented (preview load is a one-shot blob fetch; caller can reopen).

### Accessibility

```text
Finding: Report S5/P5 expand control was icon-only +/− with aria-expanded but no accessible name.
Route/component: ReportDetailDocumentsTable
Fix: reports.detail.expandRow / collapseRow with {id}; keep toggle(id) / expanded Set.
```

PDF preview now has a labelled `role="dialog"`, Escape, and focus trap via Modal.

### Responsive / dark mode / shared primitives

No page-level overflow bug identified. Dark-mode leftover `bg-black/50` on the PDF overlay is fixed by using Modal. Shared primitive bypass: PDF preview was the remaining custom overlay of this class.

### Not implemented (no API / no contract)

```text
Not implemented: billing create-invoice / payment method / cancel
Reason: unavailable API / unavailable contract

Not implemented: platform admin Users / ETA schema / audit log / platform statistics
Reason: unavailable API / unavailable contract

Not implemented: purchases empty extra CTA beyond existing Sync Purchases
Reason: existing empty copy already points at ETA sync; no new mutation
```

## 5. Changes made

1. `LocalPdfPreviewModal` now uses `Modal` + `Button`. Download remains disabled until a blob exists; download still calls `triggerBrowserDownload(blob, filename)`. Overlay click / Escape / Modal X / footer close all call the same `onClose`.
2. Report expand/collapse buttons have translated `aria-label`s including the internal id (fallback: row id). Token classes on the button only.
3. App-group auth loading uses translated `common.states.loading` with `role="status"` and `aria-busy="true"`.
4. EN/AR message keys `reports.detail.expandRow` and `reports.detail.collapseRow`.

## 6. Files modified

- `apps/web/src/components/local-pdf-preview-modal.tsx`
- `apps/web/src/app/[locale]/(app)/layout.tsx`
- `apps/web/src/app/[locale]/(app)/reports/[reportId]/report-detail-table.tsx`
- `apps/web/src/messages/en.json`
- `apps/web/src/messages/ar.json`

## 7. Files created

- `apps/web/src/components/local-pdf-preview-modal.behavior.test.tsx`
- `apps/web/src/app/[locale]/(app)/reports/[reportId]/report-detail-table.behavior.test.tsx`
- `specs/015-ui-ux-overhaul/p17-audit.md`

## 8. Shared primitives involved

Used (not reinvented): `Modal`, `Button`.

Unchanged consumers: `PageHeader`, `Breadcrumbs`, `Card`, `EmptyState`, `Skeleton`, `Toast`, `ConfirmDialog`, `QueryErrorCard`, `Table` / `TableWrap`, `FilterBar`, `Drawer`, `Badge`, `StatCard`, `Input`, `Select`, `Checkbox`.

Document editor native line controls and customer-picker combobox were not replaced (payload-adjacent).

## 9. API / data sources

```text
API client files changed: no
```

PDF still uses caller-supplied `loadPdf()` (`downloadLocalPrintoutFromBody` on document/purchase surfaces). Report table still renders existing report row payloads.

## 10. Query keys

```text
Query keys changed: NONE
```

## 11. Payload verification

```text
Payloads: unchanged
```

Download filename still comes from `loadPdf()` result. Expand toggle does not emit API calls.

## 12. Permission verification

```text
Permissions: unchanged
```

Dotted `roles.perm.*` keys were not renamed.

## 13. Business logic audit

```text
Calculations: unchanged
Validation: unchanged
Mutations: unchanged
Polling: unchanged
Pagination: unchanged
Sorting: unchanged
Filtering: unchanged
Tenant scoping: unchanged
Navigation: unchanged
Status handling: unchanged
Confirmation conditions: unchanged
Error semantics: unchanged
```

Redirect when `ready && !user` is unchanged. `PendingActivationScreen` gating is unchanged.

## 14. Loading / empty / error / success verification

- App auth-not-ready: translated loading + `aria-busy` (new).
- PDF preview: loading `role="status"` `aria-busy`; error `role="alert"`; success iframe with `title={title}`; download disabled until blob.
- Reports S5 default window (2026-08-13 → 2026-09-11): empty copy “No documents in this period” / showing 0 of 0. After existing From filter 2026-07-01 + Refresh: 7 of 7 real documents.
- Purchases live: empty heading “No received purchases yet…”; last-sync status FAILED from ETA HTTP 400 (existing API). No new retry invented for that 400.
- `/en/admin` and `/ar/admin`: access-denied `role="alert"` (this user is not a platform operator).
- Billing invoices empty: “لا توجد فواتير بعد” / no create CTA (no API).

## 15. RTL / LTR QA

Observed live:

| Route | dir | h1 | notes |
| --- | --- | --- | --- |
| `/en/users` | ltr | Users | |
| `/ar/users` | rtl | المستخدمون | `owner@test.local` is `dir="ltr"` |
| `/en/documents` | ltr | Documents | |
| `/ar/documents` | rtl | المستندات | IDs `BYTES-1785487283545`, date `2026-07-31`, tax id `29210250100551` remain LTR |
| `/en/purchases` | ltr | Purchases | |
| `/ar/purchases` | rtl | المشتريات | |
| `/en/settings/company` | ltr | Company | tenant UUID LTR |
| `/ar/settings/company` | rtl | الشركة | tenant UUID `966c5778-955c-4fe9-a46e-d3df808eff58` LTR |
| `/en/billing` | ltr | Billing | |
| `/ar/billing` | rtl | الفواتير | |
| `/en/admin` | ltr | Platform admin | |
| `/ar/admin` | rtl | إدارة المنصة | |
| `/en/reports/S5` | ltr | S5 — Sales Detail | internal ids in expand labels |

Arabic page text was not forced LTR.

## 16. Responsive QA

`document.documentElement.scrollWidth <= clientWidth` observed:

| Route | width | overflow |
| --- | --- | --- |
| `/en/users` | 375 | false (`sw=cw=375`) |
| `/en/users` | 768 | false |
| `/en/users` | 1024 | false (`sw=cw=1009`; innerWidth 1024) |
| `/en/users` | 1440 | false (`sw=cw=1425`) |
| `/en/documents` | 1440 | false |
| `/en/purchases` | 1440 | false |
| `/en/settings/company` | 1440 | false |
| `/en/billing` | 1440 | false |
| `/en/admin` | 1440 | false |
| `/en/reports/S5` | 1440 | false |
| `/ar/users` | 375 | false |
| `/ar/documents` | 375 | false (7 table rows; internal table scroll only) |
| `/ar/purchases` | 375 | false |
| `/ar/settings/company` | 375 | false |
| `/ar/billing` | 375 | false |
| `/ar/admin` | 375 | false |

PDF modal `max-h-[90vh]` / preview `h-[70vh]` is viewport-bounded, not page overflow.

## 17. Dark mode QA

- Session started with `data-theme="dark"` (theme toggle pressed).
- `/ar/billing` toggled to `data-theme="light"`: body background `rgb(245, 247, 251)`, foreground `rgb(15, 23, 42)`.
- PDF overlay no longer uses `bg-black/50`; Modal uses `bg-navy/50`.
- Light `/ar/admin` alert remained readable.
- No new hex colors introduced.

## 18. Accessibility QA

- One `h1` on inspected routes.
- PDF dialog: `role="dialog"` named “Preview / Print”; Close focused on open; Download PDF disabled while loading then enabled after blob; Escape closed the dialog (`dialogs: 0` after Escape). Iframe `title="Preview / Print"`, `src` blob URL. Did not click Download (would trigger a file download).
- Report expand: live names `Expand document BYTES-1785487283545` → after click `Collapse document BYTES-1785487283545` with `aria-expanded`.
- Admin 403: `role="alert"` EN “You don't have platform-operator access.” / AR “ليس لديك صلاحية مشغل المنصة.”
- App loading: `role="status"` `aria-busy` (code); not live-tested without logging out.

## 19. Visual QA

XIRA shell, PageHeader/breadcrumbs, plan cards, and table sticky-first-column behavior preserved. PDF preview heading uses Modal `h2` “Preview / Print”. Duplicate close (Modal X + footer closeLabel) matches the P16 WhatsApp dialog pattern.

Next.js “Open issues overlay” badge was present during live QA (dev overlay). It is not application UI.

Login/register/onboarding were not re-authenticated live.

## 20. Focused tests

```text
suites: 2
tests:  4
result: passed
```

- `local-pdf-preview-modal.behavior.test.tsx` — 3 tests (Escape + busy/disabled download; blob download helper; error alert)
- `report-detail-table.behavior.test.tsx` — 1 test (accessible expand/collapse name + line items)

Existing list/detail tests still mock `LocalPdfPreviewModal` as `() => null`. No existing assertion deleted, skipped, or weakened.

## 21. Full test results

```text
command: pnpm --filter @einvoice/web test -- --no-coverage
suites:  107
tests:   370
result:  passed
```

(+2 suites / +4 tests vs the 105 / 366 P17 baseline.)

## 22. Lint

```text
command: pnpm --filter @einvoice/web lint
result:  0 errors, 0 warnings
```

## 23. Typecheck

```text
command: pnpm --filter @einvoice/web typecheck
result:  passed
```

## 24. git diff --check

```text
result: clean
```

## 25. Deviations

- Next.js `INVALID_KEY` for dotted `roles.perm.*` — not renamed
- Document editor in-place first-load hydrate (P5)
- Document editor / customer-picker `text-foreground/60|70` left in place (P5 chrome; not a competing palette)
- No Playwright e2e runner — browser QA used instead
- Billing: no create-invoice / payment-method / cancel-subscription UI
- Platform admin: no Users / ETA schema / audit / stats APIs
- Export history: no duplicate EmptyState CTA
- Shell breadcrumbs + page breadcrumbs (P2) unchanged
- Live `owner@test.local` is not a platform operator
- Report expand test passes the full `en.json` messages object, which logs the pre-existing `INVALID_KEY` overlay (same as other full-message tests)

## 26. Remaining issues

### Pre-existing

- `roles.perm.*` INVALID_KEY overlay
- Duplicate breadcrumbs
- Document editor hydrate
- Live test user is not a platform operator (`/admin` access-denied state)
- Purchases list empty for this tenant; last ETA sync FAILED HTTP 400 (API, not UI)
- Jest “worker process failed to exit gracefully” can appear after the suite; all tests still passed

### P17

None identified after the three confirmed fixes.

## 27. Final business-logic confirmation

```text
API contracts: unchanged
Query keys: unchanged
Payloads: unchanged
Permissions: unchanged
Backend: untouched
P1–P16 behavior: preserved
```
