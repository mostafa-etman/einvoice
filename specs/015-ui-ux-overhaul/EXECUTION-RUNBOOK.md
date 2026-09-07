# Execution Runbook — from Cursor prompt to Hostinger production

End-to-end path for shipping the XIRA UI/UX refactor. Follow the stages in order. Every stage has a checklist; don't advance until every box is ticked.

**Companion docs:**
- `UI-UX-REFACTOR.md` — what to build
- `CURSOR-PROMPTS.md` — how to instruct Cursor
- `XIRA-DESIGN-DEMO.html` — client-approved visual
- `DEPLOY.md` (repo root) — the low-level Hostinger deploy commands (referenced here, don't duplicate)

---

## Stage 0 · Prep the workspace (once, ~30 min)

**On your local machine**

- [ ] Pull latest `main`
  ```bash
  cd C:\xampp\htdocs\einvoice
  git checkout main
  git pull --ff-only
  ```
- [ ] Create the feature branch
  ```bash
  git checkout -b 015-ui-ux-overhaul
  ```
- [ ] Install dependencies
  ```bash
  pnpm install
  ```
- [ ] Verify baseline is green — this is the reference you'll compare against after each phase
  ```bash
  pnpm --filter @einvoice/web lint
  pnpm --filter @einvoice/web typecheck
  pnpm --filter @einvoice/web test
  ```
- [ ] Start local infra + dev servers so you can eyeball changes as Cursor works
  ```bash
  pnpm infra:up          # postgres/redis/minio (mkcert)
  pnpm --filter @einvoice/api dev
  pnpm --filter @einvoice/web dev
  ```
  Open http://localhost:3000, log in with a seeded user, confirm the current UI loads.
- [ ] Open the approved demo in a second browser tab as reference: `specs/015-ui-ux-overhaul/XIRA-DESIGN-DEMO.html`.
- [ ] Take **before** screenshots (ar + en, desktop + mobile) of the 5 most-changed pages: `/login`, `/`, `/documents`, `/documents/[id]`, `/settings`. Save under `specs/015-ui-ux-overhaul/screenshots/before/`.

---

## Stage 1 · Kick off Cursor (10 min)

- [ ] Open Cursor with the `einvoice` folder as the workspace.
- [ ] Confirm the SpecKit skills are available: type `/speckit` in the chat — you should see `speckit-plan`, `speckit-tasks`, `speckit-implement`, etc.
- [ ] Paste **Prompt 0 · Kick-off** from `CURSOR-PROMPTS.md`. Wait for Cursor's summary of the differences and questions.
- [ ] Paste **Prompt 1 · Clarify** and answer the questions it raises. Recommended defaults:
  - Dark mode: ship in P1 (it's just a data-attribute + palette override).
  - Command palette: MVP in P2 (modal with nav destinations only, real search later).
  - Storybook: dev-only page (no extra tooling).
  - Fonts: `next/font/google` (best performance, no external CDN).
- [ ] Paste **Prompt 2 · Plan**. Review the generated `plan.md` — sanity-check the file paths and time estimates.
- [ ] Paste **Prompt 3 · Tasks**. Review `tasks.md`.
- [ ] Paste **Prompt 4 · Analyze**. Fix any constitution conflicts Cursor flags before starting implementation.

---

## Stage 2 · Phase-by-phase execution (2–4 weeks depending on pace)

**For each phase P1 → P15:**

- [ ] Paste the phase-specific prompt from `CURSOR-PROMPTS.md`.
- [ ] Let Cursor work. When it says it's done:
  - [ ] Run the checks locally
    ```bash
    pnpm --filter @einvoice/web lint
    pnpm --filter @einvoice/web typecheck
    pnpm --filter @einvoice/web test
    ```
  - [ ] If any fails, paste **Prompt 12 · Converge** with the exact error output.
- [ ] Manual QA on `http://localhost:3000`:
  - [ ] The pages touched by this phase render without console errors.
  - [ ] Compare side-by-side with the equivalent tab in `XIRA-DESIGN-DEMO.html` — colors, spacing, hover states all match.
  - [ ] Toggle language `ar` ↔ `en` — layout flips correctly, no LTR bleed.
  - [ ] Resize to 375px — nothing overflows, sidebar collapses to drawer.
  - [ ] Toggle dark mode — every element remains legible.
  - [ ] Keyboard-only test: `Tab` through the page, `Escape` closes modals, focus rings visible.
- [ ] Take **after** screenshots (same 4 combinations as before) and save under `specs/015-ui-ux-overhaul/screenshots/after/P<N>/`.
- [ ] Commit
  ```bash
  git add .
  git commit -m "ui(P<N>): <one-line summary>"
  git push origin 015-ui-ux-overhaul
  ```
- [ ] Open a PR titled `ui(P<N>): <summary>`. In the PR description:
  - What changed / What did NOT change (business logic, API, etc. = untouched).
  - Before/after screenshots inline.
  - Test/lint/typecheck output confirmed green.
- [ ] Send the PR link + screenshots to the client (or project owner). Wait for sign-off before moving to the next phase.
- [ ] Merge the PR into `015-ui-ux-overhaul` (squash), delete the sub-branch if you used one.
- [ ] Move to the next phase.

**Recommended review checkpoints with the client:**
- After P2 (Shell) — shape of the app is visible.
- After P5 (Documents) — the most-used screen is done.
- After P8 (Settings) — configuration UX is done.
- After P14 (States) — the app feels finished.

---

## Stage 3 · Final review & merge to main (1 day)

- [ ] Paste **Prompt 13 · Final review** in Cursor. Read the generated `final-report.md`.
- [ ] Run the whole test suite once more from a clean state
  ```bash
  pnpm clean         # if the repo has this; otherwise: rm -rf node_modules && pnpm install
  pnpm install
  pnpm --filter @einvoice/web lint
  pnpm --filter @einvoice/web typecheck
  pnpm --filter @einvoice/web test
  pnpm --filter @einvoice/api test      # sanity check, should be untouched
  ```
- [ ] Build the production bundle locally to catch build-time issues
  ```bash
  pnpm --filter @einvoice/web build
  ```
- [ ] Merge `015-ui-ux-overhaul` → `main` via a squash-merge PR titled `feat(ui): XIRA design system rollout`.
- [ ] Tag the release
  ```bash
  git checkout main
  git pull --ff-only
  git tag -a v1.15.0 -m "XIRA UI/UX rollout"
  git push origin v1.15.0
  ```

---

## Stage 4 · Staging smoke test on the VPS (2–3 hours)

Even though the change is UI-only, a staging pass catches build-time issues that only show up with production env vars (fonts, `NEXT_PUBLIC_API_URL` baking, etc.).

If you have a staging VPS:
- [ ] SSH into staging: `ssh user@staging-vps`
- [ ] Pull + rebuild
  ```bash
  cd /opt/einvoice
  git fetch --tags
  git checkout v1.15.0
  ./scripts/prod-deploy.sh
  ```
- [ ] Wait for Traefik + all services healthy: `docker compose -f docker-compose.prod.yml --env-file .env.prod ps`
- [ ] Smoke-test the staging URLs (Arabic + English, mobile + desktop):
  - [ ] `/login` — hero renders, fonts load, form submits
  - [ ] `/` — dashboard KPIs load, sidebar collapse works
  - [ ] `/documents` — list loads, filters work, bulk actions open confirm dialog
  - [ ] `/documents/<real-uuid>` — detail loads, timeline renders, actions work
  - [ ] `/settings` — hub tiles link correctly
  - [ ] `/settings/eta-credentials` — env badge shows Sandbox, "Test connection" returns success
- [ ] Check the browser console — zero errors, zero React hydration warnings.
- [ ] Check Lighthouse score on `/login` and `/` — Performance ≥ 85, Accessibility = 100.

If you don't have a dedicated staging VPS, run the same smoke test after the production deploy in Stage 5, and be ready to roll back fast.

---

## Stage 5 · Production deploy to Hostinger (30–45 min, low traffic hours)

The project already has a battle-tested deploy pipeline. This stage USES `DEPLOY.md` — read that file for the underlying commands. What follows is the checklist wrapping it.

**Pre-flight**
- [ ] Pick a low-traffic window (weekend early morning in Cairo time is safest).
- [ ] Notify users (email or in-app banner) — expect ~5 min of possible visual flicker while the web container recycles.
- [ ] Confirm the last daily backup exists
  ```bash
  ssh user@erp-esafe.com "ls -lh /opt/einvoice/backups/daily | tail -3"
  ```
- [ ] Have `DEPLOY.md` open in another tab for reference.

**Deploy**
- [ ] SSH into the production VPS
  ```bash
  ssh user@erp-esafe.com
  cd /opt/einvoice
  ```
- [ ] Confirm you're on the intended branch
  ```bash
  git status
  git log -1 --oneline
  ```
- [ ] Merge new env keys if any were added (`.env.prod.example` grew) — this rollout should NOT need any new secrets, but check
  ```bash
  diff .env.prod.example .env.prod | grep -E '^<'
  ```
  If diff shows new `<` lines (keys in example not in prod), add them to `.env.prod` before deploying.
- [ ] Run the one-shot deploy — it backs up first, then pulls, migrates, and rebuilds
  ```bash
  ./scripts/prod-deploy.sh
  ```
  This does:
  1. Timestamped `pg_dump` + MinIO snapshot into `./backups/deploy/` (keeps last 5)
  2. `git pull --ff-only`
  3. Builds the `api` image, runs `prisma migrate deploy` (no schema changes expected for UI-only, but it's safe to run)
  4. Rebuilds `web`, `api`, `worker` and force-recreates them
  5. Prints `docker compose ps` + health-check output

**Verify (do all of these before leaving the terminal)**
- [ ] All containers `Up` and healthy
  ```bash
  docker compose -f docker-compose.prod.yml --env-file .env.prod ps
  ```
- [ ] API health passes
  ```bash
  curl -fsS https://etaapi.erp-esafe.com/health/live
  curl -fsS https://etaapi.erp-esafe.com/health/ready
  ```
- [ ] Web serves HTML
  ```bash
  curl -fsSI https://eta.erp-esafe.com | head
  ```
- [ ] Open `https://eta.erp-esafe.com/login` in an incognito browser:
  - [ ] XIRA hero renders (navy + teal gradient + logo tile)
  - [ ] Fonts load (Inter + IBM Plex Sans Arabic — no fallback flash)
  - [ ] Form submits, redirects to `/` after login
- [ ] Open `/`, `/documents`, `/settings` after login — same smoke test as staging.
- [ ] Watch logs for 5 min for red flags
  ```bash
  docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f --tail=100 web api worker
  ```

---

## Stage 6 · Post-deploy (24h)

- [ ] Keep the deploy backup snapshot named for this release
  ```bash
  ssh user@erp-esafe.com "ls /opt/einvoice/backups/deploy/"
  # Rename the newest folder to something like: v1.15.0-2026-09-15
  ```
- [ ] Copy backups off the VPS (per DEPLOY.md section "Copy backups OFF the server")
  ```bash
  # From your local machine:
  rsync -avz -e ssh user@erp-esafe.com:/opt/einvoice/backups/ ~/einvoice-backups/
  ```
- [ ] Monitor for 24h:
  - [ ] Server error rate (check API `/health/ready` on a schedule).
  - [ ] User reports (email, chat).
  - [ ] Browser console errors from real users — check with a manual visit twice a day.
- [ ] Update `README.md` release notes with the v1.15.0 changes and a link to the design demo.

---

## Rollback — if things break

The refactor is UI-only, so DB and API are untouched — rollback is safe and fast.

- [ ] SSH into the VPS
  ```bash
  ssh user@erp-esafe.com
  cd /opt/einvoice
  git log -1 --oneline
  # Find the last known-good commit BEFORE v1.15.0
  git checkout <previous-good-sha>
  docker compose -f docker-compose.prod.yml --env-file .env.prod build web
  docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --force-recreate web
  ```
- [ ] Verify web is back on the old UI: `curl -fsSI https://eta.erp-esafe.com | head`
- [ ] If for any reason the API changed (shouldn't have), also rebuild `api` and `worker` and restore from `backups/deploy/<pre-deploy-stamp>/postgres.sql.gz` per DEPLOY.md "Restore Postgres".
- [ ] Open a hot-fix branch, reproduce the issue locally, fix, and re-run stages 3 → 5.

---

## Quick reference — commands cheat sheet

```bash
# Local dev
pnpm infra:up
pnpm --filter @einvoice/api dev
pnpm --filter @einvoice/web dev
pnpm --filter @einvoice/web lint && pnpm --filter @einvoice/web typecheck && pnpm --filter @einvoice/web test

# Cursor
/speckit-clarify    /speckit-plan    /speckit-tasks    /speckit-analyze
/speckit-implement  /speckit-converge

# Production (on the VPS)
./scripts/prod-deploy.sh                                       # rebuild + migrate + restart
./scripts/prod-backup.sh --kind daily                          # manual backup
./scripts/prod-restore-postgres.sh backups/daily/<stamp>/postgres.sql.gz
./scripts/prod-reset-password.sh owner@erp-esafe.com

# Logs
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f web api worker traefik
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

---

## Timeline estimate

| Stage | Duration | Blocking? |
|---|---|---|
| 0 · Prep | 30 min | Yes |
| 1 · Cursor kick-off | 30 min | Yes |
| 2 · Phase execution (P1–P15) | 2–4 weeks | Yes — client review gates |
| 3 · Final review + merge | 1 day | Yes |
| 4 · Staging smoke test | 2–3 hours | Optional (recommended) |
| 5 · Production deploy | 30–45 min | Yes |
| 6 · Post-deploy monitor | 24h background | No |

Total wall time: **~3–5 weeks** depending on how fast the client reviews each phase. Actual coding time inside Cursor is far less; the bottleneck is review cycles.
