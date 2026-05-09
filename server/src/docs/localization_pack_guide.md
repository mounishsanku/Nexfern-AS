# Localization Pack Extension Guide

## Overview

Nexfern FinanceOS uses a **Localization Registry** pattern to isolate
country-specific accounting rules from the global core engine. Each country
is served by a **Localization Pack** — a self-contained service that implements
a fixed interface.

This guide explains how to add a new country pack (e.g. UK VAT, US Sales Tax,
UAE VAT).

---

## Architecture

```
LocalizationRegistry (singleton)
  └── registered packs by country code
        ├── IN  → IndiaPackService
        ├── GB  → [new: UKPackService]
        └── US  → [new: USPackService]
```

**Key files:**

| File | Role |
|---|---|
| `src/localization/registry/LocalizationRegistry.js` | Singleton registry — call `registry.get("GB")` |
| `src/localization/packs/IndiaPackService.js` | Reference implementation |
| `src/localization/providers/IndiaReportProvider.js` | India GST report generation |
| `src/localization/registry/LocalizationRegistry.js` | `getTaxLiabilityAccount()` abstraction |

---

## Step 1 — Create the Pack Service

Create `src/localization/packs/<CountryCode>PackService.js`.

Implement the following interface exactly:

```js
class GBPackService {
  /**
   * Validate invoice payload for UK VAT rules.
   * Throw if invalid. Return void if valid.
   */
  async validateInvoice(invoiceData, entity) {
    // e.g. check VAT number format, supply chain rules
  }

  /**
   * Calculate tax for the invoice.
   * Must return: { cgst: 0, sgst: 0, igst: 0, vat: Number, totalTax: Number, taxLines: [] }
   */
  async calculateTax(invoiceData, entity) {
    const vatRate = invoiceData.vatRate ?? 20; // UK standard 20%
    const vat = Math.round((invoiceData.amount * vatRate / 100) * 100) / 100;
    return {
      cgst: 0, sgst: 0, igst: 0,
      vat,
      totalTax: vat,
      taxLines: [{ type: "VAT", rate: vatRate, amount: vat }],
    };
  }

  /**
   * Return the GL account name for the tax liability posting.
   * Used by voucherService and diagnostics to avoid hardcoding.
   */
  getTaxLiabilityAccount() {
    return "VAT Payable";
  }
}

module.exports = GBPackService;
```

---

## Step 2 — Register the Pack

Open `src/localization/registry/LocalizationRegistry.js` and register your pack:

```js
const GBPackService = require("../packs/GBPackService");

// Inside the registry constructor or init() call:
this.register("GB", new GBPackService());
```

---

## Step 3 — Create a Report Provider (optional)

If the country has statutory reports (VAT Return, EC Sales List, etc.):

1. Create `src/localization/providers/GBReportProvider.js`
2. Implement `generate(entityId, financialYearId, reportType, filters)` → structured JSON
3. Reference the report helpers in `src/controllers/reportsController.js`

---

## Step 4 — Seed the Entity

When onboarding a UK entity:

```json
POST /api/localization-admin/entities
{
  "name": "Acme Ltd",
  "country": "GB",
  "baseCurrency": "GBP"
}
```

The localization engine will automatically route to `GBPackService` based on `entity.country`.

---

## Step 5 — Test

Add a test suite at `tests/unit/<countryCode>Pack.test.js`:

```js
const GBPackService = require('../../src/localization/packs/GBPackService');
const pack = new GBPackService();

test('calculates 20% UK VAT correctly', async () => {
  const result = await pack.calculateTax({ amount: 1000, vatRate: 20 }, {});
  expect(result.totalTax).toBe(200);
  expect(result.taxLines[0].type).toBe('VAT');
});

test('getTaxLiabilityAccount returns VAT Payable', () => {
  expect(pack.getTaxLiabilityAccount()).toBe('VAT Payable');
});
```

---

## Key Rules

> [!IMPORTANT]
> - Never hardcode currency strings (`"INR"`, `"GBP"`) in core services.
> - Always use `LocalizationRegistry.getTaxLiabilityAccount()` for GL account lookups.
> - `calculateTax()` must always return `{ cgst, sgst, igst, totalTax, taxLines }` — fields not applicable to the country should be `0` or `[]`.
> - All monetary arithmetic must use `Math.round(val * 100) / 100`.

---

## Currently Registered Packs

| Country | Pack | Tax Regime |
|---|---|---|
| `IN` | `IndiaPackService` | GST (CGST+SGST / IGST) |
