# Nexfern FinanceOS Admin Manual

Welcome to the Admin Manual. This guide provides step-by-step instructions for managing the Nexfern FinanceOS platform.

## 1. Entity Setup
1. Navigate to Settings -> Entity Settings.
2. Fill in the Legal Name, Registration Number, and Base Currency.
3. Save changes. This defines the primary entity for accounting.

## 2. Localization & Tax Profiles
1. Go to Settings -> Localization.
2. Select the active localization pack (e.g., India).
3. Set the default tax profiles and region codes (e.g., GSTIN).

## 3. Exchange Rates
1. Navigate to Currencies.
2. Ensure base currency is set correctly.
3. Update exchange rates for foreign currencies regularly.

## 4. Reconciliation Workflow
1. Upload bank statement in Reconcile -> Import.
2. Review suggested matches.
3. Confirm matches and investigate exceptions.

## 5. Backup & Restore
1. Go to Operations -> System Operations.
2. Generate an encrypted backup payload.
3. Store the payload and the encryption key securely.

## 6. Diagnostics
1. Review the System Operations dashboard for health checks.
2. Address any stale caches or broken invariants highlighted by the diagnostics engine.
