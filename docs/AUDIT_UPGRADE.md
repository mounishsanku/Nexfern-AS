# Audit System — Production Upgrade

## Summary

The Audit Trail has been upgraded for compliance and tamper-resistance.

---

## 1. Immutability

**AuditLog is append-only.**

- Mongoose pre-hooks block: `updateOne`, `findOneAndUpdate`, `updateMany`, `replaceOne`, `deleteOne`, `findOneAndDelete`, `deleteMany`
- `save()` on existing documents is blocked
- Only `AuditLog.create()` is allowed

---

## 2. Standardized Actions

Use only these actions for new logs:

- **CREATE**
- **UPDATE**
- **DELETE**
- **LOGIN**

Existing logs keep legacy action names (e.g. `CREATE_INVOICE`); they are not modified.

---

## 3. Before / After Data

Metadata uses:

```json
{
  "before": { /* state before change */ },
  "after":  { /* state after change, or null for DELETE */ }
}
```

- **CREATE**: `before: null`, `after: { ... }`
- **UPDATE**: `before: { ... }`, `after: { ... }`
- **DELETE**: `before: { ... }`, `after: null`
- **LOGIN**: `before: null`, `after: { userId, email }`

---

## 4. Tracked Operations

| Entity   | CREATE | UPDATE                         | DELETE                                  |
|----------|--------|--------------------------------|-----------------------------------------|
| Invoice  | ✓      | ✓ (status only)                | ✓ (only if no payments)                 |
| Expense  | ✓      | ✓ (title, category, vendorId)  | ✓                                       |
| Payment  | ✓      | ✓ (reference only)             | ✓ (with reversal voucher + ledger)      |
| Voucher  | ✓      | —                              | —                                       |
| Revenue  | ✓      | —                              | —                                       |
| Auth     | —      | —                              | — (LOGIN only)                          |

---

## 5. Login Tracking

- Action: **LOGIN**
- Entity: **auth**
- Metadata: `{ before: null, after: { userId, email } }`

---

## 6. Access Control

Audit logs are restricted to:

- **admin**
- **auditor**

---

## API Endpoints

| Method | Path                 | Purpose          |
|--------|----------------------|------------------|
| PUT    | /api/invoices/:id    | Update status    |
| DELETE | /api/invoices/:id    | Delete (no payments) |
| PUT    | /api/expenses/:id    | Update expense   |
| DELETE | /api/expenses/:id    | Delete expense   |
| PUT    | /api/payments/by-id/:id | Update reference |
| DELETE | /api/payments/by-id/:id | Delete payment (with reversal) |

---

## Helper

```js
const { logAction, logActionFromReq, buildMetadata, ACTIONS } = require("../utils/audit");

await logAction(userId, ACTIONS.CREATE, "invoice", doc._id, buildMetadata(null, { ... }));
await logAction(userId, ACTIONS.UPDATE, "expense", doc._id, buildMetadata(before, after));
await logAction(userId, ACTIONS.DELETE, "payment", doc._id, buildMetadata(before, null));
```
