# Implementation Plan: Tenant Settings

**Branch**: `003-tenant-settings` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-tenant-settings/spec.md` plus
technical direction: Prisma models (Branch extensions, Currency, ExchangeRate,
TenantEtaCredential, ItemCode); libsodium encryption service (ciphertext +
nonce, master key from config); CRUD APIs with RBAC + tenant scoping + zod;
web settings screens with masked secrets and Test Connection stub; tests for
ciphertext-at-rest and cross-tenant CRUD isolation.

## Summary

Extend the multi-tenant platform with a **Settings** domain: richer branches
(ETA branch/activity codes, default currency), multi-currency + manual exchange
rates (provider **adapter interface** only), **TenantEtaCredential** (and
optional branch-scoped rows) with Client Secret encrypted via libsodium
(ciphertext + nonce; master key from env/KMS), and local **ItemCode** catalog
(EGS|GS1). NestJS modules expose CRUD under `X-Tenant-Id` + permission guards;
Next.js settings screens (ar/en) wire TanStack Query + RHF/zod; Test Connection
is a stub reserved for Phase 3 live ETA. Mandatory tests: DB stores ciphertext
not plaintext; tenant A cannot read tenant B settings rows.

## Technical Context

**Language/Version**: TypeScript 5.x (NestJS 10 + Next.js 15)

**Primary Dependencies**: NestJS, Prisma, `libsodium-wrappers` (or
`@noble/ciphers` only if sodium unavailable — prefer libsodium); zod validation;
existing JWT/RBAC/`TenantPrismaService`; Next.js 15, next-intl, TanStack Query,
react-hook-form + zod, Tailwind design tokens

**Storage**: PostgreSQL 16 via Prisma; FORCE RLS on new tenant-scoped tables;
secrets as `BYTEA` ciphertext + `BYTEA` nonce columns; master key via
`SECRETS_MASTER_KEY` (env) with KMS-ready abstraction later

**Testing**: Jest — encryption unit tests (round-trip, never log plaintext);
integration — ciphertext persisted; tenant isolation for Branch/Currency/
ExchangeRate/TenantEtaCredential/ItemCode; API permission deny tests; web smoke
for settings routes + masked secret field

**Target Platform**: Existing Compose Postgres + host `api`/`web` + Traefik TLS

**Project Type**: Multi-tenant SaaS (API + web); agent out of scope

**Performance Goals**: Settings list endpoints p95 < 500ms for ≤500 rows/tenant
locally; encrypt/decrypt of one secret < 5ms in-process

**Constraints**: Decrypt only in memory when needed; never return/log plaintext
secret; masked UI + rotate; manual rates only; EGS|GS1 only; Test Connection
non-live; Arabic/English settings copy

**Scale/Scope**: Per-tenant settings MVP; no live FX provider; no live ETA auth
or code sync

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Reliability & Audit**: PASS — acceptance scenarios; audit on
  branch/currency/rate/credential/item mutations (no secret payloads)
- **II. Security by Default**: PASS — libsodium encryption at rest; master key
  from env/KMS; masked UI; rotate; no secrets in git/logs/clients
- **III. Multi-Tenant Isolation**: PASS — `tenantId` + RLS + `withTenant` /
  `SET LOCAL`; isolation tests required
- **IV. Serialization Parity**: N/A — no signing
- **V. Runtime ETA Config**: PASS — credentials/taxpayer fields are runtime
  tenant/branch config; Test Connection stub only
- **VI. Sandbox-First**: PASS — no production ETA calls; stub documents Phase 3
- **VII. UX/i18n**: PASS — settings under shell; ar/en + RTL
- **VIII. Phased Full-Stack DoD**: PASS — API + web + tests; agent N/A
- **Stack**: PASS — within baseline (+ explicit libsodium dependency)

### Post-Design Re-check (Phase 1)

Gates remain PASS/N/A. Data model stores ciphertext+nonce; contracts never
expose plaintext secrets; RLS listed for all new tenant tables; provider adapter
is interface-only. No unjustified violations.

## Project Structure

### Documentation (this feature)

```text
specs/003-tenant-settings/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── settings-api.yaml
│   └── permissions.md
└── tasks.md                 # /speckit-tasks (later)
```

### Source Code (repository root)

```text
apps/api/
├── prisma/
│   ├── schema.prisma              # Branch+; Currency; ExchangeRate;
│   │                              # TenantEtaCredential; ItemCode
│   └── migrations/                # schema + RLS policies
├── src/
│   ├── crypto/                    # SecretsEncryptionService (libsodium)
│   ├── settings/
│   │   ├── branches/              # extend list/CRUD
│   │   ├── currencies/
│   │   ├── exchange-rates/
│   │   ├── eta-credentials/
│   │   └── item-codes/
│   ├── config/env.ts              # SECRETS_MASTER_KEY (+ optional KMS later)
│   └── ...                        # existing auth/tenant/rbac/audit
└── test/
    ├── encryption.ciphertext.spec.ts
    ├── settings-isolation.integration.spec.ts
    └── settings.*.spec.ts

apps/web/
├── src/app/[locale]/(app)/settings/
│   ├── page.tsx                   # settings hub
│   ├── branches/page.tsx
│   ├── currencies/page.tsx
│   ├── eta-credentials/page.tsx
│   └── item-codes/page.tsx
├── src/lib/api/                   # branches, currencies, rates, eta, items
└── src/messages/{ar,en}.json      # settings copy

packages/shared/
└── src/permissions.ts             # settings.* permission codes + matrix
```

**Structure Decision**: Extend `apps/api` / `apps/web` / `packages/shared`. No
new packages. Agent untouched.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | No constitution violations requiring justification |
