# Support & Troubleshooting

## 1. Diagnostics Errors
- **`ACCOUNTING_INVARIANT_BANK_GL`**: The bank operational balance doesn't match the general ledger balance. Run the auto-heal tool or manually reconcile.
- **`SYSTEM_STATE_UNHEALABLE`**: Contact Level 2 support. Manual database intervention required.

## 2. Reconciliation Mismatches
- If imported transactions do not match existing vouchers, check the date ranges and amounts. Ensure the correct exchange rates were applied for multi-currency transactions.

## 3. Startup Failures
- **`ENV_VALIDATION_FAILED`**: A critical environment variable is missing. Check `.env`.

## 4. Webhook Failures
- If the system reports repeated webhook failures, check the provider dashboard (e.g., Stripe/Razorpay) for details on the payload rejection.

## 5. Rate Limiting
- Wait 15 minutes if locked out due to `RATE_LIMIT_EXCEEDED` on auth routes.
