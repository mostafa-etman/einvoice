# ETA eReceipt (B2C) requirements — spec + implementation plan

**Status**: spec only (no model / signing / submission code in this pass).  
**Date**: 2026-09-18  
**SDK last update shown on homepage**: 08-12-2022 (document type pages were still served as of this review).  
**Hard constraint**: do **not** change the existing e-Invoice signing / canonical / digest path.

Official sources (fetched):

| Topic | URL |
| --- | --- |
| SDK home | https://sdk.invoicing.eta.gov.eg/ |
| Getting started | https://sdk.invoicing.eta.gov.eg/start/ |
| Receipt v1.2 (use this; v1.0 retired) | https://sdk.invoicing.eta.gov.eg/documents/receipt-v1-2/ |
| Return Receipt v1.2 | https://sdk.invoicing.eta.gov.eg/documents/return-receipt-v1-2/ |
| Retail Receipt v1.2 | https://sdk.invoicing.eta.gov.eg/documents/retail-receipt-v1-2/ |
| Receipt issuance FAQ | https://sdk.invoicing.eta.gov.eg/receiptissuancefaq/ |
| Authenticate POS | https://sdk.invoicing.eta.gov.eg/ereceiptapi/01-authenticate-pos/ |
| Submit receipts | https://sdk.invoicing.eta.gov.eg/ereceiptapi/02-submit-receipt/ |
| Get receipt details | https://sdk.invoicing.eta.gov.eg/ereceiptapi/03-get-receipt-details/ |
| Get receipt submission | https://sdk.invoicing.eta.gov.eg/ereceiptapi/06-get-receipt-submission/ |
| Receipt batch signature | https://sdk.invoicing.eta.gov.eg/receipt-batch-signature-creation/ |
| Document serialization | https://sdk.invoicing.eta.gov.eg/document-serialization-approach/ |
| Branch ID (portal, not API) | https://sdk.invoicing.eta.gov.eg/codes/branch/ |
| Payment methods | https://sdk.invoicing.eta.gov.eg/codes/payment-methods/ |
| ERP (invoice) login | https://sdk.invoicing.eta.gov.eg/api/01-login-as-taxpayer-system/ |

There is **no SDK API to register a branch or a POS device**. Both are created on the taxpayer profile in the ETA portal; we store the resulting codes/credentials and send them on every receipt.

---

## 1. What we already support (e-Invoice) vs what eReceipt is

We already issue **B2B e-Invoices** (`I` / `C` / `D` / export variants) via:

- `packages/eta-core` document builder (`issuer` + `receiver` + `invoiceLines`)
- per-document canonical serialize → SHA-256 → detached CAdES-BES (eSeal)
- `POST /api/v1.0/documentsubmissions/`
- OAuth `client_credentials` with **only** `client_id` / `client_secret` (Basic auth)
- `Branch.etaBranchCode` mapped to **invoice** `issuer.address.branchId`
- account-pooled **branch quota** and **signing-device quota** (`QuotaService`)

eReceipt is a **separate document family** (B2C). Same tax authority, same identity host, **different JSON shape, different identity fields, different digest root, different submit URL, extra POS auth headers**.

Taxpayer prerequisite (ETA, not us): the issuer must have the **B2C tag** on their ETA profile. Without it, receipt submit is rejected.

**Recommended first receipt types** (v1.0 of receipt/retail is retired):

| Kind | `receiptType` | `typeVersion` | When |
| --- | --- | --- | --- |
| Sale receipt | `s` | `1.2` | General B2C sale |
| Return receipt | `r` | `1.2` | Return of a captured sale (`referenceUUID` required) |
| Retail sale | `SR` | `1.2` | Retail activity; `orderdeliveryMode` **mandatory** |
| Return without reference | (see SDK type) | `1.2` | International / uncaptured original; `documentUseReason` |

Activity code on the taxpayer/branch determines which receipt types ETA will accept. Do not assume every tenant can send `s`; some activities require `SR` or a specialized type (utilities, education, …). Specialized types exist in the SDK (`utilities-receipt-v1-2`, `education-receipt-v1-2`, …) and are out of scope for the first slice.

---

## 2. eReceipt document structure (v1.2) and how it differs from our invoice

JSON root of a **single receipt** (not the HTTP body) is one object with these groups. ETA’s HTML tables say “header / documentType / …” — the JSON uses nested objects with those names.

### 2.1 Header (receipt-only)

| Field | Req | Format | Invoice equivalent today |
| --- | --- | --- | --- |
| `dateTimeIssued` | M | UTC ISO (`2022-02-03T00:00:00Z`) | `dateTimeIssued` (exists) |
| `receiptNumber` | M | String(50), unique **per branch within the same submission** | `internalID` — **not the same rule** (see §8) |
| `uuid` | M | 64-char hex SHA-256 of **this receipt** (uuid itself empty while hashing) | Invoice UUID is **assigned by ETA after accept**, not taxpayer-generated |
| `previousUUID` | M | 64-char hex of the **previous receipt from the same POS**; `""` only for that POS’s first receipt | **No invoice equivalent** — POS chain |
| `referenceOldUUID` | O | Prior invalid uuid when correcting and resubmitting | Invoice has no `referenceOldUUID`; credit notes use `references[]` |
| `referenceUUID` | M on returns | UUID of the original sale receipt | Credit note `references` |
| `currency` | M | ISO 4217, 3 chars | Document `currencyCode` / line `unitValue` |
| `exchangeRate` | M if not EGP | Decimal | Line-level FX on invoices; receipt is header-level |
| `sOrderNameCode` | O | String(200) | `salesOrderReference` (different name) |
| `orderdeliveryMode` | O on `s`; **M on `SR`** | Code table | No invoice equivalent |
| `grossWeight` / `netWeight` | O | kg | Invoice line weight fields |

### 2.2 Document type

| Receipt | Invoice |
| --- | --- |
| Object: `{ receiptType: "s"\|"r"\|"SR"\|…, typeVersion: "1.2" }` | Flat: `documentType: "I"`, `documentTypeVersion: "1.0"` |

### 2.3 Seller vs our invoice `issuer`

Receipts use **`seller`**, not `issuer`. Identity is flattened onto the seller; branch + POS serial live here.

| Receipt `seller.*` | Req | Invoice `issuer.*` today | Our store |
| --- | --- | --- | --- |
| `rin` | M | `issuer.id` | `TenantEtaCredential.registrationNumber` |
| `companyTradeName` | M | `issuer.name` | `Tenant.legalName` (not branch name) |
| `branchCode` | M | `issuer.address.branchId` | `Branch.etaBranchCode` |
| `branchAddress` | M | `issuer.address` (minus `branchId`) | `Branch.address*` columns |
| `deviceSerialNumber` | M | **does not exist** | **missing** — POS identity |
| `activityCode` | M | `taxpayerActivityCode` (document root) | `Branch.activityCode` falling back to credential |
| `syndicateLicenseNumber` | O | **does not exist** | **missing** |

`issuer.type` (`B`/`P`/`F`) is **not** a seller field on receipts. Buyer type is `buyer.type`.

### 2.4 Buyer vs our invoice `receiver`

| Receipt `buyer.*` | Req | Invoice `receiver.*` |
| --- | --- | --- |
| `type` | M | `receiver.type` (`B`/`P`/`F`) |
| `id` | Conditional | Usually required for invoices |
| `name` | Conditional | Usually required |
| `mobileNumber` | O | Not on invoice receiver |
| `paymentNumber` | O | Not on invoice receiver |
| *(no address)* | — | Invoice receiver **requires** an address object |

Buyer `id`/`name` become mandatory when:

- `type = B`, or
- `type = P` and `totalAmount` ≥ **150000 EGP** (v1.2+; older 1.0–1.1 used 50000).

Anonymous walk-in (`P` under the threshold) is valid. That is the main B2C difference.

### 2.5 Lines (`itemData`) vs `invoiceLines`

Same GS1/EGS coding, unit types, and tax types. Shape differs:

| Receipt line | Invoice line |
| --- | --- |
| `unitPrice` (scalar) | `unitValue: { currencySold, amountEGP, amountSold?, currencyExchangeRate? }` |
| `netSale` / `totalSale` / `total` | `netTotal` / `salesTotal` / `total` |
| `internalCode` **mandatory** | `internalCode` optional |
| `commercialDiscountData[]` / `itemDiscountData[]` as `{ amount, description, rate? }` | Single `discount: { rate, amount }` plus scalar `itemsDiscount` |
| `additionalCommercialDiscount` / `additionalItemDiscount` (v1.2) | No equivalent |
| No `totalTaxableFees` on the receipt line | `totalTaxableFees` present |

Max **300** lines per receipt (ETA FAQ). Average assumed 10.

### 2.6 Totals / taxes / extras

| Receipt | Invoice |
| --- | --- |
| `totalSales`, `netAmount`, `totalAmount` | Same idea, different field names (`totalSalesAmount`, …) |
| `totalCommercialDiscount`, `totalItemsDiscount` | `totalDiscountAmount`, `totalItemsDiscountAmount` |
| `extraReceiptDiscountData[]` of `{ amount, description, rate? }` | Scalar `extraDiscountAmount` |
| `taxTotals[]` of `{ taxType, amount }` | Same |
| **`paymentMethod` mandatory** (`C` Cash, `V` Visa, `CC`, `VC`, `VO`, `PR`, `GC`, `P`, `O`) | Optional `payment` object, different shape |
| `feesAmount` / `adjustment` — **must be 0** on v1.2 (reserved) | N/A |
| Optional `contractor` / `beneficiary` (medical split-pay) | N/A |

### 2.7 HTTP body (this is the signing unit)

```json
{
  "receipts": [ { /* receipt 1 */ }, { /* receipt 2 */ } ],
  "signatures": [
    { "signatureType": "I", "value": "<Base64 CAdES-BES>" }
  ]
}
```

Invoice submit is `{ "documents": [ { …invoice, signatures: [...] }, … ] }` — **signature lives on each invoice**. Receipt **signature lives on the batch**, once, covering all receipts.

---

## 3. BRANCH / POS registration — what ETA actually requires

### 3.1 Branch (organizational)

ETA does **not** register branches through this SDK. The taxpayer creates branches on the **eInvoicing portal** profile. SDK [Branches](https://sdk.invoicing.eta.gov.eg/codes/branch/):

> Only **branch ID** (not branch name) should be supplied on documents. Read the ID from the taxpayer profile dropdown.

That ID is what we must store as `Branch.etaBranchCode`. Head office is commonly `"0"` (ETA’s own examples use `0`). It is **taxpayer-specific**; another company may also use `"0"`.

On the **receipt** itself, the branch is identified by:

1. `seller.branchCode` = portal branch ID  
2. `seller.branchAddress` = address object (must be consistent with that branch)  
3. `seller.activityCode` = activity allowed for that branch (ETA also checks branch activity dates server-side; ceased branches cannot issue)

There is no separate “POS branch code” vs “invoice branch code”. Same portal ID is used for invoices (`issuer.address.branchId`) and receipts (`seller.branchCode`).

### 3.2 POS device (the till)

The POS must be **registered and linked to the issuer RIN** on the ETA profile **before** any receipt is issued (FAQ “Limitations on POS device”). Serial length ≤ 100. Retired / permanently retired devices cause the **entire submission** to be rejected.

The SDK does not document a “create POS” REST call. After portal registration, Authenticate POS consumes:

| Auth input | Where | Max | Meaning |
| --- | --- | --- | --- |
| `posserial` | HTTP header | 100 | POS serial; **must equal** `seller.deviceSerialNumber` |
| `pososversion` | HTTP header | 50 | OS / software version string registered for that POS |
| `posmodelframework` | HTTP header | 10 | Model/framework number registered for that POS |
| `presharedkey` | HTTP header | 200 | Pre-shared key issued at POS registration |
| `grant_type=client_credentials` | body | — | Same OAuth grant as invoices |
| `client_id` / `client_secret` | body | 100 | System credentials for that POS (or the ERP system, depending how the taxpayer registered it) |

Errors include `invalid_posserial`, `invalid_pososversion`, `invalid_posmodelframework`, `invalid_presharedkey`.

ERP login (what we do today for invoices) is the **same** `/connect/token` **without** those four POS headers. Receipts submitted on the POS channel need the extra headers. FAQ also: “POS should be activated before submission on any other channel” — ERP-channel receipt submit is only allowed after the POS has been activated.

General notifications (SDK eReceipt API list) include: **POS Device Credentials Expiration**, **POS Device Dates Expiration**, **POS Device Deactivated**.

### 3.3 Field-by-field map: ETA receipt seller/branch vs what we store

Current `Branch` (`apps/api/prisma/schema.prisma`): `name`, `isDefault`, `isActive`, `etaBranchCode?`, `activityCode?`, `defaultCurrencyCode?`, full address columns (`country`, `governate`, `regionCity`, `street`, `buildingNumber`, `postalCode`, `floor`, `room`, `landmark`, `additionalInformation`). Quota is **account-pooled** with devices.

Current `SigningDevice`: `label`, `machineFingerprint`, pairing `tokenHash`, `status`, `lastReadyJson`. **No** ETA POS serial, PSK, OS, model, or `previousUUID`.

| ETA field | On | Req | Format | Our field today | Gap |
| --- | --- | --- | --- | --- | --- |
| Branch ID (`seller.branchCode`) | receipt | M | String(50), **portal ID** | `Branch.etaBranchCode` nullable | Exists but optional; not labeled as portal ID; HQ `"0"` is a valid value |
| `seller.branchAddress.country` | receipt | M | ISO 3166-1 alpha-2, `EG` for EG issuers | `addressCountry` | Exists; invoice path defaults `EG` |
| `governate` | receipt | M | String(100) | `addressGovernate` | Exists; already required for complete invoice address |
| `regionCity` | receipt | M | String(100) | `addressRegionCity` | Exists |
| `street` | receipt | M | String(200) | `addressStreet` | Exists |
| `buildingNumber` | receipt | M | String(100) | `addressBuildingNumber` | Exists |
| `postalCode` | receipt | O | String(30) | `addressPostalCode` | Exists |
| `floor` / `room` / `landmark` / `additionalInformation` | receipt | O | String 100–500 | matching columns | Exists |
| `seller.activityCode` | receipt | M | String(10), code table | `Branch.activityCode` nullable, else tenant credential | Exists but optional |
| `seller.rin` | receipt | M | String(30) | credential `registrationNumber` | Tenant, not branch — correct |
| `seller.companyTradeName` | receipt | M | String(200) | `Tenant.legalName` | Tenant, not branch — correct (do not use `Branch.name`) |
| `seller.deviceSerialNumber` | receipt | M | String(100) | — | **Missing** (POS, not branch) |
| `seller.syndicateLicenseNumber` | receipt | O | String(30); person = 10 digits zero-padded; company = `"C"` | — | **Missing** |
| Portal branch name EN/AR | get-details only | — | String(100) | `Branch.name` (internal label) | Not submitted; optional display-only `nameAr` |
| POS OS version | auth header | M for POS token | String(50) | — | **Missing** |
| POS model/framework | auth header | M for POS token | String(10) | — | **Missing** |
| POS pre-shared key | auth header | M for POS token | String(200), secret | — | **Missing** |
| POS client_id / client_secret | token body | M | same as ERP creds or POS-specific | `TenantEtaCredential` (ERP) | May need **POS-scoped** creds if the taxpayer registered the POS as its own system |
| `previousUUID` chain | receipt header | M | 64 hex / `""` first | — | **Missing** (per POS, not per branch) |
| POS active / retired / permanently retired | ETA profile | M (must be active) | enum | — | **Missing** local mirror |
| POS activation / expiry dates | ETA profile + notifications | — | datetime | — | **Missing** (optional local copy) |
| Buyer `mobileNumber` / `paymentNumber` | receipt | O | String(30) | Customer / document | Document-level, not branch |
| `paymentMethod` | receipt | M | code table | — | Document-level, not branch |

---

## 4. Extra BRANCH fields we need (the main question)

**Most of the receipt seller/branch payload already exists on `Branch`.** We do not need a second address model. The gap is: (a) make the existing ETA coding **mandatory and portal-accurate** for receipt-capable branches, (b) add two small issuer fields that invoices never sent, (c) stop treating POS identity as a branch column.

### 4.1 Must add (branch or tenant — not POS)

| Proposed field | Put on | Req when issuing receipts | Format | Why |
| --- | --- | --- | --- | --- |
| `syndicateLicenseNumber` | **Tenant**, optional **branch override** | Required if `Tenant.issuerType = P`; for `B` send `"C"` or omit | String(30); persons zero-pad to ≥ 10 | Receipt `seller.syndicateLicenseNumber`. Not on invoices. Company vs professional is a taxpayer fact, so tenant-default + rare branch override is enough. |
| `etaBranchCode` | already on Branch | **Required** (today optional) | String(50), exact portal ID | Receipts reject missing issuer branch id (FAQ rule 16). Same field invoices already use. |
| `activityCode` | already on Branch | **Required** on the issuing branch (no silent tenant fallback once receipts are on) | String(10) | Receipt seller requires it; ETA also gates allowed receipt types by activity. |
| Address required quartet | already on Branch | Already enforced for invoices | governate, regionCity, street, buildingNumber + country `EG` | Same object as `seller.branchAddress`. Keep the existing completeness check. |

### 4.2 Should add (branch UX / compliance, not in the signed JSON)

| Proposed field | Put on | Req | Why |
| --- | --- | --- | --- |
| `nameAr` | Branch | O | ETA get-details returns `branchName` / `branchNameAr`. Not submitted. Helps operators match the portal. |
| `receiptsEnabled` | Branch | default false | Gate: refuse to build receipts until `etaBranchCode`, `activityCode`, and address are complete. Lets invoice-only tenants keep today’s looser branch rows. |
| `etaActivityFrom` / `etaActivityTo` | Branch | O | ETA taxpayer validator stops issuance on ceased branches. We cannot query this via SDK; storing portal dates avoids sending receipts we know will fail. |

### 4.3 Do **not** add on Branch

These look like “branch coding” but ETA binds them to the **POS device** or the **tenant**:

- `deviceSerialNumber`, `posOsVersion`, `posModelFramework`, `presharedKey`
- `previousUUID` / last issued receipt uuid
- `rin` / `companyTradeName` (stay on tenant + ETA credentials)
- POS client_id/secret (credentials entity, possibly per POS)

### 4.4 Proposed POS device fields (sibling of Branch, not columns on it)

New entity (name TBD: `PosDevice` / `EtaPosRegistration`), **many POS per branch**, counting against the existing **account-pooled device quota** (same pool as signing agents, unless product later splits the SKU).

| Field | Req | Format | Maps to |
| --- | --- | --- | --- |
| `branchId` | M | FK | POS is linked to a portal branch |
| `serialNumber` | M | String(100), unique per tenant | `seller.deviceSerialNumber` + header `posserial` |
| `osVersion` | M for auth | String(50) | header `pososversion` |
| `modelFramework` | M for auth | String(10) | header `posmodelframework` |
| `preSharedKey` (encrypted) | M for auth | String(200) | header `presharedkey` |
| `clientId` / `clientSecret` (encrypted) | M if POS has its own system | same as today’s credentials | POS token body; else reuse tenant ERP creds |
| `etaStatus` | M | `ACTIVE` / `RETIRED` / `PERMANENTLY_RETIRED` | FAQ rule 27 |
| `activatedAt` / `expiresAt` | O | datetime | portal dates + expiry notifications |
| `lastReceiptUuid` | M after first receipt | 64 hex or empty | next receipt `previousUUID` |
| `signingDeviceId` | O | FK `SigningDevice` | optional link: this till also runs the eSeal agent |

Portal work the customer still does (we cannot API it): create branch IDs, register each POS serial, generate PSK, assign B2C tag, keep the POS activated.

---

## 5. Device registration vs our existing agent pairing

Two different “devices”:

| | ETA POS | Our `SigningDevice` (agent) |
| --- | --- | --- |
| Purpose | Tax-authority identity of a till | Pair a Windows agent that holds the eSeal |
| Created | ETA portal | Our pairing code → `POST /devices/pair` |
| Auth to ETA | `posserial` + OS + model + PSK + client_id/secret | Not used; API uses tenant ERP `client_id`/`client_secret` |
| Auth to us | — | hashed device token |
| On the receipt | `seller.deviceSerialNumber` | not sent |
| Chain | `previousUUID` per POS serial | none |
| Signing | Does not replace eSeal; POS auth ≠ document signature | Performs CAdES-BES with USB token |

**Relation:** a physical cash register that both issues receipts and signs with eSeal should be **one PosDevice + one SigningDevice**, linked. Pairing the agent does **not** register the POS with ETA. Copying `machineFingerprint` into `deviceSerialNumber` is unsafe unless that string is exactly the serial registered on the portal (max 100 chars).

Do not overload `SigningDevice` with PSK/OS/model unless product explicitly wants one row for both jobs. Prefer a dedicated POS registration row so invoice-only signing agents stay unchanged.

---

## 6. Signing / submission method — not HMAC of the receipt body

### 6.1 What people confuse

| Mechanism | Used for | HMAC? |
| --- | --- | --- |
| POS **pre-shared key** | OAuth **headers** on `POST /connect/token` | PSK is a shared secret for **login**, not a receipt MAC |
| Receipt **UUID** | Identity + POS chain | SHA-256 of **canonical receipt text** with uuid empty — **hash, not a signature** |
| Batch **`signatures[]`** | Integrity of the **submission** | **CAdES-BES** over SHA-256 of the **canonical batch**, eSeal X.509 — **same crypto family as invoices** |

SDK [Receipt Batch Signature Creation](https://sdk.invoicing.eta.gov.eg/receipt-batch-signature-creation/) and [Submit Receipt](https://sdk.invoicing.eta.gov.eg/ereceiptapi/02-submit-receipt/): `signatureType` `I` (issuer) or `S` (service provider); `value` is **CAdES-BES Base64**. “Sign the hash, using CAdES-BES signature” / “using eSeal certificate”.

ETA note (repeated on FAQ and submit): *signature validation may not be deployed yet*. We still send the structure; we must not skip eSeal because validation is currently loose.

### 6.2 Exact difference vs our invoice signing (why the agent needs a second path)

| Step | e-Invoice (keep frozen) | eReceipt |
| --- | --- | --- |
| Canonical **root** | **One document object** (not the `documents[]` wrapper). Signatures stripped. | **Entire batch** `{ receipts: [...] }` (JSON only). Serialization “applied to the entire batch”. |
| Hash | SHA-256(UTF-8 canonical) | SHA-256(UTF-8 canonical of the batch) |
| Sign | Detached CAdES-BES, eSeal | Same CAdES-BES / eSeal **algorithm** |
| Where signature is stored | **Each** document: `documents[i].signatures` | **Once** on the HTTP body: top-level `signatures` |
| Taxpayer-generated uuid | No | **Per receipt**, SHA-256 hex of that receipt with `uuid: ""`, including `previousUUID` |
| Agent job shape today | One job per document | One job per **batch** (or sign the already-assembled `receipts` JSON) |

[Document Serialization Approach](https://sdk.invoicing.eta.gov.eg/document-serialization-approach/) calls this out explicitly:

- **eInvoicing:** root is the document object, **not** the `documents` array.  
- **eReceipt:** receipts grouped into batches; serialize the **entire batch**.

So: **reuse the CAdES primitive and eSeal token; do not reuse the invoice digest input builder or per-document `SignatureJob` as-is.** Add a parallel “receipt batch” path. Do not edit `packages/eta-core` invoice canonical serialize to “also handle receipts” in a way that can change invoice bytes.

### 6.3 UUID algorithm (FAQ) — not CAdES

1. Include all key fields, including `previousUUID` of the last receipt from **this POS**.  
2. Returns: include `referenceUUID`.  
3. Set `uuid` to empty.  
4. Serialize/normalize (flatten) the receipt.  
5. SHA-256 → 64 hex chars → that is `uuid`.

Correcting an invalid receipt in a chain: new uuid, same `previousUUID` as the invalid one, `referenceOldUUID` = old uuid. Unchanged neighbours keep their uuids. Amendment windows: **96h** with reference, **72h** without; late-submission request for older documents.

---

## 7. Submission endpoints, statuses, batching

### 7.1 Auth

| | Invoice (current) | Receipt POS |
| --- | --- | --- |
| URL | `{identity}/connect/token` | **same** identity host |
| Headers | `Authorization: Basic` | Basic **plus** `posserial`, `pososversion`, `posmodelframework`, `presharedkey` |
| Body | `grant_type=client_credentials` | same (+ optional scope) |
| Token TTL | ~3600 s | ~3600 s |
| Tag | B2B | JWT carries B2C (and/or B2B) tags |

### 7.2 Submit

| | Invoice | Receipt |
| --- | --- | --- |
| Method | `POST /api/v1.0/documentsubmissions/` | `POST /api/v1/receiptsubmissions` |
| Content-Type | `application/json` | `application/json` only (no XML) |
| Body | `{ documents: [...] }` | `{ receipts: [...], signatures: [...] }` |
| Sync result | HTTP **202** | HTTP **202** |
| IDs returned | `submissionUUID`, accepted `uuid`/`longId`/`internalId` | `submissionUUID`, accepted `uuid`/`longId`/`receiptNumber` |

Submit errors of note: `BadStructure` 400, `IncorrectSubmitter` 403, `MaximumSizeExceeded` 400, `DuplicateSubmission` 422 (10-minute identical payload hash, `Retry-After`).

Limits (FAQ):

- 1–**500** receipts per submission, max **1.5 MB**
- Submit within **24 hours** of `dateTimeIssued` unless `referenceOldUUID` / late-submission request
- All receipts in a POS submission must be from the **same POS serial**
- Return receipts: original sale ≤ **540 days** old
- Throttling applies; batch rather than one HTTP call per ticket

### 7.3 Status

Poll: `GET /api/v1/receiptsubmissions/{submissionUuid}/details`

| Level | Values |
| --- | --- |
| Submission | `InProgress`, `Valid`, `Invalid` |
| Receipt | `Valid`, `Invalid`, `Cancelled` |

Details: `GET /api/v1/receipts/{uuid}/details` (issuer: valid + cancelled). Search supports `PosSerialNumber`, `DocumentTypeCode` `s`/`r`, etc.

Printed receipt QR (FAQ):

`{portal}/receipts/search/{UUID}/share/{dateTimeIssued}#Total:{total},IssuerRIN:{rin}`

---

## 8. Point-of-sale receipt numbering

ETA `receiptNumber`:

- Mandatory, String(50)
- Uniqueness stated as: **unique per branch within the same submission** (batch-local)
- Global identity is the content **uuid**, not the number
- Returns may reuse a different number; they chain via `referenceUUID`

Operational rules we should impose (stricter than ETA’s batch-local rule):

1. Separate sequence from invoice `internalId` (do not mix `INV-` prefixes into receipts).  
2. Scope: **per branch** at minimum; **per POS** is safer so two tills never collide inside one batch. Reuse `TenantInvoiceNumbering` / `DocumentNumberSequence` with a new document kind (e.g. `RECEIPT` / `RETURN_RECEIPT`) and `BRANCH_AND_KIND` or POS-scoped counters.  
3. Persist `lastReceiptUuid` **per POS serial** under a transaction with submit, or the `previousUUID` chain breaks (this is harder than numbering).  
4. First receipt from a POS: `previousUUID = ""`. Never invent a sibling chain for the same serial.

---

## 9. Implementation plan (proposal only — do not build yet)

Order matches the constraint: **branch/POS coding → receipt builder → signing → submission**. Invoice canonical/digest stays untouched.

### Phase 0 — product decisions to approve with this spec

1. Confirm **extra branch fields** in §4.1–4.2 (especially tenant `syndicateLicenseNumber`, `receiptsEnabled`, optional `nameAr` / activity dates).  
2. Confirm POS is a **new entity** linked to `Branch`, optionally to `SigningDevice`, sharing the **account device quota**.  
3. First document types: Receipt v1.2 `s`/`r` only vs also Retail `SR`.  
4. POS credentials: always extra headers on the existing tenant client_id, vs per-POS client_id/secret.

### Phase 1 — Branch / POS coding (first build)

- Tighten branch settings UI/API: when `receiptsEnabled`, require portal `etaBranchCode`, `activityCode`, complete address; copy helper text that the code is the **portal branch ID**, HQ often `0`.  
- Add `syndicateLicenseNumber` (tenant + optional branch override).  
- Add `PosDevice` (or equivalent) with serial / OS / model / encrypted PSK / status / `lastReceiptUuid` / `branchId`.  
- Settings screens: “ETA POS registration” — operator pastes portal values; we never call a register-POS API.  
- Validation: serial ≤ 100; refuse receipts if POS not `ACTIVE`.  
- Tests: branch completeness for receipts; quota still account-pooled; invoice branch create path unchanged for `receiptsEnabled=false`.

### Phase 2 — Receipt document builder (new code, new package surface)

- New builder alongside invoice `buildDocumentPayload` — **do not** extend invoice `DocumentKind` with a flag that changes invoice JSON.  
- Map seller from tenant legal name + RIN + branch address + POS serial.  
- Buyer: allow anonymous `P`; enforce national ID at 150000 EGP.  
- Lines: `itemData` naming; mandatory `internalCode`; v1.2 discount objects.  
- Header: allocate `receiptNumber`; compute uuid; stamp `previousUUID` from POS.  
- Local validators from FAQ (structure, codes, core fields).  
- Golden JSON fixtures from SDK samples (download linked from FAQ “receipt batch schema”) — not invoice `gv-01`.

### Phase 3 — Signing (receipt-specific path)

- Canonicalize `{ receipts: [...] }` with a **receipt-batch** serializer. Prefer a new module (`receipt-canonical.ts` / agent equivalent) that may share *helpers* but not the invoice golden-vector entrypoint.  
- Hash + existing CAdES-BES eSeal (BouncyCastle / PKCS#11) — same token, new digest input.  
- New job type: sign this batch (not one invoice). Agent UI can stay; claim/submit contract changes.  
- Per-receipt uuid hash is **not** the CAdES digest; implement separately.  
- **Do not** modify invoice `SignatureJob`, `cades-digest` goldens, or `gv-01`.

### Phase 4 — Submission

- `EtaAuthClient` variant that adds POS headers (leave current invoice token helper unchanged).  
- `POST /api/v1/receiptsubmissions`; store `submissionUUID` / uuid / longId.  
- Poll receipt submission details; map `InProgress`/`Valid`/`Invalid`.  
- DuplicateSubmission / size / 24h window / same-POS-in-batch rules.  
- QR generation for print.  
- Returns (`r` + `referenceUUID`) after sales path is stable.

### Phase 5 — later

- Retail `SR` + `orderdeliveryMode`.  
- Specialized activity types.  
- Late submission requests.  
- POS expiry notifications webhook.  
- Optional HMAC/toolkit CLI is **not** our signing path.

---

## 10. Decision log (for review)

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Extra **branch** columns beyond today’s address + codes | Only `syndicateLicenseNumber` (tenant-first), optional `nameAr`, `receiptsEnabled`, optional activity dates. Make existing `etaBranchCode` + `activityCode` required when receipts are on. |
| D2 | POS serial / PSK / OS / model | **New POS entity**, not Branch columns. |
| D3 | Signing | Same **eSeal CAdES-BES**, **different digest root** (batch). Not HMAC. Not the invoice serialize function. |
| D4 | Agent | Reuse hardware/token; **new batch signing path**. |
| D5 | Auth | Invoice token helper stays; receipt token adds POS headers. |
| D6 | Numbering | New receipt sequences; `previousUUID` stored per POS. |

**Stop here until the branch-fields gap (§4) is approved.**
