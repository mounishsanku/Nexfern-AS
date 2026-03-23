/**
 * Normalize opening balance row to signed amount for TB (opening + dr - cr).
 * Supports legacy `amount` or explicit debit/credit columns.
 */
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function signedOpeningAmount(ob) {
  if (!ob) return 0;
  const d = Number(ob.debit) || Number(ob.debitAmount) || 0;
  const c = Number(ob.credit) || Number(ob.creditAmount) || 0;
  if (d > 0 || c > 0) return round2(d - c);
  return round2(Number(ob.amount) || 0);
}

/** Closing in debit-minus-credit convention → stored debit/credit columns (≥ 0, mutually exclusive). */
function splitClosingToDebitCredit(closing) {
  const x = round2(closing);
  if (x > 0) return { debit: x, credit: 0 };
  if (x < 0) return { debit: 0, credit: -x };
  return { debit: 0, credit: 0 };
}

module.exports = { signedOpeningAmount, round2, splitClosingToDebitCredit };
