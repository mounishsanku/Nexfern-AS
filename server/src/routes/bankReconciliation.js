const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

const BankStatement = require("../models/BankStatement");
const BankTransaction = require("../models/BankTransaction");

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

router.use(requireAuth);

// POST /api/bank/statement  — create a bank statement entry
router.post("/statement", async (req, res) => {
  try {
    const statement = new BankStatement(req.body);
    await statement.save();
    res.status(201).json(statement);
  } catch (err) {
    return sendStructuredError(res, {
      status: 400,
      code: "VALIDATION_ERROR",
      message: err?.message || "Invalid request",
      action: ACTION.FIX_REQUIRED,
    });
  }
});

// GET /api/bank/reconciliation  — match statements against transactions
router.get("/reconciliation", async (req, res) => {
  try {
    const statements = await BankStatement.find();
    // Fetch ALL transactions — do not filter by isMatched so that legacy
    // records that never had the field are still considered.
    const transactions = await BankTransaction.find();

    const matched = [];
    const unmatched = [];

    // Work on plain objects; guard against double-matching within one run.
    const availableTx = transactions.map((tx) => tx.toObject({ getters: true }));
    const matchedTxIds = new Set();

    for (const stmt of statements) {
      // Skip statements already reconciled in a previous run
      if (stmt.isMatched) {
        matched.push({ statement: stmt, transaction: null });
        continue;
      }

      let foundTx = null;

      for (let i = 0; i < availableTx.length; i++) {
        const tx = availableTx[i];
        if (matchedTxIds.has(tx._id.toString())) continue;

        // Use tx.date if present, otherwise fall back to createdAt
        const txDate = tx.date || tx.createdAt;

        const isMatch =
          stmt.amount === tx.amount &&
          stmt.type === tx.type &&
          Math.abs(new Date(txDate) - new Date(stmt.date)) <= TWO_DAYS_MS &&
          (tx.isMatched === false || tx.isMatched === undefined);

        if (isMatch) {
          foundTx = tx;
          break;
        }
      }

      if (foundTx) {
        matchedTxIds.add(foundTx._id.toString());

        // Persist matched flags on both sides
        stmt.isMatched = true;
        await BankStatement.findByIdAndUpdate(stmt._id, { isMatched: true });
        await BankTransaction.findByIdAndUpdate(foundTx._id, { isMatched: true });

        matched.push({
          statement: { ...stmt.toObject(), isMatched: true },
          transaction: { ...foundTx, isMatched: true },
        });
      } else {
        unmatched.push(stmt);
      }
    }

    res.json({ matched, unmatched });
  } catch (err) {
    return sendStructuredError(res, {
      status: 503,
      code: "BANK_RECONCILIATION_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
      details: err?.message ? { reason: String(err.message) } : undefined,
    });
  }
});

module.exports = router;
