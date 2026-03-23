# Expense Management — Production Upgrade

## Summary

Expense Management has been upgraded with vendor linkage, bill uploads, and recurring expenses.

---

## 1. Vendor Model (`server/src/models/Vendor.js`)

Already existed. Fields:
- **name** (required)
- **email**
- **phone**
- **gstNumber**

---

## 2. Expense Model Updates (`server/src/models/Expense.js`)

| Field | Type | Description |
|-------|------|-------------|
| `vendorId` | ObjectId | Ref Vendor (existing) |
| `billUrl` | String | URL to uploaded bill (PDF/image) |
| `isRecurring` | Boolean | Whether this expense recurs monthly |
| `recurringInterval` | String | `"monthly"` when recurring |
| `recurringSourceId` | ObjectId | For child expenses: ref to template expense |

---

## 3. Bill Upload

**Endpoint:** `POST /api/expenses/upload`

- Accepts PDF and images (jpeg, jpg, png, webp)
- Max 5MB
- Returns `{ url, billUrl }` — store in expense via `billUrl` or `attachmentUrl`

**Backward compatible:** Existing `attachmentUrl` still supported; `billUrl` = `billUrl || attachmentUrl` on create.

---

## 4. Recurring Expense API

**Endpoint:** `POST /api/expenses/run-recurring`

**Logic:**
1. Find expenses with `isRecurring: true`, `recurringInterval: "monthly"`, `recurringSourceId: null` (templates)
2. For each template, check if a child already exists for the current month
3. If not: create duplicate expense with `recurringSourceId = template._id`
4. Create voucher (Dr General Expense, Cr Cash)
5. Create LedgerEntry records

**Response:**
```json
{
  "message": "Created N recurring expense(s)",
  "count": N,
  "expenses": [...]
}
```

Requires active financial year; blocked when year is closed.

---

## 5. Frontend

- **Vendor dropdown** — existing; create new vendor inline
- **Bill upload** — existing; now labeled "Bill (PDF / image)", stored in `billUrl`
- **Recurring toggle** — new checkbox: "Recurring (monthly)"
- **Run Recurring** — new button to trigger `POST /api/expenses/run-recurring`
- **Table** — "Bill" and "Recurring" columns added

---

## Example Flow

1. **Create recurring expense:** Rent, ₹50,000, category: rent, vendor: Landlord, Recurring ✓
2. **Each month:** Click "Run Recurring" → duplicates rent for current month, creates voucher
3. **Bill:** Upload PDF before or after creation; URL stored in `billUrl`

---

## Files Touched

| File | Change |
|------|--------|
| `server/src/models/Expense.js` | Added billUrl, isRecurring, recurringInterval, recurringSourceId |
| `server/src/controllers/expenseController.js` | createExpense accepts new fields; runRecurring handler; upload returns billUrl |
| `server/src/routes/expenseRoutes.js` | POST /run-recurring route |
| `client/src/pages/Expenses.tsx` | Recurring toggle, Run Recurring button, Bill column, Recurring column |
