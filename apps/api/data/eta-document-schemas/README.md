# ETA document field schemas (eInvoice)

**Important version note:** As of 2026-07-25, the official ETA SDK
([Types](https://sdk.invoicing.eta.gov.eg/types/)) publishes **document type
version `1.0`** for Invoice, Credit Note, Debit Note, Export Invoice, Export
Credit Note, and Export Debit Note. There is **no published Invoice v2.0**.
These schemas mirror **v1.0**.

| Kind | ETA `documentType` | Schema file | Source |
|------|--------------------|-------------|--------|
| Invoice | `I` | `invoice-v1.0.json` | https://sdk.invoicing.eta.gov.eg/documents/invoice-v1-0/ |
| Credit Note | `C` | `credit-note-v1.0.json` | https://sdk.invoicing.eta.gov.eg/documents/credit-note-v1-0/ |
| Debit Note | `D` | `debit-note-v1.0.json` | https://sdk.invoicing.eta.gov.eg/documents/debit-note-v1-0/ |
| Export Invoice | `EI` | `export-invoice-v1.0.json` | https://sdk.invoicing.eta.gov.eg/documents/export-invoice-v1-0/ |
| Export Credit Note | `EC` | `export-credit-note-v1.0.json` | https://sdk.invoicing.eta.gov.eg/documents/export-credit-note-v1-0/ |
| Export Debit Note | `ED` | `export-debit-note-v1.0.json` | https://sdk.invoicing.eta.gov.eg/documents/export-debit-note-v1-0/ |

Shared field definitions live in `_shared-v1.0.json` (issuer, receiver, address,
line, payment, delivery, taxes, signatures).

These schemas drive the **invoice form and local validation**. They do not call
ETA. Live submission still requires credentials later.
