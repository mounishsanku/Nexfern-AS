/**
 * BankFeedAdapter.js — Foundation for bank feed normalization.
 *
 * SAFETY RULES (enforced):
 *  - Does NOT auto-post or auto-reconcile entries.
 *  - Provides normalized structures for the reconciliation engine to consume.
 *
 * Status: Phase 9 — normalization foundation. Live sync in future phase.
 */

class BankFeedAdapter {
  static get providerName() {
    return "bank-feed";
  }

  /**
   * Parses a raw CSV row into a normalized bank transaction structure.
   * Returns a normalized object ready for reconciliation review — NOT auto-posted.
   *
   * @param {object} row - Raw parsed CSV row (key-value pairs)
   * @param {string} accountId - Associated bank account ID
   */
  static normalizeTransaction(row, accountId) {
    const amount = parseFloat(row.amount || row.Amount || row.AMOUNT || "0");
    const date = row.date || row.Date || row.DATE || row.transaction_date;
    const description = row.description || row.Description || row.NARRATION || row.narration || "";
    const type = amount >= 0 ? "credit" : "debit";

    return {
      provider: "bank-feed",
      accountId,
      date: date ? new Date(date) : null,
      description,
      amount: Math.abs(amount),
      type,
      referenceNumber: row.reference || row.cheque_number || row.ref_no || null,
      rawRow: row,
      normalized: true,
      autoPosted: false, // ALWAYS false — reconciliation engine decides posting
    };
  }

  /**
   * Parses an array of CSV rows into normalized transactions.
   * @param {object[]} rows - Parsed CSV rows
   * @param {string} accountId - Bank account ID
   */
  static normalizeTransactionBatch(rows, accountId) {
    return rows
      .filter((row) => row && (row.amount || row.Amount || row.AMOUNT))
      .map((row) => BankFeedAdapter.normalizeTransaction(row, accountId));
  }

  /**
   * Validates a normalized transaction before handing to reconciliation engine.
   */
  static validate(normalizedTx) {
    const errors = [];
    if (!normalizedTx.date) errors.push("Missing date");
    if (!normalizedTx.amount || isNaN(normalizedTx.amount)) errors.push("Invalid amount");
    if (!normalizedTx.accountId) errors.push("Missing accountId");
    return { valid: errors.length === 0, errors };
  }
}

module.exports = BankFeedAdapter;
