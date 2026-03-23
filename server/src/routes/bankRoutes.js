const express = require("express");

const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const {
  createBankAccount,
  getBankAccounts,
  createBankTransaction,
  getBankTransactions,
  markBankTransactionsReconciled,
} = require("../controllers/bankController");
const {
  uploadBankTransactions,
  reconcileBankTransactions,
  manualMatchBankTransaction,
  unmatchBankTransaction,
} = require("../controllers/bankReconciliationController");

const router = express.Router();

// Accounts
router.post("/accounts", requireAuth, roleMiddleware("admin", "accountant"), createBankAccount);
router.get("/accounts", requireAuth, roleMiddleware("admin", "accountant"), getBankAccounts);

// Transactions
router.post(
  "/transactions",
  requireAuth,
  roleMiddleware("admin", "accountant"),
  createBankTransaction,
);
router.get(
  "/transactions",
  requireAuth,
  roleMiddleware("admin", "accountant"),
  getBankTransactions,
);
router.post(
  "/transactions/reconcile",
  requireAuth,
  roleMiddleware("admin", "accountant"),
  markBankTransactionsReconciled,
);

// Reconciliation
router.post(
  "/upload",
  requireAuth,
  roleMiddleware("admin", "accountant"),
  express.text({ type: ["text/csv", "text/plain"] }),
  uploadBankTransactions,
);
router.get(
  "/reconcile",
  requireAuth,
  roleMiddleware("admin", "accountant"),
  reconcileBankTransactions,
);
router.post(
  "/match",
  requireAuth,
  roleMiddleware("admin", "accountant"),
  manualMatchBankTransaction,
);
router.post(
  "/unmatch",
  requireAuth,
  roleMiddleware("admin", "accountant"),
  unmatchBankTransaction,
);

module.exports = router;

