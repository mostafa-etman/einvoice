# Research: Purchases (Received Documents)

**Feature**: `008-purchases-received` | **Date**: 2026-07-31

Resolves Technical Context unknowns and encodes the user plan:
Search/Recent clients, sync + classify, Accept/Reject/Decline via Phase 6 ETA
endpoints, web Purchases, sandbox integration tests.

---

## R1 — Where Search / Recent “clients” live

**Decision**:
1. **HTTP clients** in `apps/api/src/eta/` (`EtaDocumentsSearchClient`,
   `EtaDocumentsRecentClient`, plus details client) using `etaFetch` +
   `EtaService.getAccessToken` — same pattern as `EtaSubmitClient` /
   `EtaItemCodesClient`.
2. **Classification + direction constants** in `@einvoice/eta-core`
   (`classifyReceivedDocument`, `ETA_DOCUMENT_DIRECTION_RECEIVED`, purchase
   kind enum helpers).

**Rationale**: Live ETA HTTP in this repo always sits next to Nest auth/token
caching. Putting raw `fetch` clients in `eta-core` would either duplicate
auth or drag Nest concerns into a serialization package. The user’s
“eta-core: SearchDocuments/RecentDocuments clients” intent is met by making
eta-core the **canonical place for received semantics** (direction filter,
type→purchase classification) while Nest owns transport.

**Alternatives considered**: Pure HTTP clients inside `eta-core` with
`getToken` callback (possible later extract); OpenAPI codegen (overkill for
MVP).

---

## R2 — ETA Search & Recent paths

**Decision**:
- **SearchDocuments**: `GET {ETA_API_BASE_URL}/api/v1.0/documents/search`
  with query `direction=Received` (and date / status / type / pageSize /
  continuationToken as ETA documents).
- **GetRecentDocuments**: `GET .../api/v1.0/documents/recent` with
  `direction=Received` (+ pageNo/pageSize).
- Sync pipeline calls **both**, merges by uuid, upserts once.
- Prefer Search for backfill windows; Recent for “what’s new” when Search
  windowing is awkward. ETA may mark Recent obsolete — still call it when
  configured/`PURCHASES_SYNC_USE_RECENT=1` (default on for v1 per spec).

**Rationale**: Spec FR-001 + user plan; direction received only (FR-020).

**Alternatives considered**: Search-only (violates explicit dual-pull
requirement); hardcoding absolute hostnames (constitution V).

---

## R3 — Dedupe / upsert identity

**Decision**: Unique `(tenantId, documentUuid)`. Missing uuid → do not insert;
increment sync `skipped`/`failed` counter with reason `MISSING_UUID`. Updates
refresh metadata, raw snapshot, status, and details when present.

**Rationale**: Spec clarification 2026-07-31.

**Alternatives considered**: Composite internalId+issuer (fragile across
issuers); longId-only (not always present on list endpoints).

---

## R4 — Classification

**Decision** (in eta-core):

| ETA document type code | Purchase classification |
|------------------------|-------------------------|
| `I` (Invoice)          | `PURCHASE_INVOICE`      |
| `C` (Credit Note)      | `PURCHASE_RETURN`       |
| Other (`D`, export, …) | `OTHER_RECEIVED`        |

Export invoice/credit variants map to OTHER unless product later expands.
List UI defaults to purchase invoice + purchase return only.

**Rationale**: Spec FR-002; testable pure function for unit + sandbox assert.

**Alternatives considered**: Infer from Arabic labels (unstable).

---

## R5 — Sync orchestration (cron + Sync now)

**Decision**: Mirror `ItemCodesSyncService`:
- `ReceivedDocumentSyncRun` row (PENDING/RUNNING/SUCCEEDED/FAILED) with
  counters.
- In-memory + DB in-flight guard per tenant (409 if busy).
- **Sync now** → `POST /purchases/sync`.
- **Cron** → Nest `@Cron` (or BullMQ repeatable) iterating tenants with valid
  ETA credentials; env `PURCHASES_SYNC_CRON` (default `*/15 * * * *`) and
  `PURCHASES_SYNC_ENABLED`.
- After list hits, optionally call **Get Document Details** for new uuids to
  populate lines/taxes/full payload; store printout **URL/path capability**
  (uuid sufficient to call PDF later) as `printoutAvailable` / last printout
  artifact link when fetched.

**Rationale**: Spec FR-013; proven sync UX in item-codes; BullMQ workers are
still stubs — ScheduleModule is enough for v1.

**Alternatives considered**: BullMQ-only cron (premature until queue module
lands); single global sync (breaks tenant isolation).

---

## R6 — Accept / Reject / Decline (reuse Phase 6 ETA endpoints)

**Decision** — implement shared clients planned in 007 research R8/R9:

| Product action | Actor | ETA call | Local effect |
|----------------|-------|----------|--------------|
| **Accept** | Buyer (us as receiver) | **No dedicated Accept API** | Set `buyerDecision=ACCEPTED`; audit. Optionally call **Decline cancellation** if a seller cancel is pending (`PUT .../documents/state/{uuid}/decline/cancelation`) when ETA status requires it |
| **Reject** | Buyer | `PUT /api/v1.0/documents/state/{uuid}/state` body `{ status: "rejected", reason }` | `buyerDecision=REJECTED`; store reason; map ETA errors to needsAttention |
| **Decline** | Context-dependent | `PUT .../decline/cancelation` (receiver declines issuer cancel) and/or `PUT .../decline/rejection` (issuer declines buyer reject — mainly for **issued** docs) | For Purchases UI: expose **Decline cancellation** when received doc shows pending cancel; issuer decline-rejection is available on the shared client for 007 later |

Shared module: `EtaDocumentLifecycleClient` in `apps/api/src/eta/` used by
Purchases now and by issuer cancel/reject routes when 007 US6 is implemented.
Do **not** invent a separate ETA base path for Purchases.

**Rationale**: User plan “reusing Phase 6 endpoints”; ETA SDK has no Accept
Document; 007 deferred receiver actions here.

**Alternatives considered**: Accept as silent no-op without status (poor UX);
implementing only Reject (fails Accept story).

---

## R7 — PDF printout

**Decision**: `EtaPrintoutClient.getPdf(uuid)` →
`GET /api/v1.0/documents/{uuid}/pdf`. Cache in MinIO under
`tenants/{tenantId}/printouts/received/{documentUuid}.pdf`. Link via
`DocumentArtifact` with `receivedDocumentId` (new optional FK) or `etaUuid`
when `documentId` (issued) is null. App:
`GET /purchases/{id}/printout`. Eligible when uuid present (and ETA returns
PDF); surface clear error otherwise.

**Rationale**: 007 R9; spec US3; artifact table already optional `documentId`.

**Alternatives considered**: Always stream from ETA (rate limits); store only
URL string without bytes (ETA URLs are not durable public links).

---

## R8 — Data model vs issued `Document`

**Decision**: New tenant-scoped **`ReceivedDocument`** aggregate (see
data-model.md). Issued `Document` unchanged. Reserved
`purchaseOrderLinkId` (nullable uuid, no FK to PO table yet) + optional
`reconciliationExternalRef` text for future PO matching hooks.

**Rationale**: Spec clarification; avoids contaminating sign/submit lifecycle.

**Alternatives considered**: `direction` column on `Document` (rejected —
status/signing pollution).

---

## R9 — Permissions

**Decision**: Reuse **`documents.view`** / **`documents.manage`** for Purchases
list/detail/sync/accept/reject/PDF (same as 007 R10). Viewer: list/detail/PDF
download only; Accountant/Admin/Owner: manage actions. Document in
`contracts/permissions.md` that manage includes purchases buyer actions.
Defer dedicated `purchases.*` until product asks for separation.

**Rationale**: Avoid role-matrix churn; FR-016 still satisfied via view vs
manage.

**Alternatives considered**: Immediate `purchases.view|manage` (extra seed
migration for little gain).

---

## R10 — Reconciliation vs PO matching

**Decision**: Ship statuses `PENDING_REVIEW` | `RECONCILED` | `DISPUTED` +
note. **No** PO list, match API, or auto-matcher. Keep nullable PO link hook
(R8).

**Rationale**: Spec clarification 2026-07-31.

---

## R11 — Sandbox integration tests

**Decision**: Gate with `ETA_SANDBOX_INTEGRATION=1` (same convention as 007).
Test:
1. Authenticate with tenant sandbox creds.
2. Run sync (or client search with `direction=Received`).
3. Assert each stored row has uuid; classification matches type code;
   no duplicates on second sync.
4. Optional: reject/accept against a disposable received doc when sandbox
   data allows (skip if none).

**Rationale**: User plan; constitution VI.

**Alternatives considered**: Mock-only (insufficient for ETA contract drift).

---

## R12 — Web module

**Decision**: Routes under `apps/web/src/app/[locale]/(app)/purchases/` with
nav entry; filters date/branch/type/status/reconciliation; detail with
accept/reject (reason modal), Sync now on list, PDF button; ar/en messages;
reuse existing field/table patterns from documents list.

**Rationale**: Spec US1–US4; constitution VII.

---

## Open items deferred to `/speckit-tasks` (not blocking plan)

- Exact ETA search query param casing (`Received` vs `received`) — verify
  against sandbox in first implement task; wrap in client constants.
- Whether Get Document Details is mandatory on first sight vs lazy on detail
  open — default: fetch details for **new** uuids during sync; refresh on
  detail open if lines empty.
- Cron host: API replica vs dedicated worker — default API process Schedule.
