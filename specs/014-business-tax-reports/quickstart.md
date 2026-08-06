# Quickstart: Business Tax Reports

## Prerequisites

- API + web running with a tenant that has VALID issued docs and Valid received docs
- User role Owner, Admin, or Accountant (reports.view / reports.export)

## Manual check

1. Open `/{locale}/reports` — see Sales / Purchases / Combined catalog.
2. Open **C1 NET VAT**; set a period that includes invoices **and** credit/debit notes.
3. Confirm components: output VAT, input VAT, net, payable/refundable; T4 not inside net.
4. Enable **per-branch**; branch nets sum to tenant net.
5. Open **S1**; confirm netted sales = invoices − credits + debits.
6. Export C1 as CSV and PDF; totals match on-screen.

## Automated acceptance

```bash
# From repo root (API tests)
pnpm --filter @einvoice/api test -- reports.netting-sales
pnpm --filter @einvoice/api test -- reports.net-vat
```

Expected:
- S1 net equals hand-calculated invoices − credit + debit
- C1.netVat === S4.outputVatT1 − P3.inputVatT1 for the same filters
- Cross-tenant report returns empty / forbidden for other tenant data
- Report endpoints do not UPDATE documents
