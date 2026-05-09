# Architecture Documentation

This document describes the core architecture of Nexfern FinanceOS.

## Core Principle
**All financial truth derives from `VoucherEntry` and `buildAccountMap`.**
There is no separate reporting database or duplicated calculation logic. Every report, KPI, and analytics dashboard computes its values by aggregating base-currency voucher entries.

## 1. Accounting Engine Architecture

```mermaid
graph TD
  A[Invoice/Expense/Payment] --> B(VoucherService)
  B --> C{Validation}
  C -->|Valid| D[Voucher]
  D --> E[VoucherEntry 1]
  D --> F[VoucherEntry 2]
  E --> G(Account Balances)
  F --> G
```

## 2. Reconciliation Lifecycle

```mermaid
graph LR
  A[Bank Feed Import] --> B[Normalization]
  B --> C[Reconciliation Engine]
  D[System Transactions] --> C
  C --> E{Matching Rules}
  E --> F[ReconciliationSession]
  F --> G[ReconciliationMatch]
```

## 3. Integration Isolation

External systems NEVER mutate accounting data directly.

```mermaid
graph TD
  A[Webhook] --> B[Integration Adapter]
  B --> C[Normalized Payload]
  C --> D[Business Service]
  D --> E[Voucher Creation]
```

## 4. Analytics Pipeline

```mermaid
graph TD
  A[Analytics Engine] --> B(Report Cache)
  B -->|Miss| C[Report Controller]
  C --> D[Voucher Entries]
```
