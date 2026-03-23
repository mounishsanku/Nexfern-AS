# FinanceOS — system diagnostics

## API

- **`GET /api/system/diagnostics`** (auth: admin, accountant, auditor)  
  Read-only scan: voucher balance, orphans, missing `accountId`, FY gaps, negative bank balances, balance-sheet equation (voucher-based), duplicate bank matches, dual ledger notice.

- **`GET /api/system/diagnostics?fix=1`**  
  Same scan, plus **safe normalization only**: trims leading/trailing whitespace on **expense `category`** (max 5000 rows per run).  
  Does **not** delete data, rewrite vouchers, or change amounts.

## UI

- **`/diagnostics`** — same data as the API (Nexfern client).

## Payroll API (backward compatible)

- **`GET /api/payroll/summary`** now includes:
  - `payslipCount` — payslips matching the month filter
  - `activeEmployeeCount` — employees with `isActive: true`
  - `totalEmployees` — still the payslip count (legacy); prefer `payslipCount` for new code

## Manual bank match guard

- **`POST /api/bank/match`** rejects matching if the bank line or payment is already matched, or if the payment is already linked to another bank statement line.

## Remaining architectural notes

- **`/api/trial-balance`** (legacy) uses **LedgerEntry**; **`/api/reports/trial-balance`** uses **VoucherEntry**. If both have rows, numbers may differ — diagnostics flags this.
- **Canonical reports** for CFO views should use voucher-based routes under `/api/reports/*` and dashboard summary.

## Full reset (destructive)

- Use `scripts/resetFinancialData.js` only after backup — see script header.
