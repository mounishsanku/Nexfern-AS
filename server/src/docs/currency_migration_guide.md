# Currency-Aware Invoices: Post-Migration Guide

## Context

As of Phase 15, Nexfern FinanceOS no longer applies a hardcoded `INR` default
to invoice, expense, or entity records at the Mongoose schema level.

This guide explains what changed, what existing data looks like, and what
operators and developers need to do.

---

## What Changed

| Area | Before | After |
|---|---|---|
| `Invoice.currency` | Defaulted to `"INR"` if omitted | `null` unless caller supplies it or `entityId` is resolved |
| `Entity.country` | Defaulted to `"IN"` if omitted | **Required** — no default |
| `Entity.baseCurrency` | Defaulted to `"INR"` if omitted | **Required** — no default |
| `CompanySettings.defaultCurrency` | Defaulted to `"INR"` | No server default |
| Invoice creation (no localization) | Used `"INR"` fallback | Derives from `Entity.baseCurrency`; `null` if no entity |

---

## Existing Data: Is Anything Broken?

**No.** Removing a Mongoose schema `default` only affects **new** documents.
All existing records already have their field values stored in MongoDB.
They are unaffected.

You can verify with:

```js
db.invoices.countDocuments({ currency: { $exists: false } })
db.invoices.countDocuments({ currency: null })
db.entities.countDocuments({ country: { $exists: false } })
```

If either count is > 0, run the standardisation script below.

---

## Standardisation Script (run once, optional)

```js
// Standardise null/missing currency on invoices to entity baseCurrency.
// Run in mongosh or as a migration script — not in application code.

const entities = await db.entities.find({}).toArray();
const currencyMap = Object.fromEntries(entities.map(e => [e._id.toString(), e.baseCurrency]));

await db.invoices.find({ $or: [{ currency: null }, { currency: { $exists: false } }] }).forEach(inv => {
  const currency = currencyMap[inv.entityId?.toString()] ?? null;
  if (currency) {
    db.invoices.updateOne({ _id: inv._id }, { $set: { currency } });
  }
});
```

---

## New Entity Creation Requirements

All new entities **must** supply `country` and `baseCurrency`:

```json
POST /api/localization-admin/entities
{
  "name": "Acme GmbH",
  "country": "DE",
  "baseCurrency": "EUR"
}
```

Omitting either field returns `HTTP 400 ValidationError`.

---

## Invoice Creation — Currency Resolution Order

1. Caller explicitly sets `currency` in payload → used as-is
2. `currency` omitted + `entityId` provided → resolved from `Entity.baseCurrency`
3. `currency` omitted + no `entityId` → `currency` stored as `null`

**Recommendation:** Always pass `currency` explicitly in API calls for clarity.

---

## API Contract Update

The OpenAPI spec (`src/docs/openapi.yaml`) has been updated:

- `InvoiceCreate.currency` — no default, `example: INR`
- `InvoiceCreate.gstType` — free-form string (not enum-constrained)
- `EntityCreate.country` — required, no default
- `EntityCreate.baseCurrency` — required, no default

---

## Excel Bulk Import — Supported Types

As of Phase 16, the Import Engine supports four types:

| Type | Required Fields | Notes |
|---|---|---|
| `invoice` | `customerId`, `amount` | Requires active FY; currency derived from entity if omitted |
| `expense` | `title`, `amount`, `category`, `date` | Requires active FY |
| `customer` | `name` | Email format validated; duplicates blocked |
| `vendor` | `name` | Duplicates blocked by name (case-insensitive) |

### Download Templates

```
GET /api/import/template/invoice
GET /api/import/template/expense
GET /api/import/template/customer
GET /api/import/template/vendor
```

### Import Flow

1. `POST /api/import/upload` — parse + validate (returns job with status `ready` or `failed`)
2. `GET /api/import/preview/:jobId` — review preview data + row errors
3. `POST /api/import/execute/:jobId` — atomic commit (all-or-nothing)

### Batch Limits

- Maximum rows per import: **5,000**
- Maximum file size: **20 MB**
- Formats: `.xlsx`, `.xls`, `.csv`
