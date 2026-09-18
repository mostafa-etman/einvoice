# ETA eReceipt (B2C) requirements — spec + implementation plan

**Status**: Phase 1 (branch/POS) and Phase 2 (document builder) are in the product. This revision is **spec + plan only** for receipt signing and submission — **do not implement until approved**.  
**Date**: 2026-09-18 (signing correction: receipts do **not** use the USB eSeal token / desktop agent).  
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
| Integration toolkit (signing disabled) | https://sdk.invoicing.eta.gov.eg/toolkit/home/ |
| Toolkit NuGet POS token | https://sdk.invoicing.eta.gov.eg/nugetoperation/02-toolkit-nuget-connect-token/ |
| Toolkit NuGet usage (Authenticate + SubmitReceipts) | https://sdk.invoicing.eta.gov.eg/toolkit/nuget/usage/ |
| Toolkit CLI usage | https://sdk.invoicing.eta.gov.eg/toolkit/cli/usage/ |
| Toolkit local batch submit (ITIDA component) | https://sdk.invoicing.eta.gov.eg/toolkitapi/08-batch-submission/ |
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

eReceipt is a **separate document family** (B2C). Same tax authority, same identity host, **different JSON shape, different identity fields, different digest root, different submit URL, extra POS auth headers**. Receipt **signing does not use the USB eSeal token or the desktop agent** — see §6.

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
| `signingDeviceId` | O | FK `SigningDevice` | **Not required for receipts.** Optional only if the same machine also invoices |

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
| Signing | **Not used for receipts.** PSK authenticates the POS; receipt batch CAdES (when produced) is **server-side**, not USB | Invoice-only: CAdES-BES with USB eSeal token |

**Relation:** pairing the invoice signing agent does **not** register the POS with ETA and is **not** required to issue or submit receipts. Copying `machineFingerprint` into `deviceSerialNumber` is unsafe unless that string is exactly the serial registered on the portal (max 100 chars).

Do not overload `SigningDevice` with PSK/OS/model. Invoice-only signing agents stay unchanged. `PosDevice.signingDeviceId` may remain optional for operators who also invoice from the same machine; **receipts must not wait on that agent**.

---

## 6. Receipt signing (no token)

**Correction vs earlier draft:** invoice signing in this product uses a Windows agent + USB eSeal (PKCS#11). **eReceipt does not.** Tenants must be able to submit receipts from our cloud with **no desktop agent and no USB token**. Invoice `SignatureJob` / canonical-serialize / cades-digest stay frozen.

### 6.1 How receipts are signed without the USB token — exact SDK requirement

**Not HMAC of the receipt using the POS PSK. Not a per-receipt MAC.**

The POS pre-shared key is **only** an OAuth header on identity login. [Authenticate POS](https://sdk.invoicing.eta.gov.eg/ereceiptapi/01-authenticate-pos/) lists `presharedkey` with `posserial` / `pososversion` / `posmodelframework` as **`POST {identity}/connect/token` headers**. Errors include `invalid_presharedkey`. No SDK page hashes or HMACs the receipt body with that key.

**Not “unsigned JSON” as the documented format**, either. [Submit Receipt](https://sdk.invoicing.eta.gov.eg/ereceiptapi/02-submit-receipt/) body:

> `signatures` — Structure containing one or two digital signatures. **At least signature of the Issuer must be present.** Signature of the Service provider is optional.

> `signatureType`: Issuer (`I`), ServiceProvider (`S`)  
> `value`: **CAdES-BES standard Base64 encoded signature**

[Receipt Batch Signature Creation](https://sdk.invoicing.eta.gov.eg/receipt-batch-signature-creation/) (the signing algorithm page):

> 1. Create receipt batch JSON … individual receipts into separate `receipts` root-level array field elements.  
> 2. Create canonical version of the JSON as per algorithm described  
> 3. Apply sha256 hash on the byte array created from canonical JSON version (**using UTF-8**)  
> 4. **Sign the hash, using CAdES-BES signature.**  
> 5. Include **Base64 encoded CAdES-BES** signature into original document JSON `signatures` element.

> After signing the hash value **using eSeal certificate** and creating CADES-BES signature …

So the **documented** crypto is **CMS/CAdES-BES (RSA with an X.509 eSeal certificate) over SHA-256 of the canonical batch**, not HMAC-SHA256, not PSK.

**Where the certificate lives:** [Getting started](https://sdk.invoicing.eta.gov.eg/start/) integration step 5 is:

> Getting **eSeal X.509 certificate that needs to be configured in ERP and POS system** that is submitting digitally signed documents.

That is **software configuration of a certificate in the ERP/POS**, not “insert the USB token at every till.” Our ERP is this cloud app; the private key therefore belongs **on the server** (PFX / software keystore), not on a PKCS#11 stick via the invoice agent.

**ETA currently does not check the CAdES.** Same page, FAQ, and submit API all say:

> The function to perform **signature validation will not be deployed at this point** until a decision is provided by ETA to test and deploy the component.

[Integration Toolkit home](https://sdk.invoicing.eta.gov.eg/toolkit/home/) is explicit:

> **Signing the submission is not required as this feature is disabled.**

The optional ETA toolkit *can* sign locally with “ITIDA’s signature component” ([toolkit batch submission](https://sdk.invoicing.eta.gov.eg/toolkitapi/08-batch-submission/)); that is **not** a requirement on `POST /api/v1/receiptsubmissions`, and we **must not** adopt the toolkit / USB agent as our receipt path.

| Mechanism | Used for | HMAC? | USB token? |
| --- | --- | --- | --- |
| POS **pre-shared key** | OAuth header `presharedkey` on `/connect/token` only | No — login secret | No |
| Receipt **UUID** | Identity + `previousUUID` chain | SHA-256 of **one** canonical receipt with `uuid` empty — **hash, not a signature** | No |
| Batch **`signatures[]`** | Documented integrity of the **submission** | **CAdES-BES / RSA + X.509**, SHA-256 of canonical `{ receipts: [...] }` | **No** — cert configured in ERP; our cloud holds a software cert. Invoice USB path is unrelated. |

### 6.2 Exact input, algorithm, and where the signature goes

**Input (the thing that is hashed for CAdES):** the **entire batch**, not each receipt.

[Document Serialization Approach](https://sdk.invoicing.eta.gov.eg/document-serialization-approach/):

> **eReceipt:** Receipts are grouped into batches. Every batch is processed as one submission. **Serialization is applied to the entire batch.** Batches in JSON format only, are supported.

> **eInvoicing:** The root of the document is not the root of the entire submission. … Root is **not** the entire documents array of JSON.

Canonical rules (same SerializeToken idea as invoices, **different root** — do not call invoice `canonicalSerialize` on a receipt batch):

1. Recurse from the batch root `{ receipts: [ … ] }` (signatures **not** included in the bytes that are hashed).  
2. Property names → culture-invariant uppercase.  
3. Values copied as-is (`0.0` stays `0.0`).  
4. Names and simple values wrapped in `"`.  
5. Arrays: prefix the array name, then prefix **each** element with the same name.

**Algorithm:**

1. `canonical = Serialize({ receipts: [...] })`  
2. `hash = SHA-256(UTF-8 bytes of canonical)` → 32 bytes  
3. `cms = CAdES-BES(hash)` using the eSeal **X.509 certificate + RSA private key**  
4. `value = Base64(cms)`

**Not:** HMAC-SHA256(PSK, body). **Not:** SHA-256 of each receipt (that is `uuid` only). **Not:** invoice per-document digest.

**Where it is placed** — once on the **HTTP body**, not inside each receipt:

```json
{
  "receipts": [ { /* receipt 1, including uuid */ }, { /* receipt 2 */ } ],
  "signatures": [
    { "signatureType": "I", "value": "<Base64 CAdES-BES of the batch hash>" }
  ]
}
```

Invoice submit is `{ "documents": [ { …invoice, "signatures": [...] }, … ] }` — signature on **each** invoice. Receipt signature is **one** top-level array covering the whole `receipts` list. Optional second entry `signatureType: "S"` for a service provider.

(The batch-signature page’s leftover sentence about putting documents into a `documents` array is invoice copy-paste. [Submit Receipt](https://sdk.invoicing.eta.gov.eg/ereceiptapi/02-submit-receipt/) is authoritative: `receipts` + `signatures`.)

### 6.3 Where it runs — entirely server-side; no receipt agent

**Yes: receipt signing and submission run in our cloud. Tenants do not need the desktop agent for receipts at all.**

| Step | Where | Needs USB / agent? |
| --- | --- | --- |
| Build receipt JSON, uuid, `previousUUID` | API (`packages/eta-core` receipts + `receipts.service`) | No (already shipped) |
| POS OAuth (`/connect/token` + PSK headers) | API, using stored `PosDevice` + tenant `client_id`/`client_secret` | No |
| Canonicalize batch + SHA-256 | API (new receipt-batch digest module; **not** invoice `canonical-serialize.ts`) | No |
| CAdES-BES | API, software RSA key / PFX in our keystore (or skip cryptographic CAdES while ETA validation is disabled — see Phase 3) | **No** |
| `POST /api/v1/receiptsubmissions` | API with Bearer POS token | No |
| Invoice CAdES | Existing Windows agent + USB token | Yes — **invoices only** |

The invoice agent exists because Egyptian **B2B eSeal** is issued as a hardware token and our invoice path talks PKCS#11. Receipt SDK never requires that channel. Do **not** create a receipt `SignatureJob` or wait for `SigningDevice` ready.

### 6.4 POS authentication for submission (exact flow)

Receipt submit is a protected eReceipt API. The caller must send `Authorization: Bearer <access_token>` from identity. That token is **not** the invoice ERP token.

**Invoice ERP login** ([Login as Taxpayer System](https://sdk.invoicing.eta.gov.eg/api/01-login-as-taxpayer-system/)) — keep as-is, do not reuse for receipts:

```
POST {identity}/connect/token
Headers:
  Authorization: Basic base64(client_id:client_secret)
  Content-Type: application/x-www-form-urlencoded
Body:
  grant_type=client_credentials
```

**POS login** ([Authenticate POS](https://sdk.invoicing.eta.gov.eg/ereceiptapi/01-authenticate-pos/)) — **different request shape**. The official table does **not** use `Authorization: Basic`. Client id/secret are **body** fields; PSK is a **header**:

```
POST {identity}/connect/token
Headers:
  posserial:            <PosDevice.serialNumber>          // max 100
  pososversion:         <PosDevice.osVersion>             // max 50
  posmodelframework:    <PosDevice.modelFramework>        // max 10
  presharedkey:         <decrypted PosDevice PSK>         // max 200
  Content-Type: application/x-www-form-urlencoded
Body (x-www-form-urlencoded):
  grant_type=client_credentials
  client_id=<system client id>
  client_secret=<system client secret>
```

Response: HTTP 200, `access_token` (JWT, `token_type` Bearer, `expires_in` ~3600). JWT carries `TaxProfTags` (must include **B2C** or receipt submit is refused). Toolkit example JWT also includes `PosSerial` / `DeviceId`.

POS errors (400): `invalid_posserial`, `invalid_pososversion`, `invalid_posmodelframework`, `invalid_presharedkey`, `invalid_clientsecret`, `unauthorized_client`, …

[Toolkit NuGet token](https://sdk.invoicing.eta.gov.eg/nugetoperation/02-toolkit-nuget-connect-token/) documents two options:

1. **Option 1** — `client_id` + `client_secret` only (ERP-style token).  
2. **Option 2** — those plus `posserial`, `pososversion`, `presharedkey`, `posmodelframework` (optional in toolkit wording).  

> To be able to authenticate the POS, the developer must provide the **client ID and client secret that were provided when registering the POS**.

Receipt submission on the POS channel **must use option 2**. FAQ: “POS should be activated before submission on any other channel.” Only taxpayers with the **B2C** tag may submit receipts.

Then:

```
POST {api}/api/v1/receiptsubmissions
Authorization: Bearer <POS access_token>
Content-Type: application/json
Body: { "receipts": [ ... ], "signatures": [ { "signatureType": "I", "value": "..." } ] }
```

HTTP **202** + `submissionUUID`. Poll `GET /api/v1/receiptsubmissions/{submissionUuid}/details`.

PSK is **never** sent on the submit call. It is **never** the CAdES key.

### 6.5 PSK / credentials mapping to what we already store

**Each ETA POS has its own pre-shared key**, issued when the taxpayer registers that serial on the portal. That is the self-service secret we already encrypt on `PosDevice`.

| ETA Authenticate POS | Our store (already built) | Notes |
| --- | --- | --- |
| header `posserial` | `PosDevice.serialNumber` | Must equal `seller.deviceSerialNumber` on every receipt in the batch |
| header `pososversion` | `PosDevice.osVersion` | Portal string, max 50 |
| header `posmodelframework` | `PosDevice.modelFramework` | Portal string, max 10 |
| header `presharedkey` | `PosDevice.preSharedKeyCiphertext` + `preSharedKeyNonce` | Decrypt at token time only; never log; UI shows masked |
| body `client_id` / `client_secret` | `TenantEtaCredential.clientId` + encrypted secret | Toolkit: “provided when registering the POS.” Many taxpayers reuse the same ERP system creds for POS; if a tenant registered the POS as **its own system**, they need **POS-scoped** creds we do **not** store yet (optional Phase 4 field on `PosDevice`) |
| B2C tag | ETA profile (not us) | Token JWT `TaxProfTags` must include B2C |
| POS active / not retired | `PosDevice.status` (local mirror) | ETA still rejects retired serials even if our row is ACTIVE |

**Not** mapped to PSK: the CAdES certificate. PSK ≠ eSeal. Do not put the USB token PIN on `PosDevice`.

Tenant isolation: each tenant pastes **their** portal serial + OS + model + PSK in Settings → POS devices. Platform owner never holds a global PSK. Company-wide vs per-branch **serial scope** (`Tenant.posSerialScope`) only chooses **which `PosDevice` row** (and therefore which PSK + `previousUUID` chain) a receipt uses; it does not change the OAuth header names.

### 6.6 UUID algorithm (FAQ) — not CAdES

Unchanged from Phase 2 (already implemented in `packages/eta-core` receipts). Recap so it is not confused with batch signing:

1. Include all key fields, including `previousUUID` of the last receipt from **this POS**.  
2. Returns: include `referenceUUID`.  
3. Set `uuid` to empty.  
4. Serialize/normalize (flatten) **that one receipt**.  
5. SHA-256 → 64 hex chars → that is `uuid`.

Correcting an invalid receipt in a chain: new uuid, same `previousUUID` as the invalid one, `referenceOldUUID` = old uuid. Unchanged neighbours keep their uuids. Amendment windows: **96h** with reference, **72h** without; late-submission request for older documents.

---

## 7. Submission endpoints, statuses, batching

### 7.1 Auth

See §6.4 for the full POS token request. Summary:

| | Invoice (current — do not change) | Receipt POS (new helper) |
| --- | --- | --- |
| URL | `{identity}/connect/token` | **same** identity host |
| Headers | `Authorization: Basic` | **`posserial`, `pososversion`, `posmodelframework`, `presharedkey`** — **no** Basic header per Authenticate POS |
| Body | `grant_type=client_credentials` | `grant_type=client_credentials` **plus** `client_id` and `client_secret` as form fields |
| Token TTL | ~3600 s | ~3600 s |
| Tag | B2B | JWT must carry **B2C** (and/or B2B) |
| Cache key | tenant ERP creds | tenant creds **+ POS serial** (PSK differs per device; do not reuse the invoice token cache entry) |

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

## 9. Implementation plan (proposal only for Phase 3–4 — do not build signing/submit yet)

Phases 1–2 are **done**. Remaining order: **server-side batch CAdES → POS OAuth → submit**. Invoice canonical/digest stays untouched. **No receipt work on the desktop agent.**

### Phase 0 — remaining product decisions (signing)

Phases 1–2 decisions (branch fields, `PosDevice`, `s`/`r`/`SR` builder, company vs branch POS serial) are already implemented.

Approve before coding Phase 3–4:

1. **No USB / no agent for receipts** — confirmed by this spec (§6.3).  
2. **Not HMAC/PSK** — PSK is only `presharedkey` on `/connect/token` (§6.1, §6.4).  
3. **CAdES-BES in our API** over SHA-256 of canonical `{ receipts: [...] }`, `signatures[]` on the batch (§6.2).  
4. **Software certificate:** start with a **platform-held PFX** in the API so every tenant can submit without uploading a cert (ETA signature validation is not deployed). Add optional **tenant PFX** later if ETA starts verifying the issuer certificate. Still never the USB token.  
5. **POS token:** new `requestPosToken` using `PosDevice` PSK headers + tenant ERP `client_id`/`client_secret` in the body; per-POS creds only if preprod proves ERP creds are insufficient.

### Phase 1 — Branch / POS coding — **done**

- Tighten branch settings UI/API: when `receiptsEnabled`, require portal `etaBranchCode`, `activityCode`, complete address; copy helper text that the code is the **portal branch ID**, HQ often `0`.  
- Add `syndicateLicenseNumber` (tenant + optional branch override).  
- Add `PosDevice` (or equivalent) with serial / OS / model / encrypted PSK / status / `lastReceiptUuid` / `branchId`.  
- Settings screens: “ETA POS registration” — operator pastes portal values; we never call a register-POS API.  
- Validation: serial ≤ 100; refuse receipts if POS not `ACTIVE`.  
- Tests: branch completeness for receipts; quota still account-pooled; invoice branch create path unchanged for `receiptsEnabled=false`.

### Phase 2 — Receipt document builder — **done**

- New builder alongside invoice `buildDocumentPayload` — **do not** extend invoice `DocumentKind` with a flag that changes invoice JSON.  
- Map seller from tenant legal name + RIN + branch address + POS serial.  
- Buyer: allow anonymous `P`; enforce national ID at 150000 EGP.  
- Lines: `itemData` naming; mandatory `internalCode`; v1.2 discount objects.  
- Header: allocate `receiptNumber`; compute uuid; stamp `previousUUID` from POS.  
- Local validators from FAQ (structure, codes, core fields).  
- Golden JSON fixtures from SDK samples (download linked from FAQ “receipt batch schema”) — not invoice `gv-01`.

### Phase 3 — Receipt signing (server-side, **no USB / no agent**) — **do not build until this section is approved**

Goal: produce the submit body’s `signatures[]` in the API. **Do not** touch invoice `SignatureJob`, `canonical-serialize.ts`, `cades-digest`, PKCS#11, or the desktop agent.

Recommended build order:

1. **Batch canonical (new module only)**  
   - Input: `{ receipts: ReceiptJson[] }` with each receipt already carrying `uuid` (Phase 2). Strip / omit `signatures`.  
   - Output: SerializeToken over the **batch root** (uppercase names, array name repeated per element).  
   - Reuse *helpers* from `packages/eta-core` receipts `receipt-canonical.ts` if they are root-agnostic; **do not** call invoice `canonicalSerialize`. New goldens from SDK batch examples, not `gv-01`.

2. **Batch digest**  
   - `SHA-256(UTF-8(canonical))` → 32 bytes. This is the CAdES message digest, **not** the per-receipt uuid.

3. **`signatures[]` assembly**  
   - API builds **CAdES-BES** over the batch hash with a **server-side RSA private key** (platform PFX first; optional tenant PFX later). Place `{ signatureType: "I", value: Base64(cms) }`. Optional `{ signatureType: "S", ... }` only if we act as intermediary.  
   - While ETA documents “signing is not required / validation not deployed”, we still send this array because Submit Receipt requires the issuer signature **to be present**. A real CMS from a software cert is safer than an empty string.  
   - **Rejected:** HMAC-SHA256(PSK, body); invoice USB agent; omit `signatures`; put `signatures` inside each receipt.

4. **Key storage**  
   - Platform PFX in API secret store (ops), not in git.  
   - Later: optional encrypted tenant PFX + password on tenant settings (not on `SigningDevice`). Self-service upload. Never log. Invoice USB pairing UI stays invoice-only.

5. **Tests**  
   - Batch canonical golden; digest stable; signatures array shape; invoice goldens + cades-digest remain green; **no** agent/e2e USB tests for receipts.

### Phase 4 — Submission (server-side POS token) — **do not build until Phase 3 path is approved**

1. **`EtaAuthClient.requestPosToken`** (new method; leave `requestToken` Basic invoice path untouched)  
   - Headers from decrypted `PosDevice`; body `grant_type` + tenant (or future per-POS) `client_id`/`client_secret`.  
   - Separate cache key: tenant + POS id. Never log PSK / secret / access_token.  
   - Map `invalid_presharedkey` / `invalid_posserial` / … to tenant-visible errors (PSK wrong vs POS not activated on portal).

2. **Submit**  
   - `POST /api/v1/receiptsubmissions` with Bearer POS token, body `{ receipts, signatures }` from Phase 3.  
   - Persist `submissionUUID`, accepted `uuid` / `longId` / `receiptNumber`.  
   - Same-POS-in-batch: all receipts in one HTTP call share one `PosDevice`. Size 1–500 / 1.5 MB; 24h window; DuplicateSubmission 10-minute payload hash.

3. **Status**  
   - Poll `GET /api/v1/receiptsubmissions/{submissionUuid}/details`; map InProgress / Valid / Invalid.  
   - Optional later: `GET /api/v1/receipts/{uuid}/details`.

4. **Print QR** (FAQ; no signing):  
   `{portal}/receipts/search/{UUID}/share/{dateTimeIssued}#Total:{total},IssuerRIN:{rin}`

5. **Credentials gap (only if preprod tokens fail with invalid_client)**  
   - Add optional encrypted `clientId` / `clientSecret` on `PosDevice` for taxpayers who registered the POS as its own system. Default remains tenant ERP creds.

6. **Still no agent.** Receipt submit must succeed for a tenant that has never paired a signing device.

### Phase 5 — later

- Retail `SR` + `orderdeliveryMode` (builder already accepts `SR`).  
- Specialized activity types.  
- Late submission requests.  
- POS expiry notifications webhook.  
- Per-POS `client_id`/`client_secret` if ERP creds are insufficient.  
- Tenant eSeal PFX upload **if/when** ETA enables receipt signature validation.  
- HMAC/toolkit CLI remains **not** our signing path.

---

## 10. Decision log (for review)

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Extra **branch** columns beyond today’s address + codes | Only `syndicateLicenseNumber` (tenant-first), optional `nameAr`, `receiptsEnabled`, optional activity dates. Make existing `etaBranchCode` + `activityCode` required when receipts are on. **Done (Phase 1).** |
| D2 | POS serial / PSK / OS / model | **New POS entity**, not Branch columns. **Done** — `PosDevice` encrypted PSK is the Authenticate POS `presharedkey` header. |
| D3 | Signing mechanism | **Not HMAC/PSK.** Documented CAdES-BES over SHA-256 of canonical `{ receipts: [...] }`, Base64 in top-level `signatures[]` (`I` required, `S` optional). **Not** invoice serialize / USB PKCS#11. |
| D4 | Where signing runs | **API / cloud only.** No desktop agent for receipts. Software X.509 (platform PFX first; optional tenant PFX if ETA later validates). Invoice USB path untouched. |
| D5 | Auth | Invoice `requestToken` (Basic) stays. New `requestPosToken`: POS headers + `client_id`/`client_secret` **in the body**. Cache per POS. |
| D6 | Numbering / chain | Receipt sequences; `previousUUID` on `PosDevice.lastReceiptUuid`. **Done (Phase 2).** |
| D7 | PSK mapping | Confirm: tenant self-service `PosDevice` PSK = OAuth `presharedkey`. Each POS has its own. `client_id`/`client_secret` default from `TenantEtaCredential`; optional per-POS creds only if needed. |

**Approve §6 + Phase 3 (server-side CAdES + platform PFX) and Phase 4 (POS token + submit) before any signing/submission code.** Do not start USB/agent work for receipts.
