# P14 — Empty / error / loading states audit

Generated during Phase 14 (states pass). Routes are the pages under `apps/web/src/app/[locale]/(app|auth|platform)/**/page.tsx`.

Legend:

- **Loading** — `Skeleton` (or equivalent `aria-busy`) on first fetch; no fake numbers
- **Empty** — `EmptyState` with a helpful existing CTA where an action already exists
- **Error** — danger `Card` / `QueryErrorCard` + Retry that re-triggers the existing query (403 stays without Retry)
- **Success** — real UI from API data
- **Toast** — mutations announce success/error via `Toast`
- **confirm()** — no raw `window.confirm` / `alert` on the route

| Route | Loading | Empty | Error | Success | Toast | confirm/alert |
|---|---|---|---|---|---|---|
| `/login` | n/a (form) | n/a | inline + toast | redirect | ✅ mutation errors | ✅ |
| `/register` | n/a (form) | n/a | inline + toast | redirect | ✅ mutation errors | ✅ |
| `/onboarding` | catalog skeleton (P3) | catalog empty from API | inline + toast | redirect | ✅ create tenant | ✅ |
| `/` (dashboard) | ✅ P4 | ✅ P4 | ✅ P4 | ✅ | n/a (reads) | ✅ |
| `/documents` | ✅ P5 | ✅ + create/reset | ✅ + Retry | ✅ | ✅ list mutations | ✅ ConfirmDialog |
| `/documents/[id]` | editor hydrates in place (preserved) | n/a (new form) | load `QueryErrorCard` + Retry; mutation banners | ✅ | ✅ save (+ existing list toasts) | ✅ ConfirmDialog |
| `/purchases` | ✅ P6 | ✅ + sync/reset | ✅ + Retry | ✅ | ✅ sync | ✅ |
| `/purchases/[id]` | ✅ P6 | n/a | ✅ + Retry | ✅ | ✅ decisions / download | ✅ |
| `/customers` | ✅ P7 | ✅ + create/reset | ✅ + Retry | ✅ | ✅ save / deactivate | ✅ |
| `/settings` | n/a (hub) | n/a | n/a | ✅ tiles | n/a | ✅ |
| `/settings/company` | ✅ | n/a | load Retry + mutation alert | ✅ | ✅ logo | ✅ |
| `/settings/branches` | ✅ | ✅ + create | ✅ + Retry | ✅ | ✅ create / address | ✅ |
| `/settings/invoice-numbering` | ✅ | n/a | load Retry + mutation alert | ✅ | ✅ save | ✅ |
| `/settings/eta-credentials` | ✅ | n/a | query Retry + mutation alerts | ✅ | ✅ mutations | ✅ |
| `/settings/eta-document-types` | ✅ | ✅ + refresh | ✅ + Retry | ✅ | n/a (refresh is query) | ✅ |
| `/settings/item-codes` | ✅ table | ✅ + ETA sync | ✅ + Retry | ✅ | ✅ create / sync | ✅ |
| `/settings/currencies` | ✅ | ✅ + enable | ✅ + Retry | ✅ | ✅ enable / default / rate | ✅ |
| `/users` | ✅ | ✅ invite / reset filters | ✅ + Retry; 403 no Retry | ✅ | ✅ invite / role | ✅ |
| `/roles` | ✅ | ✅ + create | ✅ + Retry | ✅ | ✅ save / create / delete / assign | ✅ |
| `/sync` | ✅ | ✅ + retry | preserved queue errors | ✅ | ✅ drain / discard | ✅ ConfirmDialog |
| `/sync/conflict` | ✅ | ✅ + back to sync | mutation alert + toast | ✅ | ✅ resolve | ✅ |
| `/backup` | ✅ | ✅ + create | ✅ + Retry; 403 no Retry | ✅ | ✅ create / restore / wipe | ✅ ConfirmDialog |
| `/devices` | ✅ | ✅ pairing / reset filters | ✅ + Retry; 403 no Retry | ✅ | ✅ pair / unpair | ✅ ConfirmDialog |
| `/imports` | ✅ | ✅ + start | ✅ + Retry | ✅ | ✅ upload / validate / run | ✅ |
| `/exports` | ✅ | ✅ (create cards are the CTA) | ✅ + Retry | ✅ | ✅ create jobs | ✅ |
| `/analytics` | ✅ P12 | zeros from API | ✅ + Retry | ✅ | n/a (reads) | ✅ |
| `/reports` | n/a (catalog) | n/a | n/a | ✅ | n/a | ✅ |
| `/reports/[reportId]` | ✅ | ✅ + retry load | ✅ + Retry | ✅ | ✅ export | ✅ |
| `/billing` | ✅ | invoices empty (no create API) | ✅ + Retry | ✅ | n/a (reads / WhatsApp dialog) | ✅ |
| `/admin` | ✅ | tenants provision/reset; trials retry | ✅ + Retry; 403 no Retry | ✅ | ✅ lifecycle / catalog / drawer | ✅ ConfirmDialog |
| `/dev/ui` | gallery | gallery | gallery | gallery | gallery | gallery |

## Gaps closed in P14

- Replaced `window.confirm` in logout with `ConfirmDialog` (`LogoutUnsyncedDialog` in the locale layout).
- Mutation toasts on remaining write surfaces (settings, users/roles, devices/backup, admin, imports/exports, auth errors, sync).
- Query error + Retry on settings pages that previously only showed a text alert.
- EmptyState primary actions where an existing action already existed (sync, create, reset filters, refresh, provision).

## Intentional omissions (no fabricated API)

- Billing invoice empty has no create-invoice endpoint — no fake CTA.
- Export job history empty sits below the existing create-local / ETA-package cards, so a second identical `createLocal` button was omitted (would duplicate the primary action and break unique accessible names).
- Dashboard / analytics numeric zeros are real API zeros, not empty lists.
- Reports hub is a static catalog — no loading/empty/error fetch.
- Settings hub is navigation only.
- Login/register/onboarding have no list queries; error is form `role="alert"` plus toast.
- Document editor first-load still hydrates the form in place (P5 behavior preserved); load failure now has Retry without a full navigation change.
