# ETA Webhook Callback Contracts

**Feature**: `007-submission-pipeline`  
**Base path**: `/eta-callbacks` (public HTTPS; registered with ETA as ERP base URL)

These endpoints are called **by ETA**, not by our JWT users. Authentication uses
the per-tenant pre-shared **ApiKey** registered with ETA (`Authorization` header).

## Auth

| Header | Description |
|--------|-------------|
| `Authorization` | Pre-shared ApiKey (exact scheme as registered; treat as secret) |
| `Content-Type` | `application/json` |
| `Accept-Language` | `ar` or `en` (optional) |

On missing/invalid key → `401`. Never log the key. PSK stored encrypted at rest
per tenant.

## `PUT /eta-callbacks/ping`

Connectivity check during ERP notification registration ([ETA ERP Ping](https://sdk.invoicing.eta.gov.eg/api/08-erp-ping/)).

**Body**:

```json
{ "rin": "943832043" }
```

**Behavior**:

1. Verify ApiKey → resolve tenant.
2. Verify `rin` matches tenant's registered tax registration number.
3. Return `200` with `{ "rin": "<same>" }`.

## `PUT /eta-callbacks/notifications/documents`

Document lifecycle notifications ([ETA Receive Document Notifications](https://sdk.invoicing.eta.gov.eg/einvoicingapi/14-receive-document-notifications/)).

**Body (illustrative)**:

```json
{
  "deliveryId": "unique-delivery-id",
  "type": "document-validated",
  "uuid": "F9D425P6DS7D8IU",
  "submissionUUID": "JU7GH07JNA23N",
  "longId": "...",
  "internalId": "PZ-234-A",
  "status": "Valid"
}
```

`type` includes at least: `document-validated`, `document-received`,
`document-rejected`, `document-cancelled`.

**Behavior**:

1. Verify ApiKey + tenant.
2. Upsert `AuthorityNotification` by `(tenantId, deliveryId)` — duplicates are
   no-ops (idempotent).
3. Enqueue **immediate poll** for `uuid` / `submissionUUID` (do **not** set
   local `VALID`/`INVALID` from the webhook alone).
4. Return `200` quickly.

## `PUT /eta-callbacks/notifications/documentpackages`

Package ready ([ETA Download Ready Notification](https://sdk.invoicing.eta.gov.eg/einvoicingapi/15-receive-download-ready-notification/)).

**Body (illustrative)**:

```json
{
  "deliveryId": "unique-delivery-id",
  "type": "document-package-ready",
  "packageId": "Q932847883HDH"
}
```

**Behavior**: Persist notification; optionally enqueue package download job;
return `200`.

## Security notes

- Endpoints must be reachable from ETA over the public Internet with a globally
  trusted TLS certificate (local tunnels for sandbox registration).
- Rate-limit by ApiKey; reject oversized bodies.
- Audit every received notification (verified / rejected).
