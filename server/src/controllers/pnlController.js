/**
 * @deprecated Use reportController.getProfitLoss — P&L is derived from VoucherEntry only.
 */
const { getProfitLoss } = require("./reportController");

module.exports = { getPnl: getProfitLoss };
