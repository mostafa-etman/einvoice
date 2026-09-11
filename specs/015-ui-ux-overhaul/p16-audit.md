# P16 — Final XIRA UI/UX hardening & release readiness

P15 baseline: `e045f494526ff2a9e8f2427820a70cc94d63f549` (`ui(P15): finalize XIRA UI UX consistency audit`).

P16 is a hardening pass. Pages that already matched P1–P15 were not rewritten.

## 1. Baseline

```text
P15 commit: e045f494526ff2a9e8f2427820a70cc94d63f549
suites:     103
tests:      363
result:     passed
lint:       0 errors, 0 warnings
typecheck:  passed
git diff --check: clean
```

## 2. Audit scope

Inspected tenant app, auth, platform admin, pending activation, logout/theme shell, and shared primitives (`Table`, `Input`, `Button`, `Card`, `Badge`, `EmptyState`, `Skeleton`, `QueryErrorCard`, `Toast`, `ConfirmDialog`, `Drawer`, `Modal`, `Tabs`, `PageHeader`, `Breadcrumbs`, `FilterBar`, `ThemeToggle`, `CopyButton` / `CopyableTenantId`).

Routes: `/`, `/documents`, `/documents/[id]`, `/purchases`, `/purchases/[id]`, `/customers`, `/settings` (+ all children), `/users`, `/roles`, `/sync`, `/sync/conflict`, `/backup`, `/devices`, `/imports`, `/exports`, `/analytics`, `/reports`, `/reports/[reportId]`, `/billing`, `/dev/ui`, `/login`, `/register`, `/onboarding`, `/admin`, root locale redirect, pending activation.

## 3. Findings

### Visual consistency

```text
Finding: Billing plan/addon cards still used pre-XIRA classes (text-muted-foreground is not a token, text-green-700, text-white, native buttons, arbitrary p-4/gap-4).
Route/component: PlanCards / AddonCards / PromoNote
Problem: Muted copy did not use design tokens; savings color broke dark mode; competing button styles.
Fix: Card + Button + text-foreground-muted / text-success / text-on-dark / token spacing.
Why it is safe: Presentation only. onChoose payloads unchanged. Choose-plan / start-trial accessible names unchanged.
Test coverage: plan-cards.behavior.test.tsx; auth.smoke still clicks startFreeTrial.
```

```text
Finding: WhatsApp upgrade overlay used a custom dialog (bg-black/50, text-muted-foreground, text-white) and set dir="ltr" on the entire CTA including localized label.
Route/component: WhatsAppUpgradeDialog
Problem: Legacy overlay; Arabic CTA would be forced LTR; no Modal focus trap.
Fix: Modal + token CTA; phone number only is dir="ltr".
Why it is safe: Same queryKey ['activation-help'], same fetchActivationHelp, same prefill/href builders. Escape still closes.
Test coverage: whatsapp-upgrade-dialog.behavior.test.tsx
```

```text
Finding: Customer picker mutation error used text-red-700.
Route/component: CustomerPicker
Problem: Hardcoded Tailwind red, not the danger token; no alert role.
Fix: text-danger + role="alert".
Why it is safe: Message source unchanged; picker save mutation unchanged.
Test coverage: existing document-detail mocks the picker; no payload tests affected.
```

### RTL / LTR

```text
Finding: Plan quota list items used dir="ltr" on the whole Arabic sentence.
Route/component: PlanCards
Problem: Forced LTR on localized quota copy.
Fix: Removed list-item dir="ltr"; EGP amounts remain LTR.
Why it is safe: Display only.
Test coverage: plan-cards.behavior.test.tsx Arabic case.
```

Physical Tailwind (`ml-`/`mr-`/`text-left`/`text-right`): none found.

### Responsive

No P16 overflow bug identified after viewport checks (see §13). Internal table scroll + sticky first column preserved.

### Dark mode

No P16 issue identified after replacing `text-green-700` / `text-white` / `text-muted-foreground`. Light body `rgb(245, 247, 251)` verified on `/ar/billing`.

### Accessibility

WhatsApp dialog now uses `Modal` (`role="dialog"`, labelled title, Escape, focus). Customer picker errors use `role="alert"`. No extra ARIA added elsewhere.

### Loading / empty / error / success

No P16 issue identified. P14 `states-audit.md` remains the state model. Billing invoices empty still has no create CTA (no API).

### Forms / tables / shell

No P16 issue identified. Shell + page breadcrumbs left as pre-existing P2 design. Sticky first column still `start-0`.

### Technical values

No further P16 issue identified beyond billing CTA/phone and plan prices.

### Tests / dev/ui / known issues

No P16 issue identified. `/dev/ui` remains a primitive gallery. Known issues in §18 were not “fixed.”

## 4. Files modified

- `apps/web/src/components/billing/plan-cards.tsx`
- `apps/web/src/components/billing/whatsapp-upgrade-dialog.tsx`
- `apps/web/src/components/customers/customer-picker.tsx`

## 5. Files created

- `apps/web/src/components/billing/plan-cards.behavior.test.tsx`
- `apps/web/src/components/billing/whatsapp-upgrade-dialog.behavior.test.tsx`
- `specs/015-ui-ux-overhaul/p16-audit.md`

## 6. API / data sources

```text
API client files changed: no
```

## 7. Query keys

```text
Query keys changed: NONE
```

`['activation-help']` unchanged. Billing catalog/subscription/quotas/invoices keys unchanged.

## 8. Payloads

```text
Payloads: unchanged
```

## 9. Permissions

```text
Permissions: unchanged
```

## 10. Business logic

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
```

## 11. Loading / Empty / Error / Success

Unchanged from P14. Billing empty invoices: no create-invoice API. Export empty: create cards remain the CTA.

## 12. RTL / LTR

- `/en/billing`: `dir="ltr"`, h1 Billing
- `/ar/billing`: `dir="rtl"`, h1 `الفواتير`
- WhatsApp CTA: localized label follows page direction; phone `00201000864620` is `dir="ltr"`
- Plan prices: EGP amounts LTR; Arabic quota sentences not forced LTR

## 13. Responsive

Page-level `scrollWidth > clientWidth` was **false**:

| Width | Route | Result |
|---|---|---|
| 375 | `/en/billing`, `/en/users`, `/en/documents`, `/ar/billing` | false |
| 768 | `/en/documents` | false (clientWidth 753) |
| 1024 | `/en/documents` | false (clientWidth 1009) |
| 1440 | `/en/documents`, `/en/purchases`, `/en/settings/company`, `/en/settings/item-codes`, `/en/imports`, `/en/exports`, `/en/analytics`, `/en/reports`, `/en/admin` | false |

Documents sticky first column still `position: sticky` at 375.

## 14. Dark mode

Dark persisted on most routes. Light check on `/ar/billing`: `data-theme="light"`, body `rgb(245, 247, 251)`. No leftover `muted-foreground` / `green-700` classes in the DOM.

## 15. Accessibility

- One `h1` on inspected routes
- WhatsApp dialog named, Escape closes, Close focused on open
- Choose plan / Request via WhatsApp have accessible names
- Customer picker save errors: `role="alert"`
- Item-codes technical cells remain `td[dir=ltr]`

## 16. Visual QA

Logged in as `owner@test.local` on `http://localhost:3000`.

Inspected live: `/en/billing` (opened plan dialog, Escape, did not follow WhatsApp), `/en/users`, `/en/documents`, `/en/purchases`, `/en/settings/company`, `/en/settings/item-codes`, `/en/imports`, `/en/exports`, `/en/analytics`, `/en/reports`, `/en/admin`, `/ar/billing`.

`/en/admin` live: page renders with h1 “Platform admin” and `role="alert"` “You don't have platform-operator access.” This account is not a platform operator. Admin happy-path remains covered by existing admin tests.

Login/register/onboarding not re-authenticated live (would end the session). Covered by `auth.smoke.test.tsx`.

## 17. Test results

```text
focused: 4 suites / 21 tests / passed
         (plan-cards.behavior, whatsapp-upgrade-dialog.behavior, billing.behavior, auth.smoke)
full:    105 suites / 366 tests / passed
lint:    0 errors, 0 warnings
typecheck: passed
git diff --check: clean
```

## 18. Intentional deviations

- Next.js `INVALID_KEY` for dotted `roles.perm.*` — not renamed
- Document editor in-place first-load hydrate (P5)
- No Playwright e2e runner — browser QA used instead
- Billing: no create-invoice / payment-method / cancel-subscription UI
- Platform admin: no Users / ETA schema / audit / stats APIs
- Export history: no duplicate EmptyState CTA
- Shell breadcrumbs + page breadcrumbs (P2) unchanged
- Reports/settings static hubs have no list fetch

## 19. Remaining issues

### Pre-existing

- `roles.perm.*` INVALID_KEY overlay
- Duplicate breadcrumbs
- Document editor hydrate
- Live test user is not a platform operator (`/admin` access-denied state)
- Jest “worker process failed to exit gracefully” can appear after the suite (timer teardown); all tests still passed

### P16

```text
P16: None
```

### Backend/data limitations

- No create-invoice, payment-method, or cancellation APIs
- No platform Users / ETA schema / audit / stats endpoints
- No Playwright package
