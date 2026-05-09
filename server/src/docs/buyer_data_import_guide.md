# Buyer’s Guide: Data Portability & Bulk Import Infrastructure

## Overview
Nexfern FinanceOS is designed for seamless enterprise migration and day-to-day high-volume data operations. Our **Excel Import Engine** provides a robust, fail-safe mechanism for migrating historical data (Invoices, Expenses) and bulk-onboarding master data (Customers, Vendors).

---

## Key Capabilities

### 1. Multi-Entity Data Routing
Imports are strictly partitioned by **Entity**. The system ensures that data uploaded for one legal entity (e.g., Nexfern India) never leaks into another (e.g., Nexfern UAE), even during bulk operations.

### 2. Transactional Atomicity (ACID Compliance)
Unlike simple import tools that leave your ledger in a "partial" state if a row fails midway, Nexfern uses **Atomic Commits**. 
- If you import 1,000 invoices and the 999th row fails validation at the database level, the **entire batch is rolled back**.
- This guarantees that your accounting books are never out of balance due to a technical glitch or malformed data.

### 3. "Preview-First" Validation Logic
The engine runs a comprehensive pre-flight check before any data touches the permanent ledger:
- **Schema Validation**: Ensures required fields (Amounts, Dates, IDs) are present.
- **Business Logic Checks**: Verifies if Customers/Vendors exist, checks for duplicate records, and validates Financial Year boundaries.
- **UI Highlighting**: The frontend provides a clear list of row-level errors, allowing users to fix their spreadsheets and re-upload before execution.

---

## Supported Import Types

| Module | Purpose | Impact |
|---|---|---|
| **Invoices** | Historical billing or monthly bulk uploads | Generates ledger entries, updates AR, syncs with revenue recognition. |
| **Expenses** | Payroll reimbursements or vendor bills | Updates AP, allocates to cost centers/departments. |
| **Customers** | CRM migration / Master data | Onboards clients with GST/Tax details. |
| **Vendors** | Supplier onboarding | Onboards vendors with payment and tax profiles. |
| **Payments** | Settlement tracking | Links payments to invoices, updates AR/AP status. |

---

## Tally ERP 9 / Tally Prime Integration
Nexfern provides a direct migration path for Tally users via our **Tally XML Parser**:
- **Automatic Mapping**: Simply export `List of Accounts` or `Daybook` as XML from Tally.
- **Smart Linking**: The engine automatically matches Tally "Party Names" to Nexfern Customers and links "Against Ref" payments to the correct invoices.
- **Master Data Sync**: Imports Ledgers, Groups, and contact details directly from Tally's internal XML structure.

---

## Technical Performance & Limits
The engine is optimized for high-performance parsing:
- **Maximum Batch Size**: 5,000 rows per file.
- **File Limit**: 20MB (.xlsx, .xls, .csv, .xml).
- **Security**: All uploads are sanitized and scanned. Row-level error logging provides exact field-level feedback (e.g., "Row 42: invalid GSTIN format").

---

## Compliance & Audit Trail
Every import creates a permanent `ImportJob` record, capturing:
- Who uploaded the file.
- When it was executed.
- The original file name.
- Summary of successes vs. failures.
- Detailed error logs for failed attempts.

This ensures that any data correction in the system can be traced back to the source file and the responsible administrator.
