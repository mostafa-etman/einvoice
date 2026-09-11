# RTL / Mobile audit report

Required by original P15 prompt (`CURSOR-PROMPTS.md` §11).

This file is an **honest** Final Review artifact. It is **not** a Playwright screenshot matrix.

---

## Original P15 requirement

From `CURSOR-PROMPTS.md` Phase 15:

1. Grep and replace physical CSS (`ml-/mr-/pl-/pr-/text-left/text-right/left-/right-/justify-start/justify-end`) with logical equivalents.
2. Manually review every page at 375×667 in `ar` and `en`.
3. Fix table overflow, wrapping actions, top-bar overflow, directional icons.
4. Add `apps/web/e2e/rtl-audit.spec.ts` with Playwright (`@playwright/test` as a new devDependency if missing): 4 screenshots per route (ar/en × mobile/desktop).
5. Write this report.

`UI-UX-REFACTOR.md` §17 matches items 2–3 (manual 375 walk, table overflow, sticky first column, chevrons, `text-start`/`text-end`). It does **not** name Playwright; the Playwright file is from the Cursor prompt only.

`EXECUTION-RUNBOOK.md` Stage 2 asks for manual 375 QA and screenshots under `screenshots/after/P<N>/`, not a Playwright package.

---

## Playwright / e2e

```text
required by original plan:     yes (CURSOR-PROMPTS.md P15 item 4)
artifact:                      apps/web/e2e/rtl-audit.spec.ts
status:                        not executable in current package/environment
reason:                        @playwright/test is not in apps/web/package.json or the workspace
                               root; apps/web/e2e/ does not exist; P15 already declined to add
                               a new e2e runner. Final Review is forbidden from inventing
                               testing infrastructure or installing Playwright just to create
                               the file.
actual verification performed: see below
```

This item is **not** marked complete.

---

## Verified now (Stage 3 re-check)

Ripgrep over `apps/web/src` (`*.ts`, `*.tsx`, `*.css`) during this Stage 3 session:

```text
ml-* / mr-* / pl-* / pr-* / left-* / right-* : no matches
text-left / text-right                         : no matches
```

Fresh live RTL/mobile overflow matrix this session: **NOT VERIFIED**.

Remaining `justify-end` (flex-end) in:

- `components/ui/modal.tsx` (footer)
- `components/auth/auth-layout.tsx`
- `(auth)/login/page.tsx`
- `(app)/exports/page.tsx`

P15 documented these as already-logical flex-end in RTL rows. Not changed in Final Review.

Non-class exception: `components/ui/copy-button.tsx` uses `input.style.left = '-9999px'` for an off-screen clipboard node. Not page layout.

### Default document direction

`apps/web/src/app/layout.tsx` still boots `<html lang="ar" dir="rtl">`. Locale routing is responsible for `en` LTR.

### Sticky / overflow implementation (code)

`Table` / `TableWrap` still use logical sticky `start-0` for the first column (P15). Internal table scroll is the intended overflow strategy.

---

## Reported previously, not re-verified in this Final Review

P15 / P16 / P17 audits recorded live checks such as:

- `/ar/*` `dir="rtl"`, `/en/*` `dir="ltr"`
- emails, UUIDs, internal IDs, tax IDs, EGP amounts `dir="ltr"`
- `document.documentElement.scrollWidth <= clientWidth` at 375 / 768 / 1024 / 1440 on representative tenant routes
- light body `rgb(245, 247, 251)` on `/ar/billing`

Those numbers are **not** repeated here as if they were measured again.

---

## Attempted live verification (this session)

Dev server had been running at `http://localhost:3000`. After the Stage 3 command `pnpm --filter @einvoice/web build`, navigating to `/ar/users` returned:

```text
Internal Server Error
document.readyState: complete
dir/lang/theme: empty (document not the app shell)
```

No viewport overflow matrix was collected. Likely cause: production `.next` output replaced the running `next dev` compilation. Final Review did not restart or patch the app to force a screenshot pass.

---

## Screenshots

```text
required:     runbook before/after folders + Prompt 13 “screenshots before/after for 5 pages”
in repository: specs/015-ui-ux-overhaul/screenshots/ does not exist
Playwright 4-shot matrix: not generated
```

---

## Conclusion

Directional Tailwind physical classes required by P15 item 1 are absent from `apps/web/src`.

P15 items 4 (Playwright) and committed screenshot folders are **not** satisfied and must not be claimed as complete.

Manual 375× RTL/LTR walk exists only as **prior audit evidence**, not as a measurement from this Final Review session.
