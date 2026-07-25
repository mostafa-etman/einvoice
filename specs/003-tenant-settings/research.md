# Research: Tenant Settings

**Feature**: `003-tenant-settings` | **Date**: 2026-07-20

## R1 — Libsodium: sealed box vs ciphertext + nonce

**Decision**: Use libsodium **secretbox / XSalsa20-Poly1305** (or
XChaCha20-Poly1305 AEAD) with a **32-byte master key** from config and a
**random nonce stored beside ciphertext**. Decrypt only in memory inside the
API process when Test Connection (future) or outbound ETA calls need plaintext.

**Rationale**: Clarification named “sealed boxes” and “master key from
env/KMS”. Sealed boxes (`crypto_box_seal`) encrypt to a *public* key and embed
ephemeral key material in the blob—they do **not** naturally produce a separate
nonce column. The implementation plan explicitly requires **ciphertext +
nonce**, which matches **symmetric secretbox/AEAD** under a server master key.
This still satisfies: libsodium, env/KMS master key, never log secrets, decrypt
only when needed.

**Alternatives considered**:

| Option | Rejected because |
|--------|------------------|
| `crypto_box_seal` only | No separate nonce; awkward with single master key (need derived keypair) |
| App-level AES via Node `crypto` only | Spec/clarification prefers libsodium; sodium APIs are battle-tested for this pattern |
| Envelope encryption per tenant key | Better long-term; out of scope for MVP complexity |

**Operational note**: Document in env that `SECRETS_MASTER_KEY` is 32 raw bytes
(base64). KMS: later wrap/unwrap that key; service interface stays
`encrypt(plain) → {ciphertext, nonce}` / `decrypt(...)`.

---

## R2 — Prisma model naming vs catalog

**Decision**:

| Spec / plan name | Prisma model | Notes |
|------------------|--------------|-------|
| Branch (extended) | `Branch` | Add fields; keep existing table |
| Currency | `Currency` | **Global** ISO catalog (code PK); not tenant-scoped |
| Tenant enabled + default | `TenantCurrency` | tenantId + currencyCode + isDefault |
| ExchangeRate | `ExchangeRate` | tenant-scoped; source `manual` |
| TenantEtaCredential | `TenantEtaCredential` | tenant-scoped; optional `branchId` null = tenant default |
| ItemCode | `ItemCode` | tenant-scoped; type enum EGS \| GS1 |

**Rationale**: A global `Currency` catalog avoids duplicating ISO metadata per
tenant; `TenantCurrency` captures enablement/default (implied by FR-003).
Credentials use one table with nullable `branchId` instead of two tables.

**Alternatives**: Single `Currency` model with `tenantId` only — rejected
(harder to share catalog + translations).

---

## R3 — Provider adapter for FX rates

**Decision**: Define `ExchangeRateProvider` TypeScript interface in API
(`fetchRates(pair, asOf): Promise<RateQuote | null>`) with a `NoopExchangeRateProvider`
registered by default. Manual CRUD writes `source: MANUAL` rows. No HTTP
provider in this feature.

**Rationale**: Spec FR-006 — interface now, implementation later.

---

## R4 — Validation library

**Decision**: Validate request bodies with **zod** (already used in `apps/api`
env and web forms). Nest pipes: thin zod pipe or parse in services. Do **not**
introduce class-validator for this feature unless already present.

**Rationale**: Consistency with existing codebase; user’s “zod/class-validator”
satisfied by zod.

---

## R5 — RBAC permission codes

**Decision**: Extend `@einvoice/shared` permissions:

- `settings.branches.manage` (or reuse `branches.manage` / `branches.view`)
- `settings.currencies.view` / `settings.currencies.manage`
- `settings.eta.view` / `settings.eta.manage`
- `settings.item_codes.view` / `settings.item_codes.manage`

Reuse existing `branches.view` / `branches.manage` for branch CRUD to avoid
duplicate grants; add the settings.* codes for currencies, ETA, item codes.
Update `ROLE_PERMISSION_MATRIX` (Owner all; Admin manage+view; Accountant view
currencies/item codes; Viewer branches view only — no ETA secrets).

**Rationale**: Least privilege; ETA manage is sensitive.

---

## R6 — Test Connection stub

**Decision**: `POST /settings/eta-credentials/test-connection` checks required
fields exist (after decrypt in memory only for future live call). Returns
`{ status: 'stub', message: 'Live ETA auth deferred to Phase 3' }` without
network I/O to ETA. Never returns decrypted secret.

**Rationale**: Spec FR-010 + sandbox-first.

---

## R7 — Masking & rotate semantics

**Decision**: GET credentials returns `clientSecretMasked: "••••••••"` (or last
4 only if product prefers — default full mask) and `hasClientSecret: boolean`.
`PATCH` with omitted/empty secret = keep. `POST .../rotate-secret` body
`{ clientSecret: string }` required. Audit: `eta.credentials.rotated`.

**Rationale**: Spec clarifications.
