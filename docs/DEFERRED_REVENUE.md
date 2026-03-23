# Deferred Revenue — Implementation Summary

## Overview

Nexfern FinanceOS now supports **deferred revenue** recognition over time. Revenue from invoices can be spread across multiple months instead of being recognized at invoice creation.

**Example:** ₹9,000 invoice over 3 months → ₹3,000/month recognized.

---

## 1. Invoice Model (`server/src/models/Invoice.js`)

New fields:

| Field             | Type    | Default | Description                          |
|-------------------|---------|---------|--------------------------------------|
| `isDeferred`      | Boolean | false   | Whether revenue is deferred          |
| `deferredMonths`  | Number  | null    | Number of months to spread revenue   |
| `recognizedRevenue` | Number | 0       | Cumulative amount already recognized |

---

## 2. Revenue Schedule Model (`server/src/models/RevenueSchedule.js`)

| Field       | Type     | Description                          |
|-------------|----------|--------------------------------------|
| invoiceId   | ObjectId | Reference to Invoice                 |
| date        | Date     | Recognition due date (1st of month)  |
| amount      | Number   | Amount to recognize on that date     |
| isRecognized| Boolean  | Whether this schedule has been recognized |

---

## 3. Invoice Creation Flow

**Regular invoice** (existing logic, unchanged):
- Dr Accounts Receivable  
- Cr Revenue  
- Cr GST Payable (if GST)

**Deferred invoice** (new logic):
- Dr Accounts Receivable  
- Cr **Deferred Revenue** (base amount only)  
- Cr GST Payable (if GST)
- Create `RevenueSchedule` records: split base amount into monthly entries

---

## 4. Revenue Recognition API

**Endpoint:** `POST /api/revenue/recognize`

**Logic:**
1. Find schedules where `date <= today` and `isRecognized = false`
2. Mark them as `isRecognized = true`
3. Create voucher: **Dr Deferred Revenue, Cr Revenue**
4. Update `invoice.recognizedRevenue` for affected invoices

**Response example:**
```json
{
  "message": "Revenue recognized",
  "recognized": 3000,
  "scheduleCount": 1,
  "voucherId": "..."
}
```

---

## 5. Report Impact

- **Profit & Loss:** Uses voucher-based `Revenue` account → only recognized revenue appears
- **Balance Sheet:** `Deferred Revenue` is a liability → unrecognized amount shows under liabilities (in `other`)

---

## 6. Frontend

**Invoice Create Form:**
- Toggle: **Deferred Revenue**
- Input: **Months** (when toggle is on)

**Reports > Profit & Loss:**
- **Recognize Revenue** button — runs recognition for due schedules

---

## Example Flow

1. Create deferred invoice: ₹9,000 base, 18% GST, 3 months  
   - Total: ₹10,620  
   - Voucher: Dr A/R ₹10,620, Cr Deferred Revenue ₹9,000, Cr GST Payable ₹1,620  
   - RevenueSchedule: 3 records of ₹3,000 each (Feb 1, Mar 1, Apr 1)

2. Month 1 (Feb 1): Run **Recognize Revenue**  
   - ₹3,000 recognized  
   - Voucher: Dr Deferred Revenue ₹3,000, Cr Revenue ₹3,000

3. Month 2 (Mar 1): Run **Recognize Revenue**  
   - ₹3,000 recognized

4. Month 3 (Apr 1): Run **Recognize Revenue**  
   - ₹3,000 recognized

5. After all recognitions: `recognizedRevenue = 9000`, Deferred Revenue balance = 0

---

## Files Touched

| File | Change |
|------|--------|
| `server/src/models/Invoice.js` | Added `isDeferred`, `deferredMonths`, `recognizedRevenue` |
| `server/src/models/RevenueSchedule.js` | **New** |
| `server/src/controllers/accountController.js` | Added "Deferred Revenue" to DEFAULT_ACCOUNTS |
| `server/src/services/voucherService.js` | `createVoucherForDeferredInvoice`, `createVoucherForRevenueRecognition` |
| `server/src/controllers/invoiceController.js` | Branch for deferred invoices, create schedules |
| `server/src/controllers/revenueController.js` | **New** — recognize, getSchedules |
| `server/src/routes/revenueRoutes.js` | **New** |
| `server/src/index.js` | Mount `/api/revenue` |
| `client/src/pages/Invoices.tsx` | Deferred toggle + months input |
| `client/src/pages/Reports.tsx` | Deferred Revenue recognition card |

---

## Constraints

- Existing invoice logic unchanged  
- GST and voucher system intact  
- Revenue recognition requires active financial year
