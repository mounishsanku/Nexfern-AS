const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const { getReports, getGstReport, exportGstr1, exportGstr3b, exportGstr1Csv, exportGstr3bCsv } = require("../controllers/reportsController");

const {
  getTrialBalance,
  getLedgerByAccount,
  exportTrialBalanceCsv,
  exportLedgerCsv,
  getProfitLoss,
  getRevenueSplit,
  getDepartmentSummary,
  getCashFlow,
  getBalanceSheet,
} = require("../controllers/reportController");

const router = express.Router();
const guard  = [requireAuth, roleMiddleware("admin", "accountant")];

router.get("/",             ...guard, getReports);
router.get("/pnl",          ...guard, getProfitLoss);
router.get("/gst",          ...guard, getGstReport);
router.get("/balance-sheet",...guard, getBalanceSheet);
router.get("/cashflow",     ...guard, getCashFlow);

router.get("/trial-balance/csv",        ...guard, exportTrialBalanceCsv);
router.get("/ledger/:account/csv",      ...guard, exportLedgerCsv);
router.get("/trial-balance",            ...guard, getTrialBalance);
router.get("/profit-loss",              ...guard, getProfitLoss);
router.get("/revenue-split",            ...guard, getRevenueSplit);
router.get("/department-summary",       ...guard, getDepartmentSummary);
router.get("/cash-flow",                ...guard, getCashFlow);
router.get("/accounting-balance-sheet", ...guard, getBalanceSheet);
router.get("/ledger/:account",          ...guard, getLedgerByAccount);

// ── GST Export Routes ────────────────────────────────────────────────────────
router.get("/gst/export/gstr1",      ...guard, exportGstr1);
router.get("/gst/export/gstr3b",     ...guard, exportGstr3b);
router.get("/gst/export/gstr1/csv",  ...guard, exportGstr1Csv);
router.get("/gst/export/gstr3b/csv", ...guard, exportGstr3bCsv);

module.exports = router;
