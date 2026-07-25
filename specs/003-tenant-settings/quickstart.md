# Quickstart Validation: Tenant Settings

**Feature**: `003-tenant-settings` | **Date**: 2026-07-20

Prerequisites: `002-multi-tenant-auth` working (login, tenant, Owner role,
`einvoice_app` RLS role). Contracts: [settings-api.yaml](./contracts/settings-api.yaml),
[permissions.md](./contracts/permissions.md). Data model: [data-model.md](./data-model.md).

## 0. Env

Add to `apps/api/.env` (32-byte key, base64 example — generate your own):

```bash
SECRETS_MASTER_KEY=<base64-32-bytes>
```

Never commit real keys. Fail startup if missing in non-test envs.

## 1. Migrate

```bash
pnpm --filter @einvoice/api prisma:migrate
```

**Expect**: New tables + RLS; `Currency` seed includes EGP/USD/EUR; Branch
columns for ETA codes / default currency / isActive.

## 2. Encryption proof (T027 + unit)

```bash
pnpm --filter @einvoice/api test -- --testPathPattern="ciphertext|secrets-encryption" --runInBand
```

**Expect**: Round-trip encrypt/decrypt; asserting a saved credential row’s
`client_secret_ciphertext` does **not** contain the plaintext secret string.

## 3. Settings UI (manual)

1. Sign in as Owner → open Settings (ar/en).
2. **Branches**: create second branch with `etaBranchCode` + `activityCode`;
   set default currency on branch.
3. **Currencies**: enable USD; set tenant default EGP; add manual USD/EGP rate.
4. **ETA credentials**: save Client ID + Secret; reload — secret shows masked;
   rotate secret; click Test Connection → stub message (no live ETA).
5. **Item codes**: create one EGS and one GS1; reject other types if attempted.

## 4. Isolation (T045)

```bash
pnpm --filter @einvoice/api test -- --testPathPattern="settings-isolation" --runInBand
```

**Expect**: Under tenant A GUC / HTTP context, zero tenant B rows for
`tenant_currencies`, `exchange_rates`, `tenant_eta_credentials`, `item_codes`,
and extended branches.

## 5. RBAC

As Viewer: branch list may work; currency/ETA/item manage endpoints return 403.
As Accountant: currencies/item codes view OK; ETA manage 403.

## Timing

Happy path (branch + currency + credential + item code) under 10 minutes for an
Owner on a seeded tenant.
