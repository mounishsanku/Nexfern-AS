# Standard Operating Procedures (SOPs)

## 1. Month-End Close
1. Ensure all bank transactions for the month are reconciled.
2. Review Payables and Receivables aging reports.
3. Run full system diagnostics and resolve any warnings.
4. Export the Trial Balance and verify balances.
5. Optionally lock the period (if implemented).

## 2. Year-End Close
1. Complete all Month-End procedures for the last month.
2. Ensure all adjusting entries (e.g., depreciation) are booked.
3. Create a new Financial Year in the system.
4. Review opening balances for the new year.

## 3. Incident Response
- If diagnostics report an invariant failure:
  1. Check the Incident Log in the System Operations dashboard.
  2. Identify the source of the anomaly.
  3. Contact support or use the auto-heal feature if available.

## 4. Disaster Recovery
1. Retrieve the latest encrypted backup payload.
2. Ensure the `BACKUP_ENCRYPTION_KEY` is available.
3. Run the restore simulation script.
4. If successful, apply the restore to the production database.
5. Run full system diagnostics to verify integrity.
