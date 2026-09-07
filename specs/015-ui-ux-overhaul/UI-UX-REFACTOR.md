# UI/UX Refactor Brief for `apps/web` — XIRA Brand

> **For Cursor.** Follow this file top-to-bottom. Work in the phases and page groups defined here. Do NOT change API contracts, business logic, i18n keys, or spec files under `/specs/001..014`. Only touch `apps/web/src/**` and the design tokens.
>
> **Design source of truth (client-approved):** `specs/015-ui-ux-overhaul/XIRA-DESIGN-DEMO.html`. Every screen you build must match this demo pixel-for-pixel in color, spacing, and structure. Open it before starting each phase and mirror the pattern for the equivalent page.
>
> **Brand:** XIRA — Smart Tax & Business Suite. Deep navy hero panels + teal→blue gradient accents + white content surfaces.

---

## 0. Ground Rules (do not violate)

1. **Stack is fixed:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind 3, `next-intl`, `react-hook-form` + `zod`, `@tanstack/react-query`, `recharts`. Do NOT add UI libraries (no shadcn install, no MUI, no Chakra). Build primitives in-house using existing tokens.
2. **RTL is the default.** `ar` locale ships first. Every layout MUST use logical properties (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`, `text-end`). No `ml-*`, `mr-*`, `pl-*`, `pr-*`, `left-*`, `right-*`.
3. **Design tokens only.** Use `bg-brand`, `bg-surface`, `bg-background`, `text-foreground`, `border-border`, `p-token-*`, `text-token-*`, `font-display`. If a value is missing, **extend `src/styles/tokens.css` + `tailwind.config.ts`** — never hardcode a hex, px, or rem inside a component.
4. **Preserve every existing test.** Smoke tests live next to pages (`*.smoke.test.tsx`). Run `pnpm --filter @einvoice/web test` and `pnpm --filter @einvoice/web typecheck` and `pnpm --filter @einvoice/web lint` after each phase; all must pass with zero warnings.
5. **Preserve every `data-testid`, form field name, and i18n key** already present. Refactor markup around them; do not rename them. If a translation string is missing, ADD it to both `ar.json` and `en.json`.
6. **No behavior changes.** Same endpoints, same query keys, same submit payloads. UI polish only.
7. **File size discipline.** Any page over ~400 lines must be split into local `./_components/*.tsx` (route-colocated) — never move logic to `src/components/*` unless it is reused across two or more routes.
8. **Accessibility is a requirement, not a nice-to-have.** Every interactive element needs a visible focus ring, an accessible name, correct roles, and keyboard operability. Every icon-only button needs `aria-label`. Every table needs `<caption>` (visually hidden is fine) and `scope="col"` on headers. Every form control needs a real `<label>`.

---

## 1. Project Snapshot (for context)

- Domain: Egyptian Tax Authority (ETA) e-invoicing SaaS. Multi-tenant, sandbox-first, audit-first.
- Web app: `apps/web` (Next.js). API: `apps/api` (NestJS). Signing agent: `apps/agent` (.NET).
- Locales: `ar` (default, RTL) and `en` (LTR). Message files in `apps/web/src/messages/{ar,en}.json`.
- Existing tokens (`apps/web/src/styles/tokens.css`): `--color-background`, `--color-foreground`, `--color-brand`, `--color-brand-muted`, `--color-surface`, `--color-border`, spacing `xs/sm/md/lg/xl`, fonts `sans/display`, sizes `sm/md/lg/xl`.
- App shell: `src/components/shell/app-shell.tsx` (sidebar + top bar, collapsible, RTL-aware).
- 30 routed pages under `src/app/[locale]/(app|auth|platform)`.

---

## 2. Phase Plan (execute in order)

Cursor: do **one phase per PR**. After every phase, run tests + typecheck + lint and stop for review.

| Phase | Goal | Touches |
|---|---|---|
| P1 | Design tokens & primitives | `tokens.css`, `tailwind.config.ts`, new `src/components/ui/*` |
| P2 | App shell polish | `components/shell/*`, `components/switchers/*` |
| P3 | Auth flows | `(auth)/login`, `(auth)/register`, `(auth)/onboarding` |
| P4 | Dashboard / Home | `(app)/page.tsx` |
| P5 | Documents (list + detail) | `(app)/documents/**` |
| P6 | Purchases (list + detail) | `(app)/purchases/**` |
| P7 | Customers | `(app)/customers/**` |
| P8 | Settings cluster | `(app)/settings/**` |
| P9 | Users / Roles | `(app)/users`, `(app)/roles` |
| P10 | Sync / Backup / Devices | `(app)/sync/**`, `(app)/backup`, `(app)/devices` |
| P11 | Imports / Exports | `(app)/imports`, `(app)/exports` |
| P12 | Analytics / Reports / Billing | `(app)/analytics`, `(app)/reports/**`, `(app)/billing` |
| P13 | Platform admin | `(platform)/admin` |
| P14 | Empty / error / loading states pass | every route |
| P15 | Mobile & RTL audit | every route |

---

## 3. Phase 1 — Design Tokens & UI Primitives

### 3.1 Replace and extend tokens (XIRA brand)

Replace the entire `:root` block in `src/styles/tokens.css` with the XIRA palette, then mirror the color keys in `tailwind.config.ts`. Use these exact hex values (copied from the approved demo):

```css
:root {
  /* Brand — XIRA logo */
  --color-brand: #2f6fed;               /* primary blue */
  --color-brand-strong: #1d4ed8;        /* hover / pressed */
  --color-brand-deep: #1e3a8a;          /* deep navy blue */
  --color-brand-teal: #14b8a6;          /* teal accent */
  --color-brand-teal-strong: #0d9488;
  --color-brand-cyan: #38bdf8;
  --color-brand-muted: rgba(47,111,237,0.10);
  --color-brand-teal-muted: rgba(20,184,166,0.10);

  /* Hero surfaces (navy) */
  --color-navy: #0a1628;
  --color-navy-2: #0f2545;
  --color-navy-3: #14315b;

  /* Content surfaces */
  --color-background: #f5f7fb;
  --color-surface: #ffffff;
  --color-surface-alt: #f8fafc;
  --color-surface-hover: #eef2f8;

  /* Text */
  --color-foreground: #0f172a;
  --color-foreground-muted: #64748b;
  --color-foreground-subtle: #94a3b8;
  --color-on-dark: #ffffff;
  --color-on-dark-muted: #94a5c7;

  /* Borders */
  --color-border: #e2e8f0;
  --color-border-strong: #cbd5e1;
  --color-border-dark: rgba(255,255,255,0.08);

  /* Semantic */
  --color-success: #10b981;      --color-success-muted: #d1fae5;
  --color-warning: #f59e0b;      --color-warning-muted: #fef3c7;
  --color-danger:  #ef4444;      --color-danger-muted:  #fee2e2;
  --color-info:    #3b82f6;      --color-info-muted:    #dbeafe;

  /* ETA status */
  --color-status-draft:     #64748b; --color-status-draft-muted:     #f1f5f9;
  --color-status-signed:    #3b82f6; --color-status-signed-muted:    #dbeafe;
  --color-status-submitted: #f59e0b; --color-status-submitted-muted: #fef3c7;
  --color-status-valid:     #10b981; --color-status-valid-muted:     #d1fae5;
  --color-status-invalid:   #ef4444; --color-status-invalid-muted:   #fee2e2;
  --color-status-cancelled: #64748b; --color-status-cancelled-muted: #e2e8f0;
  --color-status-rejected:  #b91c1c; --color-status-rejected-muted:  #fecaca;

  /* Spacing */
  --space-2xs: 0.125rem;
  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2.5rem;
  --space-2xl: 4rem;

  /* Radii */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-pill: 999px;

  /* Elevation */
  --shadow-xs: 0 1px 2px rgba(15,23,42,0.05);
  --shadow-sm: 0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04);
  --shadow-md: 0 4px 12px rgba(15,23,42,0.08), 0 2px 4px rgba(15,23,42,0.04);
  --shadow-lg: 0 20px 40px rgba(15,23,42,0.12), 0 8px 16px rgba(15,23,42,0.06);
  --shadow-brand: 0 8px 24px rgba(47,111,237,0.25);

  /* Focus */
  --ring: 0 0 0 3px rgba(47,111,237,0.35);

  /* Type */
  --font-sans: "IBM Plex Sans Arabic", "Inter", "Segoe UI", sans-serif;
  --font-en:   "Inter", "IBM Plex Sans Arabic", sans-serif;
  --font-display: var(--font-sans);
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-md: 1rem;
  --font-size-lg: 1.25rem;
  --font-size-xl: 2rem;

  /* Signature gradients (use for CTAs, marks, hero backgrounds) */
  --gradient-brand: linear-gradient(135deg, #14b8a6 0%, #2f6fed 50%, #1e3a8a 100%);
  --gradient-brand-soft: linear-gradient(135deg, rgba(20,184,166,0.08) 0%, rgba(47,111,237,0.08) 100%);
  --gradient-hero: linear-gradient(160deg, #0a1628 0%, #0f2545 40%, #14315b 100%);
}
```

Load fonts in `src/app/layout.tsx` via `next/font/google` — IBM Plex Sans Arabic (weights 300–700) + Inter (weights 400–700). Bind `--font-sans` / `--font-en` to the CSS variables the loaders return; do not use `<link>` tags.

Mirror into `tailwind.config.ts`:
- `colors`: `brand`, `brand-strong`, `brand-deep`, `brand-teal`, `brand-teal-strong`, `navy`, `navy-2`, `navy-3`, `surface`, `surface-alt`, `border-strong`, plus success/warning/danger/info and all `status-*` families.
- `spacing`: `2xs, xs, sm, md, lg, xl, 2xl` under `token-*` prefixes (keep the existing convention).
- `borderRadius`: `sm/md/lg/xl/pill`.
- `boxShadow`: `xs, sm, md, lg, brand`.
- `backgroundImage`: `gradient-brand`, `gradient-brand-soft`, `gradient-hero`.

**Dark mode**: add a `:root[data-theme="dark"]` block. In dark mode `--color-background: #0a1628`, `--color-surface: #0f2545`, `--color-surface-alt: #14315b`, `--color-foreground: #e6ede9`, `--color-foreground-muted: #94a5c7`, `--color-border: #26382e`. Wire a `ThemeProvider` in `components/providers.tsx` that persists to `localStorage` and respects `prefers-color-scheme`. Add a toggle button in the top bar (icon only, `aria-pressed`).

### 3.1a XIRA brand mark

Add `src/components/brand/xira-logo.tsx` — a component that renders the XIRA wordmark next to a gradient "X" tile. Two variants:
- `<XiraLogo variant="on-dark" />` — for sidebars and the login hero (white text, teal tagline).
- `<XiraLogo variant="on-light" />` — for the platform-admin header, footer, and printouts (navy text, muted tagline).

The tile is a 40–48px rounded square filled with `--gradient-brand`, containing a bold "X" in Inter 700. The wordmark is "XIRA" in Inter 700 with `letter-spacing: 0.05em`. Tagline underneath: "SMART TAX & BUSINESS SUITE" in `--color-brand-teal` (on-dark) or `--color-foreground-muted` (on-light), uppercase, `letter-spacing: 0.2em`, 10–11px. Reference the exact rendering in `XIRA-DESIGN-DEMO.html` (the `.brand-block` / `.brand-mark` markup).

### 3.2 Build primitives in `src/components/ui/`

Create these files. Each is a small typed component with tokenized styles, RTL-safe, no external deps. **Every visual detail must match the approved demo** — colors, radii, shadows, hover states, spacing.

- `button.tsx` — variants: `primary | secondary | ghost | danger | link`; sizes: `sm | md | lg`; loading state (spinner + disabled); `iconStart` / `iconEnd`; icon-only variant requires `aria-label`.
- `input.tsx`, `textarea.tsx`, `select.tsx` — labeled wrapper: `label`, `hint`, `error`, `required`. Wire to `react-hook-form` via `forwardRef`. Error text uses `--color-danger`. Focus uses `--ring`.
- `field.tsx` — layout for label + control + hint/error, used by all form controls.
- `checkbox.tsx`, `radio.tsx`, `switch.tsx`.
- `badge.tsx` — variants: `neutral | success | warning | danger | info` plus ETA status variants (`draft/signed/submitted/valid/invalid/cancelled/rejected`).
- `card.tsx` — `<Card>`, `<CardHeader>`, `<CardBody>`, `<CardFooter>`. Uses `bg-surface`, `border-border`, `--shadow-sm`, `--radius-md`.
- `table.tsx` — semantic `<table>` with sticky header, zebra rows off by default, `dense` prop, column config accepts `align: 'start' | 'end' | 'center'`, empty state slot, loading skeleton rows, sort indicator.
- `pagination.tsx` — page-size selector, prev/next, jump-to-page. RTL-safe arrows.
- `modal.tsx` — accessible dialog (focus trap, `Escape` to close, initial focus, `aria-labelledby`, `aria-describedby`). Body scroll lock. Sizes: `sm | md | lg | xl`.
- `drawer.tsx` — side sheet, opens from `end` in RTL, `start` in LTR.
- `toast.tsx` + `ToastProvider` — success/error/info/warn, auto-dismiss, stackable, mounted in root providers.
- `tabs.tsx` — arrow-key navigation, `aria-selected`, keyboard focus ring.
- `dropdown-menu.tsx` — accessible menu, arrow keys, Home/End, close on outside click.
- `tooltip.tsx` — delay 400ms, `aria-describedby`.
- `progress.tsx` — indeterminate + determinate; `role="progressbar"`.
- `skeleton.tsx` — text / rect variants.
- `empty-state.tsx` — icon, title, description, primary action.
- `page-header.tsx` — title, subtitle, breadcrumbs slot, actions slot.
- `breadcrumbs.tsx` — RTL-aware separator.
- `stat-card.tsx` — label, value, delta (up/down/flat), sparkline slot.
- `filter-bar.tsx` — search input + chip filters + reset button.
- `confirm-dialog.tsx` — thin wrapper over `modal.tsx` for destructive actions; requires typed confirmation for cancel-document flows.
- `copy-button.tsx` — replaces the ad-hoc copy behavior in `copyable-tenant-id.tsx`; the existing component should re-export from here.

Export everything from `src/components/ui/index.ts`.

### 3.3 Utilities

- `src/lib/cn.ts` — a tiny `cn(...classes)` (no dependency). Every primitive uses it.
- `src/lib/format-date.ts` — ETA-aware date/time formatters, locale-aware (Arabic-Indic digits for `ar` when appropriate; default to Latin digits for anything user might paste into ETA).
- Existing `format-number.ts` stays; add `formatPercent`, `formatCompact`.

### 3.4 Acceptance for P1

- All primitives render in a Storybook-less demo page at `src/app/[locale]/(app)/_dev/ui/page.tsx` (only when `NODE_ENV !== 'production'`).
- Zero hex/rgb literals in `src/components/ui/**`.
- Dark mode toggles cleanly on every primitive.
- All primitives pass a11y smoke tests (add `ui.smoke.test.tsx` per primitive: renders, has accessible name, handles keyboard).

---

## 4. Phase 2 — App Shell (dark navy sidebar)

Refactor `components/shell/app-shell.tsx` to match the demo's shell exactly:
- **Sidebar background is `--color-navy`** (deep navy), with white text at 75% opacity by default, 100% opacity on hover. Active link = filled `--color-brand` (blue) with `--shadow-brand`. Nav-group titles are 10px uppercase, 12% letter-spacing, `--color-on-dark-muted`.
- Sidebar top: XIRA logo (`variant="on-dark"`) + a **quick-search pill** (`⌘K` keyboard hint) that opens the command palette. Bottom: user block with gradient avatar tile.
- Top bar is white on the light content column, with tenant/branch pills, ETA env pill (yellow/green/red per env), notification bell, and theme toggle.
- Reference: `.app-sidebar`, `.nav-link`, `.user-block`, `.app-topbar` in the demo.

Then:

- Split into `AppShell`, `Sidebar`, `SidebarNav`, `Topbar`, `UserMenu`, `LocaleSwitcher`, `ThemeToggle`, each in `components/shell/`.
- **Group the sidebar nav** into sections with headers (translations live under `nav.sections.*`):
  - **Sales**: Home, Documents, Customers
  - **Purchases**: Purchases
  - **Data Movement**: Imports, Exports, Sync
  - **Insights**: Analytics, Reports
  - **Operations**: Devices, Backup
  - **Billing**: Billing
  - **Administration**: Users, Roles, Settings
- Active link uses `aria-current="page"` + `bg-brand-muted text-brand`.
- Collapsed sidebar shows only glyphs; each link becomes a tooltip.
- Add a **mobile drawer**: below `md`, hide the sidebar and show a hamburger in the top bar that opens `Drawer` with the same nav. Trap focus, close on route change.
- Top bar: `TenantSwitcher`, `BranchSwitcher`, `EtaEnvironmentBadge` on the start side; on the end side: `Search` (command palette, P2 stub — just open a modal that says "Coming soon" and lists nav destinations, filterable), `ThemeToggle`, `LocaleSwitcher`, `UserMenu` (avatar with initials, email, "Platform Admin" if applicable, "Logout").
- `PendingActivationScreen` — polish with `Card` + `EmptyState`, add support-contact block.
- `SendBlockedBanner` — style with `--color-warning-muted` background, `--color-warning` icon, dismiss control that persists per-tenant in `sessionStorage`.
- Add a **`<Breadcrumbs>`** slot rendered by `page-header.tsx`; each route feeds its own crumbs.

Acceptance:
- No `ml/mr/pl/pr/left/right` in shell code — replaced with logical properties.
- Sidebar collapse state still persists via `getSidebarCollapsed`/`setSidebarCollapsed`.
- Mobile drawer works with keyboard only.
- Existing tests still pass; add `shell.smoke.test.tsx` for the mobile drawer and theme toggle.

---

## 5. Phase 3 — Auth (`(auth)/**`) — XIRA hero layout

`login`, `register`, `onboarding` share a **`<AuthLayout>`** in `src/app/[locale]/(auth)/layout.tsx`. Match the demo's login screen exactly:
- **Two-column grid** desktop, single column mobile.
- **Left (hero) — 60% width**: `--gradient-hero` background with two radial glows (teal top-start, blue bottom-end), and a decorative teal blob bottom-end. Inside: XIRA logo (on-dark), a small teal-tinted pill "منظومة الفوترة والإرسال الإلكتروني المتقدمة", the big title with a gradient span "الفوترة والربط" using `--gradient-brand` clipped to text, the tagline, a row of feature chips (E-Invoicing · Tax Gateway · Cloud ERP · POS Integration), and at the bottom **four glass stat cards** — Enterprise ERP: Ready · ETA Portal: Live · فاتورة/شهر: 6,000 · تعامل/يوم: 18,000. Copy the exact markup from `.login-hero` in the demo.
- **Right (form) — 480px fixed on desktop**: white surface, language switcher pill top-end, big title, subtitle, form with icon-prefixed inputs, remember-me + forgot-password row, primary CTA `dxح إلى قوة التحكم` full-width, security footnote (`TLS 1.3 · PDPL`).
- Register uses the same layout with a password-strength meter driven by the existing zod rule set. Add password visibility toggle (eye icon), Caps-Lock hint.
- Onboarding: same hero on the left; right side is a **3-step stepper** (Company → ETA credentials sandbox check → Confirm). Use `Tabs`-style step indicator; validate before advancing; persist draft in `sessionStorage`.
- All three pages use the new `Field`, `Input`, `Button`, `Card` primitives. Inline validation via existing `zod` schemas; show error messages under fields, not just a generic string.

Acceptance:
- Keyboard-only signup/login works end-to-end.
- All error paths reachable (bad credentials, taken email, weak password, invalid ETA sandbox).

---

## 6. Phase 4 — Home / Dashboard (`(app)/page.tsx`)

Replace the placeholder with a real dashboard:

- `<PageHeader>` with tenant name and lifecycle badge.
- Row of `<StatCard>`: **Documents this month**, **Submitted to ETA**, **Rejected**, **Overdue submissions**, **Purchases received**. Data comes from existing analytics endpoints — reuse `lib/api/*`; do not invent new endpoints.
- **Quick actions** card: New sales document, Import CSV, Sync now, Open latest report.
- **Recent activity** table (last 10 documents) reusing `Table` primitive; row click → document detail.
- **ETA status** card: current environment (sandbox/production), last successful token, next credential expiry.
- **Onboarding checklist** card (dismissible per-tenant): company profile complete, ETA credentials verified, first document submitted, first user invited.

Acceptance:
- All strings translated in `ar`/`en`.
- Cards degrade gracefully to skeletons while queries load, and to empty-state variants when zero data.

---

## 7. Phase 5 — Documents

### `documents/page.tsx` (list, currently 1167 lines)

Split into `./_components/`:
- `document-filters.tsx` — status multi-select, date range, receiver search, tax status, has-ETA-UUID toggle. Uses `FilterBar` primitive.
- `document-table.tsx` — the `Table` primitive with columns: checkbox, internal ID, receiver, issue date, total, status `Badge`, ETA UUID (with `CopyButton`), row actions `DropdownMenu`.
- `document-bulk-actions.tsx` — bar that appears when `selectedIds.length > 0` (Sign, Submit, Refresh status, Cancel, Download printout). Uses `ConfirmDialog` for cancel.
- `document-sync-controls.tsx` — the existing sales sync buttons, moved into a `Card` in the header row with last-sync timestamp.
- `document-status-legend.tsx` — collapsible legend explaining each status badge.

Behavioral requirements to keep:
- Auto-poll every `AUTO_POLL_MS` when there are pending items.
- Batch operations & the toast pattern for success/failure summaries.
- Late-submission warning via `checkLateSubmission` — show as inline warning badge on the row.

Acceptance:
- The main `page.tsx` shrinks to < 250 lines and is orchestration only.
- All existing smoke tests pass unchanged.
- Empty state, error state, loading skeleton, and "no results for these filters" state all present.

### `documents/[id]/page.tsx` (detail, currently 2520 lines)

Split into `./_components/`:
- `document-summary-card.tsx` — status pill, internal ID, receiver, totals.
- `document-timeline.tsx` — vertical timeline of lifecycle events (draft → signed → submitted → valid/invalid, with cancellation), each with actor and timestamp.
- `document-lines-editor.tsx` — the huge lines editor UI; keep `line-taxes-editor.tsx` as a child.
- `document-actions.tsx` — sticky action bar at the page bottom (or top on mobile): Save draft, Sign, Submit, Cancel, Download printout, Preview PDF.
- `document-eta-panel.tsx` — ETA UUID, response payload viewer (collapsible), submission history.
- `document-preview-panel.tsx` — right-side drawer/tab that renders the PDF preview inline via `LocalPdfPreviewModal` logic.

Layout: two-column on desktop (lines + actions on start, summary + timeline + ETA on end), stacked on mobile, tabs on mobile.

---

## 8. Phase 6 — Purchases

`purchases/page.tsx` — mirror the documents-list refactor: split filters, table, bulk actions into `./_components/`. Reuse the same `Table`, `Badge`, `FilterBar` primitives.

`purchases/[id]/page.tsx` — mirror the documents-detail refactor. Purchase-specific status legend and receipt-confirmation flow live in `./_components/purchase-actions.tsx`.

Acceptance: the two lists (sales documents and purchases) MUST look and behave consistently — same columns pattern, same filter placement, same empty state.

---

## 9. Phase 7 — Customers

`customers/page.tsx` (548 lines):
- List with `Table`: name, tax registration number, address summary, primary contact, last-invoiced date, actions.
- Create/edit uses a right-hand `Drawer` form (not a full-page navigation) — feels faster.
- Bulk import stub button linking to `/imports?type=customers`.
- Inline validation of Egyptian tax registration number (9 digits) via zod.
- Empty state prompts to import customers.

---

## 10. Phase 8 — Settings

`settings/page.tsx` becomes a **hub page**: cards linking to each sub-page grouped by:
- **Company** (company profile, branches, invoice numbering)
- **ETA** (credentials, document types)
- **Catalog** (currencies, item codes)

Each sub-page gets a consistent structure:
- `<PageHeader>` with breadcrumbs `Settings › <section>`.
- Read view uses `Card` + description list.
- Edit uses form primitives with save/cancel bar pinned at the bottom.
- ETA credentials page: prominent environment badge (sandbox vs production), "Test connection" button with clear success/failure toast, credential rotation flow, last-used timestamp.
- Branches: table with add/edit/delete via `Drawer`.
- Currencies & Item codes: searchable table.
- Invoice numbering: preview of the resulting invoice number as the user edits the pattern.

---

## 11. Phase 9 — Users & Roles

`users/page.tsx` — table with invite flow via `Modal`. Show membership status (active/pending/suspended) as `Badge`. Row actions: change role, suspend, remove.

`roles/page.tsx` — role grid on the start side, permission matrix on the end side (checkbox tree). Save button pinned at the bottom of the matrix panel. Read-only view for non-admins.

---

## 12. Phase 10 — Sync, Backup, Devices

- `sync/page.tsx` — big status card (Online/Offline, last sync, pending queue count), sync log table, manual "Sync now" button with progress.
- `sync/conflict/page.tsx` — side-by-side diff view with per-field pick controls, "keep local / keep server / merge".
- `backup/page.tsx` — list of backups (created at, size, status), "Create backup now" button with progress modal, restore flow behind `ConfirmDialog` requiring typed tenant name.
- `devices/page.tsx` — registered signing agents; card grid: hostname, last seen, agent version, certificate status. Revoke behind confirm.

---

## 13. Phase 11 — Imports & Exports

- `imports/page.tsx` — 3-step wizard: choose type (sales / purchases / customers / items) → upload file (drag-and-drop zone) → map columns → validate → confirm. Show row-level errors in a virtualized table. Reuse `Tabs` primitive for steps.
- `exports/page.tsx` — filter + preview + download; show export history with re-download links.

---

## 14. Phase 12 — Analytics, Reports, Billing

- `analytics/page.tsx` — grid of `StatCard`s + `recharts` charts wrapped in `Card`. Chart colors come from tokens (`--color-brand`, ETA status hues) — never inline hex.
- `reports/page.tsx` — list of report templates as `Card`s. Filters at top.
- `reports/[reportId]/page.tsx` — parameter form → run → results table + download. Split `report-detail-table.tsx` if it drifts past 300 lines.
- `billing/page.tsx` — current plan card, usage bars (submissions vs quota), invoices table, payment method card. Cancellation flow behind `ConfirmDialog`.

---

## 15. Phase 13 — Platform Admin (`(platform)/admin/page.tsx`, 917 lines)

- Split into `_components/tenant-table.tsx`, `_components/tenant-detail-drawer.tsx`, `_components/platform-stats.tsx`, `_components/lifecycle-actions.tsx`.
- Tabs: Tenants, Users, ETA schemas, Audit log.
- Lifecycle actions (approve, suspend, reject) each behind `ConfirmDialog`.

---

## 16. Phase 14 — States pass

For every route, guarantee all four states are handled with the right primitive:
- **Loading**: `Skeleton` rows / cards. No spinners over static text.
- **Empty**: `EmptyState` with a helpful primary action (never just "No data").
- **Error**: `Card` with the danger palette, error message, and a "Retry" button that re-triggers the query.
- **Success**: the real UI.

Also: every mutation flows through `Toast`. Kill any raw `alert()` / `confirm()`.

---

## 17. Phase 15 — Mobile & RTL audit

Manually walk every route in Chrome DevTools at 375×667 in `ar` and in `en`. Fix:
- Horizontal scrolling caused by tables (wrap in `overflow-x-auto` container with sticky first column on mobile).
- Buttons that stack awkwardly (use `flex-wrap gap-token-sm`).
- Top-bar controls that overflow (collapse into a menu under `md`).
- Any icon whose direction depends on reading order (chevrons, arrows) — mirror with `rtl:rotate-180`.
- Any `text-left`/`text-right` — replace with `text-start`/`text-end`.
- Any `justify-start`/`justify-end` used for horizontal placement that should flip in RTL — audit each.
- Any date/number formatting: use `Intl` with the active locale.

---

## 18. i18n

- Every visible string uses `useTranslations`. No inline `"..."` in JSX.
- New keys go into both `ar.json` and `en.json` in the same commit.
- Group new keys under existing scopes: `nav.*`, `shell.*`, `auth.*`, `documents.*`, `purchases.*`, `customers.*`, `settings.*`, `users.*`, `roles.*`, `sync.*`, `backup.*`, `devices.*`, `imports.*`, `exports.*`, `analytics.*`, `reports.*`, `billing.*`, `admin.*`, `common.*`, `ui.*`.
- Add `common.states.loading`, `common.states.empty`, `common.states.error`, `common.actions.save`, `common.actions.cancel`, `common.actions.retry`, `common.actions.delete`, `common.actions.confirm`, `common.actions.close` for the primitives to consume.

---

## 19. Definition of Done (per phase)

Every PR must:
1. Pass `pnpm --filter @einvoice/web lint` with zero warnings.
2. Pass `pnpm --filter @einvoice/web typecheck`.
3. Pass `pnpm --filter @einvoice/web test`.
4. Add or update a `*.smoke.test.tsx` for every new primitive or split component.
5. Include screenshots in the PR description for `ar` (RTL) and `en` (LTR), desktop + mobile.
6. Contain a short "What changed / What did NOT change" section confirming no API or business-logic touch.
7. Have zero raw hex colors, raw pixel values, or `ml/mr/pl/pr/left/right` classes in the diff.

---

## 20. Suggested working order for Cursor

For each phase:

1. Read the whole phase section here.
2. Read the target files and their smoke tests.
3. Write or update the primitive(s) needed.
4. Refactor the page(s), extracting `./_components/*`.
5. Run tests, typecheck, lint.
6. Fix, then commit as `ui(<phase>): <summary>`.

Ask for clarification only if a design decision is ambiguous. Otherwise, default to the pattern in the nearest already-refactored page and keep going.
