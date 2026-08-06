# Data Model: Business Tax Reports

**Feature**: `014-business-tax-reports` | **Date**: 2026-08-06

## Persistence

No new Prisma models required for MVP. Reports read existing tenant-scoped
tables (FORCE RLS already applied):

| Source | Role |
|--------|------|
| `documents` + `document_lines` + `document_line_taxes` | Sales S1–S4, output VAT, C1/C2/C3 issued side |
| `received_documents` + `received_document_lines` | Purchases P1–P3, input VAT, C1/C2/C3 received side |
| `branches` | Filter labels + C1 per-branch names |
| `permissions` / role grants | `reports.view`, `reports.export` seed rows |

Optional later: `ReportExportJob` mirroring usage export jobs — not required
if sync export streams from memory/MinIO temp object.

## Logical entities (API)

### ReportFilter

| Field | Type | Notes |
|-------|------|-------|
| from / to | date (Cairo) | Inclusive period on issue/received dates |
| branchId | uuid? | Optional |
| currencyCode | string? | Optional single currency |
| perCurrency | boolean | Group without mixing |
| documentKinds | string[]? | Issued and/or received kinds |
| includeNonFinancialStatuses | boolean | Default false |
| showGross | boolean | Default false |
| grain | day\|month | Series reports |
| perBranch | boolean | C1 only |
| limit | number | Top-N rankings |

### NettedMoney

| Field | Meaning |
|-------|---------|
| net | Signed sum after credit/debit netting |
| grossPositive | Optional: invoices+debits |
| creditReduction | Optional: absolute credit/return sum |
| currencyCode | ISO code or `*` when per-currency rows |

### VatBreakdownRow

| Field | Meaning |
|-------|---------|
| taxType | e.g. T1, T4 |
| rate | rate string |
| amount | netted amount |
| category | `vat` \| `withholding` \| `other` |

### NetVatResult (C1)

| Field | Meaning |
|-------|---------|
| period | from/to |
| outputVat | netted T1 sales |
| inputVat | netted T1 purchases |
| netVat | output − input |
| position | `payable` if netVat > 0, `refundable` if < 0, `settled` if 0 |
| withholdingSeparate | T4 (and labeled non-VAT) totals |
| branches[] | optional per-branch same shape + branchId/name |
| total | tenant rollup |

## Netting rules (invariant)

```
signedAmount(doc) = sign(kind) * amount
net = Σ signedAmount
```

C1 identity (same filters):

```
netVat === outputVat(S4 T1 total) − inputVat(P3 T1 total)
```

## Permission seed

| code | description |
|------|-------------|
| reports.view | View business tax reports |
| reports.export | Export report artifacts |

Granted to system roles Owner, Admin, Accountant via ROLE_PERMISSION_MATRIX sync.
