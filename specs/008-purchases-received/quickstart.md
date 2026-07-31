# Quickstart: Purchases (Received Documents)

**Feature**: `008-purchases-received`  
**Purpose**: Validate sync, classification, buyer actions, and Purchases UI
against ETA sandbox after implementation.

## Prerequisites

- Compose stack up (Postgres, Redis, MinIO, API, web)
- Tenant with **sandbox/preprod** ETA credentials configured
- User with `documents.manage` (Owner / Admin / Accountant)
- Optional: `ETA_SANDBOX_INTEGRATION=1` for automated pull tests
- At least one **received** invoice or credit note visible to that ETA
  registration in sandbox (or accept empty sync success)

## 1. Classification unit check

```bash
pnpm --filter @einvoice/eta-core test -- received-classify
```

Expect: `I` → `PURCHASE_INVOICE`, `C` → `PURCHASE_RETURN`, other → `OTHER_RECEIVED`.

## 2. Manual Sync now

1. Open `/en/purchases` (and `/ar/purchases` for RTL smoke).
2. Click **Sync now**.
3. Expect 202 sync run; UI shows fetched / new / updated / skipped counts.
4. Re-run Sync now → **zero new duplicates** for same uuid (updated/skipped only).

API equivalent:

```http
POST /purchases/sync
Authorization: Bearer <token>
X-Tenant-Id: <tenantUuid>
```

```http
GET /purchases/sync/latest
```

## 3. List + filters

```http
GET /purchases?kind=PURCHASE_INVOICE&from=2026-01-01T00:00:00Z
```

Expect only purchase invoices in range; credit notes when
`kind=PURCHASE_RETURN`.

## 4. Detail + accept / reject

1. Open a purchase detail.
2. **Accept** → `buyerDecision=ACCEPTED` (audit row present).
3. On another eligible doc, **Reject** with reason → ETA state reject via shared
   Phase 6 client; local `REJECTED`.
4. Repeat accept/reject on terminal doc → **409**.

## 5. Printout

```http
GET /purchases/{id}/printout
```

Expect `application/pdf` when ETA returns printout; second call served from
MinIO cache when artifact exists.

## 6. Sandbox integration (gated)

```bash
cd apps/api
# Requires sandbox creds in env / DB for the test tenant
ETA_SANDBOX_INTEGRATION=1 pnpm test -- purchases.sandbox
```

Expect:

- Search/Recent with `direction=Received` succeed (or skip cleanly if ETA
  unreachable — fail only on classification/dedupe bugs when data present).
- Stored rows have `documentUuid`.
- Second sync does not create duplicate uuids.
- Classifier matches `etaDocumentType`.

## 7. Isolation smoke

As tenant B, `GET /purchases/{idA}` → 404. Sync for B must not write into A.

## 8. Out of scope checks

- No PO matching UI or required PO field on reconcile.
- `purchaseOrderLinkId` remains null unless explicitly set by a future API.
- Issued Documents module still has no receiver accept/reject (007 FR-043).

## References

- API contract: [contracts/purchases-api.yaml](./contracts/purchases-api.yaml)
- Data model: [data-model.md](./data-model.md)
- Research: [research.md](./research.md)
