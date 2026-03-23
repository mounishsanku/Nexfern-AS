/**
 * @deprecated Use reportController.getCashFlow — cash flow from chart (VoucherEntry).
 * The previous implementation used BankTransaction aggregates only.
 */
const { getCashFlow } = require("./reportController");

module.exports = { getCashflow: getCashFlow };
