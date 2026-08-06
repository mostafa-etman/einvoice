# ETA Document Packages (external contract)

**Feature**: `009-bulk-import-export`  
**Base**: `{ETA_API_BASE_URL}` (runtime/env only — never hardcode hosts in source)

Official docs:

- [Request Document Package](https://sdk.invoicing.eta.gov.eg/einvoicingapi/05-request-document-package/)
- [Get Package Requests](https://sdk.invoicing.eta.gov.eg/einvoicingapi/06-get-package-requests/)
- [Get Document Package](https://sdk.invoicing.eta.gov.eg/einvoicingapi/07-get-document-package/)

## Endpoints used by this feature

### Request Document Package

`POST /api/v1.0/documentpackages/requests`

Wire body (as of ETA SDK — casing is significant):

```json
{
  "type": "Full",
  "format": "JSON",
  "queryParameters": {
    "dateFrom": "2026-07-01T00:00:00Z",
    "dateTo": "2026-07-31T23:59:59Z",
    "documentTypeNames": ["I"],
    "statuses": ["Valid"],
    "truncateifexceeded": true
  }
}
```

- `type`: `Full` | `Summary` (PascalCase — lowercase yields `Invalid Package Type`)
- `format`: `JSON` | `XML` | `CSV` (uppercase; CSV only with Summary)
- Filters live under `queryParameters` (flat top-level dates are ignored / rejected)
- `statuses`: `Valid` | `Invalid` | `Rejected` | `Cancelled` (PascalCase)

**Success**: `201` + `{ packageId }` (also accept `requestId`) → store as
`EtaPackageRequest.etaRequestId`.

### Get Package Requests (canonical status)

`GET /api/v1.0/documentpackages/requests?pageNo=&pageSize=`

Find our `etaRequestId` in the list; map ETA `status`:

| ETA status | Local |
|------------|--------|
| 1 | `IN_PROGRESS` |
| 2 | `READY` (then download) |
| 3 | `ERROR` |
| 4 | `DELETED` |

**This API is the source of truth** until ready/failed. Package-ready webhook
only enqueues an immediate poll of this endpoint.

### Get Document Package

`GET /api/v1.0/documentpackages/{rid}`

| HTTP | Meaning |
|------|---------|
| 200 | Zip body → store in MinIO |
| 204 | Not ready — continue polling Get Package Requests |

## Auth

Bearer access token via existing `EtaService` / `etaFetch`. Never log tokens.
Never return ETA tokens to the web client.

## Product API mapping

See [imports-exports-api.yaml](./imports-exports-api.yaml) `POST /exports/packages`
and package job status resources — product APIs wrap the three ETA calls above.
