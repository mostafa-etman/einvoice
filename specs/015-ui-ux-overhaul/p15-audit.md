# P15 — XIRA final UI/UX consistency & audit

Generated during Phase 15. P1–P14 were already implemented. P15 is a polish pass: remaining Mobile/RTL gaps, technical LTR, table overflow, and QueryErrorCard alignment. No new business functionality.

Legend for route states: see `states-audit.md` (P14). P15 did not reopen those contracts.

## 1. Scope

Inspected every route under `apps/web/src/app/[locale]/(app|auth|platform)`, shared primitives in `apps/web/src/components/ui`, shell, auth, messages, and P15 requirements in `UI-UX-REFACTOR.md` §17 / `CURSOR-PROMPTS.md` §11 plus this phase’s consistency audit.

Did **not** mechanically rewrite pages that already matched the P1–P14 XIRA language.

## 2. Routes audited

### Tenant app

| Route | Purpose | Data | Query vs manual | Notes |
|---|---|---|---|---|
| `/` | Dashboard | analytics, company, documents, ETA, members | mixed | P4 header (not PageHeader); unchanged |
| `/documents` | Invoice list | `listDocuments` | React Query | TableWrap + sticky first column via primitive |
| `/documents/[id]` | Editor | `getDocument` + mutations | manual | Caption + sticky first on lines table |
| `/purchases` | Received docs | purchases API | React Query | TableWrap sticky via primitive |
| `/purchases/[id]` | Purchase detail | `getPurchase` + decisions | manual | QueryErrorCard; lines caption |
| `/customers` | Customers | customers API | React Query | Unchanged beyond TableWrap sticky |
| `/settings` | Settings hub | none | n/a | Unchanged |
| `/settings/company` | Company profile | company API | manual | issuerType LTR |
| `/settings/branches` | Branches | branches API | React Query | ETA/activity codes LTR |
| `/settings/invoice-numbering` | Numbering | numbering API | manual | prefix + preview LTR |
| `/settings/eta-credentials` | ETA creds | credentials/ETA APIs | React Query | technical fields LTR |
| `/settings/eta-document-types` | ETA types | ETA types API | React Query | JSON versions LTR |
| `/settings/item-codes` | Item codes | item-codes API | React Query | code/type LTR columns |
| `/settings/currencies` | Currencies | currencies API | React Query | codes/rates LTR |
| `/users` | Members | members/roles | React Query | Unchanged (email already LTR) |
| `/roles` | Roles | roles API | React Query | Unchanged |
| `/sync` | Offline queue | sync engine | mixed | Unchanged |
| `/sync/conflict` | Conflict | sync engine | mixed | Unchanged |
| `/backup` | Backups | backup API | React Query | QueryErrorCard |
| `/devices` | Devices | devices API | React Query | QueryErrorCard |
| `/imports` | Imports | imports API | React Query | Unchanged |
| `/exports` | Exports | exports API | React Query | Unchanged |
| `/analytics` | Analytics | analytics API | React Query | Unchanged |
| `/reports` | Report catalog | static catalog | n/a | Unchanged |
| `/reports/[reportId]` | Report detail | reports API | React Query | Unchanged |
| `/billing` | Billing | billing API | React Query | Unchanged |
| `/dev/ui` | Primitive gallery | none | n/a | Dev-only; production `notFound` |

### Authentication

| Route | Purpose | Notes |
|---|---|---|
| `/login` | Sign in | No PageHeader (intentional) |
| `/register` | Sign up | No PageHeader (intentional) |
| `/onboarding` | Create tenant | No PageHeader (intentional) |

### Platform / admin

| Route | Purpose | Notes |
|---|---|---|
| `/admin` | Platform tenants | Isolated P13 chrome preserved |

### Public / other

| Route | Purpose | Notes |
|---|---|---|
| `/` (root `app/page.tsx`) | Locale redirect | Unchanged |

Pending-activation is a shell screen (not a locale route): email LTR.

## 3. Changes made

- **Table / TableWrap:** sticky first column on horizontal overflow (`start-0`, RTL-safe). Optional `TableColumn.ltr`.
- **Input:** default `dir="ltr"` for technical types (`email`, `url`, `tel`, `number`, `password`, date/time types). Ordinary text unchanged.
- **CopyableTenantId:** design tokens + `Button`; tenant id remains LTR.
- **User menu / pending activation:** emails LTR; role names stay locale direction.
- **Settings technical values:** issuer type, invoice prefix/preview, item codes, currencies, ETA client/registration/activity fields, branch ETA/activity codes, document-type JSON.
- **Purchase party id** LTR.
- **QueryErrorCard** on purchase detail load error, devices list error, backup jobs error (same retry semantics).
- **Captions** on document/purchase line tables.
- **Document editor lines table:** sticky first column without changing editor hydration.

## 4. Shared primitive coverage

Pages that are normal app screens use `PageHeader` + `Breadcrumbs` (settings via `SettingsPageHeader`). Auth and dashboard keep their established chrome.

`Table` / `TableWrap` now include sticky-first + overflow. `EmptyState`, `Skeleton`, `ConfirmDialog`, `Toast` / `useMutationToast`, `QueryErrorCard` remain as of P14.

`justify-end` on modal/auth/login/exports is flex-end (already logical). No `ml-`/`mr-`/`text-left`/`text-right` remain in `apps/web/src`.

## 5. Legacy UI removed/replaced

- Ad-hoc danger Card + Retry → `QueryErrorCard` on `/purchases/[id]` load error, `/devices` query error, `/backup` jobs error.
- CopyableTenantId raw `<button>` + non-token spacing → `Button` + tokens.
- No remaining `window.confirm` / `window.alert` / `window.prompt` in production UI (P14).

## 6. API contract verification

```text
API contracts changed: no
```

## 7. Query key verification

```text
Query keys changed: no
```

## 8. Payload verification

```text
Payloads changed: no
```

## 9. Permissions

```text
Permissions changed: no
```

`roles.perm.*` dotted keys were not renamed. 403 still has no Retry where that was the existing pattern.

## 10. Backend

```text
Backend touched: no
```

## 11. RTL / LTR

- English pages remain `dir="ltr"`; Arabic pages remain `dir="rtl"`.
- Technical values use the smallest `dir="ltr"` (ids, emails, codes, checksums, masked secrets, JSON, invoice prefixes).
- Table sticky uses `start-0` (inline-start), not `left-0`.
- Physical Tailwind (`ml-`/`mr-`/`pl-`/`pr-`/`text-left`/`text-right`) : none found.

Playwright screenshot suite from the original CURSOR-PROMPTS P15 text was **not** added: this repo has no Playwright dependency, and this phase forbids committing screenshots. Browser QA substituted.

## 12. Responsive

Table overflow is internal (`overflow-x-auto`) with sticky first column. Header actions already `flex-wrap`. Mobile nav drawer (P2) unchanged.

Viewport overflow checks (see final report §17): page-level `scrollWidth > clientWidth` is false at 375 / 768 / 1024 / 1440 on representative routes.

## 13. Dark mode

No new hex colors. Token surfaces (`bg-surface`, `border-border`, `bg-surface-alt` on sticky cells) follow `data-theme`. Sticky first-column backgrounds use surface tokens so dark mode remains opaque while scrolling.

## 14. Accessibility

- Line tables gained `sr-only` captions (`t('lines')`).
- QueryErrorCard keeps `role="alert"` + Retry button name.
- Input technical types keep labels; `dir` is presentation-only.
- One `h1` per PageHeader page (unchanged).
- Duplicate shell breadcrumbs + page breadcrumbs is pre-existing P2/P5 chrome, not changed.

## 15. Tests

Baseline: 103 suites / 360 tests passed.

Final focused: table / input / copy-button / purchase-detail / devices / backup / settings / documents suites — 18 suites / 67 tests passed.

Final full web: 103 suites / 363 tests passed (+3 assertions: table sticky + LTR column, input technical dir).

## 16. Known limitations

- Billing invoices empty: no create-invoice API — no fake CTA (P14).
- Export history empty: create cards are the CTA; no duplicate EmptyState action (P14).
- Dashboard / analytics zeros are real API zeros.
- Reports hub and settings hub have no list fetch.
- Document editor still hydrates in place on first load (P5).
- No Playwright four-shot screenshot matrix (no e2e runner; screenshots not committed).

## 17. Pre-existing issues

- Next.js `INVALID_KEY` overlay for dotted `roles.perm.*`.
- Shell breadcrumbs plus page `Breadcrumbs` (intentional P2 + page headers).
- Some list query errors still use an equivalent danger `Card` + Retry with route-specific `data-testid` (documents/purchases/customers). Behavior already matched P14; not rewritten mechanically.
- 403 states without Retry (users, backup, devices, admin).
- `justify-end` is already logical flex-end.

## 18. Business logic confirmation

```text
API contracts: unchanged
Query keys: unchanged
Payloads: unchanged
Permissions: unchanged
Backend: untouched
P1–P14 behavior: preserved
```
