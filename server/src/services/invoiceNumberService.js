const FinancialYear = require("../models/FinancialYear");

/**
 * Allocate next human-readable invoice number for a financial year: INV-{YYYY}-{NNNN}
 * @param {import("mongoose").Types.ObjectId|string|null} financialYearId
 * @returns {Promise<string>}
 */
async function allocateNextInvoiceNumber(financialYearId, session = null) {
  if (!financialYearId) {
    const y = new Date().getUTCFullYear();
    const r = Math.floor(Math.random() * 9000) + 1000;
    return `INV-${y}-N-${r}`;
  }

  let q = FinancialYear.findByIdAndUpdate(
    financialYearId,
    { $inc: { nextInvoiceSequence: 1 } },
    { returnDocument: "after" },
  );
  if (session) q = q.session(session);
  const fy = await q.lean();

  if (!fy) {
    const y = new Date().getUTCFullYear();
    const r = Math.floor(Math.random() * 9000) + 1000;
    return `INV-${y}-N-${r}`;
  }

  const year = new Date(fy.startDate).getUTCFullYear();
  const seq = String(fy.nextInvoiceSequence).padStart(4, "0");
  return `INV-${year}-${seq}`;
}

module.exports = { allocateNextInvoiceNumber };
