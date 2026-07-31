# ETA static code tables (offline seed)

These files are **verbatim downloads** from the official Egyptian Tax Authority
eInvoicing SDK portal. They do **not** require ETA API credentials.

**Source index:** https://sdk.invoicing.eta.gov.eg/files/  
**Downloaded:** 2026-07-25 (files dated 22-Feb-2026 on the portal)

| File | Catalog | Official page / notes |
|------|---------|------------------------|
| `TaxTypes.json` | Taxable tax types T1–T12 | https://sdk.invoicing.eta.gov.eg/codes/tax-types/ |
| `NonTaxableTaxTypes.json` | Non-taxable types T13–T20 | same page |
| `TaxSubtypes.json` | Tax subtypes (V001, Tbl01, W001, …) with `TaxtypeReference` | same page |
| `UnitTypes.json` | Unit of measure codes | https://sdk.invoicing.eta.gov.eg/codes/unit-types/ |
| `WeightUnitTypes.json` | Weight unit codes (export lines) | https://sdk.invoicing.eta.gov.eg/codes/ |
| `CurrencyCodes.json` | ISO currency codes | https://sdk.invoicing.eta.gov.eg/codes/ |
| `CountryCodes.json` | ISO country codes (addresses) | https://sdk.invoicing.eta.gov.eg/codes/ |
| `ActivityCodes.json` | Taxpayer activity codes | https://sdk.invoicing.eta.gov.eg/codes/ |
| `ReturnWithNoReferenceReasonTypes.json` | Return-without-reference reasons (receipts) | https://sdk.invoicing.eta.gov.eg/codes/ |
| `static-enums.json` | Receiver types `B`/`P`/`F`, item types `EGS`/`GS1`, document type codes | Derived from document structure pages (not a downloadable JSON on `/files/`) |

## Governorates

ETA does **not** publish a governorate code table. Per Invoice v1.0,
`address.governate` is a **free-text** field (example: `Giza Governorate`).
Do not invent governorate codes. Country codes come from `CountryCodes.json`.

## Re-download / refresh

```powershell
# Offline-safe refresh from the public SDK files host (no credentials):
pnpm --filter @einvoice/api eta:codes:refresh-sdk
```

Authenticated ETA APIs are used later for **EGS/GS1 published item codes**
(`GET /api/v1.0/codetypes/{GS1|EGS}/codes`) and document-type catalogs — not for
these static tables.

## Integrity

Do not hand-edit these JSON files. If ETA updates a file, re-download from
`/files/` and re-run `pnpm db:seed` (or the refresh script). The seed stores a
content hash per catalog so drift can be detected.
